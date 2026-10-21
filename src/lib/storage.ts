import { createStore, del, entries, set } from "idb-keyval";
import type { SessionRecord } from "./types";

// Call history stays in this browser (IndexedDB). No backend.

const store = createStore("roleplay-studio", "sessions");

export async function saveSession(s: SessionRecord): Promise<void> {
  try {
    await set(s.id, s, store);
  } catch (err) {
    console.warn("Could not save session", err);
  }
}

export async function listSessions(): Promise<SessionRecord[]> {
  try {
    const all = await entries<string, SessionRecord>(store);
    return all.map(([, v]) => v).sort((a, b) => b.startedAt - a.startedAt);
  } catch {
    return [];
  }
}

export async function deleteSession(id: string): Promise<void> {
  await del(id, store);
}

/** Ask the browser not to evict cached models and history under storage pressure. */
export async function requestPersistentStorage(): Promise<boolean> {
  try {
    return (await navigator.storage?.persist?.()) ?? false;
  } catch {
    return false;
  }
}

export function downloadJSON(filename: string, data: unknown): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// Small per-browser preferences (selected model, language, voices…).
export function loadPrefs<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(`roleplay:${key}`);
    return raw ? { ...fallback, ...JSON.parse(raw) } : fallback;
  } catch {
    return fallback;
  }
}

export function savePrefs(key: string, value: unknown): void {
  try {
    localStorage.setItem(`roleplay:${key}`, JSON.stringify(value));
  } catch {
    // storage blocked: preferences just won't persist
  }
}
