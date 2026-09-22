/* botRunModel — which LLM drives a bot run, and on which rail (Forge).

   A bot's RUNTIME is always the same (Forge's own ReAct loop — see
   runLazyBotMission.ts). What varies is the BRAIN: the user may hold a CLI
   subscription (claude/codex/devin) or nothing but the local Ollama engine
   — and the app must run the bot with whichever of those is actually
   usable, never fail because a default id pointed at a rail the user
   doesn't have.

   Rail detection reuses the runtime's own helpers (classifyMissionModel,
   isNativeModelReady) — nothing is re-invented here.
*/

import {
  classifyMissionModel,
  isNativeModelReady,
} from '../agents/runtime.js';
import { resolveCliEngineMode } from '../agents/cliAgentTurnStreamer.js';
import { createLocalAgentTurnStreamer, DEFAULT_LOCAL_MODEL_ID } from '../models/localProvider.js';
import { ALL_MODELS, DEFAULT_MODEL } from '../models/registry.js';
import { DEFAULT_DEVIN_MODEL_ID, devinModelInfos } from '../models/devinCatalog.js';
import type { AgentTurnStreamer } from '../agents/cliAgentTurnStreamer.js';

/** The two ways a bot's brain can be served. */
export type BotModelRail = 'cli' | 'local';

export interface ResolvedBotRunModel {
  /** Model id to store on the mission (`Mission.model`). */
  model: string;
  /** Rail that model runs on — undefined when NO rail is usable right now.
   *  The mission then fails honestly at launch with `note` as its reason. */
  rail: BotModelRail | undefined;
  /** Human-readable explanation when the resolved model differs from the
   *  requested one, or when nothing is runnable. */
  note?: string;
}

/** Classifies a model id onto a bot rail. Mirrors classifyMissionModel
 *  exactly, plus one bot-specific case: an EMPTY id while the CLI tool is
 *  codex means "the codex CLI's own default model" (getActiveModel() returns
 *  id '' in codex mode by design — see models/index.ts). */
export function classifyBotModelRail(model: string | undefined): BotModelRail | undefined {
  const kind = classifyMissionModel(model);
  if (kind === 'local') return 'local';
  if (kind === 'native') return 'cli';
  // Devin-catalog ids serve as a bot brain through the same CLI text
  // streamer — same rail family as claude/codex.
  if (kind === 'devin') return 'cli';
  if (!model && resolveCliEngineMode() === 'codex') return 'cli';
  if (!model && resolveCliEngineMode() === 'devin') return 'cli';
  return undefined;
}

/** Whether a rail can serve a turn RIGHT NOW. `local` is ready by
 *  construction (Ollama reachability is async — a refused connection fails
 *  the mission honestly inside the first turn, never here). */
export function isBotRailReady(rail: BotModelRail): boolean {
  switch (rail) {
    case 'cli': return isNativeModelReady();
    case 'local': return true;
  }
}

/** Why a rail is not usable — surfaced as the mission's statusReason. */
export function describeBotRailNotReady(rail: BotModelRail, model: string): string {
  switch (rail) {
    case 'cli': return `Model "${model}" runs on a CLI (claude/codex/devin) that was not detected on this machine.`;
    case 'local': return `Local model "${model}" is unreachable (is Ollama running?).`;
  }
}

/** Local-engine streamer for a bot brain. */
export function resolveBotLocalStreamer(): AgentTurnStreamer {
  return createLocalAgentTurnStreamer();
}

function defaultCliModel(): string {
  const engine = resolveCliEngineMode();
  if (engine === 'codex') return '';
  if (engine === 'devin') return DEFAULT_DEVIN_MODEL_ID;
  return DEFAULT_MODEL.id;
}

/** The first READY rail's default model, in preference order CLI → local.
 *  `exclude` skips rail(s) that just proved unusable at run time (see
 *  runLazyBotMission's brain failover). */
