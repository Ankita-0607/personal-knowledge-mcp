import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { HashingEmbedder } from "../src/embedder.js";
import { KnowledgeBase } from "../src/knowledge-base.js";
import { buildIndex, listNoteFiles, loadIndex, resolveNotePath, saveIndex } from "../src/store.js";
import { CountingEmbedder, NOTES, tempNotes } from "./helpers.js";

describe("listNoteFiles", () => {
  it("finds notes recursively and skips hidden files, other file types and dependency folders", () => {
    const dir = tempNotes({
      ...NOTES,
      ".obsidian/workspace.md": "internal",
      ".secret.md": "hidden",
      "image.png": "binary",
      "node_modules/pkg/readme.md": "dependency",
    });
    expect(listNoteFiles(dir)).toEqual(["bikes/maintenance.md", "coffee.md", "todo.txt"]);
  });
});

describe("index build and persistence", () => {
  it("round-trips chunks and vectors through the index file", async () => {
    const dir = tempNotes(NOTES);
    const { index, stats } = await buildIndex(dir, new HashingEmbedder(64));
    expect(stats).toEqual({ files: 3, chunks: 5, embedded: 5, reused: 0 });

    const file = path.join(dir, ".kb", "index.json");
    saveIndex(index, file);
    const loaded = loadIndex(file)!;
    expect(loaded.chunks).toEqual(index.chunks);
    expect(loaded.vectors).toHaveLength(5);
    expect(Array.from(loaded.vectors[3]!)).toEqual(Array.from(index.vectors[3]!));
  });

  it("re-embeds only the chunks that changed", async () => {
    const dir = tempNotes(NOTES);
    const embedder = new CountingEmbedder();
    const first = await buildIndex(dir, embedder);
    expect(embedder.embedded).toBe(5);

    fs.appendFileSync(path.join(dir, "coffee.md"), "\n## Grinding\n\nGrind just before brewing.\n");
    const second = await buildIndex(dir, embedder, first.index);
    expect(second.stats).toEqual({ files: 3, chunks: 6, embedded: 1, reused: 5 });
    expect(embedder.embedded).toBe(6);
  });

  it("re-embeds everything when the embedding model changes", async () => {
    const dir = tempNotes(NOTES);
    const first = await buildIndex(dir, new HashingEmbedder(64));
    const second = await buildIndex(dir, new HashingEmbedder(128), first.index);
    expect(second.stats.reused).toBe(0);
  });

  it("treats a missing or corrupt index file as absent", () => {
    const file = path.join(os.tmpdir(), `kb-corrupt-${Date.now()}.json`);
    expect(loadIndex(file)).toBeUndefined();
    fs.writeFileSync(file, "{ not json");
    expect(loadIndex(file)).toBeUndefined();
  });
});

describe("resolveNotePath", () => {
  it("resolves notes inside the folder", () => {
    const dir = tempNotes(NOTES);
    expect(resolveNotePath(dir, "bikes/maintenance.md")).toBe(path.join(fs.realpathSync(dir), "bikes", "maintenance.md"));
  });

  it.each(["../outside.md", "/etc/passwd", "coffee.md/../../x.md", "missing.md", ".secret.md", "image.png"])(
    "rejects %s",
    (requested) => {
      const dir = tempNotes({ ...NOTES, ".secret.md": "hidden", "image.png": "x" });
      fs.writeFileSync(path.join(dir, "..", "outside.md"), "outside");
      expect(resolveNotePath(dir, requested)).toBeNull();
    },
  );

  it("rejects a symlink that leaves the notes folder", () => {
    const dir = tempNotes(NOTES);
    const outside = tempNotes({ "private.md": "secret" });
    fs.symlinkSync(path.join(outside, "private.md"), path.join(dir, "link.md"));
    expect(resolveNotePath(dir, "link.md")).toBeNull();
  });
});

describe("KnowledgeBase", () => {
  it("builds the index on first search, saves it, and reuses it next time", async () => {
    const dir = tempNotes(NOTES);
    const first = new CountingEmbedder();
    const kb = new KnowledgeBase(dir, first);
    const hits = await kb.search("how often to lubricate the chain", { mode: "bm25" });
    expect(hits[0]!.chunk).toMatchObject({ path: "bikes/maintenance.md", heading: "Bike maintenance > Chain" });
    expect(fs.existsSync(kb.indexPath)).toBe(true);

    const second = new CountingEmbedder();
    await new KnowledgeBase(dir, second).search("chain", { mode: "bm25" });
    expect(second.embedded).toBe(0); // loaded from disk; bm25 needs no query embedding
  });

  it("picks up new notes on refresh", async () => {
    const dir = tempNotes(NOTES);
    const kb = new KnowledgeBase(dir, new CountingEmbedder());
    expect(await kb.search("sourdough starter", { mode: "bm25" })).toEqual([]);
    fs.writeFileSync(path.join(dir, "bread.md"), "# Bread\n\nFeed the sourdough starter daily.\n");
    expect(await kb.refresh()).toMatchObject({ files: 4, embedded: 1 });
    expect((await kb.search("sourdough starter", { mode: "bm25" }))[0]!.chunk.path).toBe("bread.md");
  });

  it("fails clearly when the notes folder does not exist", () => {
    expect(() => new KnowledgeBase("/no/such/folder", new CountingEmbedder())).toThrow(/Notes directory not found/);
  });
});
