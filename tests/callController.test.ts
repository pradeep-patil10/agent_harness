import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CallController, DEFAULT_SETTINGS, type CallEvent, type CallSettings } from "../src/agent/CallController";
import type { ChatMessage } from "../src/lib/types";
import type { LLMProvider, StreamOptions } from "../src/llm/provider";
import { SCENARIOS } from "../src/scenarios/scenarios";
import type { SpeechInput } from "../src/speech/stt";
import type { SpeechOutput } from "../src/speech/tts";

class FakeLLM implements LLMProvider {
  label = "fake";
  promptBudget = 3000;
  supportsSystem = true;
  calls: ChatMessage[][] = [];
  constructor(private replies: string[]) {}
  async load() {}
  async dispose() {}
  async *stream(messages: ChatMessage[], opts: StreamOptions) {
    this.calls.push(messages);
    const reply = this.replies.shift() ?? "Okay.";
    for (const w of reply.split(/(?<= )/)) {
      if (opts.signal.aborted) return;
      await Promise.resolve();
      yield w;
    }
  }
}

class FakeSTT implements SpeechInput {
  onInterim = (_: string) => {};
  onFinal = (_: string) => {};
  onError = (_m: string, _f: boolean) => {};
  started = false;
  start() { this.started = true; }
  stop() { this.started = false; }
  setLang() {}
}

/** TTS whose utterances finish only when the test says so. */
class ManualTTS implements SpeechOutput {
  spoken: string[] = [];
  private pending: (() => void)[] = [];
  speak(text: string) {
    this.spoken.push(text);
    return new Promise<void>(r => this.pending.push(r));
  }
  finishAll() {
    const p = this.pending;
    this.pending = [];
    p.forEach(r => r());
  }
  cancel() { this.finishAll(); }
}

const flush = async () => {
  for (let i = 0; i < 20; i++) await Promise.resolve();
};

function setup(replies: string[], settings: Partial<CallSettings> = {}) {
  const llm = new FakeLLM(replies);
  const stt = new FakeSTT();
  const tts = new ManualTTS();
  const events: CallEvent[] = [];
  const ctrl = new CallController({
    llm,
    stt,
    tts,
    scenario: SCENARIOS[0],
    settings: { ...DEFAULT_SETTINGS, ...settings },
    onEvent: e => events.push(e),
  });
  return { ctrl, llm, stt, tts, events };
}

/** Let the buyer finish every sentence it has queued. */
async function speakOut(tts: ManualTTS) {
  for (let i = 0; i < 10; i++) {
    await flush();
    tts.finishAll();
  }
  await flush();
}

