import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadGolden, NOTES_DIR } from "../evals/golden.js";
import { chunkMarkdown } from "../src/chunker.js";
import { listNoteFiles } from "../src/store.js";

/** The eval is only as good as its answer key: every expected section must really exist in the notes. */
describe("golden set", () => {
  const golden = loadGolden();
  const headings = new Map(
    listNoteFiles(NOTES_DIR).map((file) => [
      file,
      chunkMarkdown(file, fs.readFileSync(path.join(NOTES_DIR, file), "utf8")).map((c) => c.heading),
    ]),
  );

  it("has unique ids and both answerable and unanswerable cases", () => {
    expect(new Set(golden.map((g) => g.id)).size).toBe(golden.length);
    expect(golden.filter((g) => g.type !== "unanswerable")).toHaveLength(50);
    expect(golden.filter((g) => g.type === "unanswerable")).toHaveLength(5);
  });

  it.each(golden.filter((g) => g.type !== "unanswerable").map((g) => [g.id, g] as const))(
    "%s points at sections that exist",
    (_id, g) => {
      const noteHeadings = headings.get(g.path!);
      expect(noteHeadings, `note ${g.path} is missing`).toBeDefined();
      for (const section of g.sections!) {
        expect(noteHeadings!.some((h) => h.endsWith(section)), `${g.path} has no section "${section}"`).toBe(true);
      }
    },
  );
});
