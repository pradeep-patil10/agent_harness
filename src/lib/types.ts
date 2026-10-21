export type Role = "system" | "user" | "assistant";

export interface ChatMessage {
  role: Role;
  content: string;
}

/** en: Indian English. hinglish: Hindi + English mixed. hi: mostly Hindi. */
export type LanguageMode = "en" | "hinglish" | "hi";

export type CallState = "idle" | "listening" | "thinking" | "speaking" | "ended";

export interface TranscriptTurn {
  role: "rep" | "buyer";
  text: string;
  /** ms since call start */
  at: number;
  /** buyer turn cut off by the rep (barge-in) */
  interrupted?: boolean;
}

export interface TurnMetrics {
  /** rep finished speaking -> first LLM token, ms */
  firstTokenMs: number | null;
  /** rep finished speaking -> first audio started, ms */
  firstAudioMs: number | null;
  /** generated chunks per second (≈ tokens/s) */
  tokensPerSec: number | null;
  tokens: number;
}

export interface ScoreItem {
  label: string;
  value: string;
  verdict: "good" | "warn" | "bad";
  tip?: string;
}

export interface SessionRecord {
  id: string;
  scenarioId: string;
  scenarioTitle: string;
  language: LanguageMode;
  engineLabel: string;
  startedAt: number;
  endedAt: number | null;
  endReason?: string;
  turns: TranscriptTurn[];
  metrics: TurnMetrics[];
  score?: ScoreItem[];
}
