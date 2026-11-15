import { tokenize } from "./bm25.js";

/**
 * Embeddings are computed locally. Indexing your notes sends nothing to any
 * service: the model is downloaded once and runs on your machine.
 */
export interface Embedder {
  /** Identifies the model; an index is only reused when this matches. */
  readonly id: string;
  /** Returns one L2-normalised vector per input text. */
  embed(texts: string[]): Promise<Float32Array[]>;
}

export const DEFAULT_MODEL = "Xenova/all-MiniLM-L6-v2";

function normalise(vector: Float32Array): Float32Array {
  let norm = 0;
  for (const value of vector) norm += value * value;
  norm = Math.sqrt(norm);
  if (norm > 0) for (let i = 0; i < vector.length; i++) vector[i] = vector[i]! / norm;
  return vector;
}

/** Sentence embeddings from a small transformer model, run locally with ONNX Runtime. */
export class LocalEmbedder implements Embedder {
  readonly id: string;
  private extractor: Promise<(texts: string[], options: object) => Promise<{ tolist(): number[][] }>> | undefined;

  constructor(
    private readonly model = process.env.KB_EMBEDDING_MODEL ?? DEFAULT_MODEL,
    private readonly batchSize = 16,
  ) {
    this.id = `local:${model}`;
  }

  private load() {
    // Imported lazily: the library is large, and keyword-only commands never need it.
    this.extractor ??= import("@huggingface/transformers").then(
      ({ pipeline }) => pipeline("feature-extraction", this.model) as never,
    );
    return this.extractor;
  }

  async embed(texts: string[]): Promise<Float32Array[]> {
    const extractor = await this.load();
    const vectors: Float32Array[] = [];
    for (let i = 0; i < texts.length; i += this.batchSize) {
      const output = await extractor(texts.slice(i, i + this.batchSize), { pooling: "mean", normalize: true });
      for (const row of output.tolist()) vectors.push(normalise(Float32Array.from(row)));
    }
    return vectors;
  }
}

/**
 * A deterministic, dependency-free embedder: hashes word unigrams and bigrams
 * into a fixed number of buckets. It captures word overlap, not meaning, so it
 * is a baseline and a test double, not a substitute for the real model. It is
 * also the fallback when the model cannot be downloaded (`--embedder hash`).
 */
export class HashingEmbedder implements Embedder {
  readonly id: string;

  constructor(private readonly dimensions = 512) {
    this.id = `hash:${dimensions}`;
  }

  private bucket(feature: string): { index: number; sign: number } {
    let h = 2166136261;
    for (let i = 0; i < feature.length; i++) {
      h ^= feature.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return { index: (h >>> 1) % this.dimensions, sign: h & 1 ? 1 : -1 };
  }

  async embed(texts: string[]): Promise<Float32Array[]> {
    return texts.map((text) => {
      const vector = new Float32Array(this.dimensions);
      const tokens = tokenize(text);
      tokens.forEach((token, i) => {
        const unigram = this.bucket(token);
        vector[unigram.index]! += unigram.sign;
        if (i > 0) {
          const bigram = this.bucket(`${tokens[i - 1]} ${token}`);
          vector[bigram.index]! += bigram.sign * 0.5;
        }
      });
      return normalise(vector);
    });
  }
}

export function createEmbedder(kind: string | undefined): Embedder {
  return kind === "hash" ? new HashingEmbedder() : new LocalEmbedder();
}
