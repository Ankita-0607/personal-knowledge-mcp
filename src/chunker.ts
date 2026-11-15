import crypto from "node:crypto";

/**
 * Markdown-aware chunking.
 *
 * Notes are split on headings rather than at fixed character counts, so each
 * chunk is one coherent idea, and every chunk carries its heading trail
 * ("Running one-on-ones > Agenda"). The trail is embedded and indexed together
 * with the body: a section that only says "Keep it to three items" is useless
 * to a retriever without the context of what "it" is.
 */

export interface Chunk {
  /** Stable id: "<path>#<n>". */
  id: string;
  /** Path of the note, relative to the notes directory, POSIX separators. */
  path: string;
  /** The note's title (first H1, else the file name). */
  title: string;
  /** Heading trail for this chunk, e.g. "Title > Section > Subsection". */
  heading: string;
  text: string;
  /** Hash of heading + text, used to skip re-embedding unchanged chunks. */
  hash: string;
}

export interface ChunkOptions {
  /** Soft upper bound on the body of one chunk, in characters. */
  maxChars?: number;
}

const DEFAULT_MAX_CHARS = 1200;

function stripFrontMatter(content: string): string {
  if (!content.startsWith("---")) return content;
  const end = content.indexOf("\n---", 3);
  return end === -1 ? content : content.slice(content.indexOf("\n", end + 1) + 1);
}

/** Pack paragraphs into pieces of at most maxChars, cutting an oversized paragraph at sentence ends. */
function splitBody(body: string, maxChars: number): string[] {
  const paragraphs = body.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  const units = paragraphs.flatMap((p) => {
    if (p.length <= maxChars) return [p];
    const sentences = p.match(/[^.!?\n]+[.!?]*\s*/g) ?? [p];
    const parts: string[] = [];
    let current = "";
    for (const sentence of sentences) {
      if (current && current.length + sentence.length > maxChars) {
        parts.push(current.trim());
        current = "";
      }
      current += sentence;
      while (current.length > maxChars) {
        parts.push(current.slice(0, maxChars));
        current = current.slice(maxChars);
      }
    }
    if (current.trim()) parts.push(current.trim());
    return parts;
  });

  const pieces: string[] = [];
  let current = "";
  for (const unit of units) {
    if (current && current.length + unit.length + 2 > maxChars) {
      pieces.push(current);
      current = "";
    }
    current = current ? `${current}\n\n${unit}` : unit;
  }
  if (current) pieces.push(current);
  return pieces;
}

export function chunkMarkdown(notePath: string, content: string, options: ChunkOptions = {}): Chunk[] {
  const maxChars = options.maxChars ?? DEFAULT_MAX_CHARS;
  const lines = stripFrontMatter(content.replace(/\r\n/g, "\n")).split("\n");
  const fallbackTitle = notePath.split("/").at(-1)!.replace(/\.[^.]+$/, "");

  let title: string | undefined;
  const trail: string[] = []; // trail[level - 1] = heading text at that level
  const sections: Array<{ heading: string; body: string[] }> = [];
  let current: { heading: string; body: string[] } = { heading: "", body: [] };
  let inFence = false;

  for (const line of lines) {
    if (/^\s*(```|~~~)/.test(line)) inFence = !inFence;
    const match = inFence ? null : line.match(/^(#{1,6})\s+(.+?)\s*#*\s*$/);
    if (!match) {
      current.body.push(line);
      continue;
    }
    const level = match[1]!.length;
    const text = match[2]!;
    if (level === 1 && title === undefined) title = text;
    sections.push(current);
    trail.length = level - 1;
    trail[level - 1] = text;
    current = { heading: trail.filter(Boolean).join(" > "), body: [] };
  }
  sections.push(current);

  const noteTitle = title ?? fallbackTitle;
  const chunks: Chunk[] = [];
  for (const section of sections) {
    const body = section.body.join("\n").trim();
    if (!body) continue;
    const heading = section.heading || noteTitle;
    for (const text of splitBody(body, maxChars)) {
      chunks.push({
        id: `${notePath}#${chunks.length}`,
        path: notePath,
        title: noteTitle,
        heading,
        text,
        hash: crypto.createHash("sha256").update(`${heading}\n${text}`).digest("hex").slice(0, 16),
      });
    }
  }
  return chunks;
}

/** The text that is embedded and keyword-indexed for a chunk: heading trail plus body. */
export const indexedText = (chunk: Pick<Chunk, "heading" | "text">) => `${chunk.heading}\n${chunk.text}`;
