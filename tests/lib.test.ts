import { describe, expect, it } from "vitest";
import { buildMessages, normalize } from "../src/lib/context";
import { devanagariRatio, pickVoice, ttsLangFor } from "../src/lib/lang";
import { countFillers, countQuestions, scoreCall } from "../src/lib/scoring";
import { SentenceSplitter } from "../src/lib/sentences";
import { ThinkStripper } from "../src/llm/provider";
import { SCENARIOS, buildSystemPrompt } from "../src/scenarios/scenarios";

const split = (chunks: string[]) => {
  const s = new SentenceSplitter();
  const out = chunks.flatMap(c => s.push(c));
  return [...out, ...s.flush()];
};

describe("SentenceSplitter", () => {
  it("emits sentences as they complete across chunk boundaries", () => {
    const s = new SentenceSplitter();
    expect(s.push("Hello the")).toEqual([]);
    expect(s.push("re. How are")).toEqual(["Hello there."]);
    expect(s.push(" you? Fine")).toEqual(["How are you?"]);
    expect(s.flush()).toEqual(["Fine"]);
  });

  it("does not split decimals, abbreviations or ellipsis-free versions", () => {
    expect(split(["It costs 2.5 lakh. Mr. Sharma agreed. Use v1.2 now."])).toEqual([
      "It costs 2.5 lakh.",
      "Mr. Sharma agreed.",
      "Use v1.2 now.",
    ]);
  });

  it("splits on the Devanagari danda", () => {
    expect(split(["हाँ, price ज़्यादा है। ", "ROI क्या है?"])).toEqual(["हाँ, price ज़्यादा है।", "ROI क्या है?"]);
  });

  it("keeps trailing punctuation and quotes together", () => {
    expect(split(['He said "no!" Then left.'])).toEqual(['He said "no!"', "Then left."]);
  });

  it("force-splits very long runs without punctuation", () => {
    const long = "word ".repeat(30) + "and, " + "more ".repeat(20);
    const out = split([long]);
    expect(out.length).toBeGreaterThan(1);
    expect(out.join(" ").replace(/\s+/g, " ").trim()).toBe(long.replace(/\s+/g, " ").trim());
  });
});

describe("ThinkStripper", () => {
  it("removes think blocks split across chunks", () => {
    const t = new ThinkStripper();
    const out = ["<thi", "nk>secret", " stuff</th", "ink>Hello", " <", "b>x"].map(c => t.push(c)).join("") + t.flush();
    expect(out).toBe("Hello <b>x");
  });
});

describe("language helpers", () => {
  it("routes sentences to the right voice", () => {
    expect(devanagariRatio("हाँ ठीक है")).toBe(1);
    expect(ttsLangFor("Okay, tell me the price.", "hinglish")).toBe("en-IN");
    expect(ttsLangFor("हाँ, price थोड़ा ज़्यादा है।", "hinglish")).toBe("hi-IN");
    expect(ttsLangFor("हाँ", "en")).toBe("en-IN");
  });

  it("prefers natural voices and skips malformed ones", () => {
    const v = (name: string, lang: string) => ({ name, lang, localService: true, voiceURI: name });
    const voices = [
      v("Microsoft undefined Online (Natural) - undefined", "en-IN"),
      v("Microsoft Heera", "en-IN"),
      v("Microsoft Neerja Online (Natural) - English (India)", "en-IN"),
      v("Google US English", "en-US"),
      v("Microsoft Kalpana", "hi-IN"),
    ];
    expect(pickVoice(voices, "en-IN")?.name).toContain("Neerja");
    expect(pickVoice(voices, "hi-IN")?.name).toBe("Microsoft Kalpana");
    expect(pickVoice([v("Google US English", "en-US")], "en-IN")?.name).toBe("Google US English");
    expect(pickVoice([v("Google US English", "en-US")], "hi-IN")).toBeNull();
  });
});

