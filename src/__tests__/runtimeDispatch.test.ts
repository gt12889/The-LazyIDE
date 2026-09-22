/**
 * Tests for the planAndAct routing table (mode -> engine) in runtime.ts.
 *
 * Per-mission dispatch is keyed off the mission's CHOSEN model
 * (classifyMissionModel): a `local/` id routes to planAndActManaged with the
 * local turn streamer, a native CLI id routes to planAndActLive, each gated
 * on that engine's own readiness. With no classifiable model, routing falls
 * back to the active provider mode. On the desktop runtime with no usable
 * engine, the mission fails explicitly instead of faking success.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { invoke } from '@tauri-apps/api/core';

// ── Mock getProviderMode so each test controls the active mode directly ───
vi.mock('../lib/models/index', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/models/index')>();
  return {
    ...actual,
    getProviderMode: vi.fn(),
  };
});

// ── Mock CLI-backend availability so isNativeModelReady() is controllable ──
vi.mock('../lib/models/cliBackendProvider', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/models/cliBackendProvider')>();
  return {
    ...actual,
    isCliBackendAvailable: vi.fn(() => true),
  };
});

// ── Mock the managed agent loop — routing tests only need proof it was (or
// wasn't) called; its internals are already covered by managedAgent.test.ts.
vi.mock('../lib/agents/managedAgent', () => ({
  planAndActManaged: vi.fn().mockResolvedValue(undefined),
}));

// ── Mock platform (brain recall) — required by planAndActLive ─────────────
vi.mock('../lib/platform', () => ({
  getPlatform: vi.fn(() => ({
    brain: {
      recall: vi.fn().mockResolvedValue({
        injectedContext: '',
        nodes: [],
        tokensInjected: 0,
        tokensSaved: 0,
      }),
      capture: vi.fn().mockResolvedValue(undefined),
      startupContext: vi.fn().mockResolvedValue(''),
    },
  })),
}));

vi.mock('../lib/brain/context', () => ({
  normalizeRecall: vi.fn((r: unknown) => r),
  buildPromptBrainContext: vi.fn(() => ''),
  estimateTokens: vi.fn((text: string) => Math.ceil(text.length / 4)),
}));

import {
  planAndAct,
  isLocalLoopAvailable,
  isLiveAgentAvailable,
} from '../lib/agents/runtime';
import type { PlanStep } from '../lib/agents/types';
import type { ProviderMode } from '../lib/models/index';
import { getProviderMode } from '../lib/models/index';
import { planAndActManaged } from '../lib/agents/managedAgent';

const mockedInvoke = invoke as ReturnType<typeof vi.fn>;
const mockedGetProviderMode = getProviderMode as ReturnType<typeof vi.fn>;
const mockedPlanAndActManaged = planAndActManaged as ReturnType<typeof vi.fn>;

/** Toggle the global flag that isTauriRuntime() reads. */
function setTauriRuntime(active: boolean): void {
  const w = window as unknown as Record<string, unknown>;
  if (active) {
    w['__TAURI_INTERNALS__'] = {};
  } else {
    delete w['__TAURI_INTERNALS__'];
  }
}

function makeSteps(): PlanStep[] {
  return [
    { label: 'Initialisation', state: 'todo' as const },
    { label: 'Analyse', state: 'todo' as const },
    { label: 'Implémentation', state: 'todo' as const },
    { label: 'Tests', state: 'todo' as const },
    { label: 'Diff', state: 'todo' as const },
  ];
}

function makeOpts(overrides: Partial<Parameters<typeof planAndAct>[0]> = {}) {
  return {
    missionId: 'test-mission-1',
    missionTitle: 'Test task',
    worktreePath: '/tmp/wt/test',
    steps: makeSteps(),
    onStep: vi.fn(),
    onAction: vi.fn(),
    onProgress: vi.fn(),
    stopSignal: vi.fn(() => false),
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockedInvoke.mockResolvedValue(undefined);
  setTauriRuntime(true);
});

afterEach(() => {
  setTauriRuntime(false);
});

// ── Pure gating helpers ────

