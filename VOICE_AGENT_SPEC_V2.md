# Browser Voice Agent for Sales Role-play: Review Notes and Spec v2 Changes

**Purpose of this file:** hand to a second reviewer (human or LLM) together with the original spec ("In-Browser Voice Agent for Sales Simulation & Roleplay"). It states the confirmed requirements, what is and isn't achievable, and a concrete change list against the original. The final section lists the claims I'm least sure of. Please try to break them.

Items marked **[verify]** are from memory and not checked against live docs or measured.

---

## 0. Confirmed requirements (these override the original spec's assumptions)

| Topic | Answer from product owner | Consequence |
|---|---|---|
| Languages | **Hindi + English, including code-mixed Hinglish** | Dominant risk. Small on-device LLMs, Kokoro-class TTS and single-language browser STT are all weak here. |
| Call length | **Up to 30 minutes** | Needs context management, session resilience, crash recovery and thermal and battery handling. The original spec ignores all of this. |
| Privacy / IT policy | **Not a concern.** Customers are startups and SMBs, with simulated data only. Cloud speech APIs are fine. | The "100% on-device, HIPAA/SOC2" framing can be dropped. Cloud STT/TTS and even a cloud LLM are allowed. |
| Backend | Don't want to build one for **agent progress** | Store progress locally (IndexedDB) and offer export. A thin serverless proxy for an LLM key is not the same thing and is discussed below. |
| Target hardware | Windows, Intel i7/i9, **8 GB RAM possible**, integrated GPU likely | See §2. |

**Key insight:** the original design chose on-device everything for privacy and cost. With privacy removed as a driver, on-device inference is justified only by "no server to run". It also fits worst with Hindi quality and 8 GB machines. The v2 design therefore treats the LLM, STT and TTS as swappable providers. The default is chosen by capability and quality, not ideology.

---

## 1. Feasibility: what is and isn't possible

### Possible (high confidence)
- Voice loop in Chrome/Edge: Web Speech API for STT (`hi-IN`, `en-IN`), streamed LLM, sentence-chunked TTS.
- Hindi and English TTS using browser voices. Edge on Windows ships natural online voices for `hi-IN` and `en-IN` **[verify the exact voice list]**.
- Barge-in using **interim** STT results as the trigger. This is simpler than a VAD and good enough for a first version.
- 30-minute calls, provided context is managed (§4.3) and session state is autosaved.
- Local progress storage, transcripts, heuristic scorecards and JSON/CSV export with no backend.
- Static hosting with no servers to run.

### Possible but with conditions
- **On-device LLM on 8 GB Windows Intel iGPU laptops.** Only a 0.5B-class model (≈1 GB GPU memory), and only for English or light Hinglish. The 1.5B model risks tab crashes next to Teams/Outlook **[verify with measurement]**.
- **Code-mixed Hinglish STT.** `SpeechRecognition.lang` takes one language per session.
  - `hi-IN` handles English words inside Hindi sentences acceptably but inconsistently in script.
  - `en-IN` handles Hindi words poorly.
  - Expect a language toggle, or a cloud STT with multilingual / code-switching support (for example Deepgram or Sarvam, called from the browser with a short-lived token). **[verify current offerings]**
- **Natural Hinglish TTS.** Best available zero-cost option is a Microsoft `en-IN`/`hi-IN` voice in Edge. Quality varies by browser and OS, so voice selection must be runtime and per-language.

### Not realistic / not recommended
- Good-quality Hindi or Hinglish role-play from a **0.5B–1.5B** on-device model. Expect broken grammar, English drift and persona loss. A cloud LLM or an on-device ≥4B model is needed, and a 4B is too big for 8 GB iGPU laptops.
- Kokoro (or any ~80M on-device TTS) for natural code-mixed Hinglish. Hindi voices exist **[verify]**, but mixed-script text is mispronounced.
- Sub-second turnaround on 8 GB iGPU laptops with an on-device LLM. Realistic first audio is 1.5–3 s.
- Reliable barge-in with **speakers** (no headphones). The mic hears the agent. Use headphones, or fall back to half-duplex (mic muted while the agent speaks).
- Fully offline operation if Web Speech is used. It needs a network connection.
- Firefox support. There is no Web Speech STT, and Safari is partial.
- Trustworthy automated grading from a tiny on-device model. Use heuristics, or a cloud LLM at end of call.
- A zero-server design that is also "free". A key-holding proxy or per-user cost exists as soon as a cloud LLM is used (§3).

### Revised confidence (my estimate, not measured)

