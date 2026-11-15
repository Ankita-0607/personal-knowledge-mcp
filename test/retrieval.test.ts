import { describe, expect, it } from "vitest";
import { Bm25Index, tokenize } from "../src/bm25.js";
import { chunkMarkdown } from "../src/chunker.js";
import { HashingEmbedder, type Embedder } from "../src/embedder.js";
import { reciprocalRankFusion, Retriever } from "../src/retriever.js";
import type { KnowledgeIndex } from "../src/store.js";

describe("tokenize", () => {
  it("lowercases, drops stopwords and folds simple plurals", () => {
    expect(tokenize("What are the DORA Metrics?")).toEqual(["dora", "metric"]);
    expect(tokenize("class process bus")).toEqual(["class", "process", "bus"]);
  });

  it("keeps numbers and non-English letters", () => {
    expect(tokenize("Über 90 psi")).toEqual(["über", "90", "psi"]);
  });
});

describe("Bm25Index", () => {
  const docs = [
    "The transactional outbox avoids dual writes.",
    "Dead-letter queues hold events that failed. Every DLQ has an alarm.",
    "Idempotent consumers tolerate duplicate events.",
  ];

  it("ranks the document containing the query terms first", () => {
    expect(new Bm25Index(docs).search("DLQ alarm", 3)[0]!.index).toBe(1);
  });

  it("weights rare terms above common ones", () => {
    const index = new Bm25Index(["event event event bus", "event outbox", "event stream"]);
    expect(index.search("event outbox", 3)[0]!.index).toBe(1);
  });

  it("returns nothing when no term matches", () => {
    expect(new Bm25Index(docs).search("kubernetes", 3)).toEqual([]);
  });
});

describe("reciprocalRankFusion", () => {
  it("puts an item both rankings agree on above items only one ranking likes", () => {
    const fused = reciprocalRankFusion([
      [10, 20, 30],
      [40, 20, 50],
    ]);
    expect(fused[0]!.index).toBe(20);
    expect(fused.map((f) => f.index).sort()).toEqual([10, 20, 30, 40, 50]);
  });

  it("scores by 1 / (k + rank)", () => {
    const [first] = reciprocalRankFusion([[7], [7]], 60);
    expect(first!.score).toBeCloseTo(2 / 61, 10);
  });
});

/** An embedder with hand-set vectors, so a test controls what "similar in meaning" is. */
class FixedEmbedder implements Embedder {
  readonly id = "fixed";
  constructor(private readonly table: Record<string, number[]>) {}
  async embed(texts: string[]) {
    return texts.map((text) => {
      const key = Object.keys(this.table).find((k) => text.includes(k));
      return Float32Array.from(this.table[key ?? ""] ?? [0, 0, 1]);
    });
  }
}

async function indexOf(notes: Record<string, string>, embedder: Embedder): Promise<KnowledgeIndex> {
  const chunks = Object.entries(notes).flatMap(([path, text]) => chunkMarkdown(path, text));
  const vectors = await embedder.embed(chunks.map((c) => `${c.heading}\n${c.text}`));
  return { version: 1, embedder: embedder.id, built_at: "", chunks, vectors };
}

describe("Retriever", () => {
  const notes = {
    "cars.md": "# Cars\n\nThe automobile needs an oil change every year.\n",
    "pets.md": "# Pets\n\nThe vehicle registration for the dog trailer is in the drawer.\n",
    "food.md": "# Food\n\nPasta water should be salty.\n",
  };
  // "vehicle upkeep" shares a word with pets.md but means what cars.md says.
  const embedder = new FixedEmbedder({
    "vehicle upkeep": [1, 0, 0],
    automobile: [0.9, 0.1, 0],
    "dog trailer": [0.1, 0.9, 0],
    Pasta: [0, 0, 1],
  });

  it("keyword mode finds the shared word; vector mode finds the shared meaning", async () => {
    const retriever = new Retriever(await indexOf(notes, embedder), embedder);
    expect((await retriever.search("vehicle upkeep", { mode: "bm25" }))[0]!.chunk.path).toBe("pets.md");
    expect((await retriever.search("vehicle upkeep", { mode: "vector" }))[0]!.chunk.path).toBe("cars.md");
  });

  it("hybrid mode returns both and reports each ranking's position", async () => {
    const retriever = new Retriever(await indexOf(notes, embedder), embedder);
    const hits = await retriever.search("vehicle upkeep", { mode: "hybrid", limit: 2 });
    expect(hits.map((h) => h.chunk.path).sort()).toEqual(["cars.md", "pets.md"]);
    const pets = hits.find((h) => h.chunk.path === "pets.md")!;
    expect(pets.ranks).toEqual({ bm25: 1, vector: 2 });
  });

  it("honours the limit and returns nothing for an empty query", async () => {
    const hashing = new HashingEmbedder(64);
    const retriever = new Retriever(await indexOf(notes, hashing), hashing);
    expect(await retriever.search("the", { limit: 1, mode: "vector" })).toHaveLength(1);
    expect(await retriever.search("   ")).toEqual([]);
  });

  it("refuses an index built with a different embedding model", async () => {
    const index = await indexOf(notes, new HashingEmbedder(64));
    expect(() => new Retriever(index, new HashingEmbedder(128))).toThrow(/re-index/);
  });
});

describe("HashingEmbedder", () => {
  it("is deterministic, unit length, and closer for texts that share words", async () => {
    const embedder = new HashingEmbedder(256);
    const [a, b, c] = await embedder.embed(["release train schedule", "the release train leaves on Tuesday", "pasta water"]);
    const dot = (x: Float32Array, y: Float32Array) => x.reduce((sum, v, i) => sum + v * y[i]!, 0);
    expect(dot(a!, a!)).toBeCloseTo(1, 5);
    expect(dot(a!, b!)).toBeGreaterThan(dot(a!, c!));
    expect((await embedder.embed(["release train schedule"]))[0]).toEqual(a);
  });
});
