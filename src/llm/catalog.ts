// On-device models offered in the UI. VRAM figures are WebLLM's own
// `vram_required_MB` from prebuiltAppConfig (checked 2026-10, web-llm 0.2.85).

export interface ModelOption {
  /** Base id without the quantisation suffix. */
  base: string;
  label: string;
  vramMB: { f16: number; f32: number };
  supportsSystem: boolean;
  /** Qwen3 thinks by default; we turn it off for snappy spoken replies. */
  thinking?: boolean;
  hindi: "poor" | "fair" | "better";
  note: string;
}

export const MODELS: ModelOption[] = [
  { base: "Llama-3.2-1B-Instruct", label: "Llama 3.2 1B", vramMB: { f16: 879, f32: 1129 }, supportsSystem: true, hindi: "poor", note: "Smallest. English only. 8 GB laptops." },
  { base: "Qwen2.5-0.5B-Instruct", label: "Qwen 2.5 0.5B", vramMB: { f16: 945, f32: 1060 }, supportsSystem: true, hindi: "poor", note: "Fastest. English only, weak role-play." },
  { base: "Qwen2.5-1.5B-Instruct", label: "Qwen 2.5 1.5B", vramMB: { f16: 1630, f32: 1889 }, supportsSystem: true, hindi: "poor", note: "Good English role-play. 16 GB recommended." },
  { base: "gemma-2-2b-it", label: "Gemma 2 2B", vramMB: { f16: 1895, f32: 2509 }, supportsSystem: false, hindi: "fair", note: "Best on-device Hindi tokenizer. 16 GB." },
  { base: "Qwen3-1.7B", label: "Qwen 3 1.7B", vramMB: { f16: 2037, f32: 2635 }, supportsSystem: true, thinking: true, hindi: "fair", note: "Newer, multilingual. 16 GB." },
  { base: "Llama-3.2-3B-Instruct", label: "Llama 3.2 3B", vramMB: { f16: 2264, f32: 2952 }, supportsSystem: true, hindi: "fair", note: "Best on-device quality. 16 GB / dedicated GPU." },
];

export function modelId(m: ModelOption, f16: boolean): string {
  return `${m.base}-${f16 ? "q4f16_1" : "q4f32_1"}-MLC`;
}

export function findModel(base: string): ModelOption {
  return MODELS.find(m => m.base === base) ?? MODELS[0];
}
