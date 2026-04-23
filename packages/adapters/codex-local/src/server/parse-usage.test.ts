import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseUsageFromStream } from "./parse-usage.js";

const FIX = (name: string) =>
  readFileSync(new URL(`./__fixtures__/${name}`, import.meta.url), "utf8");

describe("parseUsageFromStream", () => {
  it("extracts tokens from a real Codex gpt-5.4 run (fixture 1)", () => {
    const r = parseUsageFromStream(FIX("codex-gpt5-4-run-1.ndjson"));
    expect(r.input).toBeGreaterThan(0);
    expect(r.output).toBeGreaterThan(0);
    expect(r.cached).toBeGreaterThan(0);
  });

  it("extracts tokens from a real Codex gpt-5.4 run (fixture 2)", () => {
    const r = parseUsageFromStream(FIX("codex-gpt5-4-run-2.ndjson"));
    expect(r.input).toBeGreaterThan(0);
    expect(r.output).toBeGreaterThan(0);
  });

  it("sums tokens across multiple turn.completed events", () => {
    const r = parseUsageFromStream(FIX("codex-gpt5-4-run-3.ndjson"));
    expect(r.input).toBeGreaterThan(0);
    expect(r.output).toBeGreaterThan(0);
  });

  it("returns zeros when no usage block is present", () => {
    const r = parseUsageFromStream("");
    expect(r).toEqual({ input: 0, output: 0, cached: 0, model: "" });
  });

  it("returns zeros for pure non-JSON noise", () => {
    const r = parseUsageFromStream("hello world\nnot json\n[paperclip] booting\n");
    expect(r).toEqual({ input: 0, output: 0, cached: 0, model: "" });
  });

  it("handles the OpenAI Responses-API usage shape with cached_tokens in input_tokens_details", () => {
    const stream = [
      JSON.stringify({
        response: {
          model: "gpt-5.4",
          usage: {
            input_tokens: 1_000,
            output_tokens: 200,
            input_tokens_details: { cached_tokens: 400 },
          },
        },
      }),
    ].join("\n");
    const r = parseUsageFromStream(stream);
    expect(r).toEqual({ input: 1_000, output: 200, cached: 400, model: "gpt-5.4" });
  });

  it("handles the OpenAI Chat-API prompt_tokens shape with cached_tokens in prompt_tokens_details", () => {
    const stream = JSON.stringify({
      model: "gpt-5-mini",
      usage: {
        prompt_tokens: 800,
        completion_tokens: 120,
        prompt_tokens_details: { cached_tokens: 300 },
      },
    });
    const r = parseUsageFromStream(stream);
    expect(r).toEqual({ input: 800, output: 120, cached: 300, model: "gpt-5-mini" });
  });

  it("handles the Codex turn.completed shape (cached_input_tokens)", () => {
    const stream = [
      JSON.stringify({ type: "thread.started", thread_id: "t_1" }),
      JSON.stringify({
        type: "turn.completed",
        usage: { input_tokens: 10, cached_input_tokens: 2, output_tokens: 4 },
      }),
    ].join("\n");
    const r = parseUsageFromStream(stream);
    expect(r.input).toBe(10);
    expect(r.output).toBe(4);
    expect(r.cached).toBe(2);
  });

  it("sums usage across multiple turn.completed events in a single stream", () => {
    const stream = [
      JSON.stringify({
        type: "turn.completed",
        usage: { input_tokens: 100, cached_input_tokens: 10, output_tokens: 40 },
      }),
      JSON.stringify({
        type: "turn.completed",
        usage: { input_tokens: 50, cached_input_tokens: 5, output_tokens: 20 },
      }),
    ].join("\n");
    const r = parseUsageFromStream(stream);
    expect(r.input).toBe(150);
    expect(r.output).toBe(60);
    expect(r.cached).toBe(15);
  });

  it("ignores malformed JSON lines without throwing", () => {
    const stream = [
      "{ this is broken",
      JSON.stringify({ type: "turn.completed", usage: { input_tokens: 5, output_tokens: 3 } }),
      "} also broken",
    ].join("\n");
    const r = parseUsageFromStream(stream);
    expect(r.input).toBe(5);
    expect(r.output).toBe(3);
  });
});
