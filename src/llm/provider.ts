import type { ChatMessage } from "../lib/types";

export interface StreamOptions {
  maxTokens: number;
  temperature: number;
  signal: AbortSignal;
}

export interface LLMProvider {
  /** Human-readable name, e.g. "On-device · Qwen2.5-1.5B". */
  readonly label: string;
  /** Prompt budget in tokens (context window minus room for the reply). */
  readonly promptBudget: number;
  readonly supportsSystem: boolean;
  load(onProgress: (fraction: number, text: string) => void): Promise<void>;
  /** Streams text chunks. Must stop promptly when `signal` aborts. */
  stream(messages: ChatMessage[], opts: StreamOptions): AsyncIterable<string>;
  dispose(): Promise<void>;
}

/** Removes Qwen3-style <think>…</think> blocks from streamed text. */
export class ThinkStripper {
  private inThink = false;
  private pending = "";

  push(chunk: string): string {
    let s = this.pending + chunk;
    this.pending = "";
    let out = "";
    while (s.length > 0) {
      if (this.inThink) {
        const end = s.indexOf("</think>");
        if (end === -1) {
          this.pending = tailThatCouldStart(s, "</think>");
          return out;
        }
        s = s.slice(end + "</think>".length);
        this.inThink = false;
      } else {
        const start = s.indexOf("<think>");
        if (start === -1) {
          const keep = tailThatCouldStart(s, "<think>");
          out += s.slice(0, s.length - keep.length);
          this.pending = keep;
          return out;
        }
        out += s.slice(0, start);
        s = s.slice(start + "<think>".length);
        this.inThink = true;
      }
    }
    return out;
  }

  flush(): string {
    const rest = this.inThink ? "" : this.pending;
    this.pending = "";
    return rest;
  }
}

function tailThatCouldStart(s: string, tag: string): string {
  for (let n = Math.min(tag.length - 1, s.length); n > 0; n--) {
    if (tag.startsWith(s.slice(s.length - n))) return s.slice(s.length - n);
  }
  return "";
}
