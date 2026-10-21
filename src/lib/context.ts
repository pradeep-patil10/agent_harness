import { estimateTokens } from "./lang";
import type { ChatMessage } from "./types";

export interface BuildOptions {
  /** Max tokens for the prompt (context window minus reply budget). */
  budgetTokens: number;
  /** Some models (Gemma) have no system role; fold instructions into the first user turn. */
  supportsSystem: boolean;
  /** Short reminder appended to the final user turn on long calls to limit persona drift. */
  reminder?: string;
  /** Add the reminder once the history has at least this many messages. */
  reminderAfter?: number;
}

const DIGEST_TOKENS = 350;

/**
 * Turn the raw call history into a prompt that fits the context window.
 * Keeps the newest turns verbatim. Older turns are compressed into a short
 * "earlier in the call" digest instead of being dropped silently, so a
 * 30-minute call doesn't overflow a 4k-token model.
 */
export function buildMessages(system: string, history: ChatMessage[], opts: BuildOptions): ChatMessage[] {
  const turns = normalize(history);

  const systemCost = estimateTokens(system) + 8;
  let used = systemCost + DIGEST_TOKENS;
  let start = turns.length;
  while (start > 0) {
    const cost = estimateTokens(turns[start - 1].content) + 6;
    if (used + cost > opts.budgetTokens && start < turns.length) break;
    used += cost;
    start--;
  }
  // The kept window must begin with a user turn.
  while (start < turns.length && turns[start].role !== "user") start++;
  const kept = turns.slice(start);
  const dropped = turns.slice(0, start);

  let systemText = system;
  if (dropped.length > 0) systemText += "\n\n" + digest(dropped);

  if (kept.length === 0 || kept[kept.length - 1].role !== "user") {
    kept.push({ role: "user", content: "(silence)" });
  }

  if (opts.reminder && turns.length >= (opts.reminderAfter ?? 10)) {
    const last = kept[kept.length - 1];
    kept[kept.length - 1] = { ...last, content: `${last.content}\n\n(${opts.reminder})` };
  }

  if (opts.supportsSystem) return [{ role: "system", content: systemText }, ...kept];
  const [first, ...rest] = kept;
  return [{ role: "user", content: `${systemText}\n\n---\n${first.content}` }, ...rest];
}

/** Merge consecutive same-role messages, drop empties, ensure the first turn is the user's. */
export function normalize(history: ChatMessage[]): ChatMessage[] {
  const out: ChatMessage[] = [];
  for (const m of history) {
    if (m.role === "system") continue;
    const content = m.content.trim();
    if (!content) continue;
    const prev = out[out.length - 1];
    if (prev && prev.role === m.role) prev.content += " " + content;
    else out.push({ role: m.role, content });
  }
  if (out.length > 0 && out[0].role === "assistant") {
    out.unshift({ role: "user", content: "(The call connects.)" });
  }
  return out;
}

function digest(dropped: ChatMessage[]): string {
  const lines: string[] = [];
  let used = 0;
  // Newest dropped turns are most relevant: walk backwards, then restore order.
  for (let i = dropped.length - 1; i >= 0; i--) {
    const m = dropped[i];
    const who = m.role === "user" ? "Rep" : "You";
    const words = m.content.split(/\s+/);
    const line = `- ${who}: ${words.slice(0, 25).join(" ")}${words.length > 25 ? "…" : ""}`;
    const cost = estimateTokens(line);
    if (used + cost > DIGEST_TOKENS) break;
    used += cost;
    lines.push(line);
  }
  lines.reverse();
  return `Earlier in this call (older turns, abbreviated):\n${lines.join("\n")}`;
}
