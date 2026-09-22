import { isTauri } from '../platform/index.js';
import { ALL_MODELS, DEFAULT_MODEL } from './registry.js';
import { loadAccessSettings } from './accessSettings.js';
import { localProvider } from './localProvider.js';
import { isCliBackendAvailable } from './cliBackendProvider.js';
import { devinModelInfos, DEFAULT_DEVIN_MODEL_ID } from './devinCatalog.js';
import type { EngineReadiness } from './entitlement.js';
import type { ByokProviderDef } from './byokProviders.js';
export type Translate = (key: string, params?: Record<string, string | number>) => string;

// ── Contract ──────────────────────────────────────────────────────

export type ModelGroupId = 'free' | 'claude-sub' | 'devin' | 'pro' | 'byok';

/** A single selectable model, normalized to the same shape regardless of
    which catalog (native registry.ts vs openrouterCatalog.ts) it came from. */
export interface ModelOption {
  id: string;
  label: string;
  provider: string;
  description?: string;
}

export interface ModelOptionGroup {
  /** Known rail ids drive the group accent colour; any other string is a
      valid custom-group id (e.g. per-provider groups in the assistant
      settings panel) and falls back to the neutral colour. */
  id: ModelGroupId | (string & {});
  /** Display label for the group header (optgroup / section), e.g.
      "Abonnement Claude" / "LazyPro / Managé". */
  label: string;
  models: ModelOption[];
}

export type ProEntitlementState = 'active' | 'no-credits' | 'inactive';

export interface ModelEntitlements {
  /** Claude subscription usable right now (native CLI or BYOK). */
  claudeSub: boolean;
  pro: ProEntitlementState;
  /** BYOK wave: the non-Anthropic BYOK provider whose key is set (prefers
   *  the explicitly SELECTED provider, else the first keyed one). Anthropic
   *  is intentionally excluded here — its native models already live in the
   *  'claude-sub' group (see detectModelEntitlements). */
  byok?: ByokProviderDef | null;
  /** True when the effective engine is the Codex CLI (getProviderMode()
   *  === 'codex') — a valid, working backend that simply has no in-app
   *  model catalog (see registry.ts's module comment: ALL_MODELS is
   *  Anthropic-only). Lets buildModelPickerOptions tell "Codex is ready but
   *  has nothing to list" apart from "nothing is configured at all", so the
   *  empty-state message stays honest instead of recommending the user
   *  configure a subscription they may already have working. */
  codexManaged: boolean;
  /** Devin CLI detected (devin.exe resolvable). Its models live in their
   *  own group — selecting one routes through the Devin ACP backend via
   *  the model-driven short-circuit in getProvider() (index.ts). Optional:
   *  undefined behaves as false. */
  devin?: boolean;
}

