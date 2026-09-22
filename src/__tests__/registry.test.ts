import { describe, it, expect } from 'vitest';
import {
  ALL_MODELS,
  MODELS_BY_PROVIDER,
  DEFAULT_MODEL,
  findModelById,
} from '../lib/models/registry';

// ── Native CLI registry (Anthropic only) ────────────────────────────
// Forge: local-first, no hosted backend. ALL_MODELS holds the native
// Anthropic ids consumed by the CLI backends; local models use
// 'local/<name>' ids (see localProvider.ts). There is no OpenRouter /
// managed catalog anymore — the OPENROUTER_* exports are gone.

describe('registry — native models (CLI path)', () => {
  it('ALL_MODELS contains at least 3 models', () => {
    expect(ALL_MODELS.length).toBeGreaterThanOrEqual(3);
  });

  it('ALL_MODELS contains only Anthropic native ids', () => {
    const providers = new Set(ALL_MODELS.map(m => m.provider));
    expect(providers.has('anthropic')).toBe(true);
    // No hosted catalog lives here — OpenAI/Google entries were removed.
    expect(providers.has('openai')).toBe(false);
    expect(providers.has('google')).toBe(false);
  });

  it('DEFAULT_MODEL is Haiku (claude-haiku-4-5)', () => {
    expect(DEFAULT_MODEL.id).toBe('claude-haiku-4-5');
    expect(DEFAULT_MODEL.provider).toBe('anthropic');
  });

  it('DEFAULT_MODEL description mentions fast or default', () => {
    const desc = DEFAULT_MODEL.description?.toLowerCase() ?? '';
    expect(desc.includes('fast') || desc.includes('default')).toBe(true);
  });

  // v0.1.7 ("model picker fixes") deliberately added claude-fable-5 to the
  // native catalog, with matching UI updates in the same commit — a real
  // 4th model, not drift. 3 -> 4 here encodes that intent.
  it('MODELS_BY_PROVIDER.anthropic has 4 models', () => {
    expect(MODELS_BY_PROVIDER.anthropic).toHaveLength(4);
  });

  it('MODELS_BY_PROVIDER.anthropic contains Opus 5, Fable, Sonnet, Haiku', () => {
    const ids = MODELS_BY_PROVIDER.anthropic.map(m => m.id);
    expect(ids).toContain('claude-opus-5');
    expect(ids).toContain('claude-fable-5');
    expect(ids).toContain('claude-sonnet-5');
    expect(ids).toContain('claude-haiku-4-5');
  });

  it('MODELS_BY_PROVIDER groups every ALL_MODELS entry', () => {
    const grouped = Object.values(MODELS_BY_PROVIDER).flat();
    expect(grouped.map(m => m.id).sort()).toEqual(ALL_MODELS.map(m => m.id).sort());
  });

  it('findModelById returns the correct model', () => {
    const model = findModelById('claude-sonnet-5');
    expect(model).toBeDefined();
    expect(model?.provider).toBe('anthropic');
  });

  it('findModelById returns undefined for unknown id', () => {
    expect(findModelById('gpt-999-fake')).toBeUndefined();
  });

  it('findModelById returns undefined for local ids (different namespace)', () => {
    expect(findModelById('local/hermes3')).toBeUndefined();
  });

  it('every model has required fields', () => {
    for (const m of ALL_MODELS) {
      expect(m.id).toBeTruthy();
      expect(m.label).toBeTruthy();
      expect(m.provider).toBeTruthy();
    }
  });
});
