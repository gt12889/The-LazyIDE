/* readinessI18nEnglish.test.ts — regression test for hardcoded French.
 *
 * lib/models/readiness.ts used to return every BackendReadiness label /
 * reason / howToEnable string as a hardcoded French literal (e.g. "Claude
 * Code (abonnement)") regardless of the caller's locale — those strings feed
 * straight into ProvidersPanel's "Available engines" list in Settings >
 * Models. Observed live with the interface language set to English.
 *
 * The functions now accept an optional translator AND default to the
 * English fallback (FALLBACK_EN) when none is supplied. This test builds a
 * translator from the real `en` locale dictionary and asserts the English
 * copy comes out — and that the translator-less default is English too,
 * with none of the previously hardcoded French leaking through.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../lib/models/cliBackendProvider', () => ({
  isCliBackendAvailable: vi.fn().mockReturnValue(null),
  CLI_BACKENDS: [],
  detectAllCliBackends: vi.fn(),
  cliBackendProvider: vi.fn(),
}));

import {
  claudeCliReadiness,
  codexCliReadiness,
  localReadiness,
  getAllBackendsReadiness,
  type Translate,
} from '../lib/models/readiness';
import { en } from '../i18n/locales/en';

function makeTranslate(dict: Record<string, string>): Translate {
  return (key, params) => {
    let str = dict[key] ?? key;
    if (params) {
      for (const [k, v] of Object.entries(params)) {
        str = str.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v));
      }
    }
    return str;
  };
}

const tEn = makeTranslate(en);

// A few of the previously-hardcoded French words/phrases — used as a blunt
// "did French leak back in" net across every assertion below.
const FRENCH_LEAK_PATTERN = /abonnement|introuvable|en cours|Installe|redémarre|Clé API|géré par/i;

beforeEach(() => {
  localStorage.clear();
});

describe('readiness.ts — labels/reasons localize to English when passed an English translator', () => {
  it('claudeCliReadiness renders an English label and reason', () => {
    const r = claudeCliReadiness(tEn);
    expect(r.label).toBe('Claude Code (subscription)');
    expect(r.label).not.toMatch(FRENCH_LEAK_PATTERN);
    expect(r.reason).not.toMatch(FRENCH_LEAK_PATTERN);
  });

  it('codexCliReadiness renders English copy', () => {
    const r = codexCliReadiness(tEn);
    expect(r.label).toBe('Codex CLI (OpenAI)');
    expect(r.howToEnable).not.toMatch(FRENCH_LEAK_PATTERN);
  });

  it('localReadiness renders English copy', () => {
    const r = localReadiness(tEn);
    expect(r.label).not.toMatch(FRENCH_LEAK_PATTERN);
    expect(r.howToEnable).not.toMatch(FRENCH_LEAK_PATTERN);
  });

  it('getAllBackendsReadiness never leaks French labels when passed an English translator', () => {
    const all = getAllBackendsReadiness(tEn);
    expect(all).toHaveLength(3);
    for (const backend of all) {
      expect(backend.label).not.toMatch(FRENCH_LEAK_PATTERN);
      if (backend.reason) expect(backend.reason).not.toMatch(FRENCH_LEAK_PATTERN);
      if (backend.howToEnable) expect(backend.howToEnable).not.toMatch(FRENCH_LEAK_PATTERN);
    }
  });
});

describe('readiness.ts — translator-less default is English (not French)', () => {
  it('claudeCliReadiness defaults to the English label and reason', () => {
    const r = claudeCliReadiness();
    expect(r.label).toBe('Claude Code (subscription)');
    expect(r.label).not.toMatch(FRENCH_LEAK_PATTERN);
    expect(r.reason).not.toMatch(FRENCH_LEAK_PATTERN);
  });

  it('codexCliReadiness defaults to English copy', () => {
    const r = codexCliReadiness();
    expect(r.label).toBe('Codex CLI (OpenAI)');
    expect(r.howToEnable).not.toMatch(FRENCH_LEAK_PATTERN);
  });

  it('localReadiness defaults to English copy', () => {
    const r = localReadiness();
    expect(r.label).toBe('Local LLM (Ollama / LM Studio)');
    expect(r.howToEnable).not.toMatch(FRENCH_LEAK_PATTERN);
  });
});
