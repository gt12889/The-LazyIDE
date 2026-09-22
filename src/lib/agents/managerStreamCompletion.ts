/* managerStreamCompletion — per-rail LLM dispatch for the ForgeManager.

   Measured 2026-08-28: streamManagerCompletion cyclomatic complexity was 21
   (ESLint ratchet ceiling 12). Lives here so managerEngine.ts stays the
   turn/retry loop, not a three-way streamer.
*/

import { streamClaudeCodeTurn } from '../models/claudeCodeProvider.js';
import { cliBackendProvider } from '../models/cliBackendProvider.js';
import { createLocalAgentTurnStreamer, toLocalModelName } from '../models/localProvider.js';
import type { ProviderMode, ChatMessage, ModelInfo, StreamChatRequest } from '../models/index.js';
import { ALL_MODELS } from '../models/registry.js';
import { isDevinModel } from '../models/devinCatalog.js';
import { RECALL_TEACHING } from '../models/systemPrompts.js';
import {
  fallbackModeRails,
  railAttemptLabel,
  railFailoverNotice,
  runWithRailFailover,
} from './managerRailFailover.js';
import type { ManagerRailAttempt } from './managerRailFailover.js';
import type { ManagerMessage } from './types.js';

const TIER_WORD = /haiku|sonnet|opus/;

/**
 * Normalize a manager model value — a tier word ("haiku"/"sonnet"/"opus")
 * or an already-native id — to the native id consumed by the CLI backends.
 * `local/` ids pass through to toLocalModelName on the local rail instead
 * (see streamLocalRail) and never reach here with a local pick as primary.
 */
function toNativeModelId(model: string): string {
  const lower = model.toLowerCase();
  const word = lower.match(TIER_WORD)?.[0];
  if (word) {
    const found = ALL_MODELS.find((m) => m.id.toLowerCase().includes(word));
    if (found) return found.id;
  }
  if (ALL_MODELS.some((m) => m.id === model)) return model;
  if (model.includes('/')) return model.split('/')[1].replace(/\./g, '-');
  return model;
}

/**
 * Build the StreamChatRequest used to route a manager turn through the codex
 * CLI backend (cliBackendProvider('codex')).
 *
 * There is no standalone single-turn codex helper (no streamCodexTurn sibling
 * to streamClaudeCodeTurn) — cliBackendProvider is the generic ModelProvider
 * used by the main assistant chat, and its streamChat ALWAYS rebuilds the
 * system prompt internally via buildSystemPrompt(req.mode, ...); StreamChatRequest
 * has no field for a caller-supplied system string. To avoid silently dropping
 * the manager's system prompt (the action schema + live agent/mission state —
 * without it the manager cannot emit valid <lazy_actions>), it is threaded
 * through rulesContext, which IS forwarded verbatim into the final prompt
 * (under a "Project Rules" heading — cosmetically odd but functionally intact).
 * This is the smallest-correct-thing workaround called out in the task; a
 * proper fix would add an exported single-turn codex helper mirroring
 * streamClaudeCodeTurn so the manager can pass its system prompt directly.
 */
function buildCodexStreamRequest(
  messages: ManagerMessage[],
  system: string,
  model: string,
  signal: AbortSignal | undefined,
): StreamChatRequest {
  const nativeModel = toNativeModelId(model);
  const codexMessages: ChatMessage[] = messages.map((m) => ({
    id: m.id,
    role: m.role === 'assistant' ? 'assistant' : 'user',
    content: m.content,
  }));
  const codexModel: ModelInfo = { id: nativeModel, label: nativeModel, provider: 'openai' };

  return {
    messages: codexMessages,
    model: codexModel,
    mode: 'ask',
    rulesContext: system,
    signal,
  };
}

