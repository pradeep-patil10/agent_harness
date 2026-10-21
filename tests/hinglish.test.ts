import { describe, expect, it } from "vitest";
import { buildMessages } from "../src/lib/context";
import { estimateTokens, sttLang, ttsLangFor } from "../src/lib/lang";
import { countQuestions, scoreCall } from "../src/lib/scoring";
import { SentenceSplitter } from "../src/lib/sentences";
import type { TranscriptTurn } from "../src/lib/types";
import { MockProvider } from "../src/llm/mock";
import { SCENARIOS, buildSystemPrompt, reminderFor } from "../src/scenarios/scenarios";

const ramesh = SCENARIOS[0];

const splitAll = (text: string) => {
  const s = new SentenceSplitter();
  return [...s.push(text), ...s.flush()];
};

describe("Hinglish mode: speech plumbing", () => {
  it("listens with hi-IN, which handles mixed Hindi-English speech best", () => {
    expect(sttLang("hinglish")).toBe("hi-IN");
  });

  it("asks the model for Devanagari Hindi + Latin English words", () => {
    const p = buildSystemPrompt(ramesh, "hinglish");
    expect(p).toContain("Hinglish");
    expect(p).toContain("Devanagari");
    expect(reminderFor(ramesh, "hinglish")).toContain("Hinglish");
  });

  it("speaks Hindi-heavy sentences with the Hindi voice, English-heavy ones with the English voice", () => {
    expect(ttsLangFor(ramesh.opener.hinglish, "hinglish")).toBe("hi-IN");
    expect(ttsLangFor("मेरी team already busy है।", "hinglish")).toBe("hi-IN");
    expect(ttsLangFor("Setup में कितना effort लगेगा?", "hinglish")).toBe("hi-IN");
    expect(ttsLangFor("Okay, just send me the deck.", "hinglish")).toBe("en-IN");
    // English voices can't read Devanagari, so even one Hindi word routes to the Hindi voice.
    expect(ttsLangFor("Okay, send the deck, फिर देखते हैं।", "hinglish")).toBe("hi-IN");
  });

  it("splits mixed-script replies into sentences at । ? and .", () => {
    const reply = "देखिए, हमारा current vendor आधे price में देता है। ये difference मैं कैसे justify करूँ? Send me details.";
    expect(splitAll(reply)).toEqual([
      "देखिए, हमारा current vendor आधे price में देता है।",
      "ये difference मैं कैसे justify करूँ?",
      "Send me details.",
    ]);
  });

  it("budgets Devanagari as more tokens than Latin text of the same length", () => {
    expect(estimateTokens("कितना खर्च होता है")).toBeGreaterThan(estimateTokens("how much it costs!"));
  });

  it("keeps a 30-minute Hinglish call inside the on-device budget", () => {
    const history = Array.from({ length: 120 }, (_, i) => ({
      role: (i % 2 ? "assistant" : "user") as "user" | "assistant",
      content: i % 2 ? "देखिए, price ज़्यादा है, ROI कब तक दिखेगा?" : "सर, हमारे customers को तीन महीने में दस percent fuel की बचत होती है।",
    }));
    const msgs = buildMessages(buildSystemPrompt(ramesh, "hinglish"), history, { budgetTokens: 3696, supportsSystem: true });
    const tokens = msgs.reduce((n, m) => n + estimateTokens(m.content) + 6, 0);
    expect(tokens).toBeLessThanOrEqual(3696 + 50);
    expect(msgs.at(-1)!.role).toBe("user");
  });
});

