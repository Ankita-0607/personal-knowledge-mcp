/**
 * A small BM25 keyword index.
 *
 * Embeddings are good at meaning and poor at exact tokens: an acronym, a
 * ticket number, a person's name. BM25 is the opposite. The retriever runs
 * both and fuses the rankings.
 */

const STOPWORDS = new Set(
  "a an and are as at be but by do does for from had has have how i if in into is it its me my of on or our should so than that the their them then there these they this to was we were what when where which who why will with you your".split(
    " ",
  ),
);

/** Lowercase word tokens, minus stopwords, with a light plural fold ("metrics" -> "metric"). */
export function tokenize(text: string): string[] {
  const tokens: string[] = [];
  for (const raw of text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []) {
    if (STOPWORDS.has(raw)) continue;
    tokens.push(raw.length > 3 && raw.endsWith("s") && !raw.endsWith("ss") ? raw.slice(0, -1) : raw);
  }
  return tokens;
}

export interface Scored {
  index: number;
  score: number;
}

export class Bm25Index {
  private readonly termFrequencies: Array<Map<string, number>>;
  private readonly lengths: number[];
  private readonly documentFrequency = new Map<string, number>();
  private readonly averageLength: number;

  constructor(
    documents: string[],
    private readonly k1 = 1.5,
    private readonly b = 0.75,
  ) {
    this.termFrequencies = documents.map((doc) => {
      const frequencies = new Map<string, number>();
      for (const token of tokenize(doc)) frequencies.set(token, (frequencies.get(token) ?? 0) + 1);
      for (const token of frequencies.keys()) {
        this.documentFrequency.set(token, (this.documentFrequency.get(token) ?? 0) + 1);
      }
      return frequencies;
    });
    this.lengths = this.termFrequencies.map((tf) => [...tf.values()].reduce((a, c) => a + c, 0));
    this.averageLength = this.lengths.reduce((a, c) => a + c, 0) / Math.max(1, documents.length);
  }

  /** Documents with a non-zero score, best first. */
  search(query: string, limit: number): Scored[] {
    const terms = [...new Set(tokenize(query))];
    const n = this.termFrequencies.length;
    const scored: Scored[] = [];
    for (let i = 0; i < n; i++) {
      let score = 0;
      for (const term of terms) {
        const tf = this.termFrequencies[i]!.get(term);
        if (!tf) continue;
        const df = this.documentFrequency.get(term)!;
        const idf = Math.log(1 + (n - df + 0.5) / (df + 0.5));
        const norm = 1 - this.b + this.b * (this.lengths[i]! / this.averageLength);
        score += (idf * tf * (this.k1 + 1)) / (tf + this.k1 * norm);
      }
      if (score > 0) scored.push({ index: i, score });
    }
    return scored.sort((a, b) => b.score - a.score || a.index - b.index).slice(0, limit);
  }
}
