import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createEmbedder } from "../src/embedder.js";
import { Retriever, SEARCH_MODES, type SearchMode } from "../src/retriever.js";
import { buildIndex } from "../src/store.js";
import { EVALS_DIR, isCorrect, loadGolden, NOTES_DIR, type GoldenCase } from "./golden.js";

/**
 * Retrieval eval: for every answerable question in the golden set, is the
 * passage that answers it in the top results? Compares keyword-only,
 * embedding-only and hybrid ranking on the same index.
 *
 *   npm run eval                    local embedding model (downloads it on first run)
 *   npm run eval -- --embedder hash no download; a lexical baseline for the vector column
 */

const DEPTH = 10;
const embedderKind = process.argv.includes("--embedder")
  ? process.argv[process.argv.indexOf("--embedder") + 1]
  : process.env.KB_EMBEDDER;

interface Metrics {
  n: number;
  recall1: number;
  recall3: number;
  recall5: number;
  mrr: number;
}

function summarise(ranks: Array<number | null>): Metrics {
  const n = ranks.length;
  const within = (k: number) => ranks.filter((r) => r !== null && r <= k).length / n;
  const mrr = ranks.reduce<number>((sum, r) => sum + (r ? 1 / r : 0), 0) / n;
  return { n, recall1: within(1), recall3: within(3), recall5: within(5), mrr };
}

const embedder = createEmbedder(embedderKind);
const started = Date.now();
const { index, stats } = await buildIndex(NOTES_DIR, embedder);
const retriever = new Retriever(index, embedder);
const cases = loadGolden().filter((c) => c.type !== "unanswerable");

const ranksByMode = {} as Record<SearchMode, Map<string, number | null>>;
for (const mode of SEARCH_MODES) {
  ranksByMode[mode] = new Map();
  for (const golden of cases) {
    const hits = await retriever.search(golden.question, { limit: DEPTH, mode });
    const position = hits.findIndex((hit) => isCorrect(hit, golden));
    ranksByMode[mode].set(golden.id, position === -1 ? null : position + 1);
  }
}

const pct = (x: number) => `${(x * 100).toFixed(0)}%`;
const row = (label: string, m: Metrics) =>
  `| ${label} | ${m.n} | ${pct(m.recall1)} | ${pct(m.recall3)} | ${pct(m.recall5)} | ${m.mrr.toFixed(3)} |`;
const metricsFor = (mode: SearchMode, subset: GoldenCase[]) => summarise(subset.map((c) => ranksByMode[mode].get(c.id)!));

