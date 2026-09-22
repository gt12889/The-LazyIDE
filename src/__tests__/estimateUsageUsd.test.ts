import { describe, it, expect } from 'vitest';
import {
  catalogRatesFor,
  estimateUsageUsd,
  FALLBACK_PRICE_INPUT_PER_M,
  FALLBACK_PRICE_OUTPUT_PER_M,
} from '../lib/models/estimateUsageUsd';

// Forge: no hosted price catalog. Rates are static documentation-grade
// estimates for the native CLI ids in registry.ts; local runs cost $0.

describe('catalogRatesFor', () => {
  it('hits a native id exactly', () => {
    expect(catalogRatesFor('claude-sonnet-5')).toEqual({ priceIn: 2, priceOut: 10 });
  });

  it('covers every native registry id', () => {
    expect(catalogRatesFor('claude-opus-5')).toEqual({ priceIn: 5, priceOut: 25 });
    expect(catalogRatesFor('claude-haiku-4-5')).toEqual({ priceIn: 1, priceOut: 5 });
    expect(catalogRatesFor('claude-fable-5')).toEqual({ priceIn: 10, priceOut: 50 });
  });

  it('normalizes cosmetic variants onto the same entry', () => {
    // Underscores become hyphens; 4-5 becomes 4.5 — same entry either way.
    expect(catalogRatesFor('claude_haiku_4_5')).toEqual(catalogRatesFor('claude-haiku-4-5'));
    expect(catalogRatesFor('  CLAUDE-SONNET-5  ')).toEqual(catalogRatesFor('claude-sonnet-5'));
  });

  it('prices local runs at zero, not an estimate', () => {
    expect(catalogRatesFor('local/hermes3')).toEqual({ priceIn: 0, priceOut: 0 });
    expect(catalogRatesFor('LOCAL/anything')).toEqual({ priceIn: 0, priceOut: 0 });
  });

  it('returns null for an unknown id so callers can fall back', () => {
    expect(catalogRatesFor('unknown-local-cli')).toBeNull();
    expect(catalogRatesFor('')).toBeNull();
  });
});

describe('estimateUsageUsd', () => {
  it('prices 1M Haiku input tokens at $1.00', () => {
    expect(estimateUsageUsd('claude-haiku-4-5', 1_000_000, 0)).toBe(1);
  });

  it('prices 1M Sonnet output tokens at $10', () => {
    expect(estimateUsageUsd('claude-sonnet-5', 0, 1_000_000)).toBe(10);
  });

  it('charges nothing for a local run', () => {
    expect(estimateUsageUsd('local/hermes3', 50_000, 2_000)).toBe(0);
  });

  it('uses the historical Haiku fallback only when the id is unknown', () => {
    expect(estimateUsageUsd('unknown-local-cli', 1_000_000, 0)).toBe(FALLBACK_PRICE_INPUT_PER_M);
    expect(estimateUsageUsd('unknown-local-cli', 0, 1_000_000)).toBe(FALLBACK_PRICE_OUTPUT_PER_M);
  });
});
