/**
 * Tests for planAndAct's PER-MISSION model-based routing (routing-by-chosen-
 * model): a `local/` id routes to the local ReAct loop with the id forwarded
 * UNMANGLED; a Devin-catalog id routes to the managed loop with the Devin CLI
 * streamer; a native CLI id routes to the native agent_run loop; and a
 * mismatch between the chosen model's engine family and what's actually
 * ready (no CLI detected) fails the mission early with a clear reason
 * instead of silently running on the wrong engine. See runtime.ts's
 * classifyMissionModel / isNativeModelReady / planAndAct.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { invoke } from '@tauri-apps/api/core';

// ── Mock getProviderMode only — isCliBackendAvailable stays REAL except
// where overridden below, so the mode-INDEPENDENT readiness signals the new
// routing actually uses stay honest. ─────────────────────────────────────
vi.mock('../lib/models/index', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/models/index')>();
  return {
    ...actual,
    getProviderMode: vi.fn(() => 'mock' as const),
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
// wasn't) called, and with which model id; internals are already covered by
// managedAgent.test.ts. ─────────────────────────────────────────────────────
vi.mock('../lib/agents/managedAgent', () => ({
  planAndActManaged: vi.fn().mockResolvedValue(undefined),
}));

// ── Mock platform (brain recall) — required by planAndActLive/runMission ──
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

import { planAndAct, classifyMissionModel } from '../lib/agents/runtime';
import type { PlanStep } from '../lib/agents/types';
import { isCliBackendAvailable } from '../lib/models/cliBackendProvider';
import { planAndActManaged } from '../lib/agents/managedAgent';

const mockedInvoke = invoke as ReturnType<typeof vi.fn>;
const mockedPlanAndActManaged = planAndActManaged as ReturnType<typeof vi.fn>;
const mockedCliAvailable = isCliBackendAvailable as ReturnType<typeof vi.fn>;

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
  mockedCliAvailable.mockReturnValue(true);
  setTauriRuntime(true);
});

afterEach(() => {
  setTauriRuntime(false);
});

describe('classifyMissionModel', () => {
  it('classifies a local/ id as local', () => {
    expect(classifyMissionModel('local/hermes3')).toBe('local');
    expect(classifyMissionModel('local/llama3')).toBe('local');
  });

  it('classifies a Devin-catalog id as devin', () => {
    expect(classifyMissionModel('swe-2-medium')).toBe('devin');
    expect(classifyMissionModel('swe-2-high')).toBe('devin');
  });

  it('classifies a native CLI id/label as native', () => {
    expect(classifyMissionModel('claude-sonnet-5')).toBe('native');
    expect(classifyMissionModel('Claude Sonnet 5')).toBe('native');
  });

  it('returns undefined for an absent/empty model (callers fall back to mode-based routing)', () => {
    expect(classifyMissionModel(undefined)).toBeUndefined();
    expect(classifyMissionModel('')).toBeUndefined();
  });
});

describe('planAndAct — routing by chosen model', () => {
  it('a local/ id routes to the managed loop with the id forwarded unmangled', async () => {
    const opts = makeOpts({ managedModel: 'local/hermes3' });

    await planAndAct(opts);

    expect(mockedPlanAndActManaged).toHaveBeenCalledTimes(1);
    expect(mockedPlanAndActManaged).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'local/hermes3' }),
    );
    expect(mockedInvoke).not.toHaveBeenCalledWith('agent_run', expect.anything());
  });

  it('a native id (claude-sonnet-5) routes to the native live loop', async () => {
    // stopSignal=true lets planAndActLive's wait loop resolve immediately
    // (agent_run_kill) instead of hanging on the mocked listen() (setup.ts)
    // that never fires its done/error handlers — the routing proof
    // (invoke('agent_run')) already happened earlier in the same
    // synchronous-until-first-await run, same technique as
    // runtimeDispatch.test.ts.
    const opts = makeOpts({
      managedModel: 'claude-sonnet-5',
      tool: 'claude',
      model: 'sonnet',
      stopSignal: vi.fn(() => true),
    });

    await planAndAct(opts);

    expect(mockedInvoke).toHaveBeenCalledWith(
      'agent_run',
      expect.objectContaining({
        req: expect.objectContaining({ id: 'test-mission-1', tool: 'claude' }),
      }),
    );
    expect(mockedPlanAndActManaged).not.toHaveBeenCalled();
  });

  it('a native id with no CLI detected fails early with a clear reason instead of a silent wrong-engine run', async () => {
    mockedCliAvailable.mockReturnValue(false);
    const opts = makeOpts({ managedModel: 'claude-sonnet-5' });

    await planAndAct(opts);

    expect(mockedPlanAndActManaged).not.toHaveBeenCalled();
    expect(mockedInvoke).not.toHaveBeenCalledWith('agent_run', expect.anything());
    expect(opts.onAction).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'error' }),
    );
    expect(opts.onProgress).toHaveBeenCalledWith(100);
    // Every plan step is marked as errored, same terminal shape as the
    // pre-existing planAndActUnavailable path.
    expect(opts.onStep).toHaveBeenCalledTimes(5);
  });
});
