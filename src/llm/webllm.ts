import type { WebWorkerMLCEngine } from "@mlc-ai/web-llm";
import type { ChatMessage } from "../lib/types";
import { modelId, type ModelOption } from "./catalog";
import { ThinkStripper, type LLMProvider, type StreamOptions } from "./provider";

const CONTEXT_WINDOW = 4096;
const REPLY_RESERVE = 400;

/** On-device LLM via WebLLM (WebGPU), running in a Web Worker so audio and UI stay smooth. */
export class WebLLMProvider implements LLMProvider {
  readonly label: string;
  readonly promptBudget = CONTEXT_WINDOW - REPLY_RESERVE;
  readonly supportsSystem: boolean;
  private engine: WebWorkerMLCEngine | null = null;
  private worker: Worker | null = null;
  private readonly id: string;

  constructor(private readonly model: ModelOption, f16: boolean) {
    this.id = modelId(model, f16);
    this.label = `On-device · ${model.label}${f16 ? "" : " (f32)"}`;
    this.supportsSystem = model.supportsSystem;
  }

  async load(onProgress: (fraction: number, text: string) => void): Promise<void> {
    const webllm = await import("@mlc-ai/web-llm");
    this.worker = new Worker(new URL("./webllm.worker.ts", import.meta.url), { type: "module" });
    this.engine = await webllm.CreateWebWorkerMLCEngine(
      this.worker,
      this.id,
      { initProgressCallback: r => onProgress(r.progress, r.text) },
      { context_window_size: CONTEXT_WINDOW },
    );
  }

  async *stream(messages: ChatMessage[], opts: StreamOptions): AsyncIterable<string> {
    const engine = this.engine;
    if (!engine) throw new Error("Model not loaded");
    const onAbort = () => engine.interruptGenerate();
    opts.signal.addEventListener("abort", onAbort, { once: true });
    try {
      const chunks = await engine.chat.completions.create({
        messages,
        stream: true,
        max_tokens: opts.maxTokens,
        temperature: opts.temperature,
        ...(this.model.thinking ? { extra_body: { enable_thinking: false } } : {}),
      });
      const strip = new ThinkStripper();
      for await (const c of chunks) {
        if (opts.signal.aborted) break;
        const text = strip.push(c.choices[0]?.delta?.content ?? "");
        if (text) yield text;
      }
      const rest = strip.flush();
      if (rest && !opts.signal.aborted) yield rest;
    } finally {
      opts.signal.removeEventListener("abort", onAbort);
    }
  }

  async dispose(): Promise<void> {
    await this.engine?.unload().catch(() => {});
    this.worker?.terminate();
    this.engine = null;
    this.worker = null;
  }
}

export async function isModelCached(model: ModelOption, f16: boolean): Promise<boolean> {
  try {
    const webllm = await import("@mlc-ai/web-llm");
    return await webllm.hasModelInCache(modelId(model, f16));
  } catch {
    return false;
  }
}

export async function deleteCachedModel(model: ModelOption, f16: boolean): Promise<void> {
  const webllm = await import("@mlc-ai/web-llm");
  await webllm.deleteModelAllInfoInCache(modelId(model, f16));
}
