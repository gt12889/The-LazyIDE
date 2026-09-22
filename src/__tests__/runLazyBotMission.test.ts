/* runLazyBotMission.test.ts — the LazyBot runtime is NOT the code-agent
   runtime: no worktree, no diff/review, straight to `done` with the bot's
   report; the brain rail (CLI / local) only changes the streamTurn. */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Mission } from '../lib/agents/types';

const planAndActManaged = vi.fn();
vi.mock('../lib/agents/managedAgent', () => ({
  planAndActManaged: (...args: unknown[]) => planAndActManaged(...args),
}));

vi.mock('../lib/agents/runtime', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/agents/runtime')>();
  return {
    ...actual,
    isNativeModelReady: vi.fn(() => false),
  };
});

const cliStreamer = vi.fn();
vi.mock('../lib/agents/cliAgentTurnStreamer', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/agents/cliAgentTurnStreamer')>();
  return {
    ...actual,
    resolveCliEngineMode: vi.fn(() => 'claude-code'),
    createCliAgentTurnStreamer: vi.fn(() => cliStreamer),
  };
});

const localStreamer = vi.fn();
vi.mock('../lib/models/localProvider', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/models/localProvider')>();
  return {
    ...actual,
    createLocalAgentTurnStreamer: vi.fn(() => localStreamer),
  };
});

vi.mock('../lib/journal/journal', () => ({
  emitEvent: vi.fn(),
  emitBuffered: vi.fn(),
}));

vi.mock('../lib/agents/captureOutcome', () => ({
  captureOutcome: vi.fn(),
}));

vi.mock('../lib/bots/botToolHandlers', () => ({
  registerBotToolHandlers: vi.fn(),
}));

vi.mock('../lib/bots/botLearning', () => ({
  finalizeBotRunLearning: vi.fn().mockResolvedValue(undefined),
}));

// The worktree bridge must never be touched by a bot run.
const createMissionWorktree = vi.fn();
vi.mock('../lib/agents/runMissionWorktree', () => ({
  createMissionWorktree: (...args: unknown[]) => createMissionWorktree(...args),
  mergeWorktree: vi.fn(),
  discardWorktree: vi.fn(),
}));

import { isNativeModelReady, runMission } from '../lib/agents/runtime';
import { captureOutcome } from '../lib/agents/captureOutcome';
import { emitEvent } from '../lib/journal/journal';
import { runLazyBotMission, resolveBotBrain, resolveFallbackBrain, isBrainFailure } from '../lib/bots/runLazyBotMission';
import type { PlanAndActManagedOpts } from '../lib/agents/managedAgent';
import type { AgentTurnStreamer } from '../lib/agents/cliAgentTurnStreamer';

/** CLI/local streamTurn is wrapped with salvageReAct — verify it delegates to the inner streamer. */
async function expectSalvagedWrapper(
  wrapped: AgentTurnStreamer | undefined,
  inner: ReturnType<typeof vi.fn>,
): Promise<void> {
  expect(typeof wrapped).toBe('function');
  inner.mockImplementation(async function* () {
    yield 'Sure!\nTHOUGHT: ok\nACTION: web_search';
  });
  const chunks: string[] = [];
  for await (const chunk of wrapped!({} as Parameters<AgentTurnStreamer>[0])) {
    chunks.push(chunk);
  }
  expect(inner).toHaveBeenCalled();
  expect(chunks.join('')).toContain('THOUGHT: ok');
}

const nativeReady = isNativeModelReady as unknown as ReturnType<typeof vi.fn>;
const mockedCapture = captureOutcome as unknown as ReturnType<typeof vi.fn>;
const mockedEmit = emitEvent as unknown as ReturnType<typeof vi.fn>;

