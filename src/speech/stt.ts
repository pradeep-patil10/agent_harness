// Speech input through the browser's Web Speech API (Chrome / Edge).
// Note: in Chrome and Edge this streams audio to the browser vendor's cloud
// recogniser. Hindi has no on-device option there today.

export interface SpeechInput {
  start(): void;
  stop(): void;
  setLang(lang: string): void;
  onInterim: (text: string) => void;
  onFinal: (text: string) => void;
  onError: (message: string, fatal: boolean) => void;
}

export function speechInputSupported(): boolean {
  return typeof window !== "undefined" && !!(window.SpeechRecognition || window.webkitSpeechRecognition);
}

const FATAL = new Set(["not-allowed", "service-not-allowed", "language-not-supported", "audio-capture"]);

export class WebSpeechInput implements SpeechInput {
  onInterim: (text: string) => void = () => {};
  onFinal: (text: string) => void = () => {};
  onError: (message: string, fatal: boolean) => void = () => {};

  private rec: SpeechRecognition | null = null;
  private active = false;
  private lang: string;
  private lastStart = 0;
  private quickRestarts = 0;
  private restartTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(lang: string) {
    this.lang = lang;
  }

  setLang(lang: string) {
    this.lang = lang;
    if (this.rec) this.rec.lang = lang;
  }

  start() {
    this.active = true;
    this.quickRestarts = 0;
    this.open();
  }

  stop() {
    this.active = false;
    if (this.restartTimer) clearTimeout(this.restartTimer);
    try {
      this.rec?.abort();
    } catch {
      // already stopped
    }
    this.rec = null;
  }

  private open() {
    const Ctor = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Ctor) {
      this.onError("Speech recognition isn't available in this browser. Use Chrome or Edge, or type your replies.", true);
      return;
    }
    const rec = new Ctor();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = this.lang;
    rec.maxAlternatives = 1;

    rec.onresult = (e: SpeechRecognitionEvent) => {
      let interim = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        const text = r[0]?.transcript ?? "";
        if (r.isFinal) {
          if (text.trim()) this.onFinal(text.trim());
        } else {
          interim += text;
        }
      }
      if (interim.trim()) this.onInterim(interim.trim());
    };

    rec.onerror = (e: SpeechRecognitionErrorEvent) => {
      if (e.error === "no-speech" || e.error === "aborted") return;
      const fatal = FATAL.has(e.error);
      if (fatal) this.active = false;
      this.onError(describe(e.error), fatal);
    };

    // Chrome ends recognition after a few seconds of silence even in
    // continuous mode, so restart it, backing off if it keeps dying at once.
    rec.onend = () => {
      if (!this.active || this.rec !== rec) return;
      const quick = Date.now() - this.lastStart < 1500;
      this.quickRestarts = quick ? this.quickRestarts + 1 : 0;
      if (this.quickRestarts > 8) {
        this.active = false;
        this.onError("Speech recognition keeps stopping. Check your microphone and network, or type instead.", true);
        return;
      }
      const delay = quick ? Math.min(250 * 2 ** this.quickRestarts, 5000) : 100;
      this.restartTimer = setTimeout(() => this.active && this.open(), delay);
    };

    this.rec = rec;
    this.lastStart = Date.now();
    try {
      rec.start();
    } catch (err) {
      this.onError(`Could not start the microphone: ${String(err)}`, false);
    }
  }
}

function describe(code: string): string {
  switch (code) {
    case "not-allowed":
    case "service-not-allowed":
      return "Microphone permission was denied. Allow mic access in the address bar, or type your replies.";
    case "audio-capture":
      return "No microphone found.";
    case "network":
      return "Speech recognition needs an internet connection. Retrying…";
    case "language-not-supported":
      return "This language isn't supported by your browser's speech recognition.";
    default:
      return `Speech recognition error: ${code}`;
  }
}
