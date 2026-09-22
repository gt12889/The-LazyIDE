/* seedExtractor — "which rail annotates the brain seed", the onboarding-time
   counterpart of the chat model picker (modelPickerOptions.ts).

   Problem this solves: the brain seed runs in the lazybrain child process
   spawned by Rust, which auto-detects its LLM backend with no input from
   the app. This module turns the SAME local engines the app itself reads
   into a serializable SeedExtractorSpec that crosses IPC into the child's
   env (see SeedExtractorArg in src-tauri/src/commands/brain/history_import.rs).

   Rails offered, in display order:
     local      — the user's Ollama/LM Studio engine (OpenAI-compatible
                  `openai` extractor kind, baseUrl pointed at localhost).
                  Zero-config, zero-cost.
     claude-cli — the user's Claude Code subscription via the `claude` CLI.
     heuristic  — always present; zero-config, zero-cost, lower quality.

   Cost guidance is part of the contract: extraction is a fixed
   "emit a JSON array of facts" task, so the local rail runs the user's
   already-configured Ollama model and the UI label says so.
*/

import { isTauri } from '../platform/index.js';
import type { SeedExtractorSpec } from '../platform/types.js';
import { isCliBackendAvailable } from '../models/cliBackendProvider.js';
import { DEFAULT_LOCAL_MODEL_ID, loadLocalModelName } from '../models/localProvider.js';

// ── Rail descriptor ─────────────────────────────────────────────

export type SeedRailKind = 'openai' | 'claude-cli';

export interface SeedRail {
  /** Stable id used as the picker's option value ('local', 'claude-cli'). */
  id: string;
  /** Maps to SeedExtractorSpec.kind — what Rust writes to
   *  LAZYBRAIN_EXTRACTOR. */
  kind: SeedRailKind;
  /** Short rail name for the option label ("Local · Ollama", "Claude Code CLI"). */
  label: string;
  /** Resolved model id this rail would run. Undefined for rails whose
   *  backend picks its own model (claude-cli without an explicit choice). */
  model?: string;
  /** Display name of `model` when it has one. */
  modelLabel?: string;
  /** i18n key resolved at render time — the one-line cost/quality hint next
   *  to the option. Never a literal string: this module is locale-agnostic. */
  hintKey: string;
}

/** localhost base URL of the user's configured local engine (Ollama
 *  default; LM Studio override honored from the same localStorage slot the
 *  local provider reads). */
function localBaseUrl(): string {
  try {
    return localStorage.getItem('lazy.local.baseUrl') ?? 'http://localhost:11434/v1';
  } catch {
    return 'http://localhost:11434/v1';
  }
}

// ── Detection ───────────────────────────────────────────────────

/**
 * List the rails the user can pick RIGHT NOW for a brain seed.
 *
 * Order matters for the UI: local first (zero-config, zero-cost),
 * then the user's CLI.
 */
export async function listSeedRails(): Promise<SeedRail[]> {
  const rails: SeedRail[] = [];

  const localName = loadLocalModelName();
  rails.push({
    id: 'local',
    kind: 'openai',
    label: 'Local · Ollama',
    model: `local/${localName}`,
    modelLabel: localName,
    hintKey: 'onboarding.brain.railLocal.hint',
  });

  if (isTauri() && isCliBackendAvailable('claude') === true) {
    rails.push({
      id: 'claude-cli',
      kind: 'claude-cli',
      label: 'Claude Code CLI',
      hintKey: 'onboarding.brain.railClaudeCli.hint',
    });
  }

  return rails;
}

/**
 * Credential-free spec for seedEstimate — enough for Rust to report the
 * rail's real label in the estimate's `backend` field. A real seed
 * resolves the full spec via resolveSeedExtractor below.
 */
export function railEstimateSpec(rail: SeedRail): SeedExtractorSpec {
  const spec: SeedExtractorSpec = { kind: rail.kind, model: rail.model, label: rail.label };
  if (rail.kind === 'openai') spec.baseUrl = localBaseUrl();
  return spec;
}

// ── Resolution ──────────────────────────────────────────────────

/**
 * Turn a picked rail (from listSeedRails) into the spec sent to Rust.
 * For 'local' rails `modelId` may override the configured default. The
 * local engine needs no credential — only baseUrl + model cross IPC.
 */
