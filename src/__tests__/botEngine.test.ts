/* botEngine.test.ts - unit tests for the LazyBot engine.
   The engine delegates mission creation to a createMission callback (the
   agents store's addMission) and only composes the bot persona/policy +
   tracks runtime state keyed by the REAL mission id. Bots run on LOCAL
   tools only — no cloud backend. */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  buildBotSystemPrompt,
  buildBotToolPolicy,
  launchBotRun,
  finishBotRun,
  stopBotRun,
  getBotRuntimeState,
  listActiveRunsForBot,
  resetBotEngineState,
  restoreBotRuntime,
  pruneBotRunsNotLive,
  toBotNewMissionInput,
  BOT_LOCAL_TOOLS,
  botIdForMission,
} from '../lib/bots/botEngine';
import type { BotMissionInput, BotConfig } from '../lib/bots/botTypes';
import { recordBotCost, resetBudgetGuard, setBotBudgetCap } from '../lib/bots/budgetGuard';
import { persistActiveRuns, setBotRuntimeRoot } from '../lib/bots/botRuntimeStore';

const runtimeFiles = new Map<string, string>();
vi.mock('../lib/platform', () => ({
  getPlatform: vi.fn(() => ({
    fs: {
      readFile: async (path: string) => {
        const c = runtimeFiles.get(path);
        if (c === undefined) throw new Error('ENOENT');
        return c;
      },
      writeFile: async (path: string, content: string) => { runtimeFiles.set(path, content); },
      createDir: async () => undefined,
    },
  })),
}));

