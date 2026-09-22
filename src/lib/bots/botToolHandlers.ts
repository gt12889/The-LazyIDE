/* botToolHandlers — register bot_* ReAct tools and wrap ask_user / write_file
   for bot missions.

   toolRuntime.ts dispatches through a mutable table (handlers/index.ts). This
   module adds bot_request_intervention / bot_handoff there at boot without
   owning that file, and remaps a bot's write_file into
   `.lazy/bot-deliverables/<botId>/`. ask_user on a bot mission also lights
   the manager-header intervention channel.
*/

import { toolHandlers } from '../tools/handlers/index.js';
import type { ToolExecutionContext } from '../tools/handlers/types.js';
import { botIdForMission } from './botEngine.js';
import { handoffToBot } from './botHandoff.js';
import { requestUserIntervention } from './botRequestIntervention.js';
import { getBot } from './botStorage.js';
import type { BotMissionInput } from './botTypes.js';
import {
  BOT_DELIVERABLES_DIR,
  remapBotDeliverablePath,
} from './botDeliverablePaths.js';

export { BOT_DELIVERABLES_DIR, remapBotDeliverablePath };

export interface BotToolContext {
  createMission: (input: BotMissionInput) => Promise<string>;
  defaultModel: () => string;
}

let toolContext: BotToolContext | null = null;
let registered = false;
let originalAskUser = toolHandlers.ask_user;
let originalWriteFile = toolHandlers.write_file;

export function setBotToolContext(ctx: BotToolContext): void {
  toolContext = ctx;
}

export async function handleBotRequestIntervention(
  args: Record<string, unknown>,
  ctx: ToolExecutionContext,
): Promise<string> {
  const reason = String(args.reason ?? args.question ?? 'help');
  const detail = typeof args.detail === 'string'
    ? args.detail
    : typeof args.question === 'string' ? args.question : undefined;
  const botId = botIdForMission(ctx.missionId) ?? String(args.bot_id ?? 'unknown');
  requestUserIntervention(botId, reason, detail);
  if (/captcha/i.test(reason)) {
    const { markCaptchaWaiting } = await import('./botCaptchaResume.js');
    markCaptchaWaiting(botId, detail ?? '');
  }
  return `Intervention requested (${reason}). The human was notified in the manager header — take over the live session, then continue. Poll/wait until the gate clears (captcha resume loop).`;
}

/** bot_wait_for_human — BLOCKING human gate. Unlike bot_request_intervention
 *  (fire-and-forget), this parks the tool call until the human clears the
 *  gate (or timeout). The human resolves it from the manager header note. */
export async function handleBotWaitForHuman(
  args: Record<string, unknown>,
  ctx: ToolExecutionContext,
): Promise<string> {
  const botId = botIdForMission(ctx.missionId);
  if (!botId) return 'ERROR: bot_wait_for_human is only available inside a bot run.';
  const reason = String(args.reason ?? 'human input needed');
  const detail = typeof args.detail === 'string' ? args.detail : undefined;
  const timeoutMs = Math.min(Math.max(Number(args.timeout_ms) || 300_000, 10_000), 1_800_000);
  requestUserIntervention(botId, reason, detail);
  const {
    markCaptchaWaiting,
    getCaptchaResumeState,
  } = await import('./botCaptchaResume.js');
  const { getOutstandingIntervention } = await import('./botRequestIntervention.js');
  markCaptchaWaiting(botId, detail ?? reason);
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (getCaptchaResumeState(botId) === 'solved') return 'solved';
    if (!getOutstandingIntervention(botId)) return 'clear';
    await new Promise((r) => setTimeout(r, 2_000));
  }
  const state = getCaptchaResumeState(botId);
  if (state === 'waiting_human') {
    return `TIMEOUT: still waiting for the human after ${Math.round(timeoutMs / 1000)}s. ` +
      `Retry bot_wait_for_human to keep waiting, or continue if the gate cleared.`;
  }
  return `Human gate cleared (${state}) — the human finished the step; resume the task.`;
}

export async function handleBotHandoff(
  args: Record<string, unknown>,
  ctx: ToolExecutionContext,
): Promise<string> {
  if (!toolContext) return 'ERROR: bot_handoff is not wired — open the Bots space once to bind the mission factory.';
  const fromId = botIdForMission(ctx.missionId);
  if (!fromId) return 'ERROR: bot_handoff is only available inside a bot run.';
  const fromBot = await getBot(fromId);
  if (!fromBot) return `ERROR: owning bot "${fromId}" not found.`;
  const to = String(args.to ?? args.bot_id ?? '');
  const task = String(args.task ?? '');
  if (!to || !task) return 'ERROR: bot_handoff requires {"to": "bot_id_or_name", "task": "..."}.';
  const result = await handoffToBot({
    fromBot,
    toBotIdOrName: to,
    task,
    context: typeof args.context === 'string' ? args.context : undefined,
    createMission: toolContext.createMission,
    model: String(args.model ?? toolContext.defaultModel()),
    blocking: args.blocking === true,
  });
  if (!result.success) return `ERROR: bot_handoff failed: ${result.error}`;
  const childReport = 'childReport' in result && result.childReport ? `\nChild report:\n${result.childReport}` : '';
  return `Handoff launched: ${result.childBot?.name} (${result.childRunId}).${childReport}`;
}

async function wrappedAskUser(args: Record<string, unknown>, ctx: ToolExecutionContext): Promise<string> {
  const result = await originalAskUser(args, ctx);
  const botId = botIdForMission(ctx.missionId);
  if (botId) requestUserIntervention(botId, 'ask_user', String(args.question ?? ''));
  return result;
}

async function wrappedWriteFile(args: Record<string, unknown>, ctx: ToolExecutionContext): Promise<string> {
  const botId = botIdForMission(ctx.missionId);
  if (!botId) return originalWriteFile(args, ctx);
  const path = String(args.path ?? '');
  return originalWriteFile({ ...args, path: remapBotDeliverablePath(botId, path) }, ctx);
}

/** Idempotent. Safe to call from BotBootService and from the bot runtime. */
export function registerBotToolHandlers(): void {
  if (registered) return;
  registered = true;
  originalAskUser = toolHandlers.ask_user;
  originalWriteFile = toolHandlers.write_file;
  toolHandlers.bot_request_intervention = handleBotRequestIntervention;
  toolHandlers.bot_wait_for_human = handleBotWaitForHuman;
  toolHandlers.bot_handoff = handleBotHandoff;
  toolHandlers.ask_user = wrappedAskUser;
  toolHandlers.write_file = wrappedWriteFile;
}

/** Tests only — restores the dispatch table wrappers. */
export function resetBotToolHandlers(): void {
  if (!registered) return;
  toolHandlers.ask_user = originalAskUser;
  toolHandlers.write_file = originalWriteFile;
  delete toolHandlers.bot_request_intervention;
  delete toolHandlers.bot_wait_for_human;
  delete toolHandlers.bot_handoff;
  registered = false;
  toolContext = null;
}
