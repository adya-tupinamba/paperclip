/**
 * Static pricing table for LLM models used by Paperclip adapters.
 *
 * Prices are expressed per 1,000,000 tokens (USD).
 * `cachedIn` is the discounted price for cached input tokens when the
 * provider bills them separately (OpenAI, Anthropic prompt caching, etc.).
 *
 * This table is the single source of truth for cost computation when an
 * adapter stream does not include a pre-computed cost (e.g. Codex gpt-5.4
 * runs emit only token counts in `turn.completed` events).
 */

export type ModelId =
  | "claude-opus-4-7"
  | "claude-sonnet-4-6"
  | "claude-haiku-4-5"
  | "gpt-5.4"
  | "gpt-5-mini"
  | "gemini-3.1-pro"
  | "glm-5.1";

export const COSTS_PER_MODEL: Record<ModelId, { in: number; out: number; cachedIn?: number }> = {
  "claude-opus-4-7":   { in: 15.0, out: 75.0, cachedIn: 1.5 },
  "claude-sonnet-4-6": { in:  3.0, out: 15.0, cachedIn: 0.3 },
  "claude-haiku-4-5":  { in:  0.8, out:  4.0, cachedIn: 0.08 },
  "gpt-5.4":           { in:  2.5, out: 10.0, cachedIn: 0.25 },
  "gpt-5-mini":        { in:  0.25, out: 2.0, cachedIn: 0.025 },
  "gemini-3.1-pro":    { in:  1.25, out: 10.0 },
  "glm-5.1":           { in:  0.6, out:  2.2 },
};

/**
 * Compute total USD cost for a single completion given token counts.
 *
 * - `tokens.cached` is the count of input tokens served from cache and is
 *   treated as a subset of `tokens.input` (i.e. not double-counted).
 * - If the model has no `cachedIn` entry the cached tokens are billed at
 *   the standard input rate.
 * - Unknown models fall back to 0 cost so callers get a conservative number
 *   rather than a crash.
 */
export function computeCost(
  modelId: ModelId,
  tokens: { input: number; output: number; cached?: number },
): number {
  const p = COSTS_PER_MODEL[modelId];
  if (!p) return 0;
  const cached = tokens.cached ?? 0;
  const uncachedInput = Math.max(0, tokens.input - cached);
  const inputCost = (uncachedInput * p.in) / 1_000_000;
  const cachedCost = (cached * (p.cachedIn ?? p.in)) / 1_000_000;
  const outputCost = (tokens.output * p.out) / 1_000_000;
  return inputCost + cachedCost + outputCost;
}
