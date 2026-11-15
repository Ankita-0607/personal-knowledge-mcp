import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Embedder } from "../src/embedder.js";
import { HashingEmbedder } from "../src/embedder.js";

export function tempNotes(files: Record<string, string>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kb-notes-"));
  for (const [name, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
    fs.writeFileSync(path.join(dir, name), content);
  }
  return dir;
}

/** Wraps the hashing embedder and counts how many texts were embedded. */
export class CountingEmbedder implements Embedder {
  readonly id = "counting";
  embedded = 0;
  private readonly inner = new HashingEmbedder(128);

  async embed(texts: string[]): Promise<Float32Array[]> {
    this.embedded += texts.length;
    return this.inner.embed(texts);
  }
}

export const NOTES = {
  "coffee.md": "# Coffee\n\n## Brewing\n\nUse water just off the boil and a 1:16 ratio of coffee to water.\n\n## Storage\n\nKeep beans in an airtight tin away from light.\n",
  "bikes/maintenance.md": "# Bike maintenance\n\n## Chain\n\nClean and lubricate the chain every 200 kilometres.\n\n## Tyres\n\nCheck tyre pressure weekly; road tyres run at about 90 psi.\n",
  "todo.txt": "Renew the passport before March.\n",
};