describe('isLocalLoopAvailable / isLiveAgentAvailable routing table', () => {
  const cases: Array<{ mode: ProviderMode; local: boolean; live: boolean }> = [
    { mode: 'claude-code', local: true, live: true },
    { mode: 'codex', local: true, live: true },
    { mode: 'devin', local: true, live: false },
    { mode: 'local', local: true, live: false },
    { mode: 'mock', local: true, live: false },
  ];

  for (const { mode, local, live } of cases) {
    it(`mode="${mode}" (Tauri) -> local=${local}, live=${live}`, () => {
      mockedGetProviderMode.mockReturnValue(mode);
      expect(isLocalLoopAvailable()).toBe(local);
      expect(isLiveAgentAvailable()).toBe(live);
    });
  }

  it('both helpers are false outside the Tauri runtime', () => {
    setTauriRuntime(false);
    for (const { mode } of cases) {
      mockedGetProviderMode.mockReturnValue(mode);
      expect(isLocalLoopAvailable()).toBe(false);
      expect(isLiveAgentAvailable()).toBe(false);
    }
  });
});

// ── planAndAct dispatcher: routing by chosen model first ───────────────────

describe('planAndAct dispatcher', () => {
  it('a local/ model routes to planAndActManaged (local streamer), never agent_run', async () => {
    mockedGetProviderMode.mockReturnValue('claude-code');
    const opts = makeOpts({ managedModel: 'local/hermes3' });

    await planAndAct(opts);

    expect(mockedPlanAndActManaged).toHaveBeenCalledTimes(1);
    expect(mockedPlanAndActManaged).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'local/hermes3' }),
    );
    expect(mockedInvoke).not.toHaveBeenCalledWith('agent_run', expect.anything());
  });

  it('a native model routes to the native live loop (invokes agent_run, not managedAgent)', async () => {
    mockedGetProviderMode.mockReturnValue('local');
    // stopSignal=true lets planAndActLive's wait loop resolve immediately
    // (agent_run_kill) instead of hanging on the mocked listen() that never
    // fires its done/error handlers — the routing proof (invoke('agent_run'))
    // already happened earlier in the same synchronous-until-first-await run.
    const opts = makeOpts({ managedModel: 'claude-sonnet-5', tool: 'claude', model: 'haiku', stopSignal: vi.fn(() => true) });

    await planAndAct(opts);

    expect(mockedInvoke).toHaveBeenCalledWith(
      'agent_run',
      expect.objectContaining({
        req: expect.objectContaining({ id: 'test-mission-1', tool: 'claude' }),
      }),
    );
    expect(mockedPlanAndActManaged).not.toHaveBeenCalled();
  });

  it('mode="local" with no classifiable model falls back to planAndActManaged', async () => {
    mockedGetProviderMode.mockReturnValue('local');
    const opts = makeOpts();

    await planAndAct(opts);

    expect(mockedPlanAndActManaged).toHaveBeenCalledTimes(1);
    expect(mockedInvoke).not.toHaveBeenCalledWith('agent_run', expect.anything());
  });

  it('mode="mock" on the desktop runtime fails explicitly instead of faking success', async () => {
    mockedGetProviderMode.mockReturnValue('mock');
    const opts = makeOpts();

    await planAndAct(opts);

    expect(mockedPlanAndActManaged).not.toHaveBeenCalled();
    expect(mockedInvoke).not.toHaveBeenCalledWith('agent_run', expect.anything());
    expect(mockedInvoke).not.toHaveBeenCalledWith('write_file', expect.anything());

    expect(opts.onAction).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'error' }),
    );
    expect(opts.onProgress).toHaveBeenCalledWith(100);
  });

  it('mode="mock" outside the Tauri runtime (web demo) keeps the scripted placeholder loop', async () => {
    vi.useFakeTimers();
    try {
      setTauriRuntime(false);
      mockedGetProviderMode.mockReturnValue('mock');
      const opts = makeOpts();

      const pending = planAndAct(opts);
      await vi.runAllTimersAsync();
      await pending;

      // planAndActScripted writes the placeholder notes file — the only
      // surface where that is legitimate (no Tauri IPC backend exists there).
      expect(mockedInvoke).toHaveBeenCalledWith(
        'write_file',
        expect.objectContaining({ path: expect.stringContaining('LAZY_AGENT_NOTES.md') }),
      );
      expect(opts.onProgress).toHaveBeenCalledWith(100);
    } finally {
      vi.useRealTimers();
    }
  });
});