| Scenario | Confidence it works acceptably |
|---|---|
| English-only, on-device 0.5B, 8 GB Intel iGPU | ~55–60% |
| English-only, on-device 1.5B, 16 GB Intel Iris Xe or newer | ~75–80% |
| **Hindi+English quality target, fully on-device, 8 GB** | **~20–30%** |
| Hindi+English, cloud LLM + browser STT/TTS, any hardware | ~80–85% |
| Hybrid (auto-select cloud vs on-device) | ~80–85%, best coverage |

---

## 2. Hardware reality (Windows, Intel i7/i9, 8 GB)

- CPU tier is almost irrelevant. **Integrated GPU generation, RAM size and memory channel count** decide the outcome.
- 11th gen+ (Iris Xe / Arc) is usable. 8th–10th gen UHD 620/630 is marginal, and some drivers are blocked from WebGPU.
- 8 GB leaves about 2–3 GB free after the OS, Chrome and Teams. The iGPU draws from that same pool.
- Many 8 GB laptops are single-channel RAM. Decode speed is memory-bandwidth-bound, so expect roughly 5–12 tok/s on a 1.5B model there, versus 15–25 on dual-channel **[verify by measuring]**.
- Sustained decode over 30 minutes can thermal-throttle thin laptops, so speed drops during the call.
- `navigator.deviceMemory` caps at 8, so it can't distinguish 8 GB from 16 GB. Use a runtime benchmark instead.
- Required WebGPU check: `adapter.features.has("shader-f16")`. Without it, q4f16 models fail, so use `q4f32_1` variants or the cloud provider.

---

## 3. Recommended architecture (v2)

```
Mic ─► STT provider ──► Turn manager ──► LLM provider (streams tokens)
        │  (Web Speech default;           │            │
        │   cloud STT optional)           │            ▼
        │                                 │      Sentence splitter (. ! ? । \n)
        ▼                                 │            │
  Interim-result barge-in ◄───────────────┘            ▼
        │                                       TTS provider queue
        └──► cancel: LLM stream + TTS queue      (speechSynthesis default;
                                                  cloud TTS or Kokoro optional)
Session store (IndexedDB): transcript, scorecard, resume state; export JSON/CSV
```

### Provider matrix

| Layer | Default | Upgrade | Offline / fallback |
|---|---|---|---|
| STT | Web Speech API (Chrome/Edge), `hi-IN` or `en-IN` toggle | Cloud multilingual STT via short-lived token | Whisper-small/Moonshine via `@huggingface/transformers` v3 (English-centric for Moonshine) |
| LLM | **Cloud LLM via thin serverless proxy** (best Hindi, any laptop) | Larger cloud model for the scorecard | On-device WebLLM: Qwen2.5-0.5B/1.5B (English), Qwen3-1.7B (better multilingual) **[verify availability and disable thinking mode]** |
| TTS | `speechSynthesis` with per-language voice selection | Cloud neural TTS (for example Azure `hi-IN`/`en-IN`) | Kokoro-js (English) |

**On "no backend":** a cloud LLM needs an API key that can't ship in client JS. A ~30-line serverless function (for example a Cloudflare Worker) that holds the key and streams the response is enough. It has no database, no auth system and no state.
- It needs a minimal abuse guard such as a shared passcode, a per-IP rate limit or Turnstile. Cost leakage is the only risk.
- Cost per 30-minute call is probably cents with a small/fast model **[verify against current pricing]**.
- If the owner insists on zero server, the on-device provider remains available, with the quality limits above.

**Auto-selection (preflight):** WebGPU present? `shader-f16`? A 5-second tokens/sec benchmark, with the result cached in `localStorage`. If the benchmark is poor, or the language is Hindi-heavy, select the cloud provider. Always let the user override.

---

## 4. Concrete modifications to the original MD (section by section)

### Title / §1 Executive Summary
- Remove "100% client-side", "Strict Enterprise Privacy (HIPAA/SOC2)" and "$0 cloud bill" as headline claims.
- Replace with: "Static web app, no stateful backend; speech runs via the browser; LLM runs on-device or through a stateless proxy."
- Add a Hindi+English and 30-minute-call goal.

### §2 Three Pillars
- **STT:** keep Web Speech as the default but document the one-language-per-session limit, the network requirement and the auto-stop behaviour. Add the language toggle (`en-IN` / `hi-IN`) and a note that Roman-script versus Devanagari output is inconsistent.
- **Secondary STT:** change `@xenova/transformers` to `@huggingface/transformers` v3. Note that Whisper isn't natively streaming and that Whisper-tiny/base have weak Hindi. Consider Whisper-small, which is heavier.
- **LLM:** replace "Qwen2.5-1.5B exceptional Hindi/Hinglish". Small Qwen models are mediocre at Hindi. Add Qwen3-1.7B as a candidate and require an evaluation on a Hindi/Hinglish test set before choosing a default. Add the cloud provider (§3).
- **TTS:** `phonon-tts` and "Phonon-31M, <80 ms" are unverified. I could not confirm the package exists. Demote it to a spike item. Default to `speechSynthesis`, with Kokoro as an English-only on-device option.

