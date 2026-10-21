import { buildMessages } from "../lib/context";
import { ttsLangFor } from "../lib/lang";
import { scoreCall } from "../lib/scoring";
import { SentenceSplitter } from "../lib/sentences";
import type { CallState, ChatMessage, LanguageMode, SessionRecord, TranscriptTurn, TurnMetrics } from "../lib/types";
import type { LLMProvider } from "../llm/provider";
import { buildSystemPrompt, reminderFor, type Scenario } from "../scenarios/scenarios";
import type { SpeechInput } from "../speech/stt";
import type { SpeechOutput } from "../speech/tts";

export interface CallSettings {
  language: LanguageMode;
  /** Headphones on: the rep can talk over the buyer (barge-in). Off: mic is ignored while the buyer speaks. */
  fullDuplex: boolean;
  /** Silence after the rep's last words before the buyer replies. */
  endpointMs: number;
  /** Interim words needed to count as a barge-in. */
  bargeInWords: number;
  maxCallMs: number;
  maxTokens: number;
  temperature: number;
}

export const DEFAULT_SETTINGS: CallSettings = {
  language: "en",
  fullDuplex: false,
  endpointMs: 1000,
  bargeInWords: 2,
  maxCallMs: 30 * 60 * 1000,
  maxTokens: 90,
  temperature: 0.8,
};

export type CallEvent =
  | { type: "state"; state: CallState }
  | { type: "transcript"; turns: TranscriptTurn[] }
  | { type: "live"; text: string }
  | { type: "buyerPartial"; text: string }
  | { type: "metrics"; metrics: TurnMetrics }
  | { type: "error"; message: string; fatal: boolean }
  | { type: "ended"; reason: string };

export interface CallDeps {
  llm: LLMProvider;
  stt: SpeechInput | null;
  tts: SpeechOutput;
  scenario: Scenario;
  settings: CallSettings;
  onEvent: (e: CallEvent) => void;
  now?: () => number;
}

interface BuyerTurn {
  abort: AbortController;
  text: string;
  spoken: string[];
  finalized: boolean;
}

const END_MARK = /\[\s*END\s*\]/gi;
const HAS_END = /\[\s*END\s*\]/i;
const words = (t: string) => t.trim().split(/\s+/).filter(Boolean);

/**
 * Turn-taking state machine for one role-play call:
 * listening → (rep pauses) → thinking → speaking → listening, with barge-in.
 * Framework-free so it can be unit-tested with fake speech and LLM.
 */
