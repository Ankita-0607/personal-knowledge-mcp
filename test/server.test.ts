import fs from "node:fs";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";
import type { Answer } from "../src/answer.js";
import { KnowledgeBase } from "../src/knowledge-base.js";
import { createServer, type ServerOptions } from "../src/server.js";
import { CountingEmbedder, NOTES, tempNotes } from "./helpers.js";

/** A real MCP client talking to the real server over an in-memory transport. */
async function connect(options: ServerOptions = {}, notes: Record<string, string> = NOTES) {
  const dir = tempNotes(notes);
  const kb = new KnowledgeBase(dir, new CountingEmbedder());
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await createServer(kb, options).connect(serverTransport);
  const client = new Client({ name: "test-client", version: "1.0.0" });
  await client.connect(clientTransport);
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const result = await client.callTool({ name, arguments: args });
    const content = result.content as Array<{ type: string; text: string }>;
    return { text: content.map((c) => c.text).join("\n"), isError: result.isError === true };
  };
  return { client, call, dir };
}

describe("MCP server", () => {
  it("advertises its tools with schemas and descriptions", async () => {
    const { client } = await connect();
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).toEqual(["search_notes", "read_note", "list_notes", "refresh_index"]);
    const search = tools.find((t) => t.name === "search_notes")!;
    expect(search.inputSchema).toMatchObject({ type: "object", required: ["query"] });
    expect(search.description).toMatch(/personal notes/);
    expect(search.annotations).toMatchObject({ readOnlyHint: true });
  });

  it("only offers ask_notes when an answer function is configured", async () => {
    const without = await connect();
    expect((await without.client.listTools()).tools.map((t) => t.name)).not.toContain("ask_notes");
    const answer = async (): Promise<Answer> => ({ text: "", citations: [], grounded: false, model: "m", usage: { input_tokens: 0, output_tokens: 0 } });
    const withAnswer = await connect({ answer });
    expect((await withAnswer.client.listTools()).tools.map((t) => t.name)).toContain("ask_notes");
  });

  it("search_notes returns passages with their note path and heading", async () => {
    const { call } = await connect();
    const { text, isError } = await call("search_notes", { query: "tyre pressure", mode: "bm25", limit: 1 });
    expect(isError).toBe(false);
    expect(text).toContain("[1] bikes/maintenance.md — Bike maintenance > Tyres");
    expect(text).toContain("90 psi");
    expect(text).not.toContain("[2]");
  });

  it("search_notes says so when nothing matches", async () => {
    const { call } = await connect();
    expect((await call("search_notes", { query: "quantum chromodynamics", mode: "bm25" })).text).toMatch(/No passages/);
  });

  it("rejects invalid arguments at the protocol boundary", async () => {
    const { call } = await connect();
    const empty = await call("search_notes", { query: "" }).catch((err: Error) => ({ text: err.message, isError: true }));
    expect(empty.isError).toBe(true);
    const tooMany = await call("search_notes", { query: "x", limit: 500 }).catch((err: Error) => ({ text: err.message, isError: true }));
    expect(tooMany.isError).toBe(true);
  });

  it("read_note returns the note, and refuses paths outside the notes folder", async () => {
    const { call, dir } = await connect();
    expect((await call("read_note", { path: "coffee.md" })).text).toContain("1:16 ratio");

    fs.writeFileSync(path.join(dir, "..", "outside-secret.md"), "do not leak");
    for (const attempt of ["../outside-secret.md", "/etc/passwd", ".kb/index.json"]) {
      const result = await call("read_note", { path: attempt });
      expect(result.isError).toBe(true);
      expect(result.text).not.toContain("do not leak");
    }
  });

  it("list_notes lists every note with its title", async () => {
    const { call } = await connect();
    const { text } = await call("list_notes");
    expect(text.split("\n")).toHaveLength(3);
    expect(text).toContain("bikes/maintenance.md — Bike maintenance");
  });

  it("refresh_index picks up a note added while the server is running", async () => {
    const { call, dir } = await connect();
    await call("search_notes", { query: "anything", mode: "bm25" }); // builds the first index
    fs.writeFileSync(path.join(dir, "tea.md"), "# Tea\n\nSteep oolong for three minutes.\n");
    expect((await call("refresh_index")).text).toBe("Indexed 4 notes, 6 passages (1 embedded, 5 unchanged).");
    expect((await call("search_notes", { query: "oolong", mode: "bm25" })).text).toContain("tea.md");
  });

  it("ask_notes retrieves passages, passes them to the answer function and formats the sources", async () => {
    let received: { question: string; paths: string[] } | undefined;
    const { call } = await connect({
      answer: async (question, hits) => {
        received = { question, paths: hits.map((h) => h.chunk.path) };
        return {
          text: "Every 200 kilometres.",
          citations: [{ path: "bikes/maintenance.md", heading: "Bike maintenance > Chain", quote: "every 200 kilometres" }],
          grounded: true,
          model: "stub",
          usage: { input_tokens: 1, output_tokens: 1 },
        };
      },
    });
    const { text } = await call("ask_notes", { question: "How often should I lubricate the chain?" });
    expect(received!.question).toBe("How often should I lubricate the chain?");
    expect(received!.paths).toContain("bikes/maintenance.md");
    expect(text).toBe("Every 200 kilometres.\n\nSources:\n- bikes/maintenance.md (Bike maintenance > Chain)");
  });
});