const LABEL: Record<SearchMode, string> = { bm25: "Keyword (BM25)", vector: "Embeddings", hybrid: "Hybrid (RRF)" };
const header = ["| Ranking | Questions | Recall@1 | Recall@3 | Recall@5 | MRR@10 |", "|---|---:|---:|---:|---:|---:|"];
const lines = [
  "## Retrieval eval",
  "",
  `Embedder: \`${embedder.id}\` · ${stats.files} notes, ${stats.chunks} passages · ${cases.length} questions`,
  "",
  "A result counts only if it is the exact section that answers the question, not just the right note.",
  "",
  "### All questions",
  "",
  ...header,
  ...(["bm25", "vector", "hybrid"] as const).map((mode) => row(LABEL[mode], metricsFor(mode, cases))),
];
for (const type of ["paraphrase", "keyword"] as const) {
  const subset = cases.filter((c) => c.type === type);
  lines.push(
    "",
    `### ${type === "paraphrase" ? "Paraphrased questions (few shared words with the note)" : "Keyword questions (share the note's key terms)"}`,
    "",
    ...header,
    ...(["bm25", "vector", "hybrid"] as const).map((mode) => row(LABEL[mode], metricsFor(mode, subset))),
  );
}
const misses = cases.filter((c) => (ranksByMode.hybrid.get(c.id) ?? Infinity) > 3);
if (misses.length > 0) {
  lines.push("", "### Hybrid misses (right section not in the top 3)", "");
  for (const miss of misses) {
    const rank = ranksByMode.hybrid.get(miss.id);
    lines.push(`- ${miss.id} "${miss.question}" → expected ${miss.path} § ${miss.sections!.join(" / ")}; ${rank ? `found at rank ${rank}` : `not in the top ${DEPTH}`}`);
  }
}
// Weight sweep for hybrid fusion. The weight is chosen on the odd-numbered
// questions (dev) and checked on the even-numbered ones (test), so the default
// is not tuned on the same questions it is reported on.
const SWEEP = [0.5, 1, 2, 3, 4, 6];
const numberOf = (c: GoldenCase) => Number(c.id.slice(1));
const dev = cases.filter((c) => numberOf(c) % 2 === 1);
const test = cases.filter((c) => numberOf(c) % 2 === 0);
const sweep: Array<{ weight: number; dev: Metrics; test: Metrics }> = [];
for (const weight of SWEEP) {
  const ranks = new Map<string, number | null>();
  for (const golden of cases) {
    const hits = await retriever.search(golden.question, { limit: DEPTH, mode: "hybrid", vectorWeight: weight });
    const position = hits.findIndex((hit) => isCorrect(hit, golden));
    ranks.set(golden.id, position === -1 ? null : position + 1);
  }
  sweep.push({
    weight,
    dev: summarise(dev.map((c) => ranks.get(c.id)!)),
    test: summarise(test.map((c) => ranks.get(c.id)!)),
  });
}
lines.push(
  "",
  "### Hybrid fusion: embedding weight sweep",
  "",
  `Weight of the embedding ranking relative to the keyword ranking (keyword = 1). Dev = ${dev.length} odd-numbered questions, test = ${test.length} even-numbered.`,
  "",
  "| Embedding weight | Dev recall@1 | Dev recall@3 | Dev MRR@10 | Test recall@1 | Test recall@3 | Test MRR@10 |",
  "|---:|---:|---:|---:|---:|---:|---:|",
  ...sweep.map(
    (s) =>
      `| ${s.weight} | ${pct(s.dev.recall1)} | ${pct(s.dev.recall3)} | ${s.dev.mrr.toFixed(3)} | ${pct(s.test.recall1)} | ${pct(s.test.recall3)} | ${s.test.mrr.toFixed(3)} |`,
  ),
  "",
  "For reference, embeddings alone on the same halves: " +
    `dev MRR ${metricsFor("vector", dev).mrr.toFixed(3)}, test MRR ${metricsFor("vector", test).mrr.toFixed(3)}; ` +
    `keyword alone: dev MRR ${metricsFor("bm25", dev).mrr.toFixed(3)}, test MRR ${metricsFor("bm25", test).mrr.toFixed(3)}.`,
);

const markdown = lines.join("\n");
console.log(markdown);
console.error(`\nDone in ${((Date.now() - started) / 1000).toFixed(1)}s`);

const stem = embedder.id.startsWith("hash") ? "retrieval-hash" : "retrieval";
const results = {
  embedder: embedder.id,
  ran_at: new Date().toISOString(),
  platform: `${os.platform()} ${os.arch()}, node ${process.version}`,
  notes: stats.files,
  passages: stats.chunks,
  metrics: Object.fromEntries(SEARCH_MODES.map((mode) => [mode, metricsFor(mode, cases)])),
  ranks: Object.fromEntries(SEARCH_MODES.map((mode) => [mode, Object.fromEntries(ranksByMode[mode])])),
  weight_sweep: sweep,
};
fs.mkdirSync(path.join(EVALS_DIR, "results"), { recursive: true });
fs.writeFileSync(path.join(EVALS_DIR, "results", `${stem}.json`), JSON.stringify(results, null, 2) + "\n");
fs.writeFileSync(path.join(EVALS_DIR, "results", `${stem}.md`), markdown + "\n");
if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, markdown + "\n");

// Regression gate for CI: `--min-recall3 0.85` fails the run if hybrid recall@3 drops below it.
const gateFlag = process.argv.indexOf("--min-recall3");
if (gateFlag !== -1) {
  const threshold = Number(process.argv[gateFlag + 1]);
  const actual = metricsFor("hybrid", cases).recall3;
  if (actual < threshold) {
    console.error(`Hybrid recall@3 is ${pct(actual)}, below the gate of ${pct(threshold)}.`);
    process.exit(1);
  }
  console.error(`Hybrid recall@3 ${pct(actual)} meets the gate of ${pct(threshold)}.`);
}
