import { DEFAULT_SETTINGS } from "./agent/CallController";
import type { LanguageMode } from "./lib/types";
import type { CloudConfig } from "./llm/openai";

export type EngineKind = "ondevice" | "cloud" | "demo";

export interface Prefs {
  engine: EngineKind;
  modelBase: string;
  cloud: CloudConfig;
  scenarioId: string;
  language: LanguageMode;
  fullDuplex: boolean;
  micOn: boolean;
  voiceOn: boolean;
  rate: number;
  endpointMs: number;
  voiceURIs: Record<string, string | undefined>;
  showMetrics: boolean;
}

export const DEFAULT_PREFS: Prefs = {
  engine: "ondevice",
  modelBase: "",
  cloud: { baseUrl: "https://openrouter.ai/api/v1", apiKey: "", model: "google/gemini-2.5-flash-lite" },
  scenarioId: "skeptical-vp",
  language: "en",
  fullDuplex: false,
  micOn: true,
  voiceOn: true,
  rate: 1.05,
  endpointMs: DEFAULT_SETTINGS.endpointMs,
  voiceURIs: {},
  showMetrics: true,
};
