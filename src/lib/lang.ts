import type { LanguageMode } from "./types";

const DEVANAGARI = /[ऀ-ॿ]/g;
const LETTER = /[\p{L}\p{M}]/gu;

/** Share of letters that are Devanagari (0..1). */
export function devanagariRatio(text: string): number {
  const letters = text.match(LETTER)?.length ?? 0;
  if (letters === 0) return 0;
  return (text.match(DEVANAGARI)?.length ?? 0) / letters;
}

/** STT recognition language for a mode. Web Speech takes one language per session. */
export function sttLang(mode: LanguageMode): string {
  return mode === "en" ? "en-IN" : "hi-IN";
}

/** Which voice language should read this sentence. */
export function ttsLangFor(sentence: string, mode: LanguageMode): "en-IN" | "hi-IN" {
  if (mode === "en") return "en-IN";
  if (mode === "hi") return "hi-IN";
  return devanagariRatio(sentence) > 0.2 ? "hi-IN" : "en-IN";
}

export interface VoiceLike {
  name: string;
  lang: string;
  localService: boolean;
  voiceURI: string;
}

/**
 * Pick the best voice for a language. Prefers natural/neural voices (Edge's
 * online voices are much better than the legacy ones), rejects malformed
 * entries (Edge 150 reports "Microsoft undefined Online (Natural)").
 */
export function pickVoice<V extends VoiceLike>(voices: V[], lang: string, preferredURI?: string): V | null {
  const valid = voices.filter(v => v.name && !/undefined/i.test(v.name) && v.lang);
  if (preferredURI) {
    const p = valid.find(v => v.voiceURI === preferredURI);
    if (p && p.lang.toLowerCase().startsWith(lang.slice(0, 2).toLowerCase())) return p;
  }
  const norm = (l: string) => l.replace("_", "-").toLowerCase();
  const target = norm(lang);
  const base = target.slice(0, 2);
  const score = (v: V) => {
    const l = norm(v.lang);
    let s = 0;
    if (l === target) s += 100;
    else if (l.startsWith(base)) s += base === "en" ? (l === "en-gb" ? 40 : 30) : 50;
    else return -1;
    if (/natural|neural|online|premium|enhanced/i.test(v.name)) s += 20;
    if (/google/i.test(v.name)) s += 5;
    return s;
  };
  let best: V | null = null;
  let bestScore = -1;
  for (const v of valid) {
    const s = score(v);
    if (s > bestScore) {
      best = v;
      bestScore = s;
    }
  }
  return best;
}

/** Rough token estimate. Devanagari tokenises far worse than Latin on most small models. */
export function estimateTokens(text: string): number {
  const deva = text.match(DEVANAGARI)?.length ?? 0;
  const rest = text.length - deva;
  return Math.ceil(rest / 3.5 + deva / 1.2);
}
