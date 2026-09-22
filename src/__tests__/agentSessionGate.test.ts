import { describe, it, expect } from 'vitest';

import { classifyAgentRail, gateAgentSession } from '../lib/agents/agentSessionGate';

describe('classifyAgentRail', () => {
  it('routes a local/ id to the local rail', () => {
    expect(classifyAgentRail('local/hermes3', 'mock')).toBe('local');
  });

  it('routes local mode to the local rail', () => {
    expect(classifyAgentRail(undefined, 'local')).toBe('local');
  });

  it('routes a native Claude id to CLI', () => {
    expect(classifyAgentRail('claude-sonnet-5', 'claude-code')).toBe('cli');
  });

  it('routes codex / devin modes to CLI', () => {
    expect(classifyAgentRail(undefined, 'codex')).toBe('cli');
    expect(classifyAgentRail(undefined, 'devin')).toBe('cli');
  });

  it('defaults an unclassified pick to CLI', () => {
    expect(classifyAgentRail(undefined, 'mock')).toBe('cli');
    expect(classifyAgentRail('claude-sonnet-5', 'mock')).toBe('cli');
  });
});

describe('gateAgentSession', () => {
  it('allows the local rail without any session (no accounts)', async () => {
    const result = await gateAgentSession({ model: 'local/hermes3', mode: 'mock' });
    expect(result).toEqual({ ok: true, rail: 'local' });
  });

  it('allows local mode without a cliReady signal', async () => {
    const result = await gateAgentSession({ mode: 'local' });
    expect(result).toEqual({ ok: true, rail: 'local' });
  });

  it('allows CLI without a JWT when the binary is ready', async () => {
    const result = await gateAgentSession({
      model: 'claude-sonnet-5',
      mode: 'claude-code',
      cliReady: true,
    });
    expect(result).toEqual({ ok: true, rail: 'cli' });
  });

  it('allows CLI when readiness is unknown (optimistic)', async () => {
    const result = await gateAgentSession({
      model: 'claude-sonnet-5',
      mode: 'claude-code',
    });
    expect(result).toEqual({ ok: true, rail: 'cli' });
  });

  it('blocks CLI when the binary is missing', async () => {
    const result = await gateAgentSession({
      model: 'claude-sonnet-5',
      mode: 'claude-code',
      cliReady: false,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.rail).toBe('cli');
      expect(result.reasonKey).toBe('agents.sessionGate.needCli');
    }
  });
});
