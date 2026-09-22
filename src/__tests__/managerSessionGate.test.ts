/**
 * managerSessionGate.test.ts — Forge: no hosted backend, so no turn ever
 * needs a session. managerTurnNeedsSession is always false.
 */
import { describe, it, expect } from 'vitest';
import {
  managerTurnNeedsSession,
  hasManagedSession,
  formatManagerUserError,
} from '../lib/agents/managerSessionGate';

describe('managerTurnNeedsSession', () => {
  it('never needs a session for a local id', () => {
    expect(managerTurnNeedsSession('local/hermes3', 'local')).toBe(false);
  });

  it('never needs a session for a native Claude id', () => {
    expect(managerTurnNeedsSession('claude-sonnet-5', 'mock')).toBe(false);
  });

  it('never needs a session on cli modes', () => {
    expect(managerTurnNeedsSession('claude-sonnet-5', 'claude-code')).toBe(false);
    expect(managerTurnNeedsSession('local/hermes3', 'local')).toBe(false);
  });
});

describe('hasManagedSession', () => {
  it('is always true (no session to check)', async () => {
    expect(await hasManagedSession()).toBe(true);
  });
});

describe('formatManagerUserError', () => {
  it('unwraps nested LazyManager / ManagedUnavailableError prefixes', () => {
    const inner = new Error('Session requise pour le mode géré (agent)');
    inner.name = 'ManagedUnavailableError';
    const wrapped = new Error(`LazyManager error: ${String(inner)}`, { cause: inner });
    expect(formatManagerUserError(wrapped)).toBe('Session requise pour le mode géré (agent)');
  });

  it('does not leave Error: Error: LazyManager error in the user-facing string', () => {
    const thrown = new Error('LazyManager error: Error: model missing');
    expect(formatManagerUserError(thrown)).toBe('model missing');
    expect(formatManagerUserError(thrown)).not.toMatch(/LazyManager error/i);
  });

  it('unwraps the persisted Tauri bubble (measured 2026-08-28)', () => {
    const persisted =
      "Error: Error: LazyManager error: Error: There's an issue with the selected model (deepseek-chat).";
    expect(formatManagerUserError(persisted)).toBe(
      "There's an issue with the selected model (deepseek-chat).",
    );
  });

  it('strips the French i18n Error wrapper too', () => {
    expect(formatManagerUserError('Erreur : LazyManager error: Session requise')).toBe(
      'Session requise',
    );
  });
});
