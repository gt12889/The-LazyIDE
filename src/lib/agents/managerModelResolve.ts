/* managerModelResolve — exact catalog id + tier hint → rail-valid model id.

   Measured 2026-08-28: resolveManagerModelId cyclomatic complexity was 42
   (ESLint ratchet ceiling 12). Lives here so managerEngine.ts stays the
   LLM turn loop, not a rail catalog matcher.
*/

import { getDefaultModelIdForMode, loadAccessSettings } from '../models/index.js';
import type { ProviderMode } from '../models/index.js';
import { ALL_MODELS } from '../models/registry.js';
import { DEFAULT_LOCAL_MODEL_ID } from '../models/localProvider.js';
import { isDevinModel, devinModelInfos } from '../models/devinCatalog.js';
import { isCliBackendAvailable } from '../models/cliBackendProvider.js';
import type { ManagerEngineChoice } from './types.js';

const TIER_WORD = /haiku|sonnet|opus/;

/**
 * Thrown by resolveManagerModelId when an action names an exact `modelId`
 * (ManagerModelId, types.ts) that does not exist in the catalog for the rail
 * actually in effect this turn — NEVER caught here and silently swapped for
 * a default (NEVER DEGRADE IN SILENCE). Left to propagate out of
 * executeManagerAction: the per-action try/catch in sendManagerMessage
 * (agentsStore.tsx) already turns any thrown Error into an honest, visible
 * `agents.manager.actionFailed` message carrying `.message` — the same idiom
 * every other honest-failure case in that executor already uses (e.g.
 * delete_mission's "mission not found" throw) — so no new error-handling
 * plumbing is needed at the call sites.
 *
 * `hint` (tolerant-normalization wave, 2026-08-05): an optional extra
 * sentence appended after the base per-rail message — used ONLY when the id
 * could not be silently normalized (see resolveBareRailModelId /
 * findOpenRouterAliasHint / findByokHomeHint below) but a plausible OTHER
 * home for it was found anyway, so the rejection stays actionable instead of
 * a dead end. Omitted (the default) keeps the base message byte-identical to
 * before this wave — a genuinely unknown id is rejected UNCHANGED.
 */
export class UnknownManagerModelIdError extends Error {
  /** The exact id the action requested that was not found in the effective rail's catalog. */
  readonly modelId: string;
  /** Which rail's catalog was actually checked against. */
  readonly rail: 'cli' | 'local';

  constructor(modelId: string, rail: 'cli' | 'local', hint?: string) {
    const base =
      rail === 'cli'
        ? `Model id "${modelId}" is not available on the CLI rail — that rail only understands native ids (registry.ts's ALL_MODELS). Pick an id from ALL_MODELS, switch this action's "engine" to "local", or use a tier hint instead.`
        : `Model id "${modelId}" is not a local-engine id — that rail only understands 'local/<name>' ids for Ollama/LM Studio models. Pick a 'local/<name>' id, switch this action's "engine" to "cli", or omit the model to use the default.`;
    super(hint ? `${base} ${hint}` : base);
    this.name = 'UnknownManagerModelIdError';
    this.modelId = modelId;
    this.rail = rail;
  }
}

// ── Tolerant modelId normalization ────────────────────────────────────
// The manager can name a launch_mission/create_loop step's model using a
// vendor-STYLE id ("anthropic/claude-sonnet-5") even when the EFFECTIVE
// rail this turn is a bare-id one (native CLI). Fixed with a
// strictly-scoped tolerant lookup: an id is only ever silently accepted
// when it is TRIVIALLY safe to do so (same rail, same model, cosmetic
// prefix only) — anything more speculative is still a hard rejection,
// just a more actionable one.

/** Case/hyphen/dot-insensitive comparison key for a vendor token — lets
 *  "x-ai" and "xAI"-derived tokens compare equal without a hand-maintained
 *  synonym table. Used only to decide whether a supplied "vendor/" prefix
 *  plausibly agrees with a rail's own provider, never to look anything up
 *  by itself. */
