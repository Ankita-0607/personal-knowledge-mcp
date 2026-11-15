import { Bm25Index } from "./bm25.js";
import { indexedText, type Chunk } from "./chunker.js";
import type { Embedder } from "./embedder.js";
import type { KnowledgeIndex } from "./store.js";

export const SEARCH_MODES = ["hybrid", "vector", "bm25"] as const;
export type SearchMode = (typeof SEARCH_MODES)[number];

export interface SearchHit {
  chunk: Chunk;
  /** Fused score in hybrid mode; cosine similarity or BM25 score in the single modes. */
  score: number;
  /** 1-based rank in each underlying ranking, when the chunk appeared in it. */
  ranks: { bm25?: number; vector?: number };
}

/**
 * Reciprocal rank fusion: score(d) = sum over rankings of weight / (k + rank(d)).
 * It needs no score calibration between BM25 and cosine similarity, which live
 * on unrelated scales, and rewards chunks that both rankings agree on. The
 * optional weights let one ranking count for more than the other.
 */
export function reciprocalRankFusion(
  rankings: number[][],
  k = 60,
  weights: number[] = rankings.map(() => 1),
): Array<{ index: number; score: number }> {
  const scores = new Map<number, number>();
  rankings.forEach((ranking, r) => {
    ranking.forEach((index, position) => {
      scores.set(index, (scores.get(index) ?? 0) + (weights[r] ?? 1) / (k + position + 1));
    });
  });
  return [...scores.entries()]
    .map(([index, score]) => ({ index, score }))
    .sort((a, b) => b.score - a.score || a.index - b.index);
}

function dot(a: Float32Array, b: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += a[i]! * b[i]!;
  return sum;
}

/**
 * How much the embedding ranking counts relative to the keyword ranking in
 * hybrid mode. The weight sweep in evals/run.ts found no weight that is
 * reliably better than equal weighting on the dev questions; see the README.
 */
export const DEFAULT_VECTOR_WEIGHT = 1;

export class Retriever {
  private readonly bm25: Bm25Index;

  constructor(
    private readonly index: KnowledgeIndex,
    private readonly embedder: Embedder,
    /** How many candidates each ranking contributes before fusion. */
    private readonly candidates = 30,
  ) {
    if (index.embedder !== embedder.id) {
      throw new Error(`index was built with ${index.embedder} but the active embedder is ${embedder.id}; re-index`);
    }
    this.bm25 = new Bm25Index(index.chunks.map(indexedText));
  }

  get size(): number {
    return this.index.chunks.length;
  }

  private keywordRanking(query: string) {
    return this.bm25.search(query, this.candidates);
  }

  private async vectorRanking(query: string) {
    const [queryVector] = await this.embedder.embed([query]);
    // Vectors are unit length, so the dot product is the cosine similarity.
    // A linear scan is exact and fast at personal-notes scale (thousands of chunks).
    return this.index.vectors
      .map((vector, index) => ({ index, score: dot(queryVector!, vector) }))
      .sort((a, b) => b.score - a.score || a.index - b.index)
      .slice(0, this.candidates);
  }

  async search(
    query: string,
    options: { limit?: number; mode?: SearchMode; vectorWeight?: number } = {},
  ): Promise<SearchHit[]> {
    const limit = options.limit ?? 5;
    const mode = options.mode ?? "hybrid";
    if (!query.trim() || this.size === 0) return [];

    const keyword = mode === "vector" ? [] : this.keywordRanking(query);
    const vector = mode === "bm25" ? [] : await this.vectorRanking(query);
    const bm25Rank = new Map(keyword.map((hit, i) => [hit.index, i + 1]));
    const vectorRank = new Map(vector.map((hit, i) => [hit.index, i + 1]));

    const ranked =
      mode === "hybrid"
        ? reciprocalRankFusion([keyword.map((h) => h.index), vector.map((h) => h.index)], 60, [
            1,
            options.vectorWeight ?? DEFAULT_VECTOR_WEIGHT,
          ])
        : mode === "bm25"
          ? keyword
          : vector;

    return ranked.slice(0, limit).map(({ index, score }) => ({
      chunk: this.index.chunks[index]!,
      score,
      ranks: { bm25: bm25Rank.get(index), vector: vectorRank.get(index) },
    }));
  }
}
