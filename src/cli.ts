#!/usr/bin/env node
import path from "node:path";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { Command, Option } from "commander";
import { answerQuestion, formatAnswer } from "./answer.js";
import { createEmbedder } from "./embedder.js";
import { KnowledgeBase } from "./knowledge-base.js";
import { SEARCH_MODES, type SearchMode } from "./retriever.js";
import { createServer } from "./server.js";

const DEFAULT_NOTES = path.resolve(import.meta.dirname, "..", "sample-notes");

const program = new Command()
  .name("kb")
  .description("Search and question your own notes, from the terminal or from any MCP client.")
  .addOption(
    new Option("--notes <dir>", "folder of Markdown or text notes").env("KB_NOTES_DIR").default(DEFAULT_NOTES, "the bundled sample notes"),
  )
  .addOption(new Option("--index <file>", "where to keep the index").env("KB_INDEX_PATH"))
  .addOption(
    new Option("--embedder <kind>", '"local" runs a sentence-embedding model on this machine; "hash" needs no download')
      .env("KB_EMBEDDER")
      .choices(["local", "hash"])
      .default("local"),
  );

function open(): KnowledgeBase {
  const opts = program.opts<{ notes: string; index?: string; embedder: string }>();
  return new KnowledgeBase(opts.notes, createEmbedder(opts.embedder), opts.index);
}

program
  .command("index")
  .description("Build or update the index")
  .action(async () => {
    const kb = open();
    const stats = await kb.refresh();
    console.log(`Indexed ${stats.files} notes into ${stats.chunks} passages (${stats.embedded} embedded, ${stats.reused} reused).`);
    console.log(`Index: ${kb.indexPath}`);
  });

program
  .command("search <query>")
  .description("Show the passages that best match a query")
  .option("-k, --limit <n>", "number of passages", "5")
  .addOption(new Option("-m, --mode <mode>", "ranking method").choices([...SEARCH_MODES]).default("hybrid"))
  .action(async (query: string, opts: { limit: string; mode: SearchMode }) => {
    const hits = await open().search(query, { limit: Number(opts.limit), mode: opts.mode });
    if (hits.length === 0) return console.log("No matching passages.");
    hits.forEach((hit, i) => {
      const ranks = [hit.ranks.bm25 && `keyword #${hit.ranks.bm25}`, hit.ranks.vector && `meaning #${hit.ranks.vector}`]
        .filter(Boolean)
        .join(", ");
      console.log(`\n[${i + 1}] ${hit.chunk.path} — ${hit.chunk.heading}  (${ranks})`);
      console.log(hit.chunk.text.length > 400 ? `${hit.chunk.text.slice(0, 400)}…` : hit.chunk.text);
    });
  });

program
  .command("ask <question>")
  .description("Answer a question from the notes, with citations (needs ANTHROPIC_API_KEY)")
  .option("-k, --limit <n>", "passages to give the model", "6")
  .action(async (question: string, opts: { limit: string }) => {
    const hits = await open().search(question, { limit: Number(opts.limit) });
    if (hits.length === 0) return console.log("The notes contain nothing relevant to that question.");
    const answer = await answerQuestion(question, hits);
    console.log(formatAnswer(answer));
    console.error(`\n(${answer.model}: ${answer.usage.input_tokens} input, ${answer.usage.output_tokens} output tokens)`);
  });

program
  .command("serve")
  .description("Run as an MCP server over stdio")
  .action(async () => {
    const kb = open();
    // stdout carries the MCP protocol; anything for humans goes to stderr.
    const hasKey = Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
    const server = createServer(kb, hasKey ? { answer: (q, hits) => answerQuestion(q, hits) } : {});
    await server.connect(new StdioServerTransport());
    console.error(`personal-knowledge MCP server ready. Notes: ${kb.notesDir}${hasKey ? "" : " (ask_notes disabled: no API key)"}`);
  });

program.parseAsync().catch((err: unknown) => {
  console.error(`error: ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
});
