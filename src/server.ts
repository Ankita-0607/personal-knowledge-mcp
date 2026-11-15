import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { formatAnswer, type Answer } from "./answer.js";
import type { KnowledgeBase } from "./knowledge-base.js";
import { SEARCH_MODES, type SearchHit } from "./retriever.js";

/**
 * The MCP server. It exposes the knowledge base to any MCP client (Claude
 * Desktop, Claude Code, an IDE) as a handful of tools.
 *
 * Tool descriptions are written for the model that will choose between them:
 * they say when to use each tool and what comes back.
 */

export interface ServerOptions {
  /** Supplied when an API key is configured; enables the ask_notes tool. */
  answer?: (question: string, hits: SearchHit[]) => Promise<Answer>;
}

const text = (value: string, isError = false) => ({ content: [{ type: "text" as const, text: value }], isError });

export function formatHits(query: string, hits: SearchHit[]): string {
  if (hits.length === 0) return `No passages in the notes matched "${query}".`;
  const body = hits
    .map((hit, i) => `[${i + 1}] ${hit.chunk.path} — ${hit.chunk.heading}\n${hit.chunk.text}`)
    .join("\n\n---\n\n");
  return `${hits.length} passage${hits.length === 1 ? "" : "s"} for "${query}", best match first:\n\n${body}`;
}

export function createServer(kb: KnowledgeBase, options: ServerOptions = {}): McpServer {
  const server = new McpServer({ name: "personal-knowledge", version: "0.1.0" });

  server.registerTool(
    "search_notes",
    {
      title: "Search notes",
      description:
        "Search the user's personal notes and return the most relevant passages, each with the note path and section heading it came from. Use this whenever a question could be answered from the user's own notes, documents or past writing. Phrase the query as the question or topic in natural language; matching is by meaning as well as keywords. Cite the note path when you use a passage.",
      inputSchema: {
        query: z.string().min(1).describe("What to look for, in natural language."),
        limit: z.number().int().min(1).max(20).optional().describe("Number of passages to return. Default 5."),
        mode: z
          .enum(SEARCH_MODES)
          .optional()
          .describe('Ranking method. "hybrid" (default) combines meaning and keywords; "bm25" is exact keywords only.'),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ query, limit, mode }) => text(formatHits(query, await kb.search(query, { limit, mode }))),
  );

  server.registerTool(
    "read_note",
    {
      title: "Read a note",
      description:
        "Return the full text of one note. Use it after search_notes when a passage is relevant and you need the rest of the note for context.",
      inputSchema: {
        path: z.string().min(1).describe("Note path exactly as returned by search_notes or list_notes."),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ path }) => {
      const content = kb.read(path);
      return content === null ? text(`No note at "${path}". Use list_notes to see the available paths.`, true) : text(content);
    },
  );

  server.registerTool(
    "list_notes",
    {
      title: "List notes",
      description: "List every note in the knowledge base with its title, path and last-modified date. Use it to see what topics the notes cover.",
      inputSchema: {},
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async () => {
      const notes = await kb.notes();
      if (notes.length === 0) return text("The knowledge base has no notes yet.");
      return text(notes.map((n) => `${n.path} — ${n.title} (modified ${n.modified.slice(0, 10)})`).join("\n"));
    },
  );

  server.registerTool(
    "refresh_index",
    {
      title: "Refresh the index",
      description: "Re-scan the notes folder after notes were added or edited. Only changed passages are re-embedded.",
      inputSchema: {},
      annotations: { readOnlyHint: false, idempotentHint: true, openWorldHint: false },
    },
    async () => {
      const stats = await kb.refresh();
      return text(`Indexed ${stats.files} notes, ${stats.chunks} passages (${stats.embedded} embedded, ${stats.reused} unchanged).`);
    },
  );

  const { answer } = options;
  if (answer) {
    server.registerTool(
      "ask_notes",
      {
        title: "Ask the notes",
        description:
          "Answer a question strictly from the user's notes and return the answer with the notes it cites. Prefer search_notes when you want to read and reason over the passages yourself; use this for a short, sourced answer.",
        inputSchema: {
          question: z.string().min(1),
        },
        annotations: { readOnlyHint: true, openWorldHint: true },
      },
      async ({ question }) => {
        const hits = await kb.search(question, { limit: 6 });
        if (hits.length === 0) return text("The notes contain nothing relevant to that question.");
        return text(formatAnswer(await answer(question, hits)));
      },
    );
  }

  return server;
}
