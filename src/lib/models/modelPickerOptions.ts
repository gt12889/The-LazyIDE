/* modelPickerOptions — single source of truth for "which models can the user
   pick right now", used by every model picker (manager, New Mission modal,
   assistant Composer).

   Forge: local-first. Offered groups are the detected CLI backends'
   catalogs plus the local Ollama model. There is no hosted catalog, no
   free tier, no upsell group.

   Deliberately NOT a router: getProviderMode()/accessMode still decide which
   backend actually SERVES a request (unchanged, see index.ts). This module
   only answers "what should the picker OFFER".
*/

import type { ModelInfo } from './types.js';
import { isTauri as isTauriRuntime } from '../platform/index.js';
import { ALL_MODELS, DEFAULT_MODEL } from './registry.js';
import { devinModelInfos, DEFAULT_DEVIN_MODEL_ID, isDevinModel } from './devinCatalog.js';
import { loadAccessSettings } from './accessSettings.js';
import { isCliBackendAvailable } from './cliBackendProvider.js';
import { getProviderMode } from './index.js';
import { getEngineReadiness } from './entitlement.js';
import type { EngineReadiness } from './entitlement.js';
import { loadLocalModelName, getDiscoveredLocalNames, DEFAULT_LOCAL_MODEL_ID } from './localProvider.js';

/** i18n translate function shape. Optional everywhere: omitting `t` falls
 *  back to the hardcoded English copy. */
export type Translate = (key: string, params?: Record<string, string | number>) => string;

// ── Contract ──────────────────────────────────────────────────────

export type ModelGroupId = 'claude-sub' | 'devin' | 'local';

/** A single selectable model, normalized to the same shape regardless of
    which catalog it came from. */
export interface ModelOption {
  id: string;
  label: string;
  provider: string;
  description?: string;
}

export interface ModelOptionGroup {
  /** Known rail ids drive the group accent colour; any other string is a
      valid custom-group id and falls back to the neutral colour. */
  id: ModelGroupId | (string & {});
  /** Display label for the group header (optgroup / section). */
  label: string;
  models: ModelOption[];
}

export interface ModelEntitlements {
  /** Claude CLI detected (or explicitly chosen in Settings). */
  claudeSub: boolean;
  /** True when the effective engine is the Codex CLI (getProviderMode()
   *  === 'codex') — a valid, working backend that simply has no in-app
   *  model catalog (see registry.ts's module comment: ALL_MODELS is
   *  Anthropic-only). Lets buildModelPickerOptions tell "Codex is ready but
   *  has nothing to list" apart from "nothing is configured at all". */
  codexManaged: boolean;
  /** Devin CLI detected (devin.exe resolvable). Its models live in their
   *  own group — selecting one routes through the Devin ACP backend via
   *  the model-driven short-circuit in getProvider() (index.ts). Optional:
   *  undefined behaves as false. */
  devin?: boolean;
  /** Local engine — always offered (optimistic; Ollama reachability is
   *  async and surfaces at launch). */
  local: boolean;
}

export interface ModelPickerOptions {
  claudeSub: boolean;
  /** Only the entitled groups — never empty (the local group is unconditional). */
  groups: ModelOptionGroup[];
  /** True when at least one group (and therefore at least one model) is
      selectable. Always true — the local group is unconditional — but kept
      so existing callers' empty-state branches keep compiling. */
  hasOptions: boolean;
  /** Set only when hasOptions is false. Kept for call-site compatibility;
      always undefined (see hasOptions). */
  emptyReadiness?: EngineReadiness;
  /** True when the empty state above is Codex's own honest state (ready,
   *  serving chat, simply has no in-app model catalog) rather than a real
   *  "nothing configured" gap. See MODEL_MANAGED_BY_CODEX_MESSAGE, which
   *  callers should show INSTEAD of NO_MODEL_FALLBACK_MESSAGE when true. */
  codexManaged: boolean;
  /** Best default model id for these entitlements, in precedence order:
      the native default when a Claude subscription is usable, else the
      Devin default for a Devin-only setup, else the local default. Always
      a MEMBER of `groups`. */
  defaultModelId: string;
}

// ── Labels ────────────────────────────────────────────────────────

export const CLAUDE_SUB_LABEL = 'Claude subscription';
export const DEVIN_LABEL = 'Devin CLI';
export const LOCAL_LABEL = 'Local · Ollama';

/** @deprecated kept verbatim (name/type/value shape) only for existing
 *  importers. New/translated call sites should use
 *  {@link noModelFallbackMessage} instead. */
export const NO_MODEL_FALLBACK_MESSAGE = 'No model available — start Ollama or install a Claude subscription.';

/** @deprecated kept verbatim (name/type/value shape) only for existing
 *  importers. New/translated call sites should use
 *  {@link modelManagedByCodexMessage} instead. Honest empty-state copy for
 *  a Codex-only CLI setup: Codex IS a valid, selectable chat engine — it
 *  just has no in-app model catalog to list, because the Codex CLI manages
 *  its own model selection. */
export const MODEL_MANAGED_BY_CODEX_MESSAGE =
  'Codex manages its own models — model selection does not apply here.';

/** Translated replacement for NO_MODEL_FALLBACK_MESSAGE — pass useI18n().t(). */
export function noModelFallbackMessage(t?: Translate): string {
  return t ? t('models.picker.noModelFallback') : NO_MODEL_FALLBACK_MESSAGE;
}

/** Translated replacement for MODEL_MANAGED_BY_CODEX_MESSAGE — pass useI18n().t(). */
export function modelManagedByCodexMessage(t?: Translate): string {
  return t ? t('models.picker.codexManaged') : MODEL_MANAGED_BY_CODEX_MESSAGE;
}