export function firstReadyRailDefault(
  exclude?: BotModelRail | ReadonlySet<BotModelRail>,
): { model: string; rail: BotModelRail } | undefined {
  const skip = exclude instanceof Set
    ? exclude
    : new Set(exclude ? [exclude] : []);
  if (!skip.has('cli') && isNativeModelReady()) return { model: defaultCliModel(), rail: 'cli' };
  if (!skip.has('local')) return { model: DEFAULT_LOCAL_MODEL_ID, rail: 'local' };
  return undefined;
}

const TIER_WORD = /\b(haiku|sonnet|opus)\b/i;

/** True for an id that names ONE concrete model: a native registry id, a
 *  Devin id, or a `local/…` id. False for a bare tier hint ("haiku") —
 *  those are wishes about size/speed, not a rail choice, and must never
 *  drag a bot onto a rail the user isn't using. */
export function isExactBotModelId(model: string | undefined): boolean {
  if (!model) return false;
  if (model.startsWith('local/')) return true;
  if (ALL_MODELS.some((m) => m.id === model)) return true;
  if (devinModelInfos().some((m) => m.id === model)) return true;
  return false;
}

/** Resolves a bare tier hint INSIDE a rail's own catalog. The local rail
 *  has no tiers — it keeps its model unchanged. */
export function applyTierHintWithinRail(hint: string, base: { model: string; rail: BotModelRail }): string {
  const word = hint.toLowerCase().match(TIER_WORD)?.[1];
  if (!word) return base.model;
  if (base.rail === 'cli') {
    const pool = resolveCliEngineMode() === 'devin' ? devinModelInfos() : ALL_MODELS;
    return pool.find((m) => m.id.toLowerCase().includes(word))?.id ?? base.model;
  }
  return base.model;
}

function dedupe(candidates: ReadonlyArray<string | undefined>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const c of candidates) {
    if (c === undefined) continue;
    const key = c.trim();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(key);
  }
  return out;
}

/**
 * Picks the model a bot run should use.
 *
 * `requested` (the manager action's `model`, or a saved routine's model) is
 * honored first when it names an EXACT model whose rail is ready. A bare
 * tier hint ("haiku") is NOT a rail choice: the fallbacks (the manager's own
 * model for this conversation, then the app's active model — i.e. the rail
 * the user is actually using) win, and the hint is then applied within that
 * rail's catalog. Otherwise the first READY rail's default (CLI → local).
 * A `note` explains every substitution so the manager can relay it honestly.
 */
export function resolveLazyBotRunModel(
  requested: string | undefined,
  fallbacks: ReadonlyArray<string | undefined> = [],
): ResolvedBotRunModel {
  const wanted = requested?.trim() || undefined;
  const exactWanted = wanted && isExactBotModelId(wanted) ? wanted : undefined;
  const hint = wanted && !exactWanted ? wanted : undefined;
  const candidates = dedupe([exactWanted, ...fallbacks, hint]);
  let firstBlocked: { model: string; rail: BotModelRail } | undefined;

  for (const candidate of candidates) {
    const rail = classifyBotModelRail(candidate);
    if (!rail) continue;
    if (isBotRailReady(rail)) {
      const model = hint && candidate !== hint ? applyTierHintWithinRail(hint, { model: candidate, rail }) : candidate;
      let note: string | undefined;
      if (hint && candidate !== hint) {
        note = `hint "${hint}" applied on the ${rail} rail → "${model}"`;
      } else if (wanted && model !== wanted) {
        note = `requested model "${wanted}" unavailable on this machine — replaced with "${model}" (${rail})`;
      }
      return { model, rail, note };
    }
    firstBlocked ??= { model: candidate, rail };
  }

  const fallback = firstReadyRailDefault() ?? { model: DEFAULT_LOCAL_MODEL_ID, rail: 'local' as const };
  const blockedNote = firstBlocked
    ? `${describeBotRailNotReady(firstBlocked.rail, firstBlocked.model)} `
    : '';
  return { ...fallback, note: `${blockedNote}Falling back to "${fallback.model}" (${fallback.rail}).`.trim() };
}
