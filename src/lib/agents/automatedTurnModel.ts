/* automatedTurnModel — which model a BACKGROUND manager turn uses.

   The manager runs synthetic turns on the user's behalf: the resume after
   an approval queue drains, proactive wake-ups, loop promotion / demotion
   notices, fleet-hygiene alerts. Those were hard-wired to the cheap tier
   of the AMBIENT provider mode — on a desktop whose provider mode is
   "cli" that is the native CLI's haiku, whether or not the user's account
   is entitled to it.

   Rule: stay cheap, but on the rail the user's OWN chat model actually
   runs on (state.managerModel — the model that just answered). The
   tier hint is applied within that rail's catalog when it has tiers
   (CLI → claude-haiku-4-5) and is a no-op on rails without them
   (local). The old provider-mode default remains the fallback when no
   chat model is known or its rail is not ready right now. */

import { applyTierHintWithinRail, classifyBotModelRail, isBotRailReady } from '../bots/botRunModel.js';
import { getProviderMode } from '../models/index.js';
import { resolveManagerModelId } from './managerModelResolve.js';

export const AUTOMATED_TURN_TIER = 'sonnet';

export function resolveAutomatedTurnModel(chatModel: string | undefined): string {
  const id = chatModel?.trim();
  if (id) {
    const rail = classifyBotModelRail(id);
    if (rail && isBotRailReady(rail)) return applyTierHintWithinRail(AUTOMATED_TURN_TIER, { model: id, rail });
  }
  return resolveManagerModelId(AUTOMATED_TURN_TIER, getProviderMode());
}
