# Roleplay Studio: AI sales role-play in the browser

A sales rep practises a call with an AI buyer by voice, then gets a simple scorecard.
Everything runs in the browser: a static site with no backend. Call history stays in the browser's IndexedDB.

**Status: v1, deliberately rough.** It works end to end, but expect rough edges. See *Known limitations*.

## Run it

```bash
npm install
npm run dev          # http://localhost:5173  (add ?demo to skip model download)
```

Use **Chrome or Edge** on a laptop. Edge has the most natural Indian English and Hindi voices.

1. Pick a scenario and language (English, Hinglish, Hindi).
2. Pick an AI engine:
   - **On this laptop:** WebLLM on WebGPU. Downloads once (0.9–2.5 GB), then loads from cache.
     - 8 GB laptops: Llama 3.2 1B or Qwen 2.5 0.5B.
     - 16 GB: Qwen 2.5 1.5B (English) or Gemma 2 2B (Hindi).
   - **Cloud model:** any OpenAI-compatible endpoint (OpenRouter by default). Best Hindi quality, works on any laptop. The key stays in this browser's localStorage.
   - **Demo:** a scripted buyer, to check mic and speakers without any AI.
3. Click **Load**, then **Start call**, and speak. Or type in the box.
   - Tick *headphones* to be able to interrupt the buyer mid-sentence.
4. End the call to see the scorecard. Past calls are under **History**, with JSON export.

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Dev server |
| `npm run build` | Typecheck + production build to `dist/` (deploy anywhere static) |
| `npm test` | Unit tests (Vitest): sentence splitting, context trimming, scoring, call state machine, Hinglish handling |
| `npm run test:e2e` | Playwright: full demo calls in Chromium (English and Hinglish) |

## How it works

```
Mic → Web Speech API (en-IN / hi-IN) → CallController ──► LLM provider (stream)
                                         │                    │
                                         │            SentenceSplitter (. ! ? ।)
                                         │                    ▼
        barge-in / echo filter ◄─────────┴──────── speechSynthesis, one sentence at a time
```

- `src/agent/CallController.ts`: turn-taking state machine.
  - States: listening → thinking → speaking.
  - Pause detection (endpointing), barge-in, half-duplex mode for speakers, echo filter.
  - Auto-end on `[END]`, a 30-minute limit and per-turn latency metrics.
- `src/lib/context.ts`: keeps long calls inside a 4k-token context. The newest turns are kept verbatim; older turns are compressed into a digest.
- `src/llm/`: providers.
  - `webllm.ts` runs WebLLM in a Web Worker.
  - `openai.ts` handles any OpenAI-compatible endpoint (SSE).
  - `mock.ts` is the scripted buyer.
  - `catalog.ts` lists the on-device models with WebLLM's own VRAM figures.
- `src/speech/`: Web Speech recognition with auto-restart, and `speechSynthesis` with voice selection.
- `src/scenarios/scenarios.ts`: buyer personas, hidden facts, objections, openers per language, scorecard checks. **Add new scenarios here.**
- `src/lib/scoring.ts`: heuristic scorecard (talk share, questions, monologue length, fillers, scenario checks).

## Known limitations (v1)

- **Speech recognition is cloud-based.** Chrome and Edge send mic audio to Google or Microsoft. Hindi has no on-device option there.
  - Firefox has no speech recognition; type instead.
  - Hinglish recognition quality is untested. `hi-IN` handles mixed speech best, but unevenly.
- **Small on-device models are weak at Hindi** and can drift out of character. Use Gemma 2 2B or a cloud model for Hindi.
- **Hinglish:** recognition uses `hi-IN`, which usually writes English words in Devanagari ("pilot" → पायलट).
  - The scorecard checks include those spellings.
  - Any sentence containing Devanagari is read by the Hindi voice, because English voices can't read Devanagari.
  - Tested so far with the scripted buyer and typed input only, not yet with a real model, mic or voices.
- **No headphones means no interrupting.** The mic is ignored while the buyer talks, to avoid echo.
- **Latency** depends on the laptop. The metrics line under the chat shows first-word time, first-audio time and tok/s; use it to compare machines.
- **The scorecard** is keyword and word-count heuristics, not an AI judge.
- **A cloud key in the browser** is fine for personal use. For a team, put a small proxy in front of it.
- **Not tested on real GPU or mic hardware yet.** The automated tests cover the logic and a typed demo call only.

## Next steps

- [ ] Benchmark on real 8 GB and 16 GB Windows laptops; set default models from the numbers.
- [ ] Hinglish STT test set (50–100 recorded phrases) → decide whether Deepgram or Sarvam is needed.
- [ ] Voice activity detection for faster barge-in; resume a call after a reload.
- [ ] An LLM-written end-of-call review (cloud engine), and custom scenario editing in the UI.

Background research and design notes: [`VOICE_AGENT_SPEC_V2.md`](VOICE_AGENT_SPEC_V2.md).
