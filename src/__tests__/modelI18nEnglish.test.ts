/* modelI18nEnglish.test.ts — regression test for hardcoded French.
 *
 * 2026-08 i18n pass: several lib/models functions used to return hardcoded
 * French copy unconditionally (provider readiness reasons, the model-picker
 * group headers and empty-state fallback) — the exact bug class
 * RulesPanelI18nEnglish.test.tsx / HealthPanelI18nEnglish.test.tsx /
 * CommandPaletteI18n.test.tsx guard for on the React side, and
 * readinessI18nEnglish.test.ts (lib/models/readiness.ts) guards for on the
 * non-React side. This file extends that same non-React coverage to the
 * functions this pass added an optional `t` translator to.
 *
 * Every function under test accepts an optional translator (defaulting to
 * the hardcoded English copy — see each module's own doc comment). This
 * test builds a translator from the real `en` locale dictionary and
 * asserts the English copy comes out, with none of the previously
 * hardcoded French leaking through.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { en } from '../i18n/locales/en';

function makeTranslate(dict: Record<string, string>) {
  return (key: string, params?: Record<string, string | number>) => {
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

// A few of the previously-hardcoded French words/phrases this pass removed
// from the functions under test — used as a blunt "did French leak back in"
// net across every assertion below.
const FRENCH_LEAK_PATTERN = /Aucun[e]?\s|Réglages|abonnement|Crédits|indisponible|configurée|managé/i;

beforeEach(() => {
  localStorage.clear();
});

describe('models/index.ts — describeProviderReadiness localizes to English', () => {
  it('mock mode reason is English', async () => {
    const { describeProviderReadiness } = await import('../lib/models/index');
    const r = describeProviderReadiness('mock', tEn);
    expect(r.ready).toBe(false);
    expect(r.reason).toBe('No engine detected. Add an API key (Settings > Models) or install Claude Code.');
    expect(r.reason).not.toMatch(FRENCH_LEAK_PATTERN);
  });

  it('falls back to the hardcoded English when no translator is supplied', async () => {
    const { describeProviderReadiness } = await import('../lib/models/index');
    const r = describeProviderReadiness('mock');
    expect(r.ready).toBe(false);
    expect(r.reason).toMatch(/No engine detected/);
    expect(r.reason).not.toMatch(FRENCH_LEAK_PATTERN);
  });

  it('ready engines carry no reason in any locale', async () => {
    const { describeProviderReadiness } = await import('../lib/models/index');
    for (const mode of ['claude-code', 'codex', 'devin', 'local'] as const) {
      const r = describeProviderReadiness(mode, tEn);
      expect(r.ready).toBe(true);
      expect(r.reason).toBeUndefined();
    }
  });
});

describe('modelPickerOptions.ts — group labels and fallback messages localize to English', () => {
  it('buildModelPickerOptions labels the Claude-subscription and Devin groups in English', async () => {
    const { buildModelPickerOptions } = await import('../lib/models/modelPickerOptions');
    const result = buildModelPickerOptions({ claudeSub: true, codexManaged: false, devin: true, local: true }, tEn);
    const labels = result.groups.map((g) => g.label);
    expect(labels).toContain('Claude Subscription');
    expect(labels).toContain('Devin CLI');
    for (const label of labels) {
      expect(label).not.toMatch(FRENCH_LEAK_PATTERN);
    }
  });

  it('noModelFallbackMessage/modelManagedByCodexMessage render English copy', async () => {
    const { noModelFallbackMessage, modelManagedByCodexMessage } = await import('../lib/models/modelPickerOptions');
    expect(noModelFallbackMessage(tEn)).toBe('No model available — configure a Claude subscription or Lazy Pro.');
    expect(modelManagedByCodexMessage(tEn)).toMatch(/Codex manages its own models/);
    expect(noModelFallbackMessage(tEn)).not.toMatch(FRENCH_LEAK_PATTERN);
    expect(modelManagedByCodexMessage(tEn)).not.toMatch(FRENCH_LEAK_PATTERN);
  });

  it('falls back to the hardcoded English when no translator is supplied (unchanged default behavior)', async () => {
    const { noModelFallbackMessage, NO_MODEL_FALLBACK_MESSAGE } = await import('../lib/models/modelPickerOptions');
    expect(noModelFallbackMessage()).toBe(NO_MODEL_FALLBACK_MESSAGE);
    expect(noModelFallbackMessage()).toMatch(/No model available/);
    expect(noModelFallbackMessage()).not.toMatch(FRENCH_LEAK_PATTERN);
  });
});

describe('recovery.ts — noCreditsPolicy reason localizes to English', () => {
  it('blocks a no_credits error and returns an English reason when given an English translator', async () => {
    const { evaluateRecovery } = await import('../lib/agents/recovery');
    const stage = {
      id: 'stage-1', kind: 'implement' as const, label: 'Implement', description: 'test',
      model: 'anthropic/claude-sonnet-5', permissionMode: 'acceptEdits' as const,
      systemPrompt: '', taskPrompt: '', state: 'in_progress' as const,
      attemptCount: 0, maxAttempts: 3, dependsOn: [], onPass: null, onFail: null,
    };
    const decision = evaluateRecovery(
      stage,
      'Erreur agent: Crédits Pro épuisés — recharge ou bascule sur ton abonnement CLI dans Réglages > Modèles.',
      tEn,
    );
    expect(decision.action).toBe('block');
    expect(decision.reason).toMatch(/Pro credits exhausted/);
    expect(decision.reason).not.toMatch(FRENCH_LEAK_PATTERN);
  });
});
