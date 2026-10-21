import { pickVoice } from "../lib/lang";

export interface SpeechOutput {
  /** Resolves when the utterance finishes or is cancelled. */
  speak(text: string, lang: string): Promise<void>;
  cancel(): void;
}

/**
 * Browser speechSynthesis, one sentence per utterance. Short utterances
 * avoid Chrome's long-utterance cut-off bug and make barge-in immediate.
 */
export class BrowserTTS implements SpeechOutput {
  private current: { utterance: SpeechSynthesisUtterance; done: () => void } | null = null;

  constructor(
    private readonly prefs: { voiceURIs: Record<string, string | undefined>; rate: number },
  ) {}

  speak(text: string, lang: string): Promise<void> {
    const synth = window.speechSynthesis;
    return new Promise(resolve => {
      const u = new SpeechSynthesisUtterance(text);
      const voice = pickVoice(synth.getVoices(), lang, this.prefs.voiceURIs[lang]);
      if (voice) u.voice = voice;
      u.lang = voice?.lang ?? lang;
      u.rate = this.prefs.rate;
      let finished = false;
      const done = () => {
        if (finished) return;
        finished = true;
        clearTimeout(watchdog);
        if (this.current?.utterance === u) this.current = null;
        resolve();
      };
      // onend sometimes never fires in Chrome; don't let the call hang.
      const watchdog = setTimeout(done, 4000 + text.length * 120);
      u.onend = done;
      u.onerror = done;
      this.current = { utterance: u, done }; // also keeps u from being GC'd mid-utterance
      synth.speak(u);
    });
  }

  cancel(): void {
    const cur = this.current;
    this.current = null;
    window.speechSynthesis.cancel();
    cur?.done();
  }
}

/** Voice turned off: "speaks" instantly so the call flow is identical. */
export class SilentTTS implements SpeechOutput {
  async speak(): Promise<void> {}
  cancel(): void {}
}

export function speechOutputSupported(): boolean {
  return typeof window !== "undefined" && "speechSynthesis" in window;
}

/** speechSynthesis.getVoices() is empty until the browser loads them. */
export function loadVoices(timeoutMs = 2000): Promise<SpeechSynthesisVoice[]> {
  if (!speechOutputSupported()) return Promise.resolve([]);
  const synth = window.speechSynthesis;
  const now = synth.getVoices();
  if (now.length) return Promise.resolve(now);
  return new Promise(resolve => {
    const t = setTimeout(() => resolve(synth.getVoices()), timeoutMs);
    synth.addEventListener(
      "voiceschanged",
      () => {
        clearTimeout(t);
        resolve(synth.getVoices());
      },
      { once: true },
    );
  });
}
