/**
 * entitlement.test.ts
 *
 * Unit coverage for getEngineReadiness() — the single source of truth for
 * "can the selected engine run right now" (Forge: CLI + local, no hosted
 * backend). Pure logic: all runtime signals (CLI detection cache, the model
 * catalogs) are mocked at their module boundaries.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getEngineReadiness, engineReasonKey, isAnyEngineUsable } from '../entitlement';
import { loadAccessSettings } from '../accessSettings';
import { isCliBackendAvailable } from '../cliBackendProvider';
import { findModelById } from '../registry';
import { isDevinModel } from '../devinCatalog';

vi.mock('../accessSettings', () => ({
  loadAccessSettings: vi.fn(),
}));

vi.mock('../cliBackendProvider', () => ({
  isCliBackendAvailable: vi.fn(),
}));

vi.mock('../registry', () => ({
  findModelById: vi.fn(),
}));

vi.mock('../devinCatalog', () => ({
  isDevinModel: vi.fn(),
}));

const mockedLoadAccessSettings = vi.mocked(loadAccessSettings);
const mockedIsCliBackendAvailable = vi.mocked(isCliBackendAvailable);
const mockedFindModelById = vi.mocked(findModelById);
const mockedIsDevinModel = vi.mocked(isDevinModel);

beforeEach(() => {
  vi.resetAllMocks();
  // Neutral defaults — each test overrides what it cares about.
  mockedLoadAccessSettings.mockReturnValue({});
  mockedIsCliBackendAvailable.mockReturnValue(false);
  mockedFindModelById.mockReturnValue(undefined);
  mockedIsDevinModel.mockReturnValue(false);
});

describe('getEngineReadiness', () => {
  it('cli mode + CLI detected -> ready', () => {
    mockedLoadAccessSettings.mockReturnValue({ accessMode: 'cli', cliTool: 'claude' });
    mockedIsCliBackendAvailable.mockReturnValue(true);

    expect(getEngineReadiness()).toEqual({ mode: 'cli', ready: true });
    expect(mockedIsCliBackendAvailable).toHaveBeenCalledWith('claude');
  });

  it('cli mode + CLI not detected -> not ready, reason cli-not-found', () => {
    mockedLoadAccessSettings.mockReturnValue({ accessMode: 'cli', cliTool: 'claude' });
    mockedIsCliBackendAvailable.mockReturnValue(false);

    expect(getEngineReadiness()).toEqual({
      mode: 'cli',
      ready: false,
      reason: 'cli-not-found',
    });
  });

  it('cli mode checks the configured tool (codex)', () => {
    mockedLoadAccessSettings.mockReturnValue({ accessMode: 'cli', cliTool: 'codex' });
    mockedIsCliBackendAvailable.mockReturnValue(true);

    expect(getEngineReadiness()).toEqual({ mode: 'cli', ready: true });
    expect(mockedIsCliBackendAvailable).toHaveBeenCalledWith('codex');
  });

  it('local mode -> always ready (optimistic; a refused Ollama connection surfaces at launch)', () => {
    mockedLoadAccessSettings.mockReturnValue({ accessMode: 'local' });
    mockedIsCliBackendAvailable.mockReturnValue(false);

    expect(getEngineReadiness()).toEqual({ mode: 'local', ready: true });
  });

  // ── Auto mode (accessMode unset) — resolves to the effective engine ──

  it('auto mode + claude CLI detected -> cli ready', () => {
    mockedLoadAccessSettings.mockReturnValue({});
    mockedIsCliBackendAvailable.mockImplementation((tool: string) => tool === 'claude');

    expect(getEngineReadiness()).toEqual({ mode: 'cli', ready: true });
  });

  it('auto mode + only codex detected -> cli ready', () => {
    mockedLoadAccessSettings.mockReturnValue({});
    mockedIsCliBackendAvailable.mockImplementation((tool: string) => tool === 'codex');

    expect(getEngineReadiness()).toEqual({ mode: 'cli', ready: true });
  });

  it('auto mode + only devin detected -> cli ready', () => {
    mockedLoadAccessSettings.mockReturnValue({});
    mockedIsCliBackendAvailable.mockImplementation((tool: string) => tool === 'devin');

    expect(getEngineReadiness()).toEqual({ mode: 'cli', ready: true });
  });

  it('auto mode + nothing detected -> local ready (the Forge default)', () => {
    mockedLoadAccessSettings.mockReturnValue({});

    expect(getEngineReadiness()).toEqual({ mode: 'local', ready: true });
  });

  it('cli mode + detection not yet run (null) -> optimistic ready (startup window)', () => {
    mockedLoadAccessSettings.mockReturnValue({ accessMode: 'cli' });
    mockedIsCliBackendAvailable.mockReturnValue(null);

    expect(getEngineReadiness()).toEqual({ mode: 'cli', ready: true });
  });

  it('auto mode + detection not yet run (null) -> optimistic cli ready (startup window)', () => {
    mockedLoadAccessSettings.mockReturnValue({});
    mockedIsCliBackendAvailable.mockReturnValue(null);

    expect(getEngineReadiness()).toEqual({ mode: 'cli', ready: true });
  });

  // ── forMode override ─────────────

  it("getEngineReadiness('local') reports the local engine even while the user is in cli mode", () => {
    mockedLoadAccessSettings.mockReturnValue({ accessMode: 'cli', cliTool: 'claude' });
    mockedIsCliBackendAvailable.mockReturnValue(true);

    expect(getEngineReadiness('local')).toEqual({ mode: 'local', ready: true });
  });

  it("getEngineReadiness('cli') reports CLI detection even while the user is in local mode", () => {
    mockedLoadAccessSettings.mockReturnValue({ accessMode: 'local' });
    mockedIsCliBackendAvailable.mockReturnValue(false);

    expect(getEngineReadiness('cli')).toEqual({
      mode: 'cli',
      ready: false,
      reason: 'cli-not-found',
    });
  });
});

// ── modelId hint (per-launch model overrides global mode) ────
describe('getEngineReadiness — modelId hint', () => {
  it('a catalog-native modelId short-circuits to cli readiness even when global mode is local', () => {
    mockedLoadAccessSettings.mockReturnValue({ accessMode: 'local', cliTool: 'claude' });
    mockedIsCliBackendAvailable.mockReturnValue(true);
    mockedFindModelById.mockReturnValue({
      id: 'claude-sonnet-5',
      label: 'Claude Sonnet 5',
      provider: 'anthropic',
      description: 'Best coding model, orchestration',
    });

    expect(getEngineReadiness(undefined, 'claude-sonnet-5')).toEqual({
      mode: 'cli',
      ready: true,
    });
    expect(mockedFindModelById).toHaveBeenCalledWith('claude-sonnet-5');
  });

  it('a catalog-native modelId reports cli-not-found when that CLI is absent', () => {
    mockedLoadAccessSettings.mockReturnValue({ accessMode: 'local', cliTool: 'claude' });
    mockedIsCliBackendAvailable.mockReturnValue(false);
    mockedFindModelById.mockReturnValue({
      id: 'claude-sonnet-5',
      label: 'Claude Sonnet 5',
      provider: 'anthropic',
      description: 'Best coding model, orchestration',
    });

    expect(getEngineReadiness(undefined, 'claude-sonnet-5')).toEqual({
      mode: 'cli',
      ready: false,
      reason: 'cli-not-found',
    });
  });

  it('a Devin-catalog modelId follows the Devin CLI detection, whatever the ambient cliTool is', () => {
    mockedLoadAccessSettings.mockReturnValue({ accessMode: 'cli', cliTool: 'claude' });
    mockedFindModelById.mockReturnValue(undefined);
    mockedIsDevinModel.mockReturnValue(true);
    mockedIsCliBackendAvailable.mockImplementation((tool: string) => tool === 'devin');

    expect(getEngineReadiness(undefined, 'swe-2-medium')).toEqual({
      mode: 'cli',
      ready: true,
    });
    expect(mockedIsCliBackendAvailable).toHaveBeenCalledWith('devin');
  });

  it('an explicit local model id short-circuits to local readiness', () => {
    mockedLoadAccessSettings.mockReturnValue({ accessMode: 'cli', cliTool: 'claude' });
    mockedFindModelById.mockReturnValue(undefined);
    mockedIsDevinModel.mockReturnValue(false);

    expect(getEngineReadiness(undefined, 'local/hermes3')).toEqual({
      mode: 'local',
      ready: true,
    });
  });

  it('an unknown modelId falls through unchanged to the global-mode switch', () => {
    mockedLoadAccessSettings.mockReturnValue({});
    mockedFindModelById.mockReturnValue(undefined);
    mockedIsDevinModel.mockReturnValue(false);
    mockedIsCliBackendAvailable.mockReturnValue(false);

    expect(getEngineReadiness(undefined, 'gpt-999-does-not-exist')).toEqual({
      mode: 'local',
      ready: true,
    });
  });

  it('an explicit forMode always wins over modelId — the hint is only consulted when forMode is unset', () => {
    mockedLoadAccessSettings.mockReturnValue({ accessMode: 'cli' });
    mockedFindModelById.mockReturnValue({
      id: 'claude-sonnet-5',
      label: 'Claude Sonnet 5',
      provider: 'anthropic',
      description: 'Best coding model, orchestration',
    });

    expect(getEngineReadiness('local', 'claude-sonnet-5')).toEqual({
      mode: 'local',
      ready: true,
    });
    expect(mockedFindModelById).not.toHaveBeenCalled();
  });
});

// ── engineReasonKey ───────────────────────────────────────────────
describe('engineReasonKey', () => {
  it('maps each reason to its locale key', () => {
    expect(engineReasonKey('cli-not-found')).toBe('engine.reason.cli-not-found');
    expect(engineReasonKey('local-unreachable')).toBe('engine.reason.local-unreachable');
  });
});

// ── isAnyEngineUsable ─────────────────────────────────────────────
// The local engine is optimistic (reachability is async), so this is true
// whenever a CLI is detected — and still true when none is, because local
// is always assumed present.
describe('isAnyEngineUsable', () => {
  it('is true when a CLI tool is detected', () => {
    mockedIsCliBackendAvailable.mockImplementation((tool: string) => tool === 'claude');
    expect(isAnyEngineUsable()).toBe(true);
  });

  it('is true when only codex is detected', () => {
    mockedIsCliBackendAvailable.mockImplementation((tool: string) => tool === 'codex');
    expect(isAnyEngineUsable()).toBe(true);
  });

  it('is true when only devin is detected', () => {
    mockedIsCliBackendAvailable.mockImplementation((tool: string) => tool === 'devin');
    expect(isAnyEngineUsable()).toBe(true);
  });

  it('stays true with nothing detected (local engine optimism)', () => {
    mockedIsCliBackendAvailable.mockReturnValue(false);
    expect(isAnyEngineUsable()).toBe(true);
  });

  it('stays true while detection has not run yet (null)', () => {
    mockedIsCliBackendAvailable.mockReturnValue(null);
    expect(isAnyEngineUsable()).toBe(true);
  });
});