### §3 State machine and barge-in
- Add states `ERROR`, `ENDED` and `INTERRUPTED`.
- Replace the pseudocode with a **generation-ID** scheme. Every turn gets an incrementing ID. LLM chunks and TTS utterances carry the ID and are dropped if it is stale.
- Trigger barge-in on the **first interim result** with ≥2 words while `SPEAKING`. This avoids needing a VAD for v1. Add a VAD later if lag is too high.
- Echo handling: require or recommend headphones. Without them, mute the mic while speaking (half-duplex). Optionally ignore interim text that fuzzy-matches the last agent sentence.

### §4 Caching and storage
- Keep for the on-device provider only. Add `navigator.storage.persist()`. Correct "60% of free disk": the quota varies by browser, and Safari's is much smaller.
- For WebLLM use its own cache helpers (`hasModelInCache` / `deleteModelAllInfoInCache`) rather than hand-rolled version hashes.
- Add §4.3 below for 30-minute call state.

### §4.3 (new) 30-minute call resilience
1. **Context budget.** A 30-minute call is roughly 15–25k tokens, more in Hindi because of tokenisation **[verify]**. The on-device default is about 4k. Use: system persona + structured scenario state + rolling summary + the last N turns. Summarise every ~8 turns while in `LISTENING`.
2. **Persona drift.** Re-inject a short persona reminder plus current mood and objection state every turn. The scenario state machine, not the LLM, decides the next objection.
3. **STT session restarts.** Web Speech ends on silence, timeouts and network errors. Handle `onend` with restart, `no-speech` (ignore), `network` (back off and retry) and `not-allowed` (fatal, show UI).
4. **Autosave** the transcript and state to IndexedDB after every turn. Offer "resume call" after a crash or reload.
5. **Screen wake lock** (`navigator.wakeLock`). Warn on battery. Handle tab backgrounding, since the rep may switch to a CRM tab.
6. **GPU/memory:** handle `device lost`, with automatic reload or a switch to the cloud provider. Rate-limit on-device generation to avoid sustained thermal load.
7. **TTS chunking:** Chrome's cloud voices can stop on long utterances **[verify]**, so speak sentence by sentence.

### §5 Code (replace the sample; key corrections)
- `CreateWebGPUEngine` → `CreateMLCEngine` / `CreateWebWorkerMLCEngine` (worker). Run on-device inference in a Web Worker.
- Use `stream: true` and feed sentences to TTS as they complete. Cancel with `engine.interruptGenerate()` or by aborting the proxy fetch.
- Make personas data-driven (JSON scenario files), not hard-coded in the agent class.
- Create or resume `AudioContext` on the user's click. Guard against a null `recognition` object and against double-`start()`.
- Use `useRef` / a singleton so React StrictMode doesn't initialise twice.
- Keep the full transcript in UI state and IndexedDB, not just the last turn.

Reference sketch of the corrected core:

```ts
// provider interface: swap on-device and cloud without touching the turn manager
interface LLMProvider {
  init(onProgress?: (p: number, t: string) => void): Promise<void>;
  stream(messages: Msg[], opts: { signal: AbortSignal; maxTokens: number }): AsyncIterable<string>;
  abort(): void;
}

// on-device (inside the app; engine lives in a worker)
const engine = await CreateWebWorkerMLCEngine(
  new Worker(new URL("./llm.worker.ts", import.meta.url), { type: "module" }),
  modelId,
  { initProgressCallback: r => onProgress(r.progress, r.text) },
  { context_window_size: 4096 }
);
const chunks = await engine.chat.completions.create({ messages, stream: true, max_tokens: 80, temperature: 0.7 });
for await (const c of chunks) yield c.choices[0]?.delta?.content ?? "";
// llm.worker.ts: const h = new WebWorkerMLCEngineHandler(); self.onmessage = m => h.onmessage(m);

// sentence splitter that understands the Devanagari danda
const SENTENCE = /[^.!?।\n]+[.!?।]+["')\]]*\s*/g;

// per-sentence voice choice
const lang = devanagariRatio(sentence) > 0.3 ? "hi-IN" : "en-IN";
const voice = pickVoice(lang); // prefer a natural/online voice; fall back to any voice with the same lang

// turn loop with generation IDs
const gen = ++currentGen;
for await (const sentence of splitSentences(provider.stream(buildMessages(), { signal, maxTokens: 80 }))) {
  if (gen !== currentGen) break;      // barge-in or restart bumped the ID
  tts.enqueue(sentence, gen);
}

// barge-in: interim result while speaking
recognition.onresult = e => {
  const r = e.results[e.results.length - 1];
  if (state === "SPEAKING" && wordCount(r[0].transcript) >= 2 && !echoesAgent(r[0].transcript)) {
    currentGen++; provider.abort(); tts.cancel(); setState("LISTENING");
  }
  if (r.isFinal) turnQueue.push(r[0].transcript);
};
recognition.onend = () => { if (sessionActive) restartWithBackoff(); };
```