describe("CallController", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("speaks the opener, then replies to the rep", async () => {
    const { ctrl, llm, stt, tts } = setup(["Price is too high. What about ROI?"]);
    ctrl.start();
    expect(stt.started).toBe(true);
    await flush();
    expect(tts.spoken[0]).toContain("Ramesh here");
    expect(ctrl.state).toBe("speaking");
    await speakOut(tts);
    expect(ctrl.state).toBe("listening");

    ctrl.submitRep("Hi Ramesh, I'm calling about fuel costs.");
    await speakOut(tts);
    expect(tts.spoken.slice(-2)).toEqual(["Price is too high.", "What about ROI?"]);
    expect(ctrl.turns.map(t => t.role)).toEqual(["buyer", "rep", "buyer"]);
    expect(ctrl.metrics).toHaveLength(1);

    const sent = llm.calls[0];
    expect(sent[0].role).toBe("system");
    expect(sent.map(m => m.role)).toEqual(["system", "user", "assistant", "user"]);
  });

  it("waits for a pause and merges speech segments into one turn", async () => {
    const { ctrl, stt, tts, llm } = setup(["Go on."]);
    ctrl.start();
    await speakOut(tts);
    vi.advanceTimersByTime(500);

    stt.onFinal("we help fleets");
    vi.advanceTimersByTime(600);
    stt.onInterim("cut fuel");
    vi.advanceTimersByTime(600);
    stt.onFinal("cut fuel costs");
    expect(llm.calls).toHaveLength(0);
    vi.advanceTimersByTime(1000);
    await flush();
    expect(llm.calls).toHaveLength(1);
    expect(ctrl.turns.find(t => t.role === "rep")?.text).toBe("we help fleets cut fuel costs");
  });

  it("barge-in with headphones cuts the buyer off and keeps only what was said", async () => {
    const { ctrl, stt, tts, llm } = setup(["First sentence here. Second sentence never said. Third one."], { fullDuplex: true });
    ctrl.start();
    await speakOut(tts);
    vi.advanceTimersByTime(500);
    ctrl.submitRep("Hello");
    await flush();
    expect(tts.spoken.at(-1)).toBe("First sentence here.");
    expect(ctrl.state).toBe("speaking");

    stt.onInterim("sorry to interrupt");
    expect(ctrl.state).toBe("listening");
    expect(ctrl.bargeIns).toBe(1);
    const buyer = ctrl.turns.filter(t => t.role === "buyer").at(-1)!;
    expect(buyer.text).toBe("First sentence here.");
    expect(buyer.interrupted).toBe(true);

    stt.onFinal("sorry to interrupt, quick question");
    vi.advanceTimersByTime(1000);
    await flush();
    const last = llm.calls.at(-1)!;
    expect(last.at(-2)).toEqual({ role: "assistant", content: "First sentence here. —" });
    expect(tts.spoken).not.toContain("Second sentence never said.");
  });

  it("without headphones, ignores the mic while the buyer speaks", async () => {
    const { ctrl, stt, tts } = setup([]);
    ctrl.start();
    await flush();
    expect(ctrl.state).toBe("speaking");
    stt.onInterim("this is the speaker echo");
    stt.onFinal("this is the speaker echo");
    expect(ctrl.state).toBe("speaking");
    expect(ctrl.turns.filter(t => t.role === "rep")).toHaveLength(0);
    await speakOut(tts);
  });

  it("filters the buyer's own words picked up as echo", async () => {
    const { ctrl, stt, tts } = setup([], { fullDuplex: true });
    ctrl.start();
    await flush();
    stt.onInterim("Ramesh here I have about ten minutes");
    expect(ctrl.state).toBe("speaking");
    await speakOut(tts);
  });

  it("ends the call when the buyer says [END] after a real conversation", async () => {
    const { ctrl, tts, events } = setup(["Tell me more.", "Fine, let's do a pilot. Bye. [END]"]);
    ctrl.start();
    await speakOut(tts);
    ctrl.submitRep("We cut fuel cost.");
    await speakOut(tts);
    expect(ctrl.state).toBe("listening");
    ctrl.submitRep("Pilot next week?");
    await speakOut(tts);
    expect(ctrl.state).toBe("ended");
    expect(tts.spoken.join(" ")).not.toContain("[END]");
    expect(events.some(e => e.type === "ended")).toBe(true);
    const snap = ctrl.snapshot("fake");
    expect(snap.score?.length).toBeGreaterThan(3);
    expect(snap.turns.at(-1)!.text).toBe("Fine, let's do a pilot. Bye.");
  });

  it("reports LLM failures and returns to listening", async () => {
    const { ctrl, tts, llm, events } = setup([]);
    llm.stream = async function* () {
      yield* [];
      throw new Error("GPU device lost");
    };
    ctrl.start();
    await speakOut(tts);
    ctrl.submitRep("Hello?");
    await speakOut(tts);
    expect(ctrl.state).toBe("listening");
    expect(events.some(e => e.type === "error" && e.message.includes("GPU device lost"))).toBe(true);
  });

  it("ends at the time limit", async () => {
    const { ctrl, tts } = setup([], { maxCallMs: 60_000 });
    ctrl.start();
    await speakOut(tts);
    vi.advanceTimersByTime(60_000);
    expect(ctrl.state).toBe("ended");
    expect(ctrl.endReason).toBe("Time limit reached");
  });
});