function normalizeVendorToken(token: string): string {
  return token.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** Discriminated result of resolveBareRailModelId. `ok: true` carries the
 *  RESOLVED catalog id (which may differ from what was requested, once
 *  normalized). `ok: false` optionally carries a `hint` for
 *  UnknownManagerModelIdError's message — undefined means "genuinely
 *  unknown, keep the rejection unchanged" (see the call sites below). */
export type BareRailLookup =
  | { readonly ok: true; readonly id: string }
  | { readonly ok: false; readonly hint?: string };

/**
 * Tolerant lookup for a BARE-id rail — the native CLI catalog, indexed by
 * an unprefixed id (e.g. 'claude-sonnet-5'). Two tries:
 *
 *  1. Exact match against `catalogIds` — today's behavior, unchanged.
 *  2. Vendor-prefix strip: when `requestedId` looks like "vendor/rest" AND
 *     "rest" is an exact catalog match, accept it ONLY when `vendor`
 *     (compared via normalizeVendorToken) agrees with `ownVendorToken` —
 *     e.g. "anthropic/claude-sonnet-5" on the native rail (ownVendorToken
 *     'anthropic') strips and matches safely: a trivial, cosmetic rename of
 *     a real model. A DISAGREEING vendor ("openai/claude-sonnet-5" on that
 *     same rail) is a red flag, not a typo — the bare id is real, but
 *     something asserted the wrong maker for it, which is far more likely
 *     to be the model confusing itself than an innocent slip. That case
 *     returns `ok: false` with an explanatory `hint` instead of guessing —
 *     an ambiguous collision is a rejection, never a silent pick.
 *
 * Pure — takes the rail's own catalog ids and vendor token as plain
 *  arguments instead of reaching into ALL_MODELS itself, so the same
 *  function serves every bare-id rail. Exported for direct unit
 *  testing.
 */
export function resolveBareRailModelId(
  requestedId: string,
  catalogIds: readonly string[],
  ownVendorToken: string,
): BareRailLookup {
  if (catalogIds.includes(requestedId)) return { ok: true, id: requestedId };

  const slash = requestedId.indexOf('/');
  if (slash === -1) return { ok: false };

  const vendor = requestedId.slice(0, slash);
  const stripped = requestedId.slice(slash + 1);
  if (!catalogIds.includes(stripped)) return { ok: false };

  if (normalizeVendorToken(vendor) === normalizeVendorToken(ownVendorToken)) {
    return { ok: true, id: stripped };
  }
  return {
    ok: false,
    hint: `"${requestedId}" strips to a real id on this rail ("${stripped}"), but its "${vendor}/" prefix does not match this rail's own provider ("${ownVendorToken}") — drop the prefix if you meant "${stripped}", otherwise double-check which model you meant.`,
  };
}

/**
 * Cross-rail candidate search: scans every rail OTHER than `requestedRail`
 * for an exact, real home for `requestedId` (already established NOT to
 * belong to `requestedRail` itself by the time this is called).
 *
 *  - 'cli' (native/ALL_MODELS, bare ids) — vendor-tolerant, reusing the same
 *    resolveBareRailModelId helper the same-rail cosmetic case uses.
 *  - 'local' (`local/…` ids) — exact match only; any `local/`-prefixed id
 *  is accepted as-is (Ollama model availability is async and cannot be
 *  validated synchronously — a missing model fails honestly at pull/run
 *  time, never here).
 *
 * Pure. Exported for direct unit testing.
 */
export function findAlternateRailMatches(
  requestedId: string,
  requestedRail: 'cli' | 'local',
): AlternateRailMatch[] {
  const matches: AlternateRailMatch[] = [];

  if (requestedRail !== 'cli') {
    const lookup = resolveBareRailModelId(requestedId, ALL_MODELS.map((m) => m.id), 'anthropic');
    if (lookup.ok) matches.push({ rail: 'cli', id: lookup.id, label: 'cli' });
  }

  if (requestedRail !== 'local' && requestedId.startsWith('local/')) {
    matches.push({ rail: 'local', id: requestedId, label: 'local' });
  }

  // Devin ids (swe-2-medium, ...) live on the cli family but a distinct
  // sub-rail — offered as a switch target only when the devin CLI is
  // actually detected.
  if (requestedRail !== 'cli' && isDevinModel(requestedId) && isCliBackendAvailable('devin') === true) {
    matches.push({ rail: 'cli', id: requestedId, label: 'cli:devin' });
  }

  return matches;
}

// ── Inferred model rail ─────────────────────────────────────────────
//
// The manager can name a model/engine combination on the WRONG rail — a
// 'local/…' id while engine is "cli", or a native id while engine is
// "local". When the id is REAL on exactly one other rail, rejecting is
// strictly worse than running it there: the fix below silently switches
// the EFFECTIVE rail instead. The mission is routed downstream purely from
// the RETURNED id's own shape (classifyMissionModel, runtime.ts) — so
// returning the OTHER rail's id here is already the complete switch.
// Ambiguity or a genuinely unknown id both keep the honest rejection,
// optionally enriched with a hint naming what WAS found.

/** One rail where `requestedId` was found to unambiguously exist, other than
 *  the rail actually requested this turn — see findAlternateRailMatches.
 *  `id` is already in the shape that rail's own dispatch expects (bare for
 *  'cli', `local/`-prefixed for 'local') so the caller can return it
 *  directly. `label` is a human-readable rail tag for logging/hints. */
interface AlternateRailMatch {
  readonly rail: 'cli' | 'local';
  readonly id: string;
  readonly label: string;
}

/** Tagged, developer-only trace for a successful tolerant normalization
 *  (resolveBareRailModelId's vendor-prefix-strip branch) — a greppable
 *  prefix so this specific fix's activity is easy to spot in the console
 *  during QA. Purely observability: the resolved id itself already flows
 *  through as the function's normal return value, this never gates
 *  behavior. Called exactly once per accepted normalization, never for a
 *  plain exact match (which was already silent). */
function warnModelIdNormalized(requestedId: string, resolvedId: string, rail: 'cli' | 'local'): void {
  console.warn(`[manager-model-id-normalize] "${requestedId}" -> "${resolvedId}" accepted on the ${rail} rail`);
}

/** Tagged, developer-only trace for a successful CROSS-RAIL switch — a
 *  distinct tag from warnModelIdNormalized's '[manager-model-id-normalize]'
 *  (a same-rail cosmetic fix) since this is a materially bigger change: the
 *  ENGINE actually dispatching the mission changes, not just the id's
 *  spelling. Called exactly once per accepted switch. */
function warnModelRailSwitched(requestedId: string, requestedRail: string, match: AlternateRailMatch): void {
  console.warn(
    `[manager-model-rail-switch] "${requestedId}" not available on the ${requestedRail} rail — silently switched to the ${match.label} rail as "${match.id}" (unambiguous match)`,
  );
}

/** Discriminated outcome of the inferred-rail-switch decision — mirrors
 *  BareRailLookup's shape/spirit but adds the 'ambiguous' case (2+ rails),
 *  which a plain ok/hint pair cannot distinguish from "no match at all". */
type RailSwitchOutcome =
  | { readonly kind: 'switched'; readonly id: string }
  | { readonly kind: 'ambiguous'; readonly hint: string }
  | { readonly kind: 'none' };

/**
 * Applies the "exactly one other rail" rule to findAlternateRailMatches'
 * result: a single match silently switches (tagged console.warn, returns
 * that rail's id); zero or 2+ matches leave the decision to the caller's
 * EXISTING rejection path, optionally enriched with an ambiguity hint here.
 * Centralizes the "exactly one" rule and the warn call so the call sites
 * in resolveManagerModelId (local/cli) below stay identical.
 */
function tryInferredRailSwitch(
  requestedId: string,
  requestedRail: 'cli' | 'local',
): RailSwitchOutcome {
  const matches = findAlternateRailMatches(requestedId, requestedRail);
  if (matches.length === 1) {
    warnModelRailSwitched(requestedId, requestedRail, matches[0]);
    return { kind: 'switched', id: matches[0].id };
  }
  if (matches.length > 1) {
    return {
      kind: 'ambiguous',
      hint: `"${requestedId}" exists on ${matches.length} different rails (${matches.map((m) => m.label).join(', ')}) — ambiguous, so name the one you mean explicitly (the action's "engine" field, or a rail-specific id) instead of leaving it to guesswork.`,
    };
  }
  return { kind: 'none' };
}

/** Concrete native ProviderMode for a deliberate "cli" engine choice —
 *  respects the user's configured CLI tool (Settings > Models) the same way
 *  getProviderMode()'s own 'cli' branch and entitlement.ts's cliReadiness()
 *  default do, rather than assuming claude-code is always the one actually
 *  installed. Shared by resolveManagerModelId's engineOverride branch and
 *  runManagerTurn's own (STACK fix). */
export function nativeEngineMode(): ProviderMode {
  const tool = loadAccessSettings().cliTool;
  if (tool === 'codex') return 'codex';
  if (tool === 'devin') return 'devin';
  return 'claude-code';
}

/** Effective manager mode: an explicit per-action engine choice ("cli" /
 *  "local") always wins over the ambient mode. Readiness for the chosen
 *  family is NOT re-checked here: classifyMissionModel + isNativeModelReady
 *  already gate the actual mission dispatch downstream (runtime.ts's
 *  planAndAct) and report an honest mismatch if the chosen engine turns out
 *  not to be ready. */
function pickEffectiveManagerMode(
  mode: ProviderMode,
  engineOverride: ManagerEngineChoice | undefined,
): ProviderMode {
  if (engineOverride === 'cli') {
    return nativeEngineMode();
  }
  if (engineOverride === 'local') return 'local';
  return mode;
}

function resolveExactOnCliRail(modelId: string): string {
  if (ALL_MODELS.some((m) => m.id === modelId)) return modelId;
  // Devin-catalog ids belong to the CLI rail family (devin is a cliTool):
  // accepting them here lets classifyMissionModel route the mission to the
  // devin branch downstream — the id itself carries the engine switch.
  if (isDevinModel(modelId)) return modelId;
  const lookup = resolveBareRailModelId(modelId, ALL_MODELS.map((m) => m.id), 'anthropic');
  if (lookup.ok) {
    warnModelIdNormalized(modelId, lookup.id, 'cli');
    return lookup.id;
  }
  const switched = tryInferredRailSwitch(modelId, 'cli');
  if (switched.kind === 'switched') return switched.id;
  const hint = switched.kind === 'ambiguous' ? switched.hint : lookup.hint;
  throw new UnknownManagerModelIdError(modelId, 'cli', hint);
}

function resolveExactOnLocalRail(modelId: string): string {
  // Any `local/…` id is accepted as-is — Ollama model availability is async
  // and cannot be validated synchronously (a missing model fails honestly
  // at run time, never here).
  if (modelId.startsWith('local/') && modelId.length > 'local/'.length) return modelId;
  const switched = tryInferredRailSwitch(modelId, 'local');
  if (switched.kind === 'switched') return switched.id;
  const hint = switched.kind === 'ambiguous' ? switched.hint : undefined;
  throw new UnknownManagerModelIdError(modelId, 'local', hint);
}

function resolveExactManagerModelId(modelId: string, effectiveMode: ProviderMode): string {
  if (effectiveMode === 'local' || modelId.startsWith('local/')) return resolveExactOnLocalRail(modelId);
  return resolveExactOnCliRail(modelId);
}

function tierPoolForMode(effectiveMode: ProviderMode): readonly { id: string }[] {
  // Devin's own catalog holds its tier words (medium/high/max + the
  // account's claude/gpt/... variants) — resolve against it so a hint
  // lands on an id --model actually accepts.
  if (effectiveMode === 'devin') return devinModelInfos();
  // Local rail has no tier words — the pool carries the single default so a
  // tier hint degrades to it instead of throwing.
  if (effectiveMode === 'local') return [{ id: DEFAULT_LOCAL_MODEL_ID }];
  return ALL_MODELS;
}

function resolveTierOrDefault(
  word: string | undefined,
  effectiveMode: ProviderMode,
): string {
  if (!word) return getDefaultModelIdForMode(effectiveMode);
  const matched = tierPoolForMode(effectiveMode).find((m) => m.id.toLowerCase().includes(word));
  if (matched) return matched.id;
  return getDefaultModelIdForMode(effectiveMode);
}

/**
 * Resolve a launch_mission/create_loop/create_draft/spawn_submissions/
 * generate_plan-step model request to a model id valid for the CURRENT
 * provider mode. Falls back to the mode's default model
 * (getDefaultModelIdForMode) when neither `modelId` nor `tier` is given, or
 * `tier` doesn't match any catalog entry.
 *
 * @param engineOverride A deliberate per-mission "cli"/"local" choice (the
 *   action's own `engine` field) always wins over the ambient `mode`.
 *   Readiness for the deliberately chosen family is NOT re-checked here:
 *   classifyMissionModel + isNativeModelReady already gate the actual
 *   mission dispatch downstream (runtime.ts's planAndAct) and report an
 *   honest mismatch if the chosen engine turns out not to be ready.
 * @param modelId Exact catalog id (ManagerModelId, types.ts) — checked
 *   BEFORE `tier` and validated against the CURRENT effective rail's real
 *   catalog (ALL_MODELS on the CLI rail, `local/…` ids on the local rail).
 *   Throws UnknownManagerModelIdError, never silently substitutes a
 *   DEFAULT, when the id does not belong to that rail's family. Tolerant
 *   normalization (see resolveBareRailModelId) silently rewrites a COSMETIC
 *   mismatch; a genuine cross-rail id is switched to its unambiguous home
 *   rail (see tryInferredRailSwitch/findAlternateRailMatches), else an
 *   honest rejection.
 */
export function resolveManagerModelId(
  tier: string | undefined,
  mode: ProviderMode,
  engineOverride?: ManagerEngineChoice,
  modelId?: string,
): string {
  const word = tier?.toLowerCase().match(TIER_WORD)?.[0];
  const effectiveMode = pickEffectiveManagerMode(mode, engineOverride);
  if (modelId) return resolveExactManagerModelId(modelId, effectiveMode);
  return resolveTierOrDefault(word, effectiveMode);
}
