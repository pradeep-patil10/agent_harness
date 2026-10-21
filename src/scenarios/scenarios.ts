import type { LanguageMode } from "../lib/types";

export interface CoachingCheck {
  label: string;
  /**
   * Rep passes if any of these phrases appears in their speech (lower-cased match).
   * With hi-IN recognition, English words usually come back in Devanagari
   * ("pilot" → "पायलट"), so list those spellings too.
   */
  anyOf: string[];
  tip: string;
}

export interface Scenario {
  id: string;
  title: string;
  difficulty: "easy" | "medium" | "hard";
  buyer: { name: string; role: string; company: string; voiceGender: "male" | "female" };
  /** Shown to the rep before the call. */
  repBrief: string;
  /** Hidden from the rep: who the buyer is and how they behave. */
  persona: string;
  /** Facts the buyer only reveals if the rep asks good discovery questions. */
  hiddenFacts: string[];
  objections: string[];
  /** What counts as a win for the rep. */
  winCondition: string;
  opener: Record<LanguageMode, string>;
  checks: CoachingCheck[];
}

const DISCOVERY: CoachingCheck = {
  label: "Asked about current process",
  anyOf: ["currently", "today", "right now", "existing", "how do you", "what do you use", "abhi", "aajkal", "kaise", "अभी", "आजकल", "कैसे", "करंटली"],
  tip: "Ask how they handle this today before pitching.",
};

const NEXT_STEP: CoachingCheck = {
  label: "Proposed a concrete next step",
  anyOf: ["demo", "pilot", "trial", "meeting", "call next", "schedule", "calendar", "next week", "tomorrow", "kal", "agle hafte", "कल", "अगले हफ्ते", "अगले हफ़्ते", "पायलट", "डेमो", "ट्रायल", "मीटिंग", "शेड्यूल", "नेक्स्ट वीक"],
  tip: "End by asking for a specific next step with a date.",
};

