import { describe, expect, it } from "vitest";
import { answerQuestion, formatAnswer, type MessagesClient } from "../src/answer.js";
import type { SearchHit } from "../src/retriever.js";

const hit = (path: string, heading: string, text: string): SearchHit => ({
  chunk: { id: `${path}#0`, path, title: heading, heading, text, hash: "h" },
  score: 1,
  ranks: {},
});

const HITS = [
  hit("release.md", "Release governance > Release train", "Releases leave every Tuesday and Thursday."),
  hit("flags.md", "Feature flags", "Flags older than 90 days show up in the tech debt review."),
];

/** A stand-in for the Messages API that records the request and returns a canned response. */
function stubClient(response: object) {
  const calls: Array<Record<string, unknown>> = [];
  const client = {
    create: async (params: Record<string, unknown>) => {
      calls.push(params);
      return { model: "claude-test", stop_reason: "end_turn", usage: { input_tokens: 120, output_tokens: 30 }, ...response };
    },
  } as unknown as MessagesClient;
  return { client, calls };
}

const cite = (documentIndex: number, citedText: string) => ({
  type: "char_location",
  document_index: documentIndex,
  cited_text: citedText,
  start_char_index: 0,
  end_char_index: citedText.length,
  document_title: null,
});

describe("answerQuestion", () => {
  it("sends each passage as a document with citations enabled, then the question", async () => {
    const { client, calls } = stubClient({ content: [{ type: "text", text: "ok", citations: null }] });
    await answerQuestion("When do we release?", HITS, client);

    const content = (calls[0]!.messages as Array<{ content: Array<Record<string, unknown>> }>)[0]!.content;
    expect(content).toHaveLength(3);
    expect(content[0]).toMatchObject({
      type: "document",
      title: "Release governance > Release train",
      source: { type: "text", media_type: "text/plain", data: "Releases leave every Tuesday and Thursday." },
      citations: { enabled: true },
    });
    expect(content[2]).toEqual({ type: "text", text: "When do we release?" });
    expect(String(calls[0]!.system)).toMatch(/Base the answer only on those documents/);
  });

  it("maps API citations back to the note and section they came from", async () => {
    const { client } = stubClient({
      content: [
        { type: "text", text: "Releases go out ", citations: null },
        { type: "text", text: "twice a week", citations: [cite(0, "every Tuesday and Thursday")] },
        { type: "text", text: ", and old flags are reviewed.", citations: [cite(1, "Flags older than 90 days"), cite(1, "Flags older than 90 days")] },
      ],
    });
    const answer = await answerQuestion("q", HITS, client);

    expect(answer.text).toBe("Releases go out twice a week, and old flags are reviewed.");
    expect(answer.grounded).toBe(true);
    expect(answer.citations).toEqual([
      { path: "release.md", heading: "Release governance > Release train", quote: "every Tuesday and Thursday" },
      { path: "flags.md", heading: "Feature flags", quote: "Flags older than 90 days" },
    ]);
    expect(answer.usage).toEqual({ input_tokens: 120, output_tokens: 30 });
  });

  it("marks an answer with no citations as not grounded", async () => {
    const { client } = stubClient({ content: [{ type: "text", text: "Your notes do not cover that.", citations: null }] });
    const answer = await answerQuestion("What is our leave policy?", HITS, client);
    expect(answer).toMatchObject({ grounded: false, citations: [] });
    expect(formatAnswer(answer)).toBe("Your notes do not cover that.");
  });

  it("ignores a citation that points at a document that was not sent", async () => {
    const { client } = stubClient({ content: [{ type: "text", text: "x", citations: [cite(9, "invented")] }] });
    expect((await answerQuestion("q", HITS, client)).citations).toEqual([]);
  });

  it("raises a clear error when the model declines", async () => {
    const { client } = stubClient({ stop_reason: "refusal", content: [] });
    await expect(answerQuestion("q", HITS, client)).rejects.toThrow(/declined/);
  });

  it("lists each cited source once", () => {
    const text = formatAnswer({
      text: "A.",
      citations: [
        { path: "a.md", heading: "H", quote: "one" },
        { path: "a.md", heading: "H", quote: "two" },
      ],
      grounded: true,
      model: "m",
      usage: { input_tokens: 0, output_tokens: 0 },
    });
    expect(text).toBe("A.\n\nSources:\n- a.md (H)");
  });
});
