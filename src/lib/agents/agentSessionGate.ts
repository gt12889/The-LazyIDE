/* agentSessionGate — unified preflight per engine rail (Forge: no accounts).

   Manager turns have managerSessionGate.ts's error formatting; mission
   launches classify the rail from the chosen model, then refuse with a
   precise reason BEFORE planAndAct spends a worktree. There is no hosted
   backend, so there is no session/JWT check — only engine readiness.
*/

import type { ProviderMode } from '../models/index.js';

export type AgentRail = 'cli' | 'local';

export interface AgentSessionGateOk {
  ok: true;
  rail: AgentRail;
}

export interface AgentSessionGateBlocked {
  ok: false;
  rail: AgentRail;
  reasonKey: string;
  reason: string;
}

export type AgentSessionGateResult = AgentSessionGateOk | AgentSessionGateBlocked;

export function classifyAgentRail(model: string | undefined, mode: ProviderMode): AgentRail {
  if (model?.startsWith('local/')) return 'local';
  if (mode === 'local') return 'local';
  if (mode === 'claude-code' || mode === 'codex' || mode === 'devin') return 'cli';
  // Devin-catalog ids ride the Devin CLI.
  return 'cli';
}

const REASONS: Record<AgentRail, { key: string; fallback: string }> = {
  local: {
    key: 'agents.sessionGate.needLocal',
    fallback: 'Start Ollama (`ollama serve`) with the model pulled (`ollama pull <model>`).',
  },
  cli: {
    key: 'agents.sessionGate.needCli',
    fallback: 'Install or connect the Claude / Codex CLI in Settings > Models.',
  },
};

function blocked(rail: AgentRail): AgentSessionGateBlocked {
  const r = REASONS[rail];
  return { ok: false, rail, reasonKey: r.key, reason: r.fallback };
}

/**
 * Async preflight: CLI rail needs a detected CLI (`cliReady`), local rail is
 * optimistic (Ollama reachability is async — a refused connection fails the
 * mission honestly inside the first turn, never here).
 *
 * `cliReady` is injected so tests do not have to mock the whole models/index
 * graph; production callers pass isNativeModelReady.
 */
export async function gateAgentSession(opts: {
  model?: string;
  mode: ProviderMode;
  cliReady?: boolean;
}): Promise<AgentSessionGateResult> {
  const rail = classifyAgentRail(opts.model, opts.mode);

  if (rail === 'local') return { ok: true, rail };

  if (opts.cliReady === false) return blocked('cli');
  return { ok: true, rail: 'cli' };
}
