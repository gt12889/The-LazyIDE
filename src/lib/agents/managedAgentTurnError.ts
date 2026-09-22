/* managedAgentTurnError.ts — in-loop stream-error classification extracted
   from planAndActManaged.

   Forge: no hosted backend, so there is no wallet to exhaust and no
   provider key to revoke server-side. The 'no_credits' and 'provider'
   classifications below survive as message-shape matchers (the loop,
   recovery.ts, and settle still speak that reason vocabulary) for engines
   that report quota/auth failures in-band (Ollama 404 = model not pulled,
   CLI auth errors). Does not import managedAgent.ts (cycle). */

import type { ActionEvent } from './types.js';
import { agentErrorEvent } from './agentError.js';
import type { TFunc } from './runtime.js';

export type ClassifiedTurnError =
  | { kind: 'abort' }
  | { kind: 'no_credits' }
  | { kind: 'provider'; providerId: string; shortReason: string }
  | { kind: 'transient' };

/** Definitive engine rejections: retrying the IDENTICAL request can never
 *  succeed (bad credentials, HTTP 401/402/403/404, unknown model). */
const DEFINITIVE_PATTERN = /\b(401|402|403|404)\b|no_credits|insufficient balance|invalid api key|model not found/i;

/** Quota-shaped failures: the engine is reachable but refuses this run. */
const QUOTA_PATTERN = /no_credits|crédits pro épuisés|insufficient balance|quota exceeded/i;

export function classifyManagedTurnError(err: unknown): ClassifiedTurnError {
  if (err instanceof Error && err.name === 'AbortError') return { kind: 'abort' };
  const message = err instanceof Error ? err.message : String(err ?? '');
  if (QUOTA_PATTERN.test(message)) return { kind: 'no_credits' };
  if (DEFINITIVE_PATTERN.test(message)) {
    return { kind: 'provider', providerId: 'engine', shortReason: message.slice(0, 200) };
  }
  return { kind: 'transient' };
}

export function applyManagedTurnError(
  err: unknown,
  opts: {
    consecutiveFailures: number;
    maxConsecutiveFailures: number;
    nowTime: () => string;
    onAction: (event: ActionEvent) => void;
    stopForNoCredits: () => void;
    stopForDefinitiveProviderError: (providerId: string, shortReason: string) => void;
    escalateAndStop: () => void;
    t?: TFunc;
  },
): 'stop' | { retry: number } {
  const classified = classifyManagedTurnError(err);
  if (classified.kind === 'abort') {
    opts.onAction({ time: opts.nowTime(), text: 'Agent stopped by user', isLive: false });
    return 'stop';
  }
  if (classified.kind === 'no_credits') {
    opts.stopForNoCredits();
    return 'stop';
  }
  if (classified.kind === 'provider') {
    opts.stopForDefinitiveProviderError(classified.providerId, classified.shortReason);
    return 'stop';
  }
  const consecutiveFailures = opts.consecutiveFailures + 1;
  opts.onAction(agentErrorEvent(opts.nowTime(), String(err), opts.t));
  if (consecutiveFailures >= opts.maxConsecutiveFailures) {
    opts.escalateAndStop();
    return 'stop';
  }
  return { retry: consecutiveFailures };
}