describe("buildMessages", () => {
  it("merges same-role turns and starts with a user turn", () => {
    const n = normalize([
      { role: "assistant", content: "Hello?" },
      { role: "user", content: "Hi" },
      { role: "user", content: "Ramesh" },
    ]);
    expect(n.map(m => m.role)).toEqual(["user", "assistant", "user"]);
    expect(n[2].content).toBe("Hi Ramesh");
  });

  it("keeps the prompt under budget on a long call and digests older turns", () => {
    const history = Array.from({ length: 200 }, (_, i) => ({
      role: (i % 2 ? "assistant" : "user") as "user" | "assistant",
      content: `Turn ${i}: ` + "we talked about pricing and the pilot scope again ".repeat(4),
    }));
    history.push({ role: "user", content: "Final question?" });
    const msgs = buildMessages("SYSTEM", history, { budgetTokens: 3000, supportsSystem: true });
    const totalChars = msgs.reduce((n, m) => n + m.content.length, 0);
    expect(totalChars / 3.5).toBeLessThan(3200);
    expect(msgs[0].role).toBe("system");
    expect(msgs[0].content).toContain("Earlier in this call");
    expect(msgs[1].role).toBe("user");
    expect(msgs.at(-1)!.content).toContain("Final question?");
  });

  it("folds the system prompt into the first user turn for models without a system role", () => {
    const msgs = buildMessages("SYS", [{ role: "user", content: "Hi" }], { budgetTokens: 1000, supportsSystem: false });
    expect(msgs).toHaveLength(1);
    expect(msgs[0]).toEqual({ role: "user", content: "SYS\n\n---\nHi" });
  });

  it("adds the persona reminder only on longer calls", () => {
    const short = buildMessages("S", [{ role: "user", content: "Hi" }], { budgetTokens: 1000, supportsSystem: true, reminder: "Stay", reminderAfter: 3 });
    expect(short.at(-1)!.content).toBe("Hi");
    const hist = ["a", "b", "c"].map((c, i) => ({ role: (i % 2 ? "assistant" : "user") as "user" | "assistant", content: c }));
    const long = buildMessages("S", hist, { budgetTokens: 1000, supportsSystem: true, reminder: "Stay", reminderAfter: 3 });
    expect(long.at(-1)!.content).toBe("c\n\n(Stay)");
  });
});

describe("scoring", () => {
  it("counts questions without punctuation, in English and Hindi", () => {
    expect(countQuestions("how do you track fuel today and what does it cost")).toBe(2);
    expect(countQuestions("aap abhi kya use karte hain")).toBe(1);
    expect(countQuestions("आप अभी क्या use करते हैं")).toBe(1);
    expect(countQuestions("We save you money.")).toBe(0);
  });

  it("counts filler words", () => {
    expect(countFillers("Um so basically, you know, it's like great")).toBe(4);
  });

  it("scores a call against scenario checks", () => {
    const sc = SCENARIOS[0];
    const items = scoreCall(
      [
        { role: "buyer", text: "What is this about?", at: 0 },
        { role: "rep", text: "How do you plan routes today? What does fuel cost you?", at: 5000 },
        { role: "buyer", text: "Fuel is 38 percent.", at: 9000 },
        { role: "rep", text: "We typically save 10 percent, so the ROI pays back fast. Can we run a pilot next week?", at: 15000 },
      ],
      sc,
      120000,
    );
    const get = (l: string) => items.find(i => i.label === l)!;
    expect(get("Asked about current process").verdict).toBe("good");
    expect(get("Quantified ROI / savings").verdict).toBe("good");
    expect(get("Proposed a concrete next step").verdict).toBe("good");
    expect(get("Questions asked").value).toBe("3");
  });
});

describe("scenarios", () => {
  it("every scenario has openers for all languages and a usable prompt", () => {
    for (const s of SCENARIOS) {
      for (const lang of ["en", "hinglish", "hi"] as const) {
        expect(s.opener[lang].length).toBeGreaterThan(5);
        const p = buildSystemPrompt(s, lang);
        expect(p).toContain(s.buyer.name);
        expect(p).toContain("[END]");
      }
    }
  });
});
