# Browser Voice Agent for Sales Role-play: Review Notes and Spec v2 Changes

**Purpose of this file:** hand to a second reviewer (human or LLM) together with the original spec ("In-Browser Voice Agent for Sales Simulation & Roleplay"). It states the confirmed requirements, what is and isn't achievable, and a concrete change list against the original. The final section lists the claims I'm least sure of. Please try to break them.

Items marked **[verify]** are from memory and not checked against live docs or measured. Most were then checked by web search on 2026-10-21. **§7 has the results and sources and overrides anything earlier in this file that conflicts with it.** Hardware tokens/sec and Hinglish STT accuracy still need measuring.

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
| LLM | **Cloud LLM via thin serverless proxy** (best Hindi, any laptop) | Larger cloud model for the scorecard | On-device WebLLM. 8 GB: Qwen2.5-0.5B (945 MB) / Llama-3.2-1B (879 MB). 16 GB: Qwen2.5-1.5B (1.6 GB), Qwen3-1.7B (2.0 GB, `extra_body: { enable_thinking: false }`), gemma-2-2b (1.9 GB, best Hindi tokenizer). See §7. |
| TTS | `speechSynthesis` with per-language voice selection | Cloud neural TTS (for example Azure `hi-IN`/`en-IN`) | Kokoro-js, **English only** (kokoro-js ships US/UK voices only) |

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
- **Secondary STT:** change `@xenova/transformers` to `@huggingface/transformers` (currently v4.x). Note that Whisper isn't natively streaming and that Whisper-tiny/base have weak Hindi. Consider Whisper-small, which is heavier.
- **LLM:** replace "Qwen2.5-1.5B exceptional Hindi/Hinglish". Small Qwen models are mediocre at Hindi. Add Qwen3-1.7B as a candidate and require an evaluation on a Hindi/Hinglish test set before choosing a default. Add the cloud provider (§3).
- **TTS:** remove `phonon-tts`. Gradium Phonon exists, but it is a private-beta, licensed binary of about 100M parameters, not a ~31M npm package. It supports EN/FR/DE/ES/PT only, with **no Hindi** (§7). Default to `speechSynthesis`, with Kokoro-js as an English-only on-device option.

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

---

## 7. Verification results (web search, 2026-10-21)

