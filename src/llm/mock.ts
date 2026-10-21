import type { ChatMessage } from "../lib/types";
import type { LLMProvider, StreamOptions } from "./provider";

const REPLIES = [
  "Okay, but what exactly does it cost, and why is it better than what we have?",
  "Hmm. Our current vendor is half the price. How do I justify the difference?",
  "Do you have a customer like us who saw results in under three months?",
  "My team is already stretched. How much effort is the setup?",
  "Fine. Send me the details and let's talk about a small pilot next week. [END]",
];

/** Scripted buyer for trying the app without downloading a model. */
export class MockProvider implements LLMProvider {
  readonly label = "Demo · scripted buyer (no AI)";
  readonly promptBudget = 4000;
  readonly supportsSystem = true;
  private turn = 0;

  constructor(private readonly delayMs = 40) {}

  async load(onProgress: (fraction: number, text: string) => void): Promise<void> {
    onProgress(1, "Demo mode ready");
  }

  async *stream(_messages: ChatMessage[], opts: StreamOptions): AsyncIterable<string> {
    const reply = REPLIES[Math.min(this.turn++, REPLIES.length - 1)];
    for (const word of reply.split(/(?<= )/)) {
      if (opts.signal.aborted) return;
      if (this.delayMs > 0) await new Promise(r => setTimeout(r, this.delayMs));
      yield word;
    }
  }

  async dispose(): Promise<void> {}
}