function makeBot(overrides: Partial<BotConfig> = {}): BotConfig {
  return {
    id: 'bot_1',
    name: 'Test Bot',
    description: 'A test bot',
    systemPrompt: 'You are a test bot that browses the web.',
    autonomy: 'supervised',
    capabilities: { browser: true, desktop: true, sandbox: true, maxConcurrentSessions: 1 },
    routines: [],
    profileIds: [],
    enabled: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

/** Fake addMission: records the input and returns a fresh mission id. */
function makeFakeStore() {
  const created: BotMissionInput[] = [];
  let seq = 0;
  const createMission = async (input: BotMissionInput): Promise<string> => {
    created.push(input);
    seq += 1;
    return `M${seq}`;
  };
  return { created, createMission };
}

beforeEach(() => {
  vi.clearAllMocks();
  runtimeFiles.clear();
  resetBotEngineState();
  resetBudgetGuard();
  setBotRuntimeRoot('/repo');
});

describe('buildBotSystemPrompt', () => {
  it('includes the bot persona', () => {
    const bot = makeBot({ systemPrompt: 'You are a shopping assistant.' });
    const prompt = buildBotSystemPrompt(bot);
    expect(prompt).toContain('You are a shopping assistant.');
  });

  it('includes the BOT POLICY section with autonomy mode', () => {
    const bot = makeBot({ autonomy: 'manual' });
    const prompt = buildBotSystemPrompt(bot);
    expect(prompt).toContain('BOT POLICY');
    expect(prompt).toContain('MANUAL');
  });

  it('lists local browser and web tools (no cloud backend)', () => {
    const bot = makeBot();
    const prompt = buildBotSystemPrompt(bot);
    expect(prompt).toContain('browser_open');
    expect(prompt).toContain('web_search');
    expect(prompt).toContain('write_file');
  });

  it('capabilities no longer gate tools — every bot gets the same local set', () => {
    const bot = makeBot({ capabilities: { browser: false, desktop: false, sandbox: false, maxConcurrentSessions: 1 } });
    const prompt = buildBotSystemPrompt(bot);
    expect(prompt).toContain('browser_open');
    expect(prompt).toContain('web_search');
  });

  it('tells the bot to stop retrying and surface repeated service-side failures', () => {
    const bot = makeBot();
    const prompt = buildBotSystemPrompt(bot);
    expect(prompt).toContain('fails twice with a service-side error');
    expect(prompt).toContain('bot_request_intervention');
  });
});

describe('buildBotToolPolicy', () => {
  it('returns the full local set with no denied tools regardless of capabilities', () => {
    const bot = makeBot({ capabilities: { browser: false, desktop: false, sandbox: false, maxConcurrentSessions: 1 } });
    const { allowedTools, deniedTools } = buildBotToolPolicy(bot);
    expect(deniedTools).toEqual([]);
    for (const local of BOT_LOCAL_TOOLS) expect(allowedTools).toContain(local);
  });

  it('deniedTools is always empty (no cloud families to gate)', () => {
    const bot = makeBot();
    const { deniedTools } = buildBotToolPolicy(bot);
    expect(deniedTools).toEqual([]);
  });

  it('allows the documented local file tools', () => {
    const bot = makeBot();
    const { allowedTools } = buildBotToolPolicy(bot);
    expect(allowedTools).toContain('write_file');
    expect(allowedTools).toContain('read_file');
    expect(allowedTools).toContain('web_search');
    expect(allowedTools).toContain('browser_open');
  });

  it('never grants the local code-agent toolbox (a LazyBot is not a code agent)', () => {
    const { allowedTools } = buildBotToolPolicy(makeBot());
    for (const codeTool of ['edit_file', 'multi_edit', 'run_command', 'run_tests', 'git_commit', 'git_create_pr', 'delete_file', 'delegate']) {
      expect(allowedTools).not.toContain(codeTool);
    }
  });
});

describe('toBotNewMissionInput', () => {
  it('maps a bot mission onto a worktree-less, allowlisted agent mission', () => {
    const bot = makeBot();
    const policy = buildBotToolPolicy(bot);
    const out = toBotNewMissionInput({
      title: 'Test Bot: go',
      agentTask: 'go',
      agentName: bot.name,
      agentSystemPrompt: 'persona',
      allowedTools: policy.allowedTools,
      deniedTools: policy.deniedTools,
      botAutonomy: 'manual',
      botId: bot.id,
      modelLabel: 'claude-haiku-4-5',
    }, { originConversationId: 'conv-1' });
    expect(out).toMatchObject({
      repo: '.',
      worktree: '',
      agentName: 'Test Bot',
      allowedTools: policy.allowedTools,
      deniedTools: policy.deniedTools,
      botId: 'bot_1',
      botAutonomy: 'manual',
      modelLabel: 'claude-haiku-4-5',
      permissionMode: 'acceptEdits',
      orchestrator: false,
      originConversationId: 'conv-1',
    });
    expect(toBotNewMissionInput({ ...out, agentSystemPrompt: 'p', agentTask: 'go', title: 't', deniedTools: [], botAutonomy: 'yolo', botId: 'b', modelLabel: 'm' })).not.toHaveProperty('originConversationId');
  });
});

describe('launchBotRun', () => {
  it('delegates mission creation to createMission with the composed bot input', async () => {
    const store = makeFakeStore();
    const bot = makeBot({ autonomy: 'yolo' });
    const run = await launchBotRun(bot, 'Check prices', {
      createMission: store.createMission,
      model: 'test-model',
    });
    expect(store.created).toHaveLength(1);
    const input = store.created[0]!;
    expect(input.agentTask).toBe('Check prices');
    expect(input.title).toContain('Test Bot');
    expect(input.agentSystemPrompt).toContain('You are a test bot');
    expect(input.agentSystemPrompt).toContain('YOLO');
    expect(input.botAutonomy).toBe('yolo');
    expect(input.botId).toBe('bot_1');
    expect(input.modelLabel).toBe('test-model');
    expect(input.deniedTools).toEqual([]);
    expect(input.agentName).toBe('Test Bot');
    expect(input.allowedTools).toContain('browser_open');
    expect(input.allowedTools).toContain('write_file');
    expect(input.allowedTools).not.toContain('run_command');
    expect(run.missionId).toBe('M1');
    expect(run.id).toBe('run_M1');
    expect(run.status).toBe('running');
    expect(botIdForMission(run.missionId)).toBe('bot_1');
  });

  it('does not throw at 90% budget — only a true cap crossing blocks launch', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    setBotBudgetCap('bot_1', 10);
    recordBotCost('bot_1', 9.1);
    const store = makeFakeStore();
    await expect(launchBotRun(makeBot(), 'task', { createMission: store.createMission, model: 'm' })).resolves.toMatchObject({ status: 'running' });
    expect(store.created).toHaveLength(1);
    warn.mockRestore();
  });

  it('throws when the budget cap is exceeded', async () => {
    setBotBudgetCap('bot_1', 1);
    recordBotCost('bot_1', 1);
    await expect(launchBotRun(makeBot(), 'task', { createMission: async () => 'M1', model: 'm' })).rejects.toThrow(/Budget exceeded/);
  });

  it('refuses a launch past maxConcurrentSessions', async () => {
    const store = makeFakeStore();
    const bot = makeBot({ capabilities: { browser: true, desktop: false, sandbox: false, maxConcurrentSessions: 1 } });
    await launchBotRun(bot, 'one', { createMission: store.createMission, model: 'm' });
    await expect(launchBotRun(bot, 'two', { createMission: store.createMission, model: 'm' })).rejects.toThrow(/concurrent/);
  });

  it('refuses a concurrent double-launch race before createMission settles', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    let n = 0;
    const createMission = async () => {
      await gate;
      return `M${++n}`;
    };
    const bot = makeBot({ capabilities: { browser: true, desktop: false, sandbox: false, maxConcurrentSessions: 1 } });
    const p1 = launchBotRun(bot, 'one', { createMission, model: 'm' });
    const p2 = launchBotRun(bot, 'two', { createMission, model: 'm' });
    release();
    const results = await Promise.allSettled([p1, p2]);
    const ok = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');
    expect(ok).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(String((rejected[0] as PromiseRejectedResult).reason)).toMatch(/concurrent/);
  });

  it('refuses a second launch when a reservation has been pending for >30s', async () => {
    vi.useFakeTimers();
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const createMission = async () => {
      await gate;
      return 'M1';
    };
    const bot = makeBot({ capabilities: { browser: true, desktop: false, sandbox: false, maxConcurrentSessions: 1 } });
    const p1 = launchBotRun(bot, 'one', { createMission, model: 'm' });
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(31_000);
    await expect(launchBotRun(bot, 'two', { createMission, model: 'm' })).rejects.toThrow(/concurrent/);
    release();
    await p1;
    vi.useRealTimers();
  });

  it('deniedTools is empty — no cloud families to deny', async () => {
    const store = makeFakeStore();
    const bot = makeBot({ capabilities: { browser: false, desktop: false, sandbox: false, maxConcurrentSessions: 1 } });
    await launchBotRun(bot, 'task', { createMission: store.createMission, model: 'm' });
    expect(store.created[0]!.deniedTools).toEqual([]);
  });

  it('tracks the run in runtime state keyed by the real mission id', async () => {
    const store = makeFakeStore();
    const bot = makeBot();
    const run = await launchBotRun(bot, 'task', { createMission: store.createMission, model: 'm' });
    const state = getBotRuntimeState(bot.id);
    expect(state.activeRuns).toContain(run.missionId);
    expect(listActiveRunsForBot(bot.id).map((r) => r.missionId)).toEqual([run.missionId]);
  });
});