export const SCENARIOS: Scenario[] = [
  {
    id: "skeptical-vp",
    title: "Skeptical VP Procurement: price objection",
    difficulty: "hard",
    buyer: { name: "Ramesh", role: "VP Procurement", company: "TransIndia Logistics (400 trucks)", voiceGender: "male" },
    repBrief:
      "You sell FleetIQ, a route-optimisation SaaS for trucking fleets. ₹1,200 per vehicle per month. Typical customers cut fuel cost 8–12% within 90 days. Goal: get Ramesh to agree to a 30-day pilot on 20 trucks.",
    persona:
      "You are Ramesh, VP of Procurement at TransIndia Logistics, a 400-truck fleet. You are skeptical, analytical and short on time. You have been burned by software vendors before.",
    hiddenFacts: [
      "Fuel is about 38% of your operating cost and rose 11% this year.",
      "Your current tool is an in-house Excel plus a ₹600/vehicle GPS tracker.",
      "Your CFO wants a cost-saving initiative to present next quarter.",
    ],
    objections: [
      "Price: your current tracker costs half as much.",
      "Proof: you want ROI within 3 months, with a reference customer.",
      "Effort: your drivers hate new apps.",
    ],
    winCondition: "Agree to a small, time-boxed pilot if the rep quantifies ROI and lowers your risk.",
    opener: {
      en: "Ramesh here. I have about ten minutes, so let's keep it quick. What's this about?",
      hinglish: "हाँ, Ramesh बोल रहा हूँ। मेरे पास बस दस minute हैं, तो जल्दी बताइए, किस बारे में है?",
      hi: "जी, रमेश बोल रहा हूँ। मेरे पास बस दस मिनट हैं, जल्दी बताइए किस बारे में बात है?",
    },
    checks: [
      DISCOVERY,
      { label: "Quantified ROI / savings", anyOf: ["roi", "save", "saving", "payback", "%", "percent", "lakh", "crore", "bachat", "बचत", "आरओआई", "सेविंग", "परसेंट", "प्रतिशत", "लाख", "करोड़"], tip: "Turn the price objection into a savings number." },
      { label: "Offered to reduce risk", anyOf: ["pilot", "trial", "guarantee", "reference", "case study", "cancel", "पायलट", "ट्रायल", "गारंटी", "रेफरेंस", "केस स्टडी"], tip: "Reduce perceived risk with a pilot or a reference." },
      NEXT_STEP,
    ],
  },
  {
    id: "busy-cmo",
    title: "Busy CMO: \"just email me a deck\"",
    difficulty: "medium",
    buyer: { name: "Priya", role: "Chief Marketing Officer", company: "UrbanNest Home Decor (D2C)", voiceGender: "female" },
    repBrief:
      "You sell ReviewBoost, a tool that collects and publishes customer video reviews on product pages. ₹25,000 per month. Customers see 10–15% higher conversion. Goal: earn a 20-minute demo slot instead of 'send me a deck'.",
    persona:
      "You are Priya, CMO of UrbanNest, a fast-growing D2C home decor brand. You are polite but in a hurry. You often say \"Can you just email me a deck?\" You only engage if the value is clear within 30 seconds.",
    hiddenFacts: [
      "Your conversion rate dropped from 2.4% to 1.9% this year.",
      "Returns are high because photos don't match the real product.",
      "You have budget left in Q4 that must be used.",
    ],
    objections: [
      "Time: you're between meetings.",
      "Deck: you want an email instead of a conversation.",
      "Priority: your team is busy with the festive sale.",
    ],
    winCondition: "Agree to a short demo if the rep connects to conversion or returns within the first minute.",
    opener: {
      en: "Hi, Priya here. I'm between meetings, can you just email me a deck?",
      hinglish: "Hi, Priya बोल रही हूँ। मैं meetings के बीच में हूँ, आप बस मुझे एक deck email कर दीजिए?",
      hi: "नमस्ते, प्रिया बोल रही हूँ। मैं मीटिंग्स के बीच में हूँ, आप मुझे बस ईमेल कर दीजिए?",
    },
    checks: [
      { label: "Led with a business outcome", anyOf: ["conversion", "sales", "revenue", "returns", "customers", "kharid", "बिक्री", "कन्वर्ज़न", "कन्वर्जन", "सेल्स", "रेवेन्यू", "रिटर्न", "कस्टमर"], tip: "Open with their metric, not your features." },
      DISCOVERY,
      { label: "Handled the 'send a deck' brush-off", anyOf: ["two minutes", "2 minutes", "one question", "quick question", "before i send", "deck", "do minute", "ek sawal", "डेक", "दो मिनट", "एक सवाल", "क्विक क्वेश्चन"], tip: "Acknowledge, then ask one sharp question before agreeing to send anything." },
      NEXT_STEP,
    ],
  },
  {
    id: "smb-owner",
    title: "SMB owner: switching cost and trust",
    difficulty: "easy",
    buyer: { name: "Arjun", role: "Founder", company: "Arjun Electricals (3 stores, Pune)", voiceGender: "male" },
    repBrief:
      "You sell KhataPro, a billing and inventory app for retail shops. ₹999 per store per month, with free data migration. Goal: get Arjun to try it free for 14 days in one store.",
    persona:
      "You are Arjun, owner of three electrical goods shops in Pune. You are friendly, chatty and price-conscious. You speak naturally and mix Hindi and English. You worry that switching software will disrupt billing and confuse your staff.",
    hiddenFacts: [
      "Your staff lose about an hour every day on stock counting.",
      "You lost a big customer last month because an item showed in stock but wasn't.",
      "Your nephew set up your current software and he has moved to Bangalore.",
    ],
    objections: [
      "Switching: migrating data sounds risky.",
      "Staff: your staff are not tech-savvy.",
      "Price: ₹999 × 3 stores feels like a lot.",
    ],
    winCondition: "Agree to a free trial in one store if the rep addresses migration and staff training.",
    opener: {
      en: "Hello, Arjun speaking. Yes, tell me, I have a few minutes before the shop gets busy.",
      hinglish: "Hello, Arjun बोल रहा हूँ। हाँ बोलिए, shop में rush आने से पहले थोड़ा time है।",
      hi: "हैलो, अर्जुन बोल रहा हूँ। हाँ बोलिए, दुकान में भीड़ आने से पहले थोड़ा समय है।",
    },
    checks: [
      DISCOVERY,
      { label: "Addressed migration risk", anyOf: ["migration", "migrate", "transfer", "import", "we will move", "free setup", "data", "माइग्रेशन", "माइग्रेट", "ट्रांसफर", "डाटा", "डेटा", "सेटअप"], tip: "Make switching feel safe: who moves the data, and how long it takes." },
      { label: "Addressed staff training", anyOf: ["training", "train", "easy", "simple", "support", "whatsapp", "sikhayenge", "aasan", "सिखा", "ट्रेनिंग", "आसान", "सिंपल", "सपोर्ट", "व्हाट्सएप"], tip: "Explain how staff will learn it in a day." },
      NEXT_STEP,
    ],
  },
];

const LANGUAGE_RULES: Record<LanguageMode, string> = {
  en: "Speak natural Indian English.",
  hinglish:
    "Speak natural Hinglish, the way urban Indian professionals talk: mix Hindi and English in the same sentence. Write Hindi words in Devanagari script and English business words (price, ROI, demo, software) in English letters.",
  hi: "Speak simple, natural spoken Hindi in Devanagari script. Common English business words are fine.",
};

export function buildSystemPrompt(s: Scenario, mode: LanguageMode): string {
  return [
    s.persona,
    `You are on a phone call with a salesperson. You are the BUYER, never the seller. Never mention that you are an AI or that this is a role-play.`,
    `Background you reveal ONLY if the salesperson asks good, specific questions:\n${s.hiddenFacts.map(f => `- ${f}`).join("\n")}`,
    `Objections to raise naturally over the call (one at a time, not all at once):\n${s.objections.map(o => `- ${o}`).join("\n")}`,
    `When to say yes: ${s.winCondition} Do not agree easily. If the salesperson is vague, pushy or ignores your concerns, get more impatient.`,
    `Style: ${LANGUAGE_RULES[mode]} This is spoken conversation: reply in 1 or 2 short sentences, no lists, no emojis, no stage directions.`,
    `If the call reaches a natural end (you agreed to a next step, or you want to hang up), say a short goodbye and end your reply with [END].`,
  ].join("\n\n");
}

export function reminderFor(s: Scenario, mode: LanguageMode): string {
  const lang = mode === "en" ? "English" : mode === "hi" ? "Hindi" : "Hinglish";
  return `Stay in character as ${s.buyer.name}, the buyer. Reply in ${lang}, 1-2 short spoken sentences.`;
}

export function getScenario(id: string): Scenario {
  return SCENARIOS.find(s => s.id === id) ?? SCENARIOS[0];
}
