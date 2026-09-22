/* automatedTurnModel.test.ts — background manager turns (approval-queue
   resume, wake-ups, loop notices) stay on the rail the user's chat model
   actually runs on, cheap tier applied within that rail. */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../lib/models/cliBackendProvider', () => ({
  isCliBackendAvailable: vi.fn(() => false),
}));

vi.mock('../lib/models/index', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/models/index')>();
  return {
    ...actual,
    getProviderMode: vi.fn(() => 'local'),
  };
});

import { isCliBackendAvailable } from '../lib/models/cliBackendProvider';
import { getProviderMode } from '../lib/models/index';
import { saveAccessSettings } from '../lib/models/accessSettings';
import { DEFAULT_LOCAL_MODEL_ID } from '../lib/models/localProvider';
import { resolveAutomatedTurnModel } from '../lib/agents/automatedTurnModel';

const cliAvailable = isCliBackendAvailable as unknown as ReturnType<typeof vi.fn>;
const providerMode = getProviderMode as unknown as ReturnType<typeof vi.fn>;

function simulateTauri(): void {
  (window as unknown as Record<string, unknown>)['__TAURI_INTERNALS__'] = {};
}

beforeEach(() => {
  localStorage.clear();
  cliAvailable.mockReturnValue(false);
  providerMode.mockReturnValue('local');
});

afterEach(() => {
  delete (window as unknown as Record<string, unknown>)['__TAURI_INTERNALS__'];
});

describe('resolveAutomatedTurnModel', () => {
  // A CLI chat model stays on the CLI rail with the cheap tier applied
  // within it — never bounced onto another engine.
  it('applies the cheap tier within the CLI rail when the chat runs on the CLI', () => {
    simulateTauri();
    cliAvailable.mockImplementation((tool: string) => tool === 'claude');
    expect(resolveAutomatedTurnModel('claude-opus-5')).toBe('claude-sonnet-5');
  });

  it('keeps a Devin chat model inside the Devin catalog instead of the CLI default', () => {
    simulateTauri();
    cliAvailable.mockImplementation((tool: string) => tool === 'devin');
    saveAccessSettings({ accessMode: 'cli', cliTool: 'devin' });
    // 'sonnet' tier hint resolved against the Devin catalog.
    expect(resolveAutomatedTurnModel('swe-2-medium')).toBe('claude-sonnet-5-medium');
  });

  it('leaves the local rail untouched (no tiers there)', () => {
    expect(resolveAutomatedTurnModel('local/hermes3')).toBe('local/hermes3');
  });

  it('the local rail needs no probe — a local chat model stays local even with no CLI and no Tauri', () => {
    expect(resolveAutomatedTurnModel('local/custom-model')).toBe('local/custom-model');
  });

  it('falls back to the provider-mode default when the chat model rail is not ready', () => {
    // CLI chat model but no CLI detected (and no Tauri at all) — the CLI
    // rail is not ready, so the provider-mode ("local") default wins.
    expect(resolveAutomatedTurnModel('claude-sonnet-5')).toBe(DEFAULT_LOCAL_MODEL_ID);
  });

  it('falls back to the provider-mode default when no chat model is known', () => {
    providerMode.mockReturnValue('claude-code');
    expect(resolveAutomatedTurnModel(undefined)).toBe('claude-sonnet-5');
    expect(resolveAutomatedTurnModel('')).toBe('claude-sonnet-5');
  });
});
