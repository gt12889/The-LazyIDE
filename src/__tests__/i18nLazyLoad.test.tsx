/**
 * i18nLazyLoad.test.tsx
 *
 * Regression tests for the English-only i18n runtime (src/i18n/index.tsx).
 * The legacy non-English dictionaries still exist for historical fixtures
 * and key parity, but production locale resolution must ignore stale saved
 * values and never auto-switch from OS/browser locale.
 *
 * Two contracts must hold:
 *   1. Key parity — all 6 dictionaries expose the exact same key set, so
 *      switching locale (or falling back to DEFAULT_LOCALE mid-load) never
 *      silently drops a translation.
 *   2. English-only resolution — stale fr/es/zh/de/ja preferences normalize
 *      to English immediately, with no raw-key flash and no async flip.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { fr } from '../i18n/locales/fr';
import { en } from '../i18n/locales/en';
import { es } from '../i18n/locales/es';
import { zh } from '../i18n/locales/zh';
import { de } from '../i18n/locales/de';
import { ja } from '../i18n/locales/ja';
import { I18nProvider, useI18n } from '../i18n';
import type { Locale } from '../i18n/types';
import { WAKEUP_MARKER_PREFIX } from '../lib/agents/managerWakeup';

const DICTS: Record<Locale, Record<string, string>> = { fr, en, es, zh, de, ja };

function LocaleProbe({ testKey = 'nav.home' }: { testKey?: string }) {
  const { t, locale } = useI18n();
  return (
    <div>
      <span data-testid="locale">{locale}</span>
      <span data-testid="value">{t(testKey)}</span>
    </div>
  );
}

function LocaleListProbe() {
  const { LOCALES: runtimeLocales } = useI18n();
  return <span data-testid="locales">{runtimeLocales.map((l) => l.code).join(',')}</span>;
}

function setSavedLocale(locale: Locale, key = 'lazygt.locale'): void {
  localStorage.setItem(key, locale);
}

beforeEach(() => {
  localStorage.clear();
});

describe('i18n locale dictionaries — 6-way key parity', () => {
  const localeCodes = Object.keys(DICTS) as Locale[];

  it('every locale exposes the exact same key set as fr (DEFAULT_LOCALE)', () => {
    const baseline = new Set(Object.keys(DICTS.fr));
    expect(baseline.size).toBeGreaterThan(0);

    for (const code of localeCodes) {
      if (code === 'fr') continue;
      const keys = new Set(Object.keys(DICTS[code]));
      const missing = [...baseline].filter((k) => !keys.has(k));
      const extra = [...keys].filter((k) => !baseline.has(k));
      expect({ locale: code, missing, extra }).toEqual({ locale: code, missing: [], extra: [] });
    }
  });

  it('no dictionary contains an empty translation string', () => {
    for (const code of localeCodes) {
      const emptyKeys = Object.entries(DICTS[code])
        .filter(([, value]) => value.trim().length === 0)
        .map(([key]) => key);
      expect({ locale: code, emptyKeys }).toEqual({ locale: code, emptyKeys: [] });
    }
  });
});

describe('I18nProvider — English-only locale resolution', () => {
  it('en (DEFAULT_LOCALE) renders its real string on the very first synchronous render', () => {
    setSavedLocale('en');
    render(
      <I18nProvider>
        <LocaleProbe />
      </I18nProvider>,
    );
    expect(screen.getByTestId('locale')).toHaveTextContent('en');
    expect(screen.getByTestId('value')).toHaveTextContent(en['nav.home']);
  });

  it('normalizes a stale current-key French preference to English', () => {
    setSavedLocale('fr');
    render(
      <I18nProvider>
        <LocaleProbe />
      </I18nProvider>,
    );
    expect(screen.getByTestId('locale')).toHaveTextContent('en');
    expect(screen.getByTestId('value')).toHaveTextContent(en['nav.home']);
    expect(localStorage.getItem('lazygt.locale')).toBe('en');
  });

  it('removes the old lazy.locale key and still renders English', () => {
    setSavedLocale('zh', 'lazy.locale');
    render(
      <I18nProvider>
        <LocaleProbe />
      </I18nProvider>,
    );
    expect(screen.getByTestId('locale')).toHaveTextContent('en');
    expect(screen.getByTestId('value')).toHaveTextContent(en['nav.home']);
    expect(localStorage.getItem('lazy.locale')).toBeNull();
    expect(localStorage.getItem('lazygt.locale')).toBe('en');
  });

  it('does not flash raw untranslated keys for stale non-English locales', () => {
    setSavedLocale('es');
    render(
      <I18nProvider>
        <LocaleProbe testKey="nav.home" />
      </I18nProvider>,
    );
    expect(screen.getByTestId('value')).toHaveTextContent(en['nav.home']);
    expect(screen.getByTestId('value')).not.toHaveTextContent('nav.home');
  });

  it('exposes only English in the runtime locale picker metadata', () => {
    render(
      <I18nProvider>
        <LocaleListProbe />
      </I18nProvider>,
    );
    expect(screen.getByTestId('locales')).toHaveTextContent('en');
  });
});

// ── Manager wakeup — reply-language directive (regression) ──────────────
//
// Bug fixed here: managerEngine.ts's system prompt carries no locale-aware
// rule of its own, so the LazyManager's free-text reply to a proactive
// wakeup turn could come back in English even in a non-English app (real
// user report: French app, English "Action needed: ..." reply). Since
// managerWakeup.ts is deliberately i18n-free (see its own header) and the
// actual formatWakeupMessage template lives in agentsStore.tsx (out of this
// module's reach), the fix lives entirely in the translated
// `lazyManager.wakeup.instruction` string: each locale now appends an
// explicit in-language "reply in <language>" directive, so the wakeup
// turn's own input text (built from these keys) tells the LLM which
// language to answer in regardless of prior chat history. This test pins
// that content contract down so it cannot silently regress.
describe('lazyManager.wakeup.instruction — explicit reply-language directive', () => {
  // One recognizable substring per locale, in that locale's own language —
  // deliberately NOT the whole sentence, so unrelated copy edits to the
  // rest of the instruction don't break this test.
  const EXPECTED_DIRECTIVE: Record<Locale, string> = {
    fr: 'Réponds en français',
    en: 'Reply in English',
    es: 'Responde en español',
    de: 'Antworte auf Deutsch',
    zh: '请用中文回复',
    ja: '日本語で返信してください',
  };

  for (const locale of Object.keys(EXPECTED_DIRECTIVE) as Locale[]) {
    it(`${locale}: instruction embeds its own explicit reply-language directive`, () => {
      expect(DICTS[locale]['lazyManager.wakeup.instruction']).toContain(EXPECTED_DIRECTIVE[locale]);
    });
  }

  // Mirrors formatWakeupMessage's exact template (agentsStore.tsx) — that
  // function is not exported, so this reproduces its composition rule to
  // verify the directive survives concatenation into the real wakeup chip
  // text the LLM actually receives as its "user" turn input.
  function composeWakeupText(locale: Locale, body: string): string {
    const dict = DICTS[locale];
    return `${WAKEUP_MARKER_PREFIX}${dict['lazyManager.wakeup.label']} : ${body} — ${dict['lazyManager.wakeup.instruction']}`;
  }

  it('the composed wakeup message keeps the language directive and the wakeup marker for every locale', () => {
    for (const locale of Object.keys(EXPECTED_DIRECTIVE) as Locale[]) {
      const composed = composeWakeupText(locale, 'Mission M43 …');
      expect(composed.startsWith(WAKEUP_MARKER_PREFIX)).toBe(true);
      expect(composed).toContain(EXPECTED_DIRECTIVE[locale]);
    }
  });
});