export const ACTION_FORMAT_REMINDER =
  '=== ACTION FORMAT (critical) === If this reply announces or performs ' +
  'ANY action (launch, delete, open, merge, scan...), it MUST contain the ' +
  'matching <lazy_actions>[{...}]</lazy_actions> block in THIS same reply. ' +
  'Prose without the block does nothing. Pure answers/questions need no block.';

/**
 * Dispatch ONE streamed LLM completion through whichever backend matches
 * `mode` (claude-code CLI, codex CLI, devin CLI, or the local Ollama
 * engine) and return the fully concatenated raw text. Extracted from
 * runManagerTurn's main retry loop so attemptActionExtractionRepair below
 * can issue its OWN short completion through the exact same routing — same
 * engine/model path the turn already used — without duplicating the
 * three-way branch. `appendRecallTeaching` defaults to true so the main
 * planning loop's own behavior is byte-for-byte unchanged by this
 * extraction; the repair call passes false (see its own doc comment).
 */
interface StreamManagerCompletionOpts {
  mode: ProviderMode;
  model: string;
  system: string;
  cacheableSystem?: { core: string; dynamic: string };
  appendRecallTeaching?: boolean;
  apiMessages: ManagerMessage[];
  signal?: AbortSignal;
  onChunk?: () => void;
  onPartial?: (accumulatedRaw: string) => void;
}