### §6 Hardware tiers (rewrite)
- Replace the model-by-laptop table with a **benchmark-driven** selector (§3).
- Remove the unsourced tok/sec and VRAM figures, or mark them as estimates. Use the MLC prebuilt config's `vram_required_MB` instead.
- Add the f16 check, the single-versus-dual-channel caveat, thermal throttling and Teams/Outlook memory contention.
- Add Hindi-specific guidance: cloud LLM by default for Hindi-heavy sessions.

### §7 Hosting
- Static hosting is fine. If the on-device provider is used, serve weights from Cloudflare R2 or similar rather than relying on Hugging Face. Per-user download egress adds up (1 GB × many users).
- Add the stateless LLM proxy (§3) with a minimal abuse guard.
- If using multi-threaded WASM, note COOP/COEP headers and their effect on cross-origin loading. This is not needed for the default cloud-STT/TTS path.

### §8 Checklist: replace with realistic items
- STT, LLM and TTS are swappable providers. ☐
- Hindi, English and code-mixed evaluation set with pass criteria. ☐
- 30-minute soak test on an 8 GB Windows Intel laptop with Teams open. ☐
- Median time to first audio under 2 s (cloud) and under 3 s (on-device). ☐
- Progress stored locally with export. ☐

### New sections to add
1. **Scenario engine:** JSON schema with persona, goals, hidden facts the rep must elicit, objection list, patience/mood meter, difficulty and end conditions. The state machine drives the buyer. The LLM only phrases it.
2. **Scoring and feedback:** heuristics on-device (talk ratio, filler words, questions asked, objection coverage), plus an optional end-of-call cloud LLM review. The existing spec has no coaching output at all.
3. **Pre-call system check:** mic test, headphone prompt, browser check, WebGPU and f16 check, benchmark, provider selection.
4. **Progress without a backend:** IndexedDB, export, optional later sync.
5. **Evaluation plan:** Hindi/Hinglish STT accuracy, TTS pronunciation of mixed text, persona adherence over 30 minutes, latency, crash rate.

---

## 5. Suggested build order
1. **Spike, a few days:** Chrome/Edge page with Web Speech STT, streamed cloud LLM, `speechSynthesis` per-sentence TTS, interim-result barge-in and a latency overlay. Test Hindi, English and Hinglish on a real Windows laptop.
2. Add the on-device WebLLM worker provider and a benchmark. Compare quality on the Hindi test set.
3. Scenario engine, scorecard and IndexedDB progress.
4. 30-minute resilience (§4.3), then the soak test on 8 GB hardware.
5. Optional: cloud STT/TTS upgrades, VAD, Kokoro English offline mode.

---

## 6. Claims I'm least sure of (please challenge)
1. Edge ships natural online `hi-IN`/`en-IN` voices usable via `speechSynthesis`, and these handle Hinglish acceptably.
2. Web Speech with `hi-IN` handles English words within Hindi sentences well enough for coaching.
3. Qwen3-1.7B is available as a WebLLM prebuilt, is meaningfully better than Qwen2.5 at Hindi, and has a clean way to disable thinking.
4. 5–12 tok/s on single-channel 8 GB iGPU laptops, and 15–25 tok/s on dual-channel Iris Xe.
5. About 15–25k tokens for a 30-minute call, higher in Hindi.
6. Kokoro Hindi voice quality and the mispronunciation of mixed-script text.
7. Chrome `speechSynthesis` cutting off long utterances with cloud voices.
8. Cloud LLM cost per 30-minute call being cents.
9. `phonon-tts` / Phonon-31M exists and meets the stated latency (I couldn't verify it).
10. The decision to default to a cloud LLM. If the owner truly wants zero server and zero per-call cost, the Hindi quality target probably needs relaxing. Is that a better trade than a stateless proxy?
