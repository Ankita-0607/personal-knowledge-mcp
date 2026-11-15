import { describe, expect, it } from "vitest";
import { chunkMarkdown, indexedText } from "../src/chunker.js";

describe("chunkMarkdown", () => {
  it("splits on headings and records the heading trail", () => {
    const chunks = chunkMarkdown("guide.md", "# Guide\n\nIntro text.\n\n## Setup\n\nInstall it.\n\n### Linux\n\nUse apt.\n\n## Usage\n\nRun it.\n");
    expect(chunks.map((c) => c.heading)).toEqual(["Guide", "Guide > Setup", "Guide > Setup > Linux", "Guide > Usage"]);
    expect(chunks.map((c) => c.text)).toEqual(["Intro text.", "Install it.", "Use apt.", "Run it."]);
    expect(chunks.every((c) => c.title === "Guide" && c.path === "guide.md")).toBe(true);
    expect(chunks.map((c) => c.id)).toEqual(["guide.md#0", "guide.md#1", "guide.md#2", "guide.md#3"]);
  });

  it("resets deeper levels when a shallower heading starts", () => {
    const chunks = chunkMarkdown("a.md", "# T\n\n## A\n\n### A1\n\nx\n\n## B\n\ny\n");
    expect(chunks.map((c) => c.heading)).toEqual(["T > A > A1", "T > B"]);
  });

  it("uses the file name as the title when there is no H1", () => {
    const chunks = chunkMarkdown("notes/shopping-list.txt", "milk\neggs\n");
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toMatchObject({ title: "shopping-list", heading: "shopping-list", text: "milk\neggs" });
  });

  it("skips front matter and empty sections", () => {
    const chunks = chunkMarkdown("a.md", "---\ntags: [x]\n---\n# Title\n\n## Empty\n\n## Full\n\nbody\n");
    expect(chunks.map((c) => c.heading)).toEqual(["Title > Full"]);
    expect(JSON.stringify(chunks)).not.toContain("tags");
  });

  it("does not treat a # inside a code fence as a heading", () => {
    const chunks = chunkMarkdown("a.md", "# Title\n\n```bash\n# install\nnpm i\n```\n\nafter\n");
    expect(chunks).toHaveLength(1);
    expect(chunks[0]!.text).toContain("# install");
  });

  it("splits a long section at paragraph boundaries within the size limit", () => {
    const paragraph = "word ".repeat(60).trim(); // about 300 characters
    const chunks = chunkMarkdown("a.md", `# T\n\n${Array(6).fill(paragraph).join("\n\n")}\n`, { maxChars: 700 });
    expect(chunks.length).toBe(3);
    expect(chunks.every((c) => c.text.length <= 700 && c.heading === "T")).toBe(true);
  });

  it("splits a single oversized paragraph instead of exceeding the limit", () => {
    const chunks = chunkMarkdown("a.md", `# T\n\n${"A sentence that goes on. ".repeat(100)}`, { maxChars: 500 });
    expect(chunks.length).toBeGreaterThan(3);
    expect(Math.max(...chunks.map((c) => c.text.length))).toBeLessThanOrEqual(500);
  });

  it("gives identical content the same hash and changed content a different one", () => {
    const [a] = chunkMarkdown("a.md", "# T\n\nsame\n");
    const [b] = chunkMarkdown("b.md", "# T\n\nsame\n");
    const [c] = chunkMarkdown("a.md", "# T\n\ndifferent\n");
    expect(a!.hash).toBe(b!.hash);
    expect(a!.hash).not.toBe(c!.hash);
  });

  it("indexes the heading trail together with the body", () => {
    expect(indexedText({ heading: "Coffee > Brewing", text: "Use a 1:16 ratio." })).toBe("Coffee > Brewing\nUse a 1:16 ratio.");
  });
});
