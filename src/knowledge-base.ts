import fs from "node:fs";
import path from "node:path";
import type { Embedder } from "./embedder.js";
import { Retriever, type SearchHit, type SearchMode } from "./retriever.js";
import {
  buildIndex,
  describeNotes,
  loadIndex,
  resolveNotePath,
  saveIndex,
  type BuildStats,
  type KnowledgeIndex,
  type NoteInfo,
} from "./store.js";

/** A notes directory plus its index: the one object the CLI and the MCP server both talk to. */
export class KnowledgeBase {
  readonly notesDir: string;
  readonly indexPath: string;
  private index: KnowledgeIndex | undefined;
  private retriever: Retriever | undefined;

  constructor(
    notesDir: string,
    private readonly embedder: Embedder,
    indexPath?: string,
  ) {
    this.notesDir = path.resolve(notesDir);
    if (!fs.existsSync(this.notesDir) || !fs.statSync(this.notesDir).isDirectory()) {
      throw new Error(`Notes directory not found: ${this.notesDir}`);
    }
    this.indexPath = path.resolve(indexPath ?? path.join(this.notesDir, ".kb", "index.json"));
  }

  /** Re-scan the notes directory. Unchanged chunks keep their embeddings. */
  async refresh(): Promise<BuildStats> {
    const previous = this.index ?? loadIndex(this.indexPath);
    const { index, stats } = await buildIndex(this.notesDir, this.embedder, previous);
    saveIndex(index, this.indexPath);
    this.index = index;
    this.retriever = new Retriever(index, this.embedder);
    return stats;
  }

  /** Load the saved index, or build it on first use (or when the embedding model changed). */
  private async ready(): Promise<{ index: KnowledgeIndex; retriever: Retriever }> {
    if (!this.index || !this.retriever) {
      const saved = loadIndex(this.indexPath);
      if (saved && saved.embedder === this.embedder.id) {
        this.index = saved;
        this.retriever = new Retriever(saved, this.embedder);
      } else {
        await this.refresh();
      }
    }
    return { index: this.index!, retriever: this.retriever! };
  }

  async search(query: string, options: { limit?: number; mode?: SearchMode } = {}): Promise<SearchHit[]> {
    return (await this.ready()).retriever.search(query, options);
  }

  async notes(): Promise<NoteInfo[]> {
    return describeNotes(this.notesDir, (await this.ready()).index);
  }

  /** The full text of one note, or null if the path is not a note inside the notes directory. */
  read(notePath: string): string | null {
    const resolved = resolveNotePath(this.notesDir, notePath);
    return resolved ? fs.readFileSync(resolved, "utf8") : null;
  }
}