describe('finishBotRun', () => {
  it('clears the run from active state', async () => {
    const store = makeFakeStore();
    const bot = makeBot();
    const run = await launchBotRun(bot, 'task', { createMission: store.createMission, model: 'm' });
    await finishBotRun(run.missionId);
    const state = getBotRuntimeState(bot.id);
    expect(state.activeRuns).not.toContain(run.missionId);
    expect(listActiveRunsForBot(bot.id)).toEqual([]);
  });

  it('is a no-op for an unknown mission id (both chain paths call it)', async () => {
    await expect(finishBotRun('M404')).resolves.toBeUndefined();
  });
});

describe('stopBotRun', () => {
  it('removes the run from active state', async () => {
    const store = makeFakeStore();
    const bot = makeBot();
    const run = await launchBotRun(bot, 'task', { createMission: store.createMission, model: 'm' });
    await stopBotRun(run);
    const state = getBotRuntimeState(bot.id);
    expect(state.activeRuns).not.toContain(run.missionId);
    expect(listActiveRunsForBot(bot.id)).toEqual([]);
  });
});

describe('restoreBotRuntime', () => {
  it('rehydrates active runs from disk after a crash', async () => {
    await persistActiveRuns([{
      id: 'run_M9', botId: 'bot_1', missionId: 'M9', status: 'running',
      startedAt: '2026-01-01T00:00:00.000Z',
    }]);
    resetBotEngineState();
    expect(listActiveRunsForBot('bot_1')).toEqual([]);
    await restoreBotRuntime();
    expect(listActiveRunsForBot('bot_1').map((r) => r.missionId)).toEqual(['M9']);
    expect(botIdForMission('M9')).toBe('bot_1');
  });
});

describe('restoreBotRuntime / pruneBotRunsNotLive serialization', () => {
  it('does not leave a zombie in memory when restore and prune run concurrently', async () => {
    await persistActiveRuns([{
      id: 'run_MZ', botId: 'bot_1', missionId: 'MZ', status: 'running',
      startedAt: '2026-01-01T00:00:00.000Z',
    }]);
    resetBotEngineState();
    const live = new Set<string>();
    await Promise.all([
      restoreBotRuntime(),
      pruneBotRunsNotLive(live),
    ]);
    expect(listActiveRunsForBot('bot_1')).toEqual([]);
    expect(botIdForMission('MZ')).toBeUndefined();
  });

  it('keeps a genuinely live run when restore and prune run concurrently', async () => {
    await persistActiveRuns([{
      id: 'run_ML', botId: 'bot_1', missionId: 'ML', status: 'running',
      startedAt: '2026-01-01T00:00:00.000Z',
    }]);
    resetBotEngineState();
    const live = new Set<string>(['ML']);
    await Promise.all([
      restoreBotRuntime(),
      pruneBotRunsNotLive(live),
    ]);
    expect(listActiveRunsForBot('bot_1').map((r) => r.missionId)).toEqual(['ML']);
    expect(botIdForMission('ML')).toBe('bot_1');
  });

  it('serializes: prune does not run until a prior restore completes', async () => {
    await persistActiveRuns([{
      id: 'run_MW', botId: 'bot_1', missionId: 'MW', status: 'running',
      startedAt: '2026-01-01T00:00:00.000Z',
    }]);
    resetBotEngineState();
    const live = new Set<string>();
    const restoreP = restoreBotRuntime();
    const pruneP = pruneBotRunsNotLive(live);
    const [restoredCount, cleared] = await Promise.all([restoreP, pruneP]);
    expect(restoredCount).toBeGreaterThanOrEqual(1);
    expect(cleared).toBe(1);
    expect(listActiveRunsForBot('bot_1')).toEqual([]);
  });
});
