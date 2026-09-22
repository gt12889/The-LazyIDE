/* Provider readiness model — pure, typed, testable (Forge: CLI + local).

   Returns a structured readiness descriptor for each backend so the UI can
   render actionable states rather than opaque error strings.

   Design notes:
   - All functions are pure (no React, no side effects).
   - Runtime checks (CLI detection) are resolved before calling
     these helpers; the helpers only interpret the already-known values.
   - Local-engine readiness is soft: Ollama reachability is async and cannot
     be checked from these sync helpers. We report ready=true and let the
     launch pipeline surface a refused connection loudly.
*/

import type { ProviderMode } from './index.js';
import { isCliBackendAvailable } from './cliBackendProvider.js';

// ── Types ─────────────────────────────────────────────────────────

/** Translator function shape — matches useI18n().t so callers can pass the
 *  hook's `t` directly. Defaults to the `en` copy when no translator is
 *  supplied, e.g. from tests that call these pure functions directly
 *  without an I18nProvider. */
export type Translate = (key: string, params?: Record<string, string | number>) => string;

function interpolate(template: string, params?: Record<string, string | number>): string {
  if (!params) return template;
  let str = template;
  for (const [k, v] of Object.entries(params)) {
    str = str.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v));
  }
  return str;
}

// Fallback dictionary (en) — used when a caller does not supply a translator.
const FALLBACK_EN: Record<string, string> = {
  'settings.readiness.claudeCode.label':       'Claude Code (subscription)',
  'settings.readiness.claudeCode.notFound':    'claude binary not found on PATH.',
  'settings.readiness.claudeCode.howToEnable': 'Install Claude Code: https://claude.ai/download, then restart Forge.',
  'settings.readiness.codex.label':            'Codex CLI (OpenAI)',
  'settings.readiness.codex.notFound':         'codex binary not found on PATH.',
  'settings.readiness.codex.howToEnable':      'Install the OpenAI Codex CLI (npm i -g @openai/codex), then restart Forge.',
  'settings.readiness.detectingCli':           'Detecting CLIs...',
  'settings.readiness.local.label':            'Local LLM (Ollama / LM Studio)',
  'settings.readiness.local.howToEnable':      'Start Ollama (ollama serve) — Hermes 3 is bundled with the Forge setup.',
};

const defaultTranslate: Translate = (key, params) => interpolate(FALLBACK_EN[key] ?? key, params);

export interface BackendReadiness {
  /** Unique backend id. */
  id: string;
  /** Human-readable backend name, localized via the translator passed in. */
  label: string;
  /** Whether this backend can accept requests right now. */
  ready: boolean;
  /** Why it is not ready (absent when ready === true). */
  reason?: string;
  /** Actionable fix instructions (absent when ready === true). */
  howToEnable?: string;
}

// ── Per-backend descriptors ───────────────────────────────────────

export function claudeCliReadiness(t: Translate = defaultTranslate): BackendReadiness {
  const available = isCliBackendAvailable('claude');
  // null = detection not yet run (treat as not-ready for display purposes)
  const ready = available === true;
  return {
    id: 'claude-code',
    label: t('settings.readiness.claudeCode.label'),
    ready,
    reason: ready
      ? undefined
      : available === null
        ? t('settings.readiness.detectingCli')
        : t('settings.readiness.claudeCode.notFound'),
    howToEnable: ready
      ? undefined
      : t('settings.readiness.claudeCode.howToEnable'),
  };
}

export function codexCliReadiness(t: Translate = defaultTranslate): BackendReadiness {
  const available = isCliBackendAvailable('codex');
  const ready = available === true;
  return {
    id: 'codex',
    label: t('settings.readiness.codex.label'),
    ready,
    reason: ready
      ? undefined
      : available === null
        ? t('settings.readiness.detectingCli')
        : t('settings.readiness.codex.notFound'),
    howToEnable: ready
      ? undefined
      : t('settings.readiness.codex.howToEnable'),
  };
}

export function localReadiness(t: Translate = defaultTranslate): BackendReadiness {
  return {
    id: 'local',
    label: t('settings.readiness.local.label'),
    ready: true,
    howToEnable: t('settings.readiness.local.howToEnable'),
  };
}

// ── Aggregate helper ──────────────────────────────────────────────

/** Return readiness descriptors for every backend in display order:
 *  the CLI rails, then the local engine. */
export function getAllBackendsReadiness(t: Translate = defaultTranslate): BackendReadiness[] {
  return [
    claudeCliReadiness(t),
    codexCliReadiness(t),
    localReadiness(t),
  ];
}

/** Return the backend id that corresponds to the currently active ProviderMode. */
export function activeBackendId(mode: ProviderMode): string {
  if (mode === 'mock') return 'mock';
  if (mode === 'local') return 'local';
  return mode;
}
