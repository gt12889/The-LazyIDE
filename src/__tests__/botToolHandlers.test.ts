import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { emit, on } from '../lib/bus';
import {
  remapBotDeliverablePath,
  registerBotToolHandlers,
  resetBotToolHandlers,
  handleBotRequestIntervention,
} from '../lib/bots/botToolHandlers';
import { getTool } from '../lib/agents/toolRegistry';
import { toolHandlers } from '../lib/tools/handlers/index';
import { botIdForMission, registerBotRun, resetBotEngineState } from '../lib/bots/botEngine';
import { resetInterventions } from '../lib/bots/botRequestIntervention';

vi.mock('../lib/bus', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/bus')>();
  return { ...actual, emit: vi.fn(actual.emit) };
});

describe('remapBotDeliverablePath', () => {
  it('prefixes relative writes under .lazy/bot-deliverables/<botId>/', () => {
    expect(remapBotDeliverablePath('bot_1', 'scrape-result.txt')).toBe('.lazy/bot-deliverables/bot_1/scrape-result.txt');
    expect(remapBotDeliverablePath('bot_1', 'notes/out.md')).toBe('.lazy/bot-deliverables/bot_1/notes/out.md');
  });

  it('does not double-prefix an already-remapped path', () => {
    const p = '.lazy/bot-deliverables/bot_1/out.txt';
    expect(remapBotDeliverablePath('bot_1', p)).toBe(p);
  });
});

describe('bot_* registry tools', () => {
  it('registers bot_request_intervention and bot_handoff', () => {
    expect(getTool('bot_request_intervention')?.name).toBe('bot_request_intervention');
    expect(getTool('bot_handoff')?.name).toBe('bot_handoff');
  });
});

describe('bot tool handler wiring', () => {
  const originalAskUser = toolHandlers.ask_user;

  beforeEach(() => {
    vi.mocked(emit).mockClear();
    resetBotEngineState();
    resetInterventions();
    resetBotToolHandlers();
    toolHandlers.ask_user = vi.fn(async () => 'Waiting for user input…');
    registerBotRun('bot_1', 'M1');
    registerBotToolHandlers();
  });

  afterEach(() => {
    resetBotToolHandlers();
    toolHandlers.ask_user = originalAskUser;
    resetBotEngineState();
    resetInterventions();
  });

  it('bot_request_intervention emits bot:intervention for the owning bot', async () => {
    const seen: unknown[] = [];
    const off = on('bot:intervention', (p) => { seen.push(p); });
    const msg = await handleBotRequestIntervention(
      { reason: 'login', detail: 'https://example.com/login' },
      { missionId: 'M1' } as never,
    );
    off();
    expect(msg).toMatch(/Intervention requested/);
    expect(vi.mocked(emit)).toHaveBeenCalledWith(
      'bot:intervention',
      expect.objectContaining({ botId: 'bot_1', reason: 'login', detail: 'https://example.com/login' }),
    );
    expect(seen).toHaveLength(1);
  });

  it('ask_user on a bot mission also lights the manager-header intervention channel', async () => {
    await toolHandlers.ask_user({ question: 'Which account?' }, { missionId: 'M1' } as never);
    expect(vi.mocked(emit)).toHaveBeenCalledWith(
      'bot:intervention',
      expect.objectContaining({ botId: 'bot_1', reason: 'ask_user', detail: 'Which account?' }),
    );
  });

  it('write_file on a bot mission remaps into the bot deliverables silo', async () => {
    const inner = vi.fn(async () => 'ok');
    toolHandlers.write_file = inner as never;
    // Re-register so the wrapper captures the current inner handler.
    resetBotToolHandlers();
    toolHandlers.write_file = inner as never;
    registerBotToolHandlers();
    await toolHandlers.write_file({ path: 'out.txt', content: 'hi' }, { missionId: 'M1' } as never);
    expect(inner).toHaveBeenCalledWith(
      expect.objectContaining({ path: '.lazy/bot-deliverables/bot_1/out.txt' }),
      expect.anything(),
    );
  });

  it('ignores unknown missions for bot ownership', () => {
    expect(botIdForMission('M1')).toBe('bot_1');
    expect(botIdForMission('M-other')).toBeUndefined();
  });
});
