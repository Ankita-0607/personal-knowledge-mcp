import fs from "node:fs";
import path from "node:path";
import type { SearchHit } from "../src/retriever.js";

export interface GoldenCase {
  id: string;
  /** paraphrase: little word overlap with the note. keyword: shares its key terms. unanswerable: not in the notes. */
  type: "paraphrase" | "keyword" | "unanswerable";
  question: string;
  /** The note that answers it (absent for unanswerable cases). */
  path?: string;
  /** Section headings, any of which counts as the right passage. */
  sections?: string[];
}

export const EVALS_DIR = import.meta.dirname;
export const NOTES_DIR = path.resolve(EVALS_DIR, "..", "sample-notes");

export function loadGolden(): GoldenCase[] {
  return fs
    .readFileSync(path.join(EVALS_DIR, "golden.jsonl"), "utf8")
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line) as GoldenCase);
}

/** A hit is correct when it comes from the expected note and one of the expected sections. */
export function isCorrect(hit: SearchHit, golden: GoldenCase): boolean {
  if (hit.chunk.path !== golden.path) return false;
  return (golden.sections ?? []).some((section) => hit.chunk.heading.endsWith(section));
}
