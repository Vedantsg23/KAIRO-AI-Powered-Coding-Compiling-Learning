import { describe, expect, it } from "vitest";
import type { Execution } from "./types";
import { interrupted, ndjson } from "./client";

function body(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
}

async function all<T>(stream: ReadableStream<Uint8Array>): Promise<T[]> {
  const out: T[] = [];
  for await (const item of ndjson<T>(stream)) out.push(item);
  return out;
}

describe("ndjson", () => {
  it("reads objects split across chunks and skips keep-alive lines", async () => {
    const items = await all<{ n: number }>(body(['{"n":', "1}\n\n", '{"n":2}\n{"n"', ":3}"]));
    expect(items).toEqual([{ n: 1 }, { n: 2 }, { n: 3 }]);
  });

  it("keeps multi-byte characters that a chunk boundary cuts in half", async () => {
    const bytes = new TextEncoder().encode('{"t":"नमस्ते"}\n');
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes.slice(0, 9));
        controller.enqueue(bytes.slice(9));
        controller.close();
      },
    });
    expect(await all<{ t: string }>(stream)).toEqual([{ t: "नमस्ते" }]);
  });
});

describe("interrupted", () => {
  it("ends a run whose stream broke off, without results that belong to it", () => {
    const running = {
      id: "e1",
      languageId: "c",
      state: "RUNNING",
      terminal: false,
      summary: "Running",
      sourceHash: "sha256:x",
      sourceBytes: 1,
      createdAt: "2026-10-15T00:00:00Z",
      steps: [
        { name: "compile", kind: "compile", status: "SUCCEEDED" },
        { name: "run", kind: "run", status: "RUNNING" },
      ],
      diagnostics: [],
      evidence: "sealed",
    } as unknown as Execution;
    const ended = interrupted(running, "Lost the connection");
    expect(ended.terminal).toBe(true);
    expect(ended.state).toBe("INTERNAL_ERROR");
    expect(ended.summary).toBe("Lost the connection");
    expect(ended.evidence).toBeNull();
    expect(ended.steps.map((s) => s.status)).toEqual(["SUCCEEDED", "SKIPPED"]);
  });
});
