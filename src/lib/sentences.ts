// Incremental sentence splitter for streamed LLM output. Each complete
// sentence is handed to TTS as soon as it exists, so speech starts before the
// full reply is generated. Understands the Devanagari danda (।).

const ABBREVIATIONS = new Set(["mr", "mrs", "ms", "dr", "st", "vs", "etc", "e.g", "i.e", "approx", "no", "inc", "ltd", "rs"]);
const FORCE_SPLIT_AT = 160;

export class SentenceSplitter {
  private buf = "";

  push(chunk: string): string[] {
    this.buf += chunk;
    const out: string[] = [];
    let cut: number;
    while ((cut = this.findBoundary()) !== -1) {
      const sentence = this.buf.slice(0, cut).trim();
      this.buf = this.buf.slice(cut);
      if (hasWords(sentence)) out.push(sentence);
    }
    return out;
  }

  flush(): string[] {
    const rest = this.buf.trim();
    this.buf = "";
    return hasWords(rest) ? [rest] : [];
  }

  /** Index just past the first sentence boundary, or -1 if none is certain yet. */
  private findBoundary(): number {
    const b = this.buf;
    for (let i = 0; i < b.length; i++) {
      const ch = b[i];
      if (ch === "\n") return i + 1;
      if (ch === "।" || ch === "!" || ch === "?") {
        let j = i + 1;
        while (j < b.length && /[!?।"'”’)\]]/.test(b[j])) j++;
        if (j >= b.length) return -1; // wait: more punctuation may follow
        return /\s/.test(b[j]) ? j : -1;
      }
      if (ch === ".") {
        const next = b[i + 1];
        if (next === undefined) return -1;
        if (/\d/.test(b[i - 1] ?? "") && /\d/.test(next)) continue; // 2.5
        if (!/\s|["'”’)\]]/.test(next)) continue; // e.g. "v1.2", "..."
        const word = /([A-Za-z.]+)$/.exec(b.slice(0, i))?.[1]?.toLowerCase() ?? "";
        if (ABBREVIATIONS.has(word)) continue;
        let j = i + 1;
        while (j < b.length && /["'”’)\]]/.test(b[j])) j++;
        if (j >= b.length) return -1;
        return j;
      }
    }
    // Very long run with no terminator: break at the last comma so TTS isn't starved.
    if (b.length > FORCE_SPLIT_AT) {
      const comma = Math.max(b.lastIndexOf(", "), b.lastIndexOf("; "));
      if (comma > 40) return comma + 1;
      const space = b.lastIndexOf(" ");
      if (space > 40) return space;
    }
    return -1;
  }
}

function hasWords(s: string): boolean {
  return /[\p{L}\p{N}]/u.test(s);
}
