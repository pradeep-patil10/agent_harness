import type { Scenario } from "../scenarios/scenarios";
import type { ScoreItem, TranscriptTurn } from "./types";

// Heuristic scorecard. Deliberately simple and transparent. Web Speech output
// has no reliable punctuation, so questions are detected by question words.

const QUESTION_STARTS = [
  "what", "how", "why", "when", "which", "who", "where", "can you", "could you", "would you",
  "do you", "does", "did you", "is there", "are you", "is it", "have you", "tell me",
  "kya", "kaise", "kyun", "kyon", "kab", "kaun", "kitna", "kitne", "kahan",
  "क्या", "कैसे", "क्यों", "कब", "कौन", "कितना", "कितने", "कहाँ", "बताइए",
];
const FILLERS = ["um", "umm", "uh", "uhh", "hmm", "like", "basically", "actually", "you know", "i mean", "sort of", "kind of", "matlab", "मतलब", "वो", "toh"];

const words = (t: string) => t.trim().split(/\s+/).filter(Boolean);

export function countQuestions(text: string): number {
  const marks = (text.match(/[?？]/g) ?? []).length;
  const lower = text.toLowerCase();
  // Each clause that opens with a question word counts as one question.
  const clauses = lower.split(/[.!?।,]|\band\b|\bor\b/);
  let byWord = 0;
  for (const c of clauses) {
    const t = c.trim();
    if (QUESTION_STARTS.some(q => t.startsWith(q + " ") || t === q)) byWord++;
    else if (/(^|\s)(kya|क्या)(\s|$)/u.test(t)) byWord++;
  }
  return Math.max(marks, byWord);
}

export function countFillers(text: string): number {
  const lower = ` ${text.toLowerCase().replace(/[.,!?।]/g, " ")} `;
  let n = 0;
  for (const f of FILLERS) {
    let idx = 0;
    const needle = ` ${f} `;
    while ((idx = lower.indexOf(needle, idx)) !== -1) {
      n++;
      idx += needle.length - 1;
    }
  }
  return n;
}

export function scoreCall(turns: TranscriptTurn[], scenario: Scenario, durationMs: number): ScoreItem[] {
  const rep = turns.filter(t => t.role === "rep");
  const buyer = turns.filter(t => t.role === "buyer");
  const repWords = rep.reduce((n, t) => n + words(t.text).length, 0);
  const buyerWords = buyer.reduce((n, t) => n + words(t.text).length, 0);
  const total = repWords + buyerWords;
  const items: ScoreItem[] = [];
  const minutes = Math.max(durationMs / 60000, 0.5);

  items.push({ label: "Call length", value: formatDuration(durationMs), verdict: rep.length >= 4 ? "good" : "warn", tip: rep.length < 4 ? "Very short call. Try to keep the conversation going." : undefined });

  if (total > 0) {
    const ratio = Math.round((repWords / total) * 100);
    items.push({
      label: "Your talk share",
      value: `${ratio}%`,
      verdict: ratio <= 60 ? "good" : ratio <= 72 ? "warn" : "bad",
      tip: ratio > 60 ? "You talked most of the call. Ask more and let the buyer talk." : undefined,
    });
  }

  const questions = rep.reduce((n, t) => n + countQuestions(t.text), 0);
  items.push({
    label: "Questions asked",
    value: String(questions),
    verdict: questions >= 4 ? "good" : questions >= 2 ? "warn" : "bad",
    tip: questions < 4 ? "Aim for at least 4 discovery questions." : undefined,
  });

  const longest = rep.reduce((m, t) => Math.max(m, words(t.text).length), 0);
  items.push({
    label: "Longest monologue",
    value: `${longest} words`,
    verdict: longest <= 80 ? "good" : longest <= 140 ? "warn" : "bad",
    tip: longest > 80 ? "Break long pitches up with a check-in question." : undefined,
  });

  const fillers = rep.reduce((n, t) => n + countFillers(t.text), 0);
  const perMin = fillers / minutes;
  items.push({
    label: "Filler words",
    value: `${fillers} (${perMin.toFixed(1)}/min)`,
    verdict: perMin <= 3 ? "good" : perMin <= 6 ? "warn" : "bad",
    tip: perMin > 3 ? "Replace fillers with a short pause." : undefined,
  });

  const repText = rep.map(t => t.text.toLowerCase()).join(" ");
  for (const check of scenario.checks) {
    const hit = check.anyOf.some(k => repText.includes(k.toLowerCase()));
    items.push({ label: check.label, value: hit ? "Yes" : "Not detected", verdict: hit ? "good" : "bad", tip: hit ? undefined : check.tip });
  }
  return items;
}

export function formatDuration(ms: number): string {
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
