import type { ChatMessage, LanguageMode } from "../lib/types";
import type { LLMProvider, StreamOptions } from "./provider";

const REPLIES: Record<LanguageMode, string[]> = {
  en: [
    "Okay, but what exactly does it cost, and why is it better than what we have?",
    "Hmm. Our current vendor is half the price. How do I justify the difference?",
    "Do you have a customer like us who saw results in under three months?",
    "My team is already stretched. How much effort is the setup?",
    "Fine. Send me the details and let's talk about a small pilot next week. [END]",
  ],
  hinglish: [
    "अच्छा, लेकिन exactly cost क्या है, और ये हमारे current system से better कैसे है?",
    "देखिए, हमारा current vendor आधे price में देता है। ये difference मैं कैसे justify करूँ?",
    "कोई customer है हमारे जैसा जिसने तीन महीने में results देखे हों?",
    "मेरी team already busy है। Setup में कितना effort लगेगा?",
    "ठीक है। Details भेज दीजिए, next week एक छोटा pilot discuss करते हैं। [END]",
  ],
  hi: [
    "अच्छा, लेकिन इसकी कीमत क्या है, और ये हमारे मौजूदा सिस्टम से बेहतर कैसे है?",
    "हमारा मौजूदा वेंडर आधी कीमत में देता है। ये फ़र्क मैं कैसे समझाऊँ?",
    "क्या कोई ग्राहक है जिसने तीन महीने में नतीजे देखे हों?",
    "मेरी टीम पहले से व्यस्त है। इसे लगाने में कितनी मेहनत लगेगी?",
    "ठीक है। जानकारी भेज दीजिए, अगले हफ़्ते एक छोटे पायलट पर बात करते हैं। [END]",
  ],
};

/** Scripted buyer for trying the app without downloading a model. */
export class MockProvider implements LLMProvider {
  readonly label = "Demo · scripted buyer (no AI)";
  readonly promptBudget = 4000;
  readonly supportsSystem = true;
  constructor(
    private readonly language: LanguageMode = "en",
    private readonly delayMs = 40,
  ) {}

  async load(onProgress: (fraction: number, text: string) => void): Promise<void> {
    onProgress(1, "Demo mode ready");
  }

  async *stream(messages: ChatMessage[], opts: StreamOptions): AsyncIterable<string> {
    const lines = REPLIES[this.language];
    // Stateless: the n-th reply after the opener, so a new call starts from the top.
    const said = messages.filter(m => m.role === "assistant").length - 1;
    const reply = lines[Math.min(Math.max(said, 0), lines.length - 1)];
    for (const word of reply.split(/(?<= )/)) {
      if (opts.signal.aborted) return;
      if (this.delayMs > 0) await new Promise(r => setTimeout(r, this.delayMs));
      yield word;
    }
  }

  async dispose(): Promise<void> {}
}