export interface ModelPickerOptions {
  claudeSub: boolean;
  pro: ProEntitlementState;
  /** BYOK wave: the keyed BYOK provider (null when none). */
  byok: ByokProviderDef | null;
  /** Only the entitled groups — empty when neither entitlement is present. */
  groups: ModelOptionGroup[];
  /** True when at least one group (and therefore at least one model) is
      selectable. False is the "clear empty state" case callers must handle. */
  hasOptions: boolean;
  /** True when Pro is active but out of credits — a secondary notice worth
      surfacing even when hasOptions is true (the Claude group may still be
      usable). Reuses the existing 'pro-no-credits' i18n copy (entitlement.ts). */
  proExhausted: boolean;
  /** Set only when hasOptions is false. Reuses getEngineReadiness()'s
      existing reason codes/copy (already translated in every locale, already
      wired to the "Configurer"/"Passer Pro" actions in NewMissionModal and
      Composer) instead of inventing new empty-state copy. */
  emptyReadiness?: EngineReadiness;
  /** True when the empty state above is Codex's own honest state (ready,
   *  serving chat, simply has no in-app model catalog) rather than a real
   *  "nothing configured" gap. Set only when hasOptions is false — see
   *  MODEL_MANAGED_BY_CODEX_MESSAGE, which callers should show INSTEAD of
   *  NO_MODEL_FALLBACK_MESSAGE when this is true. */
  codexManaged: boolean;
  /** Best default model id for these entitlements, in precedence order:
      the managed catalog's default when Pro is actively usable (mirrors
      getProviderMode()'s own auto-detect priority, which favors managed);
      else the keyed BYOK provider's own default model; else the native
      default when a Claude subscription is usable; else — when NONE of the
      above is entitled — the free tier's own default id (first isFree entry
      in the OpenRouter catalog, see DEFAULT_FREE_MODEL_ID). That last branch
      is what keeps this id always a MEMBER of `groups`: the free group is
      the only one offered to a zero-entitlement user, so returning the
      native DEFAULT_MODEL.id here (the pre-free-tier behavior) handed
      callers — e.g. NewMissionModal's form seed — a model id absent from
      every rendered <option>, which then failed getEngineReadiness's CLI
      preflight even though ox alpha was fully usable. */
  defaultModelId: string;
  /** W-MODELSEL fix: the full Pro catalog to render as a visually distinct,
   *  NON-selectable group with an upsell line — populated when Pro is NOT
   *  actively usable, i.e. entitlements.pro === 'inactive' (no plan at all)
   *  OR 'no-credits' (plan active, wallet exhausted). In both cases the Pro
   *  models must stay VISIBLE (grayed out) so the user can see what they're
   *  missing — the UI distinguishes the two via proExhausted for the messaging
   *  (recharge/wait-for-refill vs upgrade). Kept separate from `groups`
   *  (rather than added to it with a `locked` flag) so every existing
   *  groups-based assertion/consumer is unaffected. */
  lockedProGroup?: ModelOptionGroup;
}


export const CLAUDE_SUB_LABEL = 'Claude Code CLI';
export const PRO_LABEL = '';
export const DEVIN_LABEL = 'Devin CLI';
export const FREE_GROUP_LABEL = 'Local';
export const NO_MODEL_FALLBACK_MESSAGE = 'Select a local model or configure a CLI in Settings.';
export const MODEL_MANAGED_BY_CODEX_MESSAGE = 'Codex CLI uses its own model configuration.';
export function noModelFallbackMessage(_t?: Translate): string { return NO_MODEL_FALLBACK_MESSAGE; }
export function modelManagedByCodexMessage(_t?: Translate): string { return MODEL_MANAGED_BY_CODEX_MESSAGE; }
export function detectModelEntitlements(): ModelEntitlements {
 const s = loadAccessSettings();
 return { claudeSub: isTauri() && s.accessMode === 'cli' && (s.cliTool ?? 'claude') === 'claude', pro: 'inactive', byok: null, codexManaged: s.accessMode === 'cli' && s.cliTool === 'codex', devin: isTauri() && s.accessMode === 'cli' && s.cliTool === 'devin' };
}
export function buildModelPickerOptions(e: ModelEntitlements, _t?: Translate): ModelPickerOptions {
 const groups: ModelOptionGroup[] = e.codexManaged ? [] : e.claudeSub ? [{ id: 'claude-sub', label: CLAUDE_SUB_LABEL, models: ALL_MODELS }] : e.devin ? [{ id: 'devin', label: DEVIN_LABEL, models: [...devinModelInfos()] }] : [{ id: 'local', label: 'Local · Ollama / LM Studio', models: localProvider.listModels() }];
 return { claudeSub: e.claudeSub, pro: 'inactive', byok: null, groups, hasOptions: groups.length > 0, proExhausted: false, codexManaged: e.codexManaged, defaultModelId: e.codexManaged ? '' : e.claudeSub ? DEFAULT_MODEL.id : e.devin ? DEFAULT_DEVIN_MODEL_ID : localProvider.listModels()[0].id };
}
export function getModelPickerOptions(t?: Translate): ModelPickerOptions { return buildModelPickerOptions(detectModelEntitlements(), t); }
export function isSelectablePickerModel(id: string): boolean { return getModelPickerOptions().groups.some(g => g.models.some(m => m.id === id)); }
export function isModelRailPending(id: string): boolean { return isTauri() && id.startsWith('claude') && isCliBackendAvailable('claude') === null; }