describe("Hinglish mode: scorecard on what hi-IN recognition actually outputs", () => {
  // hi-IN recognition usually writes English words in Devanagari ("pilot" → "पायलट").
  const devanagariCall: TranscriptTurn[] = [
    { role: "buyer", text: ramesh.opener.hinglish, at: 0 },
    { role: "rep", text: "सर आप अभी रूट्स कैसे प्लान करते हैं और फ्यूल पर कितना खर्च होता है", at: 4000 },
    { role: "buyer", text: "Excel से करते हैं, fuel करीब 38 percent है।", at: 9000 },
    { role: "rep", text: "हमारे कस्टमर्स को तीन महीने में दस परसेंट की बचत होती है तो आरओआई जल्दी आता है", at: 14000 },
    { role: "buyer", text: "हम्म, proof क्या है?", at: 19000 },
    { role: "rep", text: "बीस ट्रक्स पर तीस दिन का फ्री पायलट कर लेते हैं, अगले हफ्ते शुरू करें", at: 24000 },
  ];

  it("detects Hindi questions even when the question word is mid-sentence", () => {
    expect(countQuestions("सर आप अभी रूट्स कैसे प्लान करते हैं और फ्यूल पर कितना खर्च होता है")).toBe(2);
    expect(countQuestions("aap abhi routes kaise plan karte ho aur kitna kharcha hota hai")).toBe(2);
    expect(countQuestions("हम दस परसेंट बचत करवाते हैं")).toBe(0);
  });

  it("passes every scenario check for a good Devanagari-transcribed pitch", () => {
    const items = scoreCall(devanagariCall, ramesh, 120000);
    for (const label of ["Asked about current process", "Quantified ROI / savings", "Offered to reduce risk", "Proposed a concrete next step"]) {
      expect(items.find(i => i.label === label)?.verdict, label).toBe("good");
    }
  });

  it("also works when the rep types romanised Hinglish", () => {
    const typed: TranscriptTurn[] = [
      { role: "rep", text: "aap abhi routes kaise plan karte ho?", at: 1000 },
      { role: "rep", text: "hum 10 percent bachat karwa dete hain", at: 5000 },
      { role: "rep", text: "agle hafte ek pilot karein?", at: 9000 },
    ];
    const items = scoreCall(typed, ramesh, 60000);
    expect(items.find(i => i.label === "Asked about current process")?.verdict).toBe("good");
    expect(items.find(i => i.label === "Quantified ROI / savings")?.verdict).toBe("good");
    expect(items.find(i => i.label === "Proposed a concrete next step")?.verdict).toBe("good");
  });

  it("does not pass checks for an unrelated Hinglish pitch", () => {
    const weak: TranscriptTurn[] = [{ role: "rep", text: "हमारा प्रोडक्ट बहुत अच्छा है, आप इसे ले लीजिए", at: 1000 }];
    const items = scoreCall(weak, ramesh, 60000);
    expect(items.filter(i => ["Asked about current process", "Quantified ROI / savings", "Offered to reduce risk", "Proposed a concrete next step"].includes(i.label)).every(i => i.verdict === "bad")).toBe(true);
  });

  it("every scenario check has Devanagari spellings for Hinglish speakers", () => {
    for (const s of SCENARIOS) {
      for (const c of s.checks) expect(c.anyOf.some(k => /[\u0900-\u097F]/.test(k)), `${s.id}: ${c.label}`).toBe(true);
    }
  });
});

describe("Hinglish demo buyer", () => {
  it("replies in Hinglish and restarts from the first line on a new call", async () => {
    const mock = new MockProvider("hinglish", 0);
    const signal = new AbortController().signal;
    const read = async (assistantTurns: number) => {
      const messages = [
        { role: "system" as const, content: "s" },
        ...Array.from({ length: assistantTurns }, () => ({ role: "assistant" as const, content: "x" })),
        { role: "user" as const, content: "hi" },
      ];
      let out = "";
      for await (const c of mock.stream(messages, { maxTokens: 50, temperature: 0, signal })) out += c;
      return out;
    };
    expect(await read(1)).toContain("exactly cost क्या है");
    expect(await read(2)).toContain("current vendor");
    expect(await read(1)).toContain("exactly cost क्या है");
  });
});
