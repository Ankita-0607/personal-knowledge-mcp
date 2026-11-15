import fs from "node:fs";
import path from "node:path";
import { answerQuestion, ANSWER_MODEL } from "../src/answer.js";
import { createEmbedder } from "../src/embedder.js";
import { Retriever } from "../src/retriever.js";
import { buildIndex } from "../src/store.js";
import { EVALS_DIR, loadGolden, NOTES_DIR } from "./golden.js";

/**
 * Answer eval (needs ANTHROPIC_API_KEY, costs a few cents).
 *
 * Checks the two things that matter for a "what do my notes say" tool, using
 * the API's own citations rather than a second model as judge:
 *
 *   - Answerable questions: is the answer cited, and does a citation point at
 *     the note that actually holds the answer?
 *   - Questions the notes cannot answer: does the system decline (no
 *     citations) instead of making something up?
 *
 *   npm run eval:answers                 20 answerable + 5 unanswerable
 *   npm run eval:answers -- --limit 50   every answerable question
 */

const limitFlag = process.argv.indexOf("--limit");
const limit = limitFlag === -1 ? 20 : Number(process.argv[limitFlag + 1]);

const embedder = createEmbedder(process.env.KB_EMBEDDER);
const { index } = await buildIndex(NOTES_DIR, embedder);
const retriever = new Retriever(index, embedder);

const golden = loadGolden();
const answerableAll = golden.filter((g) => g.type !== "unanswerable");
// An even spread across the notes rather than the first N.
const step = Math.max(1, Math.floor(answerableAll.length / limit));
const answerable = answerableAll.filter((_, i) => i % step === 0).slice(0, limit);
const unanswerable = golden.filter((g) => g.type === "unanswerable");

interface Row {
  id: string;
  type: string;
  question: string;
  grounded: boolean;
  cited: string[];
  correct_source: boolean | null;
  answer: string;
}

const rows: Row[] = [];
let inputTokens = 0;
let outputTokens = 0;
for (const g of [...answerable, ...unanswerable]) {
  const hits = await retriever.search(g.question, { limit: 6 });
  const answer = await answerQuestion(g.question, hits);
  inputTokens += answer.usage.input_tokens;
  outputTokens += answer.usage.output_tokens;
  const cited = [...new Set(answer.citations.map((c) => c.path))];
  rows.push({
    id: g.id,
    type: g.type,
    question: g.question,
    grounded: answer.grounded,
    cited,
    correct_source: g.path ? cited.includes(g.path) : null,
    answer: answer.text,
  });
  console.error(`${g.id} ${answer.grounded ? "cited" : "no citation"} ${cited.join(", ")}`);
}

const answered = rows.filter((r) => r.type !== "unanswerable");
const declined = rows.filter((r) => r.type === "unanswerable");
const share = (part: number, whole: number) => `${part}/${whole} (${((part / whole) * 100).toFixed(0)}%)`;

const markdown = [
  "## Answer eval",
  "",
  `Model: \`${ANSWER_MODEL}\` · Embedder: \`${embedder.id}\` · ${inputTokens.toLocaleString("en-US")} input and ${outputTokens.toLocaleString("en-US")} output tokens`,
  "",
  "| Check | Result |",
  "|---|---|",
  `| Answerable questions answered with at least one citation | ${share(answered.filter((r) => r.grounded).length, answered.length)} |`,
  `| Answerable questions citing the note that holds the answer | ${share(answered.filter((r) => r.correct_source).length, answered.length)} |`,
  `| Unanswerable questions declined (no citation) | ${share(declined.filter((r) => !r.grounded).length, declined.length)} |`,
  "",
  "Citations are produced by the API from the passages it was given, so a citation always quotes real note text. This eval checks that the quoted note is the right one.",
].join("\n");
console.log(markdown);

fs.mkdirSync(path.join(EVALS_DIR, "results"), { recursive: true });
fs.writeFileSync(
  path.join(EVALS_DIR, "results", "answers.json"),
  JSON.stringify({ model: ANSWER_MODEL, embedder: embedder.id, ran_at: new Date().toISOString(), rows }, null, 2) + "\n",
);
fs.writeFileSync(path.join(EVALS_DIR, "results", "answers.md"), markdown + "\n");
if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, markdown + "\n");