// ── Streaming chunk accumulation (2026-08-12 QA: spliced/duplicated text) ──
//
// BUG (real user repro, verbatim, Claude Sonnet 5 subscription route):
//   "Je lance un agent haiku pour ajouter la fonction sum(a, b) dans
//   index.js avec l'affichage de sum(2,3) au démarrage.js(projet actif
//   uc-smoke-2026-08-12) et affichersum(2,3)` au lancement."
//
// INVESTIGATED (2026-08-12, coordinator-directed re-review — first pass
// shipped a >=8-char "drop an exact adjacent duplicate chunk" guard, which
// was WRONG and has been reverted): that heuristic is destructive (real
// streamed code routinely repeats an identical adjacent chunk — 8 spaces of
// indentation twice, a blank "\n\n" pair, a repeated identifier at a token
// boundary — and would silently delete it, invisibly, in an IDE where
// correctness of generated code matters far more than a rare display glitch)
// AND it does not even match the actual observed corruption: the two halves
// of the real repro are NOT byte-identical to each other (compare "...dans
// index.js avec l'affichage de sum(2,3) au démarrage." against "...index.js
// (projet actif uc-smoke-2026-08-12) et afficher `sum(2,3)` au lancement.")
// — a byte-equality guard would never have fired on the real chunk sequence
// either way.
//
// Three specific hypotheses were checked against the actual owned code:
//   (a) two accumulators/concurrent streams writing into the same message —
//       RULED OUT at this layer: `acc` below is a plain local variable, one
//       per streamManagerCompletion() call, never shared/module-level state.
//       runGroundedFollowUp (agentsStore.tsx) always REPLACES currentTurn
//       sequentially (`currentTurn = nextTurn`, awaited) — it never
//       concatenates two turns' raw text together; every grounded return
//       reads turnDisplayText(currentTurn) from the SINGLE latest turn.
//       Nothing in sendManagerMessage starts a second call for the SAME
//       conversation while a first is still in flight for this repro (no
//       grounding action was involved, so runGroundedFollowUp short-circuits
//       via `findGroundingActions` returning empty). A UI-level double-send
//       race (e.g. a doubled click before the composer disables) was not
//       fully ruled out — it lives in agentsStore.tsx/LazyManagerComposer.tsx,
//       outside this fix's owned files.
//   (b) a prompt-side template splicing project-context annotation into the
//       model's own text — RULED OUT in the TS layer: no "projet actif" /
//       "active project" template string exists anywhere that writes into
//       the SAME variable the transport's chunks land in. The system prompt
//       (buildManagerDynamicContext) and the `acc`/rawResponse accumulator
//       below are structurally separate strings in every one of the four
//       streamManagerCompletion branches — the system prompt is sent AS
//       INPUT to the model, never appended to its OUTPUT after the fact.
//   (c) a retry/reconnect starting a second stream without discarding the
//       first — NO retry exists at the JS layer (streamClaudeCodeTurn /
//       cliBackendProvider / the BYOK raw streamers / streamManagedAgentTurn
//       each issue exactly ONE request per streamManagerCompletion call, no
//       automatic reconnect). Reading src-tauri/src/commands/chat.rs
//       (read-only — out of this fix's editable scope) surfaces a credible
//       mechanism, though NOT provable from a JS unit test: `claude -p
//       --output-format stream-json --verbose` is itself a multi-step
//       internal agent loop that can emit SEVERAL separate "assistant"-typed
//       stream-json lines for one logical LazyManager turn — Rust relays
//       every one of them as an independent model://chunk event with no
//       boundary/reset marker between them (extract_text_from_stream_json,
//       chat.rs:662). A closely related leak from that exact same multi-step
//       behavior (the CLI harness's own synthetic re-prompt text) was
//       already found and fixed there — see that function's own doc comment,
//       chat.rs:647-661. If the external `claude` binary internally
//       self-corrects or retries part of a response, Rust has no way to tell
//       that apart from ordinary multi-part narration (narrate -> tool call
//       -> narrate again), and would relay BOTH renderings, which this file
//       then concatenates in order — a much better structural match for the
//       real repro (two overlapping, non-identical renderings glued
//       together) than a literal duplicate chunk. This is the most likely
//       root cause, but it lives inside src-tauri/chat.rs and, ultimately,
//       the external `claude` CLI's own behavior — both outside this task's
//       editable perimeter (explicitly "Do NOT touch: ... src-tauri/") and
//       not reproducible from a Vitest unit test, which cannot invoke the
//       real external CLI's stream-json output deterministically.
//
// Since no fix at THIS layer can be proven against a real reproduction, the
// coordinator's own fallback applies: never silently drop model output.
// appendManagerChunk below is back to plain, lossless concatenation — the
// final text is ALWAYS the exact, in-order join of every chunk the
// transport ever handed us, full stop. Two NON-DESTRUCTIVE diagnostics are
// added instead, so a future occurrence leaves a trail instead of a silent
// display bug: warnIfDuplicateAdjacentChunk (flags but never drops an exact,
// non-trivial-length repeat — the (mechanism the first, reverted attempt
// guessed at) and warnIfImbalancedCodeSpans (flags an odd backtick count in
// the FINAL text — a cheap, precise signal that would have fired on the real
// repro's own stray unmatched closing backtick). Both only ever log; neither
// ever changes what the user sees.

/** Below this length, an adjacent repeated chunk is never logged — a short,
 *  legitimately-repeated fragment (a stutter, a repeated short word/token) is
 *  common enough that logging it would just be noise, not a real signal.
 *  Mirrors the same "conservative minimum length" convention as
 *  MIN_SELF_REPEAT_CHARS / MIN_DEDUP_SEGMENT_CHARS above. */
const MIN_DUPLICATE_CHUNK_LOG_CHARS = 8;

/**
 * Diagnostic only — never mutates or drops anything. Logs when `chunk` is a
 * byte-identical, non-trivial-length echo of the immediately PRECEDING
 * chunk, which is the transport-duplicate-delivery signature the reverted
 * heuristic targeted (see this section's module doc comment, hypothesis
 * (c)). Kept as a log-only signal because streamed code/markdown routinely
 * contains a legitimate identical adjacent chunk (repeated indentation, a
 * blank-line pair, a repeated identifier at a token boundary) — silently
 * dropping it would corrupt correct output, which is exactly what this
 * replaces.
 */