function botMission(overrides: Partial<Mission> = {}): Mission {
  return {
    id: 'M91',
    title: 'LocalBot: read example.com',
    status: 'queued',
    model: 'claude-sonnet-5',
    agentTask: 'Open example.com and report its title',
    agentName: 'LocalBot',
    agentSystemPrompt: 'You are LocalBot, a local browser bot.',
    botAutonomy: 'supervised',
    botId: 'bot_localtest',
    originConversationId: 'conv-origin',
    ...overrides,
  };
}

function patches(onUpdate: ReturnType<typeof vi.fn>): Array<Partial<Mission>> {
  return onUpdate.mock.calls.map((c) => (c[0] as { patch: Partial<Mission> }).patch);
}

function lastStatus(onUpdate: ReturnType<typeof vi.fn>): Mission['status'] | undefined {
  const withStatus = patches(onUpdate).filter((p) => p.status !== undefined);
  return withStatus[withStatus.length - 1]?.status;
}

/** Simulates a managed loop that opens a browser, then finishes with FINAL. */
function simulateSuccessfulLoop(report = 'Title: Example Domain') {
  planAndActManaged.mockImplementation(async (opts: PlanAndActManagedOpts) => {
    opts.onStep(0, 'in_progress');
    opts.onAction({ time: '10:00', text: 'Step 1: web_search', isLive: true });
    opts.onAction({ time: '10:00', text: 'Observation: results', isLive: false });
    opts.onProgress(50);
    opts.onMetrics?.({ durationMs: 1200, inputTokens: 10, outputTokens: 5, costUsd: 0.01, toolCount: 1 });
    opts.onOutcome?.({ type: 'completed' });
    opts.onAction({ time: '10:01', text: `Agent done: ${report}`, isLive: false });
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  nativeReady.mockReturnValue(false);
  planAndActManaged.mockReset();
});

describe('resolveBotBrain', () => {
  it('CLI model → the CLI text streamer, never the native agent_run path', () => {
    nativeReady.mockReturnValue(true);
    const brain = resolveBotBrain('claude-sonnet-5');
    expect(brain).toMatchObject({ rail: 'cli', model: 'claude-sonnet-5' });
    expect(typeof (brain as { streamTurn: unknown }).streamTurn).toBe('function');
  });

  it('local model → the local streamer', () => {
    const brain = resolveBotBrain('local/hermes3');
    expect(brain).toMatchObject({ rail: 'local', model: 'local/hermes3' });
    expect(typeof (brain as { streamTurn: unknown }).streamTurn).toBe('function');
  });

  it('reports an honest error when the rail is not usable', () => {
    nativeReady.mockReturnValue(false);
    const brain = resolveBotBrain('claude-sonnet-5');
    expect('error' in brain && brain.error).toMatch(/CLI/);
  });

  it('reports an honest error when no rail can serve the model', () => {
    const brain = resolveBotBrain(undefined);
    expect('error' in brain && brain.error).toMatch(/No runnable engine rail/);
  });
});

describe('runLazyBotMission', () => {
  it('runs the ReAct loop on the project root with the bot policy — no worktree — and lands in done with the report', async () => {
    nativeReady.mockReturnValue(true);
    simulateSuccessfulLoop();
    const onUpdate = vi.fn();
    await runLazyBotMission(botMission(), 'C:\\repo', {
      onUpdate,
      allowedTools: ['web_search', 'write_file'],
      deniedTools: [],
    });

    expect(createMissionWorktree).not.toHaveBeenCalled();
    expect(planAndActManaged).toHaveBeenCalledTimes(1);
    const loopOpts = planAndActManaged.mock.calls[0]![0] as PlanAndActManagedOpts;
    expect(loopOpts.worktreePath).toBe('C:\\repo');
    expect(loopOpts.projectRoot).toBe('C:\\repo');
    expect(loopOpts.agentSystemPrompt).toBe('You are LocalBot, a local browser bot.');
    expect(loopOpts.agentDisplayName).toBe('LocalBot');
    expect(loopOpts.autonomy).toBe('supervised');
    expect(loopOpts.allowedTools).toEqual(['web_search', 'write_file']);
    expect(loopOpts.deniedTools).toEqual([]);
    expect(loopOpts.model).toBe('claude-sonnet-5');
    expect(typeof loopOpts.streamTurn).toBe('function');
    expect(loopOpts.prelude).toBe('bot');

    expect(patches(onUpdate)[0]?.status).toBe('running');
    expect(lastStatus(onUpdate)).toBe('done');
    const final = patches(onUpdate).find((p) => p.status === 'done')!;
    expect(final.progress).toBe(100);
    expect(final.liveAction).toBeUndefined();
    expect(final.actionTimeline?.map((e) => e.text).join('\n')).toContain('LazyBot terminé — Title: Example Domain');
    expect(final.planSteps?.every((s) => s.state === 'done')).toBe(true);
    expect(patches(onUpdate).some((p) => p.status === 'review')).toBe(false);
    expect(patches(onUpdate).some((p) => p.diffSnippet !== undefined)).toBe(false);
    expect(mockedCapture).toHaveBeenCalledWith(expect.objectContaining({ id: 'M91' }), expect.any(String), 'done', expect.any(Number), expect.objectContaining({ costUsd: 0.01 }));
    expect(mockedEmit).toHaveBeenCalledWith(expect.objectContaining({ type: 'mission.started', missionId: 'M91' }));
    expect(mockedEmit).toHaveBeenCalledWith(expect.objectContaining({
      type: 'lazybot.completed',
      payload: expect.objectContaining({
        botId: 'bot_localtest',
        botName: 'LocalBot',
        conversationId: 'conv-origin',
        report: 'Title: Example Domain',
      }),
    }));
  });

  it('local model: drives the same loop through the local streamer', async () => {
    simulateSuccessfulLoop();
    const onUpdate = vi.fn();
    await runLazyBotMission(botMission({ model: 'local/hermes3' }), 'C:\\repo', { onUpdate });
    const loopOpts = planAndActManaged.mock.calls[0]![0] as PlanAndActManagedOpts;
    await expectSalvagedWrapper(loopOpts.streamTurn, localStreamer);
    expect(loopOpts.model).toBe('local/hermes3');
    expect(lastStatus(onUpdate)).toBe('done');
  });

  it('CLI model: drives the same loop through the CLI text streamer', async () => {
    nativeReady.mockReturnValue(true);
    simulateSuccessfulLoop();
    const onUpdate = vi.fn();
    await runLazyBotMission(botMission({ model: 'claude-sonnet-5' }), 'C:\\repo', { onUpdate });
    const loopOpts = planAndActManaged.mock.calls[0]![0] as PlanAndActManagedOpts;
    await expectSalvagedWrapper(loopOpts.streamTurn, cliStreamer);
    expect(loopOpts.model).toBe('claude-sonnet-5');
    expect(lastStatus(onUpdate)).toBe('done');
  });

  it('fails honestly before the loop when no rail can serve the model', async () => {
    const onUpdate = vi.fn();
    await runLazyBotMission(botMission({ model: 'claude-sonnet-5' }), 'C:\\repo', { onUpdate });
    expect(planAndActManaged).not.toHaveBeenCalled();
    expect(lastStatus(onUpdate)).toBe('failed');
    const failed = patches(onUpdate).find((p) => p.status === 'failed')!;
    expect(failed.statusReason).toMatch(/CLI/);
    expect(mockedCapture).toHaveBeenCalledWith(expect.anything(), expect.any(String), 'failed', expect.any(Number), undefined, undefined, expect.objectContaining({ category: 'bot_rail_unavailable' }));
  });

  it('fails when the bot persona is missing instead of falling back to a local agent persona', async () => {
    nativeReady.mockReturnValue(true);
    const onUpdate = vi.fn();
    await runLazyBotMission(botMission({ agentSystemPrompt: undefined }), 'C:\\repo', { onUpdate });
    expect(planAndActManaged).not.toHaveBeenCalled();
    expect(lastStatus(onUpdate)).toBe('failed');
  });

  it('propagates a managed-loop failure reason', async () => {
    nativeReady.mockReturnValue(true);
    planAndActManaged.mockImplementation(async (opts: PlanAndActManagedOpts) => {
      opts.onOutcome?.({ type: 'failed', reason: 'max_steps_exhausted' });
    });
    const onUpdate = vi.fn();
    await runLazyBotMission(botMission(), 'C:\\repo', { onUpdate });
    expect(lastStatus(onUpdate)).toBe('failed');
    expect(mockedCapture).toHaveBeenCalledWith(expect.anything(), expect.any(String), 'failed', expect.any(Number), undefined, undefined, expect.objectContaining({ category: 'max_steps_exhausted' }));
  });

  it('marks the mission cancelled when stopped during the loop', async () => {
    nativeReady.mockReturnValue(true);
    let stopped = false;
    planAndActManaged.mockImplementation(async () => { stopped = true; });
    const onUpdate = vi.fn();
    await runLazyBotMission(botMission(), 'C:\\repo', { onUpdate, stopSignal: () => stopped });
    expect(lastStatus(onUpdate)).toBe('cancelled');
  });

  it('reports a budget cap crossing as budget_exceeded', async () => {
    nativeReady.mockReturnValue(true);
    planAndActManaged.mockImplementation(async (opts: PlanAndActManagedOpts) => {
      opts.onMetrics?.({ durationMs: 10, inputTokens: 1, outputTokens: 1, costUsd: 2, toolCount: 0 });
      opts.onBudgetExceeded?.();
    });
    const onUpdate = vi.fn();
    await runLazyBotMission(botMission(), 'C:\\repo', { onUpdate, getBudgetCapUsd: () => 1 });
    expect(lastStatus(onUpdate)).toBe('failed');
    expect(mockedCapture).toHaveBeenCalledWith(expect.anything(), expect.any(String), 'failed', expect.any(Number), expect.anything(), undefined, expect.objectContaining({ category: 'budget_exceeded' }));
  });

  describe('brain failover', () => {
    const ORG_DISABLED = 'Erreur agent: Error: Your organization has disabled Claude subscription access for Claude Code';

    function simulateDeadBrainThenSuccess(report = 'Title: Example Domain') {
      planAndActManaged
        .mockImplementationOnce(async (opts: PlanAndActManagedOpts) => {
          opts.onStep(0, 'in_progress');
          for (let i = 0; i < 3; i++) opts.onAction({ time: '10:00', text: ORG_DISABLED, isLive: false });
          opts.onMetrics?.({ durationMs: 900, inputTokens: 0, outputTokens: 0, costUsd: 0, toolCount: 0 });
          opts.onAction({ time: '10:00', text: 'Escalation: 3 consecutive failures — stopping, intervention required', isLive: false });
          opts.onOutcome?.({ type: 'failed', reason: 'consecutive_failures' });
        })
        .mockImplementationOnce(async (opts: PlanAndActManagedOpts) => {
          opts.onStep(0, 'in_progress');
          opts.onAction({ time: '10:01', text: 'Step 1: web_search', isLive: true });
          opts.onMetrics?.({ durationMs: 1200, inputTokens: 10, outputTokens: 5, costUsd: 0.01, toolCount: 1 });
          opts.onOutcome?.({ type: 'completed' });
          opts.onAction({ time: '10:02', text: `Agent done: ${report}`, isLive: false });
        });
    }

    it('CLI detected but dead → reruns the same loop on the local brain and lands in done', async () => {
      nativeReady.mockReturnValue(true);
      simulateDeadBrainThenSuccess();
      const onUpdate = vi.fn();
      await runLazyBotMission(botMission({ model: 'claude-haiku-4-5' }), 'C:\\repo', {
        onUpdate,
        allowedTools: ['web_search', 'write_file'],
      });

      expect(planAndActManaged).toHaveBeenCalledTimes(2);
      const first = planAndActManaged.mock.calls[0]![0] as PlanAndActManagedOpts;
      const second = planAndActManaged.mock.calls[1]![0] as PlanAndActManagedOpts;
      expect(first.model).toBe('claude-haiku-4-5');
      expect(second.model).toContain('local/');
      await expectSalvagedWrapper(first.streamTurn, cliStreamer);
      await expectSalvagedWrapper(second.streamTurn, localStreamer);
      expect(second.allowedTools).toEqual(first.allowedTools);
      expect(second.worktreePath).toBe('C:\\repo');
      expect(second.agentSystemPrompt).toBe(first.agentSystemPrompt);
      expect(createMissionWorktree).not.toHaveBeenCalled();

      expect(lastStatus(onUpdate)).toBe('done');
      expect(patches(onUpdate).some((p) => String(p.model ?? '').startsWith('local/'))).toBe(true);
      const final = patches(onUpdate).find((p) => p.status === 'done')!;
      const text = final.actionTimeline?.map((e) => e.text).join('\n') ?? '';
      expect(text).toMatch(/Cerveau cli indisponible .*organization has disabled.*bascule sur local/);
      expect(text).toContain('LazyBot terminé — Title: Example Domain');
      expect(mockedCapture).toHaveBeenCalledTimes(1);
      expect(mockedCapture).toHaveBeenCalledWith(expect.anything(), expect.any(String), 'done', expect.any(Number), expect.objectContaining({ toolCount: 1 }));
    });

    it('local brain dead with CLI also failing → honest failure after exhausting rails', async () => {
      nativeReady.mockReturnValue(true);
      planAndActManaged.mockImplementation(async (opts: PlanAndActManagedOpts) => {
        opts.onAction({ time: '10:00', text: 'Erreur agent: Error: 401 invalid api key', isLive: false });
        opts.onMetrics?.({ durationMs: 10, inputTokens: 0, outputTokens: 0, costUsd: 0, toolCount: 0 });
        opts.onOutcome?.({ type: 'failed', reason: 'provider_definitive_error' });
      });
      const onUpdate = vi.fn();
      await runLazyBotMission(botMission({ model: 'claude-haiku-4-5' }), 'C:\\repo', { onUpdate });
      // cli → local (both dead)
      expect(planAndActManaged.mock.calls.length).toBeGreaterThanOrEqual(2);
      expect(lastStatus(onUpdate)).toBe('failed');
      expect(mockedCapture).toHaveBeenCalledWith(expect.anything(), expect.any(String), 'failed', expect.any(Number), expect.anything(), undefined, expect.objectContaining({ category: 'provider_definitive_error' }));
    });

    it('failsover on provider_definitive_error even when some tools already ran (C85)', async () => {
      nativeReady.mockReturnValue(true);
      planAndActManaged
        .mockImplementationOnce(async (opts: PlanAndActManagedOpts) => {
          opts.onAction({ time: '10:00', text: 'Step 1: web_search', isLive: false });
          opts.onMetrics?.({ durationMs: 10, inputTokens: 5, outputTokens: 5, costUsd: 0.001, toolCount: 1 });
          opts.onOutcome?.({ type: 'failed', reason: 'provider_definitive_error' });
        })
        .mockImplementationOnce(async (opts: PlanAndActManagedOpts) => {
          opts.onMetrics?.({ durationMs: 10, inputTokens: 1, outputTokens: 1, costUsd: 0.001, toolCount: 1 });
          opts.onOutcome?.({ type: 'completed' });
          opts.onAction({ time: '10:02', text: 'Agent done: recovered', isLive: false });
        });
      const onUpdate = vi.fn();
      await runLazyBotMission(botMission({ model: 'claude-haiku-4-5' }), 'C:\\repo', { onUpdate });
      expect(planAndActManaged).toHaveBeenCalledTimes(2);
      expect(lastStatus(onUpdate)).toBe('done');
    });

    it('does NOT fail over when tools actually ran — the brain works, the task failed', async () => {
      nativeReady.mockReturnValue(true);
      planAndActManaged.mockImplementation(async (opts: PlanAndActManagedOpts) => {
        opts.onAction({ time: '10:00', text: 'Step 1: web_search', isLive: false });
        opts.onMetrics?.({ durationMs: 10, inputTokens: 5, outputTokens: 5, costUsd: 0.001, toolCount: 1 });
        opts.onOutcome?.({ type: 'failed', reason: 'consecutive_failures' });
      });
      const onUpdate = vi.fn();
      await runLazyBotMission(botMission({ model: 'claude-haiku-4-5' }), 'C:\\repo', { onUpdate });
      expect(planAndActManaged).toHaveBeenCalledTimes(1);
      expect(lastStatus(onUpdate)).toBe('failed');
    });

    it('does NOT fail over when the user stopped the run', async () => {
      nativeReady.mockReturnValue(true);
      let stopped = false;
      planAndActManaged.mockImplementation(async (opts: PlanAndActManagedOpts) => {
        opts.onMetrics?.({ durationMs: 10, inputTokens: 0, outputTokens: 0, costUsd: 0, toolCount: 0 });
        opts.onOutcome?.({ type: 'failed', reason: 'consecutive_failures' });
        stopped = true;
      });
      const onUpdate = vi.fn();
      await runLazyBotMission(botMission({ model: 'claude-haiku-4-5' }), 'C:\\repo', { onUpdate, stopSignal: () => stopped });
      expect(planAndActManaged).toHaveBeenCalledTimes(1);
      expect(lastStatus(onUpdate)).toBe('cancelled');
    });
  });
});

describe('resolveFallbackBrain / isBrainFailure', () => {
  it('picks another READY rail, never the one that just failed', async () => {
    nativeReady.mockReturnValue(true);
    const localFallback = resolveFallbackBrain('cli');
    expect(localFallback).toMatchObject({ rail: 'local' });
    await expectSalvagedWrapper(localFallback!.streamTurn, localStreamer);
    const cliFallback = resolveFallbackBrain('local');
    expect(cliFallback).toMatchObject({ rail: 'cli' });
    await expectSalvagedWrapper(cliFallback!.streamTurn, cliStreamer);
    expect(resolveFallbackBrain(new Set(['cli', 'local']))).toBeUndefined();
  });

  it('is a brain failure for provider/credits even mid-run; consecutive_failures only at 0 tools', () => {
    expect(isBrainFailure({ reason: 'consecutive_failures' }, { toolCount: 0 })).toBe(true);
    expect(isBrainFailure({ reason: 'provider_definitive_error' }, undefined)).toBe(true);
    expect(isBrainFailure({ reason: 'provider_definitive_error' }, { toolCount: 2 })).toBe(true);
    expect(isBrainFailure({ reason: 'no_credits' }, { toolCount: 0 })).toBe(true);
    expect(isBrainFailure({ reason: 'consecutive_failures' }, { toolCount: 2 })).toBe(false);
    expect(isBrainFailure({ reason: 'max_steps_exhausted' }, { toolCount: 0 })).toBe(false);
    expect(isBrainFailure(null, { toolCount: 0 })).toBe(false);
  });
});

describe('runMission — LazyBot divert', () => {
  it('sends a botId mission to the LazyBot runtime and never creates a worktree', async () => {
    nativeReady.mockReturnValue(true);
    simulateSuccessfulLoop('ok');
    const onUpdate = vi.fn();
    await runMission(botMission(), 'C:\\repo', { onUpdate });
    expect(createMissionWorktree).not.toHaveBeenCalled();
    expect(planAndActManaged).toHaveBeenCalledTimes(1);
    expect(lastStatus(onUpdate)).toBe('done');
  });
});
