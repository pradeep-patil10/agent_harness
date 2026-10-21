import { MODELS, type ModelOption } from "../llm/catalog";
import type { LanguageMode } from "./types";

export interface DeviceReport {
  webgpu: boolean;
  shaderF16: boolean;
  gpuVendor: string;
  gpuDescription: string;
  /** Coarse RAM hint from navigator.deviceMemory (power of two; may be capped). */
  memoryGB: number | null;
  speechInput: boolean;
  speechOutput: boolean;
  browser: string;
  notes: string[];
}

export async function detectDevice(): Promise<DeviceReport> {
  const notes: string[] = [];
  let webgpu = false;
  let shaderF16 = false;
  let gpuVendor = "";
  let gpuDescription = "";
  try {
    const adapter = await navigator.gpu?.requestAdapter({ powerPreference: "high-performance" });
    if (adapter) {
      webgpu = true;
      shaderF16 = adapter.features.has("shader-f16");
      gpuVendor = adapter.info?.vendor ?? "";
      gpuDescription = [adapter.info?.architecture, adapter.info?.description].filter(Boolean).join(" ");
    }
  } catch {
    // WebGPU blocked or unavailable
  }
  if (!webgpu) notes.push("WebGPU isn't available, so on-device AI won't run. Use Chrome or Edge 113+ with up-to-date GPU drivers, or use a cloud model.");
  else if (!shaderF16) notes.push("Your GPU lacks 16-bit float support. Using the larger f32 model builds.");

  const memoryGB = (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? null;
  const speechInput = !!(window.SpeechRecognition || window.webkitSpeechRecognition);
  const speechOutput = "speechSynthesis" in window;
  if (!speechInput) notes.push("This browser has no speech recognition. Use Chrome or Edge, or type your replies.");

  const ua = navigator.userAgent;
  const browser = /Edg\//.test(ua) ? "Edge" : /Chrome\//.test(ua) ? "Chrome" : /Firefox\//.test(ua) ? "Firefox" : /Safari\//.test(ua) ? "Safari" : "Other";
  if (browser === "Chrome") notes.push("Tip: Microsoft Edge has more natural Indian English and Hindi voices than Chrome.");

  return { webgpu, shaderF16, gpuVendor, gpuDescription, memoryGB, speechInput, speechOutput, browser, notes };
}

/** Pick a starting model from the coarse hints we have; a benchmark beats this. */
export function recommendModel(d: DeviceReport, language: LanguageMode): ModelOption {
  const byBase = (b: string) => MODELS.find(m => m.base === b)!;
  const discrete = /nvidia|amd|apple/i.test(d.gpuVendor);
  const lowMem = d.memoryGB !== null && d.memoryGB <= 8 && !discrete;
  if (lowMem) return byBase("Llama-3.2-1B-Instruct");
  if (language !== "en") return byBase("gemma-2-2b-it");
  return byBase("Qwen2.5-1.5B-Instruct");
}
