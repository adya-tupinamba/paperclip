/**
 * Generic usage-extractor for Codex gpt-5.4 NDJSON streams.
 *
 * The existing `parseCodexJsonl` handler picks up `turn.completed` events
 * with an `input_tokens`/`output_tokens`/`cached_input_tokens` shape. Newer
 * Codex builds (gpt-5.4 default) occasionally emit an OpenAI-style
 * `{ "usage": { "input_tokens": ..., "output_tokens": ... } }` block or a
 * `{ "response": { "usage": {...}, "model": "..." } }` block without a
 * `turn.completed` wrapper, which silently bypassed the cost pipeline.
 *
 * This parser is a defensive fallback: it scans the raw stream for any line
 * with a `usage` object and sums the tokens, then reports the best-effort
 * model id so callers can price the run via `computeCost`.
 */

export type UsageResult = {
  input: number;
  output: number;
  cached: number;
  model: string;
};

function toNumber(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

function pickUsage(obj: unknown): Record<string, unknown> | null {
  if (!obj || typeof obj !== "object") return null;
  const o = obj as Record<string, unknown>;
  const direct = o.usage;
  if (direct && typeof direct === "object") return direct as Record<string, unknown>;
  const response = o.response;
  if (response && typeof response === "object") {
    const nested = (response as Record<string, unknown>).usage;
    if (nested && typeof nested === "object") return nested as Record<string, unknown>;
  }
  const data = o.data;
  if (data && typeof data === "object") {
    const nested = (data as Record<string, unknown>).usage;
    if (nested && typeof nested === "object") return nested as Record<string, unknown>;
  }
  return null;
}

function pickModel(obj: unknown): string {
  if (!obj || typeof obj !== "object") return "";
  const o = obj as Record<string, unknown>;
  if (typeof o.model === "string") return o.model;
  const response = o.response;
  if (response && typeof response === "object") {
    const m = (response as Record<string, unknown>).model;
    if (typeof m === "string") return m;
  }
  return "";
}

function pickCachedTokens(usage: Record<string, unknown>): number {
  // Codex `turn.completed` -> `cached_input_tokens`.
  // OpenAI Responses API -> `usage.input_tokens_details.cached_tokens`.
  // OpenAI Chat API -> `usage.prompt_tokens_details.cached_tokens`.
  // Generic -> `usage.cached_tokens`.
  const direct = toNumber(usage.cached_input_tokens ?? usage.cached_tokens);
  if (direct > 0) return direct;
  const inputDetails = usage.input_tokens_details;
  if (inputDetails && typeof inputDetails === "object") {
    const c = toNumber((inputDetails as Record<string, unknown>).cached_tokens);
    if (c > 0) return c;
  }
  const promptDetails = usage.prompt_tokens_details;
  if (promptDetails && typeof promptDetails === "object") {
    const c = toNumber((promptDetails as Record<string, unknown>).cached_tokens);
    if (c > 0) return c;
  }
  return 0;
}

/**
 * Parse a Codex NDJSON stream and return the accumulated usage/model.
 *
 * Safe to call on empty input or non-JSON noise — invalid lines are skipped.
 * When multiple usage blocks appear (e.g. one per turn), their tokens are
 * summed so the caller sees the whole-run total.
 */
export function parseUsageFromStream(ndjson: string): UsageResult {
  const result: UsageResult = { input: 0, output: 0, cached: 0, model: "" };
  if (!ndjson) return result;

  for (const rawLine of ndjson.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line[0] !== "{") continue;
    let obj: unknown;
    try {
      obj = JSON.parse(line);
    } catch {
      continue;
    }

    const usage = pickUsage(obj);
    if (usage) {
      result.input += toNumber(usage.input_tokens ?? usage.prompt_tokens);
      result.output += toNumber(usage.output_tokens ?? usage.completion_tokens);
      result.cached += pickCachedTokens(usage);
    }

    if (!result.model) {
      const model = pickModel(obj);
      if (model) result.model = model;
    }
  }

  return result;
}
