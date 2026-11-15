import fs from "node:fs";
import path from "node:path";
import { chunkMarkdown, indexedText, type Chunk } from "./chunker.js";
import type { Embedder } from "./embedder.js";

/** The on-disk index: chunks plus one embedding vector per chunk. */
export interface KnowledgeIndex {
  version: 1;
  embedder: string;
  built_at: string;
  chunks: Chunk[];
  vectors: Float32Array[];
}

export interface NoteInfo {
  path: string;
  title: string;
  bytes: number;
  modified: string;
}

const NOTE_EXTENSIONS = new Set([".md", ".markdown", ".txt"]);
const SKIP_DIRS = new Set(["node_modules", ".git", ".kb"]);

export const isNoteFile = (file: string) => NOTE_EXTENSIONS.has(path.extname(file).toLowerCase());

/** Note files under a directory, as sorted POSIX paths relative to it. Dotfiles and dot-directories are skipped. */
export function listNoteFiles(notesDir: string): string[] {
  const found: string[] = [];
  const walk = (relative: string) => {
    for (const entry of fs.readdirSync(path.join(notesDir, relative), { withFileTypes: true })) {
      if (entry.name.startsWith(".") || SKIP_DIRS.has(entry.name)) continue;
      const rel = relative ? `${relative}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walk(rel);
      else if (entry.isFile() && isNoteFile(entry.name)) found.push(rel);
    }
  };
  walk("");
  return found.sort();
}

export interface BuildStats {
  files: number;
  chunks: number;
  embedded: number;
  reused: number;
}

/**
 * Build the index for a notes directory. Chunks whose content hash is already
 * in `previous` (and were embedded by the same model) keep their vector, so
 * re-indexing after editing one note only embeds that note's changed chunks.
 */
export async function buildIndex(
  notesDir: string,
  embedder: Embedder,
  previous?: KnowledgeIndex,
): Promise<{ index: KnowledgeIndex; stats: BuildStats }> {
  const files = listNoteFiles(notesDir);
  const chunks = files.flatMap((file) => chunkMarkdown(file, fs.readFileSync(path.join(notesDir, file), "utf8")));

  const cached = new Map<string, Float32Array>();
  if (previous && previous.embedder === embedder.id) {
    previous.chunks.forEach((chunk, i) => cached.set(chunk.hash, previous.vectors[i]!));
  }

  const missing = chunks.filter((chunk) => !cached.has(chunk.hash));
  const fresh = missing.length > 0 ? await embedder.embed(missing.map(indexedText)) : [];
  missing.forEach((chunk, i) => cached.set(chunk.hash, fresh[i]!));

  return {
    index: {
      version: 1,
      embedder: embedder.id,
      built_at: new Date().toISOString(),
      chunks,
      vectors: chunks.map((chunk) => cached.get(chunk.hash)!),
    },
    stats: { files: files.length, chunks: chunks.length, embedded: missing.length, reused: chunks.length - missing.length },
  };
}

export function saveIndex(index: KnowledgeIndex, file: string): void {
  const dimensions = index.vectors[0]?.length ?? 0;
  const flat = new Float32Array(index.vectors.length * dimensions);
  index.vectors.forEach((vector, i) => flat.set(vector, i * dimensions));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(
    file,
    JSON.stringify({
      version: index.version,
      embedder: index.embedder,
      built_at: index.built_at,
      dimensions,
      chunks: index.chunks,
      vectors: Buffer.from(flat.buffer).toString("base64"),
    }),
  );
}

export function loadIndex(file: string): KnowledgeIndex | undefined {
  if (!fs.existsSync(file)) return undefined;
  try {
    const raw = JSON.parse(fs.readFileSync(file, "utf8")) as {
      version: number;
      embedder: string;
      built_at: string;
      dimensions: number;
      chunks: Chunk[];
      vectors: string;
    };
    if (raw.version !== 1) return undefined;
    const bytes = Buffer.from(raw.vectors, "base64");
    const flat = new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4);
    const vectors = raw.chunks.map((_, i) => flat.slice(i * raw.dimensions, (i + 1) * raw.dimensions));
    return { version: 1, embedder: raw.embedder, built_at: raw.built_at, chunks: raw.chunks, vectors };
  } catch {
    return undefined; // a corrupt index is rebuilt, not fatal
  }
}

export function describeNotes(notesDir: string, index: KnowledgeIndex): NoteInfo[] {
  const titles = new Map(index.chunks.map((chunk) => [chunk.path, chunk.title]));
  return listNoteFiles(notesDir).map((file) => {
    const stat = fs.statSync(path.join(notesDir, file));
    return { path: file, title: titles.get(file) ?? file, bytes: stat.size, modified: stat.mtime.toISOString() };
  });
}

/**
 * Resolve a note path supplied by a client. Returns the absolute path only if
 * it is a note file inside the notes directory: an MCP client is not handed a
 * general file-read primitive.
 */
export function resolveNotePath(notesDir: string, requested: string): string | null {
  const root = fs.realpathSync(notesDir);
  const absolute = path.resolve(root, requested);
  if (!isNoteFile(absolute) || !fs.existsSync(absolute)) return null;
  const real = fs.realpathSync(absolute);
  const relative = path.relative(root, real);
  if (relative.startsWith("..") || path.isAbsolute(relative)) return null;
  if (relative.split(path.sep).some((part) => part.startsWith("."))) return null;
  return real;
}
