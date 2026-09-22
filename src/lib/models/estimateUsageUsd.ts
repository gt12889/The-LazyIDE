/* estimateUsageUsd — per-model estimate when the backend did not settle costUsd.

   Forge: no hosted price catalog. Rates below are static documentation-grade
   estimates for the native CLI ids in registry.ts; unknown / local ids fall
   back to the historical Haiku 0.80/4.00 constants. Local Ollama runs cost
   $0 in reality — costStore records these estimates only so usage dashboards
   keep a consistent unit, never a bill.
*/

const STATIC_RATES: Record<string, { priceIn: number; priceOut: number }> = {
  'claude-opus-5': { priceIn: 5, priceOut: 25 },
  'claude-sonnet-5': { priceIn: 2, priceOut: 10 },
  'claude-haiku-4-5': { priceIn: 1, priceOut: 5 },
  'claude-fable-5': { priceIn: 10, priceOut: 50 },
};

/** USD / 1M tokens — only used when the model is not in the static table. */
export const FALLBACK_PRICE_INPUT_PER_M = 0.8;
export const FALLBACK_PRICE_OUTPUT_PER_M = 4.0;

function normalizeModelKey(model: string): string {
  let key = model.trim().toLowerCase().replace(/_/g, '-');
  key = key.replace(/(\d)-(\d)/g, '$1.$2');
  return key;
}

export function catalogRatesFor(model: string): { priceIn: number; priceOut: number } | null {
  const key = normalizeModelKey(model);
  if (!key) return null;
  // Local runs are free — report zero, not an estimate.
  if (key.startsWith('local/')) return { priceIn: 0, priceOut: 0 };
  // Vendor-prefixed ids ('anthropic/claude-sonnet-5') resolve against the
  // bare native id — the same short-id matching the old catalog applied.
  const bare = key.includes('/') ? key.slice(key.lastIndexOf('/') + 1) : key;
  for (const [id, rates] of Object.entries(STATIC_RATES)) {
    if (normalizeModelKey(id) === key || normalizeModelKey(id) === bare) return rates;
  }
  return null;
}

export function estimateUsageUsd(model: string, inputTokens: number, outputTokens: number): number {
  const rates = catalogRatesFor(model) ?? {
    priceIn: FALLBACK_PRICE_INPUT_PER_M,
    priceOut: FALLBACK_PRICE_OUTPUT_PER_M,
  };
  return (inputTokens / 1_000_000) * rates.priceIn + (outputTokens / 1_000_000) * rates.priceOut;
}