export class CallController {
  readonly id = `call-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
  state: CallState = "idle";
  readonly turns: TranscriptTurn[] = [];
  readonly metrics: TurnMetrics[] = [];
  startedAt = 0;
  endedAt: number | null = null;
  endReason: string | undefined;
  bargeIns = 0;

  private readonly history: ChatMessage[] = [];
  private readonly system: string;
  private readonly now: () => number;
  private current: BuyerTurn | null = null;
  private pending = "";
  private endpointTimer: ReturnType<typeof setTimeout> | null = null;
  private maxTimer: ReturnType<typeof setTimeout> | null = null;
  private lastSpeechEnd = 0;

  constructor(private readonly d: CallDeps) {
    this.now = d.now ?? Date.now;
    this.system = buildSystemPrompt(d.scenario, d.settings.language);
  }

  start(): void {
    if (this.state !== "idle") return;
    this.startedAt = this.now();
    const { stt } = this.d;
    if (stt) {
      stt.onInterim = t => this.onInterim(t);
      stt.onFinal = t => this.onFinal(t);
      stt.onError = (m, fatal) => this.emit({ type: "error", message: m, fatal });
      stt.start();
    }
    this.maxTimer = setTimeout(() => this.end("Time limit reached"), this.d.settings.maxCallMs);
    const opener = this.d.scenario.opener[this.d.settings.language];
    void this.runTurn(async function* () { yield opener; }, null);
  }

  /** Rep's turn, from the speech endpoint or the text box. */
  submitRep(text: string): void {
    const clean = text.trim();
    if (!clean || this.state === "ended" || this.state === "idle") return;
    this.clearEndpoint();
    this.pending = "";
    this.emit({ type: "live", text: "" });
    if (this.current) this.interrupt();
    this.history.push({ role: "user", content: clean });
    this.turns.push({ role: "rep", text: clean, at: this.now() - this.startedAt });
    this.emit({ type: "transcript", turns: [...this.turns] });

    const messages = buildMessages(this.system, this.history, {
      budgetTokens: this.d.llm.promptBudget,
      supportsSystem: this.d.llm.supportsSystem,
      reminder: reminderFor(this.d.scenario, this.d.settings.language),
      reminderAfter: 8,
    });
    const { maxTokens, temperature } = this.d.settings;
    void this.runTurn(signal => this.d.llm.stream(messages, { maxTokens, temperature, signal }), this.now());
  }

  end(reason = "Call ended"): void {
    if (this.state === "ended") return;
    this.clearEndpoint();
    if (this.maxTimer) clearTimeout(this.maxTimer);
    if (this.pending.trim()) {
      this.turns.push({ role: "rep", text: this.pending.trim(), at: this.now() - this.startedAt });
      this.pending = "";
    }
    if (this.current) this.interrupt();
    this.d.stt?.stop();
    this.d.tts.cancel();
    this.endedAt = this.now();
    this.endReason = reason;
    this.setState("ended");
    this.emit({ type: "transcript", turns: [...this.turns] });
    this.emit({ type: "ended", reason });
  }

  snapshot(engineLabel: string): SessionRecord {
    const end = this.endedAt ?? this.now();
    return {
      id: this.id,
      scenarioId: this.d.scenario.id,
      scenarioTitle: this.d.scenario.title,
      language: this.d.settings.language,
      engineLabel,
      startedAt: this.startedAt,
      endedAt: this.endedAt,
      endReason: this.endReason,
      turns: [...this.turns],
      metrics: [...this.metrics],
      score: this.endedAt ? scoreCall(this.turns, this.d.scenario, end - this.startedAt) : undefined,
    };
  }

  // ---- speech input -------------------------------------------------------

  private onInterim(text: string): void {
    if (!this.accepting(text)) return;
    this.emit({ type: "live", text: `${this.pending} ${text}`.trim() });
    if (this.current && words(text).length >= this.d.settings.bargeInWords) {
      this.bargeIns++;
      this.interrupt();
    }
    if (this.pending) this.scheduleEndpoint(); // still talking: push the reply back
  }

  private onFinal(text: string): void {
    if (!this.accepting(text)) return;
    if (this.current) {
      this.bargeIns++;
      this.interrupt();
    }
    this.pending = `${this.pending} ${text}`.trim();
    this.emit({ type: "live", text: this.pending });
    this.scheduleEndpoint();
  }

  /** Half-duplex gating and a simple echo filter for speakers without headphones. */
  private accepting(text: string): boolean {
    if (this.state === "ended" || this.state === "idle") return false;
    const now = this.now();
    if (!this.d.settings.fullDuplex && (this.state === "speaking" || now - this.lastSpeechEnd < 400)) return false;
    return !this.isEcho(text, now);
  }

  private isEcho(text: string, now: number): boolean {
    const recent = this.current
      ? this.current.text
      : now - this.lastSpeechEnd < 3000
        ? (this.turns.findLast(t => t.role === "buyer")?.text ?? "")
        : "";
    if (!recent) return false;
    const heard = words(text.toLowerCase());
    if (heard.length < 2) return false;
    const said = new Set(words(recent.toLowerCase().replace(/[.,!?।]/g, "")));
    const overlap = heard.filter(w => said.has(w.replace(/[.,!?।]/g, ""))).length;
    return overlap / heard.length >= 0.7;
  }

  private scheduleEndpoint(): void {
    this.clearEndpoint();
    this.endpointTimer = setTimeout(() => {
      this.endpointTimer = null;
      const text = this.pending;
      if (text.trim()) this.submitRep(text);
    }, this.d.settings.endpointMs);
  }

  private clearEndpoint(): void {
    if (this.endpointTimer) clearTimeout(this.endpointTimer);
    this.endpointTimer = null;
  }

  // ---- buyer turn ---------------------------------------------------------

  private async runTurn(source: (signal: AbortSignal) => AsyncIterable<string>, commitAt: number | null): Promise<void> {
    const turn: BuyerTurn = { abort: new AbortController(), text: "", spoken: [], finalized: false };
    this.current = turn;
    this.setState("thinking");

    const metrics: TurnMetrics = { firstTokenMs: null, firstAudioMs: null, tokensPerSec: null, tokens: 0 };
    const splitter = new SentenceSplitter();
    const queue: string[] = [];
    let producerDone = false;
    const waiter: { wake: (() => void) | null } = { wake: null };
    let endRequested = false;
    let tFirst = 0;
    let tLast = 0;

    const enqueue = (sentence: string) => {
      if (HAS_END.test(sentence)) endRequested = true;
      const s = sentence.replace(END_MARK, "").trim();
      if (/[\p{L}\p{N}]/u.test(s)) queue.push(s);
      waiter.wake?.();
    };

    const producer = (async () => {
      try {
        for await (const chunk of source(turn.abort.signal)) {
          if (turn.abort.signal.aborted) break;
          tLast = this.now();
          if (!tFirst) {
            tFirst = tLast;
            if (commitAt !== null) metrics.firstTokenMs = tFirst - commitAt;
          }
          metrics.tokens++;
          turn.text += chunk;
          this.emit({ type: "buyerPartial", text: turn.text.replace(END_MARK, "") });
          splitter.push(chunk).forEach(enqueue);
        }
        if (!turn.abort.signal.aborted) splitter.flush().forEach(enqueue);
      } catch (err) {
        if (!turn.abort.signal.aborted) {
          this.emit({ type: "error", message: `The AI buyer failed to reply: ${errorText(err)}`, fatal: false });
        }
      } finally {
        producerDone = true;
        waiter.wake?.();
      }
    })();

    while (!turn.abort.signal.aborted) {
      const next = queue.shift();
      if (next === undefined) {
        if (producerDone) break;
        await new Promise<void>(r => (waiter.wake = r));
        waiter.wake = null;
        continue;
      }
      this.setState("speaking");
      if (metrics.firstAudioMs === null && commitAt !== null) metrics.firstAudioMs = this.now() - commitAt;
      turn.spoken.push(next);
      await this.d.tts.speak(next, ttsLangFor(next, this.d.settings.language));
      this.lastSpeechEnd = this.now();
    }
    await producer;

    if (tLast > tFirst && metrics.tokens > 1) metrics.tokensPerSec = (metrics.tokens - 1) / ((tLast - tFirst) / 1000);
    if (commitAt !== null && metrics.tokens > 0) {
      this.metrics.push(metrics);
      this.emit({ type: "metrics", metrics });
    }
    if (!turn.finalized) this.finalize(turn, false);
    this.emit({ type: "buyerPartial", text: "" });
    if (this.current === turn) {
      this.current = null;
      this.lastSpeechEnd = this.now();
      if (this.state !== "ended") this.setState("listening");
      const repTurns = this.turns.filter(t => t.role === "rep").length;
      if (endRequested && repTurns >= 2) this.end("The buyer ended the call");
    }
  }

  /** Cut off the buyer: stop generation and audio, keep only what was actually said. */
  private interrupt(): void {
    const turn = this.current;
    if (!turn) return;
    this.current = null;
    turn.abort.abort();
    this.d.tts.cancel();
    if (!turn.finalized) this.finalize(turn, true);
    if (this.state !== "ended") this.setState("listening");
  }

  private finalize(turn: BuyerTurn, interrupted: boolean): void {
    turn.finalized = true;
    const said = interrupted ? turn.spoken.join(" ") : turn.text;
    const text = said.replace(END_MARK, "").replace(/\s+/g, " ").trim();
    if (!text) return;
    // Tell the model it was cut off so it doesn't repeat itself.
    this.history.push({ role: "assistant", content: interrupted ? `${text} —` : text });
    this.turns.push({ role: "buyer", text, at: this.now() - this.startedAt, interrupted: interrupted || undefined });
    this.emit({ type: "transcript", turns: [...this.turns] });
  }

  private setState(s: CallState): void {
    if (this.state === s) return;
    this.state = s;
    this.emit({ type: "state", state: s });
  }

  private emit(e: CallEvent): void {
    this.d.onEvent(e);
  }
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