export async function resolveSeedExtractor(rail: SeedRail, modelId?: string): Promise<SeedExtractorSpec | null> {
  switch (rail.kind) {
    case 'openai': {
      const model = modelId ?? rail.model ?? DEFAULT_LOCAL_MODEL_ID;
      return {
        kind: 'openai',
        baseUrl: localBaseUrl(),
        model: model.startsWith('local/') ? model.slice('local/'.length) : model,
        label: `${rail.label} · ${rail.modelLabel ?? model}`,
      };
    }
    case 'claude-cli':
      return { kind: 'claude-cli', model: modelId ?? rail.model, label: rail.label };
    default:
      return null;
  }
}

// ── Deferred-enrichment flag ────────────────────────────────────
// A heuristic-only seed still builds a usable brain; when the user later
// gains a real rail (installs the Claude CLI, starts Ollama), a one-shot
// toast offers to re-run the import with the LLM on. The flag doubles as
// the "was it heuristic" record — it is cleared by an LLM-enriched seed
// or an explicit dismiss, never by time alone (the offer stays relevant
// until acted on).

const HEURISTIC_SEED_FLAG = 'forge.brainSeedHeuristicOnly';

/** What the deferred offer is about: 'heuristic' = a seed ran without LLM
 *  (re-run to enrich), 'deferred' = the user picked "later" and never
 *  seeded at all (import from scratch). */
export type EnrichmentOfferKind = 'heuristic' | 'deferred';

function ls(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/** Called when a seed completes WITHOUT an LLM backend (useLlm=false, or the
 *  backend resolved to heuristic). Stores the rails available at that moment
 *  so a later offer only fires on a genuinely NEW option. */
export function markHeuristicSeed(railIds: string[]): void {
  ls()?.setItem(HEURISTIC_SEED_FLAG, JSON.stringify({ at: Date.now(), rails: railIds, deferred: false }));
}

/** Called when the user picks "later" on the seed step — the brain was
 *  never built; the deferred offer's copy differs (import, not enrich). */
export function markDeferredSeed(railIds: string[]): void {
  ls()?.setItem(HEURISTIC_SEED_FLAG, JSON.stringify({ at: Date.now(), rails: railIds, deferred: true }));
}

/** Called when a seed completes WITH an LLM backend — nothing to offer. */
export function markEnrichedSeed(): void {
  ls()?.removeItem(HEURISTIC_SEED_FLAG);
}

/**
 * Should the "you can now enrich your brain" toast fire — and about what?
 * Returns the offer kind when a past heuristic/deferred seed exists AND at
 * least one rail is available now that did not exist at seed time (a NEWLY
 * gained engine — the whole point of the toast). Null when there is nothing
 * to offer. The caller MUST call markEnrichmentOffered when it actually
 * shows the toast — that folds the just-seen rails into the snapshot so the
 * same set of rails can never trigger the toast twice, while a rail
 * appearing later still can.
 */
export async function shouldOfferEnrichment(): Promise<EnrichmentOfferKind | null> {
  const raw = ls()?.getItem(HEURISTIC_SEED_FLAG);
  if (!raw) return null;
  let seedRails: string[] = [];
  let deferred = false;
  try {
    const parsed = JSON.parse(raw) as { rails?: string[]; deferred?: boolean };
    seedRails = Array.isArray(parsed.rails) ? parsed.rails : [];
    deferred = parsed.deferred === true;
  } catch {
    // malformed — treat as "no rails recorded", offer on any current rail
  }
  const now = await listSeedRails();
  return now.some((r) => !seedRails.includes(r.id)) ? (deferred ? 'deferred' : 'heuristic') : null;
}

/** Called when the enrichment toast is actually shown: the current rails
 *  are folded into the snapshot so they count as "seen" — a toast already
 *  displayed for rail X never repeats for X, but rail Y appearing later
 *  still fires. Preserves the record's `deferred` kind. */
export function markEnrichmentOffered(currentRailIds: string[]): void {
  const raw = ls()?.getItem(HEURISTIC_SEED_FLAG);
  let deferred = false;
  try {
    deferred = raw ? (JSON.parse(raw) as { deferred?: boolean }).deferred === true : false;
  } catch { /* malformed — default to the heuristic copy */ }
  ls()?.setItem(HEURISTIC_SEED_FLAG, JSON.stringify({ at: Date.now(), rails: currentRailIds, deferred }));
}

/** Enrichment was accepted/started — the flag has served its purpose. */
export function clearHeuristicSeedFlag(): void {
  ls()?.removeItem(HEURISTIC_SEED_FLAG);
}
