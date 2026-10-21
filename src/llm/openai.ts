import type { ChatMessage } from "../lib/types";
import { ThinkStripper, type LLMProvider, type StreamOptions } from "./provider";

export interface CloudConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
}

/**
 * Any OpenAI-compatible chat endpoint (OpenRouter, Groq, Together, a local
 * Ollama/LM Studio server, Gemini's OpenAI-compatible endpoint…).
 * The key lives in this browser only. Fine for a personal setup; for a team,
 * put a small proxy in front so the key isn't handed out.
 */
export class OpenAICompatProvider implements LLMProvider {
  readonly label: string;
  readonly promptBudget = 12000;
  readonly supportsSystem = true;

  constructor(private readonly cfg: CloudConfig) {
    this.label = `Cloud · ${cfg.model}`;
  }

  async load(onProgress: (fraction: number, text: string) => void): Promise<void> {
    if (!this.cfg.baseUrl || !this.cfg.model) throw new Error("Cloud endpoint URL and model are required");
    onProgress(1, "Cloud model ready");
  }

  async *stream(messages: ChatMessage[], opts: StreamOptions): AsyncIterable<string> {
    const url = this.cfg.baseUrl.replace(/\/+$/, "") + "/chat/completions";
    const res = await fetch(url, {
      method: "POST",
      signal: opts.signal,
      headers: {
        "Content-Type": "application/json",
        ...(this.cfg.apiKey ? { Authorization: `Bearer ${this.cfg.apiKey}` } : {}),
      },
      body: JSON.stringify({
        model: this.cfg.model,
        messages,
        stream: true,
        max_tokens: opts.maxTokens,
        temperature: opts.temperature,
      }),
    });
    if (!res.ok || !res.body) {
      const detail = await res.text().catch(() => "");
      throw new Error(`Cloud LLM error ${res.status}: ${detail.slice(0, 200)}`);
    }
    const strip = new ThinkStripper();
    for await (const data of sseData(res.body, opts.signal)) {
      if (data === "[DONE]") break;
      try {
        const json = JSON.parse(data);
        const text = strip.push(json.choices?.[0]?.delta?.content ?? "");
        if (text) yield text;
      } catch {
        // ignore keep-alives / malformed lines
      }
    }
    const rest = strip.flush();
    if (rest) yield rest;
  }

  async dispose(): Promise<void> {}
}

export async function* sseData(body: ReadableStream<Uint8Array>, signal: AbortSignal): AsyncIterable<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  try {
    while (!signal.aborted) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let nl: number;
      while ((nl = buf.indexOf("\n")) !== -1) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (line.startsWith("data:")) yield line.slice(5).trim();
      }
    }
  } finally {
    reader.releaseLock();
  }
}