| # | Claim | Result | Impact on design |
|---|---|---|---|
| 1 | `phonon-tts` npm / Phonon-31M WASM | **False as written.** Gradium Phonon is real but in private beta, shipped as a licensed binary, ~100M params, CPU-only. Languages: EN, FR, DE, ES, PT. **No Hindi.** No public `phonon-tts` npm package found. | Remove from spec. |
| 2 | Kokoro Hindi voices | Kokoro-82M (Python) has Hindi voices (`hf_alpha`, `hf_beta`, `hm_omega`, `hm_psi`). **kokoro-js documents only 28 US/UK English voices.** | Kokoro-js is English-only. It's not an option for Hindi. |
| 3 | WebLLM Qwen3 availability, thinking off | **Confirmed.** Qwen3-0.6B/1.7B/4B/8B, Qwen3.5-0.8B/2B/4B/9B, gemma3-1b, gemma-2-2b and gemma-4-E2B are in `prebuiltAppConfig`. The official `examples/qwen3` disables thinking with `extra_body: { enable_thinking: false }`. | Use that flag. Strip `<think>` blocks from history. |
| 4 | VRAM needs (WebLLM `vram_required_MB`, q4f16_1) | Qwen2.5-0.5B **945**; Llama-3.2-1B **879**; gemma3-1b **711**; Qwen3-0.6B **1403**; Qwen2.5-1.5B **1630**; Qwen3.5-0.8B **1629**; gemma-2-2b **1895**; Qwen3-1.7B **2037**; Llama-3.2-3B **2264**; Qwen2.5-3B **2505**; gemma-4-E2B **3387**. All default to a **4096**-token context. | Original spec's "450 MB for 0.5B" is wrong (≈2×). On 8 GB, only the ≤1 GB models are safe. Qwen3-0.6B needs more VRAM than Qwen2.5-0.5B. |
| 5 | Small-model Hindi quality | Gemma 3 1B scores 24.9 on Global-MMLU-Lite vs 57.0 for 4B, so the 1B is effectively not multilingual. Gemma 4 E2B: 140+ pretraining languages, 35+ "out of the box", but 3.4 GB VRAM. Qwen3.5 small models: 201 languages per a third-party listing; Hindi quality unmeasured. | No ≤1 GB model is credible for Hindi. On-device Hindi realistically needs gemma-2-2b / Gemma-4-E2B class models on 16 GB machines. This reinforces cloud-by-default for Hindi. |
| 6 | Hindi tokenisation cost | Hindi tokens per word (LilMoo, 2026): **Qwen2.5 3.07**, Llama-3.2 2.02, **Gemma-2 1.73**. Devanagari costs about 3× more tokens than romanised Hindi on older tokenisers. | Hindi on Qwen uses ~1.8× the tokens of Gemma, so it's slower and fills the 4k context faster. Prefer Gemma for on-device Hindi. 30-minute Hindi calls definitely need summarisation. |
| 7 | iGPU tokens/sec | **No published WebLLM benchmark for Iris Xe/UHD found.** A secondary source says WebGPU runs ~25–35% below native. | Still unverified. Must measure on target laptops (step 1 of build order). |
| 8 | Edge natural `hi-IN`/`en-IN` voices in `speechSynthesis` | `en-IN` Neerja natural voices confirmed in Edge's online voice list. `hi-IN` Swara/Madhur exist as Azure voices, but **I couldn't confirm them in Edge's `getVoices()`**. Natural voices are **Edge-only and cloud** (need internet). Edge 150 has a reported bug returning `"Microsoft undefined Online (Natural)"` names. | Enumerate voices at runtime, reject malformed entries, fall back to local voices. Recommend Edge for best Indian voices. |
| 9 | Chrome `speechSynthesis` cut-off | **Confirmed.** Chromium issue 679437: playback stops after ~15 s on long utterances, especially with Google voices. Splitting into sentence-sized utterances is the standard fix. | Keep sentence chunking (already in design). |
| 10 | Web Speech STT session behaviour | Chrome ends recognition after ~7–10 s of silence even with `continuous = true`. Restarting in `onend` works; use HTTPS and guard against restart loops. On-device `processLocally` exists (Chrome ~139+). Edge's local language list (en-US, de, it, pt-PT, es, ko) has **no `hi-IN`/`en-IN`**. | Restart-with-backoff confirmed necessary. Hindi STT via Web Speech is cloud-only. |
| 11 | Web Speech `hi-IN` on Hinglish | **No published evaluation found.** One Android `hi-IN` test reported mixed results, with English words sometimes fine and sometimes mangled. | Unverified. Build a 50–100-utterance Hinglish test set and measure WER. |
| 12 | Cloud Hinglish STT alternatives | **Deepgram Nova-3** `language=multi` code-switches in real time across 10 languages **including Hindi**. Browser use needs a temporary token from `/auth/grant` (30 s TTL), so it needs a tiny server to mint. Streaming ≈ $0.0077/min (third-party figure). **Sarvam Saaras v3** has a `codemix` output mode and a WebSocket streaming API. Pricing is unverified (a reseller lists ~₹53/hr). | Viable upgrade path if Web Speech fails the Hinglish test. The same thin proxy can mint tokens. |
| 13 | Cloud LLM cost per 30-minute call | Gemini 2.5 Flash-Lite ≈ **$0.10 / $0.40 per M input/output tokens** (third-party aggregators, Sep 2026; confirm on Google's page). Estimate: ~40 turns × ~6k input tokens ≈ 240k input + ~3k output ≈ **$0.03/call**. | "Cents per call" confirmed for the LLM. |
| 14 | Cloud TTS cost | Azure neural TTS ≈ **$15 per M characters** (third-party). A 30-minute call has ~40 agent replies × ~150 chars ≈ 6k chars ≈ **$0.09/call**. | Optional upgrade; Edge voices are free. |
| 15 | `navigator.deviceMemory` caps at 8 | **Outdated.** Newer desktop Chrome can report 16 and 32. It's still a coarse power-of-two value. | Use it as a hint only. Keep the runtime benchmark. |
| 16 | Storage quota | Chromium: ~60% of **total** disk per origin (informal source; Safari/WebKit documents 60%/80% officially). Firefox: min(10% of disk, 10 GiB). `navigator.storage.persist()` protects from eviction (MDN). | Original "60% of free disk" is wrong. Call `persist()`. |
| 17 | Transformers.js | Current is **v4.x** (v4.3) with a rewritten WebGPU runtime. Whisper/Moonshine Hindi quality is not documented. | Use `@huggingface/transformers` v4. Don't plan on on-device Hindi STT without testing. |

**Bottom line after verification:** the core recommendation holds and is stronger.
- For Hindi+English: Web Speech STT (test Hinglish first; Deepgram/Sarvam as fallback), a cloud LLM through a thin proxy (≈$0.03/call), and Edge/browser voices, with sentence chunking.
- On-device LLMs are viable for **English** on 8 GB (≤1 GB models), and for Hindi only on 16 GB machines with Gemma-class models.
- Remove phonon-tts and Kokoro from any Hindi path.

### Sources
- Gradium Phonon: [gradium.ai/ondevice](https://gradium.ai/ondevice), [benchmarks](https://gradium.ai/content/gradium-phonon-on-device-tts-benchmarks-2026), [on-device TTS](https://gradium.ai/content/gradium-phonon-on-device-tts), [theresanaiforthat listing](https://theresanaiforthat.com/model/phonon/)
- Kokoro: [kokoro-js README](https://github.com/hexgrad/kokoro/tree/main/kokoro.js), [Kokoro voices (Soniqo)](https://soniqo.audio/es/guides/kokoro)
- WebLLM: [`src/config.ts`](https://github.com/mlc-ai/web-llm/blob/main/src/config.ts), [examples/qwen3](https://github.com/mlc-ai/web-llm/tree/main/examples/qwen3)
- Gemma: [Gemma 3 model card](https://ai.google.dev/gemma/docs/core/model_card_3), [Gemma 4 E2B (Featherless)](https://featherless.ai/models/google/gemma-4-E2B), [Zilliz FAQ](https://zilliz.com/ai-faq/does-gemma-4-support-multiple-languages)
- Qwen3.5 small: [DeepInfra](https://deepinfra.com/Qwen/Qwen3.5-0.8B/versions), [Gigazine](https://gigazine.net/gsc_news/en/20260303-qwen-3-5-small)
- Hindi tokenisation: [LilMoo (arXiv 2603.03508)](https://arxiv.org/pdf/2603.03508), [The Art of Breaking Words (arXiv 2508.06533)](https://arxiv.org/pdf/2508.06533), [Canonical/IITB](https://events.canonical.com/event/154/contributions/1005/attachments/522/840/MACS5.pdf)
- WebGPU benchmarking: [LLM GPU Benchmark](https://inventivehq.com/tools/developer/llm-gpu-benchmark)
- Edge voices: [Edge 150 getVoices bug](https://techcommunity.microsoft.com/discussions/edgeinsiderdiscussions/edge-version-150-javascript-speechsynthesis-getvoices-undefined-voices/4538591), [Edge TTS voice list](https://github.com/FoloToy/folotoy-server-self-hosting/wiki/Edge%E2%80%90TTS%E2%80%90Voices), [Natural voices need Edge + internet](https://learn.microsoft.com/en-us/answers/a/2428002)
- speechSynthesis cut-off: [W3C browser support table](https://docs.w3cub.com/browser_support_tables/speech-synthesis), [PhET issue](https://github.com/phetsims/utterance-queue/issues/60), [Caktus (2025)](https://www.caktusgroup.com/blog/2025/11/03/the-halting-problem/), [Kartones](https://blog.kartones.net/post/web-speech-api/)
- Web Speech STT: [MDN processLocally](https://developer.mozilla.org/docs/Web/API/SpeechRecognition/processLocally), [MDN available()](https://developer.mozilla.org/docs/Web/API/SpeechRecognition/available_static), [Edge speech recognition docs](https://learn.microsoft.com/fi-fi/microsoft-edge/web-platform/speech-recognition-api), [Blink intent to ship](https://groups.google.com/a/chromium.org/g/blink-dev/c/VNOok2dbmHM/m/TQpe9shjCgAJ), [W3C list on restarts](https://lists.w3.org/Archives/Public/public-speech-api/2015May/0000.html), [Android hi-IN code-switch test](https://hackernoon.com/testing-androids-on-device-speech-recognition-with-hindi-english-code-switching)
- Deepgram: [code-switching docs](https://developers.deepgram.com/docs/multilingual-code-switching), [changelog 2025-03-31](https://developers.deepgram.com/changelog/2025/3/31), [token auth](https://developers.deepgram.com/guides/fundamentals/token-based-authentication), [pricing (third-party)](https://convertaudiototext.com/blog/deepgram-nova-3-explained)
- Sarvam: [STT overview](https://docs.sarvam.ai/api-reference-docs/speech-to-text/apis/overview), [streaming WS](https://docs.sarvam.ai/api-reference-docs/speech-to-text/transcribe/ws), [CallMissed listing](https://www.callmissed.com/models/saaras-v3)
- Pricing: [Gemini 2.5 Flash-Lite (aggregator)](https://anotherwrapper.com/tools/llm-pricing/gemini-2.5-flash-lite), [Azure TTS (third-party)](https://speechactors.com/article/microsoft-azure-pricing-and-plans)
- Browser APIs: [MDN deviceMemory](https://developer.mozilla.org/docs/Web/API/Navigator/deviceMemory), [Castle on deviceMemory](https://blog.castle.io/deep-dive-how-navigator-devicememory-can-be-used-for-fingerprinting-and-bot-detection/), [MDN storage quotas](https://developer.mozilla.org/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria), [WebKit storage policy](https://webkit.org/?p=14403), [Frontend Masters](https://frontendmasters.com/courses/web-storage-apis/quotas-persistence)
- Transformers.js: [v4.3.0 release](https://newreleases.io/project/github/huggingface/transformers.js/release/4.3.0), [releases](https://github.com/huggingface/transformers.js/releases)