function warnIfDuplicateAdjacentChunk(previousChunk: string, chunk: string): void {
  if (chunk.length >= MIN_DUPLICATE_CHUNK_LOG_CHARS && chunk === previousChunk) {
    console.warn(
      `[streamManagerCompletion] anomaly: chunk repeated identically back-to-back ` +
      `(${chunk.length} chars) — possible duplicate transport delivery, kept as-is: ` +
      `${JSON.stringify(chunk.slice(0, 80))}`,
    );
  }
}

/** Diagnostic only. An odd number of backtick (`` ` ``) characters in the
 *  FINAL accumulated text means at least one markdown code span never
 *  closed — the exact, precise signature the real repro's own text carried
 *  ("...affichersum(2,3)\` au lancement." — one stray unmatched closing
 *  backtick). A cheap, unambiguous, whole-text check (unlike per-chunk
 *  duplicate detection, code-span balance can only be judged once the full
 *  response is assembled), logged with enough of the surrounding text to
 *  investigate without ever altering what is shown to the user. */
function warnIfImbalancedCodeSpans(text: string): void {
  const backtickCount = (text.match(/`/g) ?? []).length;
  if (backtickCount % 2 !== 0) {
    console.warn(
      `[streamManagerCompletion] anomaly: odd backtick count (${backtickCount}) in the ` +
      `final response text — an unclosed/spliced markdown code span, possibly from an ` +
      `overlapping chunk sequence. Full text kept as-is: ${JSON.stringify(text.slice(0, 400))}`,
    );
  }
}

interface ChunkAccumulatorState {
  text: string;
  previousChunk: string;
}

const EMPTY_CHUNK_ACCUMULATOR: ChunkAccumulatorState = { text: '', previousChunk: '' };

/**
 * Folds ONE incoming stream chunk into the accumulator state. Plain,
 * lossless concatenation — ALWAYS. Never drops or alters a chunk; see this
 * section's own module doc comment for why (a byte-equality drop guard was
 * tried and reverted: destructive on legitimate repeated code/markdown, and
 * did not even match the real repro's own non-identical chunk halves).
 * warnIfDuplicateAdjacentChunk runs alongside as a non-destructive
 * diagnostic only.
 */
function appendManagerChunk(state: ChunkAccumulatorState, chunk: string): ChunkAccumulatorState {
  warnIfDuplicateAdjacentChunk(state.previousChunk, chunk);
  return { text: state.text + chunk, previousChunk: chunk };
}

/**
 * Pure(-ish — see the diagnostic warnings it triggers) counterpart to
 * streamManagerCompletion's own per-branch accumulation loops below (all
 * four call appendManagerChunk in lockstep with this) — reconstructs the
 * final response text from a sequence of raw transport chunks. The result is
 * ALWAYS the exact in-order concatenation of every chunk — see this
 * section's own module doc comment for the investigation that ruled out a
 * fix at this layer, and managerEngine.test.ts's "streaming chunk
 * accumulation" suite for the regression coverage (lossless reconstruction,
 * including a duplicate chunk and a code-span split, plus the two
 * diagnostics firing without altering the text).
 */
export function accumulateManagerChunks(chunks: readonly string[]): string {
  const result = chunks.reduce(appendManagerChunk, EMPTY_CHUNK_ACCUMULATOR).text;
  warnIfImbalancedCodeSpans(result);
  return result;
}

type IngestChunk = (chunk: string) => void;

async function drainChunks(stream: AsyncIterable<string>, ingest: IngestChunk): Promise<void> {
  for await (const chunk of stream) ingest(chunk);
}

/** Local-engine rail — streams the manager turn through Ollama/LM Studio.
 *  One request per turn (no retry: a refused connection means Ollama is
 *  down, and retrying the identical request cannot fix that — the failover
 *  loop moves to the next rail instead). */
async function streamLocalRail(
  model: string,
  systemFinal: string,
  apiMessages: ManagerMessage[],
  signal: AbortSignal | undefined,
  ingest: IngestChunk,
): Promise<void> {
  const streamTurn = createLocalAgentTurnStreamer();
  await drainChunks(streamTurn({
    messages: apiMessages,
    system: systemFinal,
    model: toLocalModelName(model),
    signal,
  }), ingest);
}

/** Devin CLI rail (ACP backend, tool 'devin'). Model ids pass through
 *  UNMANGLED — devin's --model flag accepts its own catalog ids AND fuzzy
 *  names ("Accepts the same fuzzy names as /model"), so a devin id like
 *  'swe-2-medium' or a resolved tier word both work; anything invalid
 *  fails honestly in the CLI's own error. Same system-prompt workaround
 *  as buildCodexStreamRequest: threaded through rulesContext (which
 *  cliBackendProvider forwards verbatim into its own buildSystemPrompt —
 *  RECALL_TEACHING already gets appended there for non-'transform' modes,
 *  hence codexSystemFinal, not systemFinal). */
async function streamDevinRail(
  model: string,
  systemFinal: string,
  apiMessages: ManagerMessage[],
  signal: AbortSignal | undefined,
  ingest: IngestChunk,
): Promise<void> {
  const devinMessages: ChatMessage[] = apiMessages.map((m) => ({
    id: m.id,
    role: m.role === 'assistant' ? 'assistant' : 'user',
    content: m.content,
  }));
  const devinModel: ModelInfo = { id: model, label: model, provider: 'devin' };
  await drainChunks(cliBackendProvider('devin').streamChat({
    messages: devinMessages,
    model: devinModel,
    // 'plan', NOT 'ask': the Devin ACP session literally switches modes
    // (session/set_mode injects "The session mode has changed to Ask" into
    // the transcript) and swe-2 then honestly obeys it — refuses to emit
    // any action block, in prose only (real incident: reject_mission
    // request answered "je m'y conforme: aucune action"). 'plan' keeps the
    // session non-writing (the manager must never edit files itself) while
    // making the model emit its planned actions as text — exactly what the
    // <lazy_actions> contract needs. Same reason cliAgentTurnStreamer's
    // Devin rail picks 'plan' for bot brains.
    mode: 'plan',
    rulesContext: systemFinal,
    // The ACP session personas ("ask" says read-only, "plan" says produce
    // a plan) both contradict the lazy_actions contract — emit lazy_actions
    // is plain text, never a file edit — so the base persona states that
    // explicitly.
    basePromptOverride:
      'You are the LazyManager orchestrator. You never modify files or run commands yourself — ' +
      'the app executes the <lazy_actions> JSON block you emit as plain text, which is always allowed. ' +
      'Reply with your answer/prose plus a <lazy_actions> block when the request calls for action.',
    signal,
  }), ingest);
}

async function dispatchAmbientRail(
  mode: ProviderMode,
  model: string,
  systemFinal: string,
  codexSystemFinal: string,
  apiMessages: ManagerMessage[],
  signal: AbortSignal | undefined,
  ingest: IngestChunk,
): Promise<void> {
  if (mode === 'claude-code') {
    await drainChunks(streamClaudeCodeTurn({
      messages: apiMessages,
      system: systemFinal,
      model: toNativeModelId(model),
      signal,
    }), ingest);
    return;
  }
  if (mode === 'codex') {
    // RECALL_TEACHING is deliberately NOT appended here (matches the main
    // loop's own codex branch) — buildCodexStreamRequest threads `system`
    // through rulesContext into cliBackendProvider's own buildSystemPrompt,
    // which already appends RECALL_TEACHING for any non-'transform' mode.
    await drainChunks(cliBackendProvider('codex').streamChat(
      buildCodexStreamRequest(apiMessages, codexSystemFinal, model, signal),
    ), ingest);
    return;
  }
  if (mode === 'devin') {
    await streamDevinRail(model, codexSystemFinal, apiMessages, signal, ingest);
    return;
  }
  if (mode === 'local') {
    await streamLocalRail(model, systemFinal, apiMessages, signal, ingest);
    return;
  }
  throw new Error(
    'ForgeManager error: no engine available in this browser session. Open the desktop app with Ollama running or a CLI tool installed.',
  );
}

export async function streamManagerCompletion(opts: StreamManagerCompletionOpts): Promise<string> {
  const {
    mode, model, system, apiMessages, signal, onChunk, onPartial,
    appendRecallTeaching = true,
  } = opts;
  const systemWithTeaching = appendRecallTeaching ? `${system}\n\n${RECALL_TEACHING}` : system;
  // FIX 1 — ACTION_FORMAT_REMINDER appended as the true last content of
  // whatever each rail actually dispatches. `systemFinal` covers
  // claude-code/local (both send `systemWithTeaching` as-is); codex
  // deliberately does NOT read `systemWithTeaching` (see the comment on
  // that branch below), so it gets its own `codexSystemFinal` built from
  // the raw `system` instead — RECALL_TEACHING placement for codex stays
  // exactly as before, untouched by this fix.
  const systemFinal = `${systemWithTeaching}\n\n${ACTION_FORMAT_REMINDER}`;
  const codexSystemFinal = `${system}\n\n${ACTION_FORMAT_REMINDER}`;
  // accumulateManagerChunks' own doc comment above explains the guard this
  // replaces plain `rawResponse += chunk` with — every branch below folds
  // its chunks through the SAME appendManagerChunk step function.
  let acc: ChunkAccumulatorState = EMPTY_CHUNK_ACCUMULATOR;
  const ingest = (chunk: string): void => {
    acc = appendManagerChunk(acc, chunk);
    onChunk?.();
    onPartial?.(acc.text);
  };

  // Checked BEFORE the ambient-mode branches below — an explicit local
  // (`local/…`) or Devin-catalog model pick always wins over the ambient
  // mode, matching what the picker already promised the user it would do.
  const primary: ManagerRailAttempt = model.startsWith('local/')
    ? { kind: 'local-model', model }
    : isDevinModel(model)
      // Devin-catalog id picked explicitly — same model-driven short-circuit
      // as above: rides the devin ACP rail no matter which ambient mode
      // resolved (getProvider()'s isDevinModel check is the provider-level
      // twin of this branch).
      ? { kind: 'devin-model', model }
      : { kind: 'mode', mode, model };

  const dispatchAttempt = (attempt: ManagerRailAttempt): Promise<void> => {
    if (attempt.kind === 'local-model') {
      return streamLocalRail(attempt.model, systemFinal, apiMessages, signal, ingest);
    }
    if (attempt.kind === 'devin-model') {
      return streamDevinRail(attempt.model, codexSystemFinal, apiMessages, signal, ingest);
    }
    return dispatchAmbientRail(
      attempt.mode, attempt.model, systemFinal, codexSystemFinal, apiMessages, signal, ingest,
    );
  };

  // Cross-rail failover (managerRailFailover.ts): a dead rail used to strand
  // the whole turn on `LazyManager error`. Now the next AVAILABLE rail serves
  // the same request — accumulator reset + honest notice via onFallback so no
  // partial output from the dead rail contaminates the fallback reply.
  const attempts: ManagerRailAttempt[] = [primary, ...fallbackModeRails(primary)];
  const failoverTrail: Array<{ label: string; reason: string }> = [];
  await runWithRailFailover(attempts, dispatchAttempt, {
    signal,
    onFallback: (failed, next, err) => {
      failoverTrail.push({
        label: railAttemptLabel(failed),
        reason: err instanceof Error ? err.message : String(err),
      });
      acc = EMPTY_CHUNK_ACCUMULATOR;
      ingest(railFailoverNotice(next, failoverTrail));
    },
  });

  warnIfImbalancedCodeSpans(acc.text);
  return acc.text;
}