// ── Detection ─────────────────────────────────────────────────────

/**
 * Live entitlement detection. Pure aside from reading module-level caches
 * (CLI detection, settings) — the same caches every other model-routing
 * function in this package reads, so this never re-fetches or re-detects
 * anything itself.
 */
export function detectModelEntitlements(): ModelEntitlements {
  if (!isTauriRuntime()) {
    // Browser: Claude CLI / local Ollama-via-Tauri cannot run. The web demo
    // runs on mockProvider — no group is genuinely usable, but the local
    // group stays visible so the UI never renders an empty picker.
    return {
      claudeSub: false,
      codexManaged: false,
      devin: false,
      local: true,
    };
  }

  const settings = loadAccessSettings();
  // Trusts an explicit accessMode selection the same way getProviderMode()
  // does (no live re-check) — EXCEPT 'cli' only counts when the configured
  // tool is actually claude: a Codex-only CLI setup is not a Claude
  // subscription and must not unlock the Claude model catalog.
  const cliTool = settings.cliTool ?? 'claude';
  const claudeSub =
    isCliBackendAvailable('claude') === true ||
    (settings.accessMode === 'cli' && cliTool === 'claude');

  // Reuses getProviderMode()'s own resolution instead of re-deriving the
  // same priority order here.
  const codexManaged = getProviderMode() === 'codex';

  return { claudeSub, codexManaged, devin: isCliBackendAvailable('devin') === true, local: true };
}

// ── Options builder ───────────────────────────────────────────────

function nativeOptions(): ModelOption[] {
  return ALL_MODELS.map((m: ModelInfo) => ({
    id: m.id,
    label: m.label,
    provider: m.provider,
    description: m.description,
  }));
}

function localOptions(): ModelOption[] {
  // Discovered names (from the last refreshLocalModels probe) first —
  // configured model always present even before/after a failed probe.
  const discovered = getDiscoveredLocalNames();
  const names = discovered.length > 0 ? discovered : [loadLocalModelName()];
  return names.map((name) => ({
    id: `local/${name}`,
    label: name,
    provider: 'local',
    description: 'Local model (Ollama/LM Studio)',
  }));
}

/**
 * Pure builder — given an entitlements snapshot, returns everything a picker
 * needs to render. Separated from detectModelEntitlements() so tests can
 * exercise every combination without mocking CLI/localStorage internals.
 */
export function buildModelPickerOptions(entitlements: ModelEntitlements, t?: Translate): ModelPickerOptions {
  const claudeSubLabel = t ? t('models.picker.claudeSubLabel') : CLAUDE_SUB_LABEL;
  const devinLabel = t ? t('models.picker.devinLabel') : DEVIN_LABEL;
  const localLabel = t ? t('models.picker.localLabel') : LOCAL_LABEL;
  const groups: ModelOptionGroup[] = [
    // Local first — the Forge default, always offered.
    { id: 'local' as const, label: localLabel, models: localOptions() },
    ...(entitlements.claudeSub
      ? [{ id: 'claude-sub' as const, label: claudeSubLabel, models: nativeOptions() }]
      : []),
    ...(entitlements.devin
      ? [{
          id: 'devin' as const,
          label: devinLabel,
          models: devinModelInfos().map((m) => ({
            id: m.id,
            label: m.label,
            provider: m.provider,
            description: 'Devin CLI',
          })),
        }]
      : []),
  ];

  const hasOptions = groups.length > 0;

  return {
    claudeSub: entitlements.claudeSub,
    groups,
    hasOptions,
    emptyReadiness: hasOptions ? undefined : getEngineReadiness(),
    // Only meaningful when hasOptions is false — see codexManaged's doc
    // comment on ModelPickerOptions for why callers must check this BEFORE
    // falling back to the generic NO_MODEL_FALLBACK_MESSAGE.
    codexManaged: !hasOptions && entitlements.codexManaged,
    defaultModelId:
      entitlements.claudeSub
        ? DEFAULT_MODEL.id
        : entitlements.devin
          ? DEFAULT_DEVIN_MODEL_ID
          : DEFAULT_LOCAL_MODEL_ID,
  };
}

/** Convenience wrapper: live-detects entitlements, then builds options. The
    one call site every real component should use — see buildModelPickerOptions
    for the pure/testable core. */
export function getModelPickerOptions(t?: Translate): ModelPickerOptions {
  return buildModelPickerOptions(detectModelEntitlements(), t);
}

/** True when `id` is in an unlocked picker group. Any `local/` id counts:
 *  Ollama serves models by name, so a discovered-or-typed local name is
 *  selectable even when no discovery probe has run (or listed it). */
export function isSelectablePickerModel(id: string): boolean {
  if (id.startsWith('local/') && id.length > 'local/'.length) return true;
  const opts = getModelPickerOptions();
  return opts.groups.some((g) => g.models.some((m) => m.id === id));
}

/** True when `id` belongs to a rail whose availability probe has NOT
 *  settled yet — i.e. the model is temporarily invisible in the picker
 *  purely because detection is still running, not because it is unusable.
 *  Used by persistence loaders (loadManagerModel) and the header's
 *  validation effect. Local ids are never pending (no probe to wait for). */
export function isModelRailPending(id: string): boolean {
  if (!id) return false;
  // Outside Tauri the CLI probes never run — `null` there means "will
  // never be available", not "detection in flight".
  if (isTauriRuntime()) {
    if (isDevinModel(id)) return isCliBackendAvailable('devin') === null;
    if (ALL_MODELS.some((m) => m.id === id)) {
      // Native ids can be served by either CLI — pending while either probe is.
      return isCliBackendAvailable('claude') === null || isCliBackendAvailable('codex') === null;
    }
  }
  return false;
}
