/* entitlement — single source of truth for "can the selected engine run
   right now" (Forge: local-first, no hosted backend).

   Every launch surface (mission modal, assistant composer, settings model
   pickers) calls getEngineReadiness() as a synchronous preflight before
   starting work, so a mission can never launch into a void.

   Pure module: no React, no async. All runtime signals are already cached
   elsewhere and only interpreted here:
     - CLI detection      — isCliBackendAvailable() cache, filled once at
                            startup by initProviderMode() (index.ts).
     - Local engine       — optimistic (isLocalAvailable() is async); a real
                            connection failure surfaces loudly at launch.
*/

import { loadAccessSettings } from './accessSettings.js';
import type { CliTool } from './accessSettings.js';
import { isCliBackendAvailable } from './cliBackendProvider.js';
import { findModelById } from './registry.js';
import { isDevinModel } from './devinCatalog.js';

// ── Contract ──────────────────────────────────────────────────────

export type EngineReadinessReason =
  | 'cli-not-found'
  | 'local-unreachable';

export type EngineReadiness = {
  mode: 'cli' | 'local';
  ready: boolean;
  reason?: EngineReadinessReason;
};

/** i18n key for a not-ready reason — shared by every preflight surface so
    the copy lives in exactly one locale key per reason. */
export function engineReasonKey(reason: EngineReadinessReason): string {
  return `engine.reason.${reason}`;
}

// ── Readiness check ───────────────────────────────────────────────

/**
 * Synchronous readiness of the engine the user selected (or the best
 * auto-detected one when no explicit mode is set). Uses only cached
 * detection — safe to call on every submit/render.
 *
 * @param forMode Evaluate a SPECIFIC engine instead of the selected one.
 * @param modelId BUG-4: the concrete model id chosen for THIS launch (e.g. a
 *                canvas draft's model or the mission modal's form.modelId).
 *                Only consulted when forMode is not set. A real native id
 *                found in the ALL_MODELS catalog (findModelById)
 *                short-circuits to 'cli' ready; a 'local/<name>' id
 *                short-circuits to 'local' ready. Anything else falls through
 *                to the global-mode switch below unchanged.
 */
export function getEngineReadiness(
  forMode?: EngineReadiness['mode'],
  modelId?: string,
): EngineReadiness {
  const settings = loadAccessSettings();
  if (!forMode && modelId && findModelById(modelId)) {
    return cliReadiness(settings.cliTool ?? 'claude');
  }
  // Devin-catalog id picked explicitly (swe-2-medium, ...) — readiness
  // follows the Devin CLI's own detection, whatever the ambient cliTool is.
  if (!forMode && modelId && isDevinModel(modelId)) {
    return cliReadiness('devin');
  }
  // Explicit local model id — readiness follows the local engine.
  if (!forMode && modelId && modelId.startsWith('local/')) {
    return localReadiness();
  }
  switch (forMode ?? settings.accessMode) {
    case 'cli':
      return cliReadiness(settings.cliTool ?? 'claude');
    case 'local':
      return localReadiness();
    default:
      return autoReadiness();
  }
}

function cliReadiness(tool: CliTool): EngineReadiness {
  const available = isCliBackendAvailable(tool);
  // null = startup detection not finished yet — stay optimistic (mirrors
  // getProviderMode's benefit-of-the-doubt) so the first seconds of the app
  // never flash a false "CLI not found". A real launch failure is surfaced
  // loudly by the mission pipeline (statusReason).
  if (available === false) {
    return { mode: 'cli', ready: false, reason: 'cli-not-found' };
  }
  return { mode: 'cli', ready: true };
}

function localReadiness(): EngineReadiness {
  // No synchronous detection available — isLocalAvailable() is async (HTTP ping).
  // Stay optimistic like cliReadiness's null-detection window; a real launch
  // failure (Ollama down) is surfaced loudly by the mission pipeline.
  return { mode: 'local', ready: true };
}

/** No explicit mode chosen — resolve to the effective engine using the same
    priority order as getProviderMode()/autoDetectProvider(). */
function autoReadiness(): EngineReadiness {
  if (isCliBackendAvailable('claude') === true) return { mode: 'cli', ready: true };
  if (isCliBackendAvailable('codex') === true) return { mode: 'cli', ready: true };
  if (isCliBackendAvailable('devin') === true) return { mode: 'cli', ready: true };
  if (isCliBackendAvailable('claude') === null) {
    // Startup window: detection still running — optimistic, see cliReadiness.
    return { mode: 'cli', ready: true };
  }
  // No CLI detected — local LLM is the Forge default (ships with Ollama).
  return { mode: 'local', ready: true };
}

/** True when AT LEAST ONE engine can run right now — a detected CLI tool,
 *  or the local engine (always assumed present; connection failures surface
 *  at launch, not here). */
export function isAnyEngineUsable(): boolean {
  if (isCliBackendAvailable('claude') === true) return true;
  if (isCliBackendAvailable('codex') === true) return true;
  if (isCliBackendAvailable('devin') === true) return true;
  // Local engine: optimistic — see localReadiness.
  return true;
}
