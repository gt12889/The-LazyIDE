/* botRunModel.test.ts — which brain a LazyBot run gets, per rail readiness.
   Rails are 'cli' | 'local' only (Forge: no hosted/BYOK). Readiness is mocked
   at the source modules (runtime.ts for the CLI check) so each case states
   exactly which rails the "user" has. */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../lib/agents/runtime', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/agents/runtime')>();
  return {
    ...actual,
    isNativeModelReady: vi.fn(() => false),
  };
});

vi.mock('../lib/agents/cliAgentTurnStreamer', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/agents/cliAgentTurnStreamer')>();
  return {
    ...actual,
    resolveCliEngineMode: vi.fn(() => 'claude-code'),
  };
});

import { isNativeModelReady } from '../lib/agents/runtime';
import { resolveCliEngineMode } from '../lib/agents/cliAgentTurnStreamer';
import { DEFAULT_LOCAL_MODEL_ID } from '../lib/models/localProvider';
import { DEFAULT_MODEL } from '../lib/models/registry';
import { DEFAULT_DEVIN_MODEL_ID } from '../lib/models/devinCatalog';
import {
  applyTierHintWithinRail,
  classifyBotModelRail,
  firstReadyRailDefault,
  isExactBotModelId,
  resolveLazyBotRunModel,
} from '../lib/bots/botRunModel';

const nativeReady = isNativeModelReady as unknown as ReturnType<typeof vi.fn>;
const cliMode = resolveCliEngineMode as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  nativeReady.mockReturnValue(false);
  cliMode.mockReturnValue('claude-code');
});

describe('classifyBotModelRail', () => {
  it('maps a native Claude id to cli and a local/ id to local', () => {
    expect(classifyBotModelRail('claude-sonnet-5')).toBe('cli');
    expect(classifyBotModelRail('local/hermes3')).toBe('local');
  });

  it('maps a Devin catalog id to cli (same CLI text streamer family)', () => {
    expect(classifyBotModelRail(DEFAULT_DEVIN_MODEL_ID)).toBe('cli');
  });

  it('returns undefined for unknown ids', () => {
    expect(classifyBotModelRail('some-unknown-model')).toBe('cli');
  });

  it('treats an empty id as the codex CLI default only in codex mode', () => {
    expect(classifyBotModelRail('')).toBeUndefined();
    cliMode.mockReturnValue('codex');
    expect(classifyBotModelRail('')).toBe('cli');
  });

  it('treats an empty id as the devin CLI default in devin mode', () => {
    cliMode.mockReturnValue('devin');
    expect(classifyBotModelRail('')).toBe('cli');
  });
});

describe('resolveLazyBotRunModel', () => {
  it('honors the requested model when its rail is ready (no note)', () => {
    nativeReady.mockReturnValue(true);
    expect(resolveLazyBotRunModel('claude-sonnet-5', ['local/hermes3'])).toEqual({
      model: 'claude-sonnet-5',
      rail: 'cli',
      note: undefined,
    });
  });

  it('honors a requested local model (local rail is always ready)', () => {
    const r = resolveLazyBotRunModel('local/hermes3', []);
    expect(r.rail).toBe('local');
    expect(r.model).toBe('local/hermes3');
  });

  it('falls through to the first READY fallback and explains the substitution', () => {
    nativeReady.mockReturnValue(false);
    const r = resolveLazyBotRunModel('claude-haiku-4-5', ['local/hermes3']);
    expect(r).toMatchObject({ model: 'local/hermes3', rail: 'local' });
    expect(r.note).toContain('claude-haiku-4-5');
  });

  it('never sends a bot to the CLI rail when no CLI is detected — picks local default', () => {
    nativeReady.mockReturnValue(false);
    const r = resolveLazyBotRunModel(undefined, ['claude-haiku-4-5']);
    expect(r).toMatchObject({ model: DEFAULT_LOCAL_MODEL_ID, rail: 'local' });
    expect(r.note).toContain('CLI');
  });

  it('uses the codex CLI default (empty id) when codex is the CLI tool', () => {
    cliMode.mockReturnValue('codex');
    nativeReady.mockReturnValue(true);
    expect(resolveLazyBotRunModel(undefined, [''])).toMatchObject({ model: '', rail: 'cli' });
  });

  it('lands on local with an honest note when the CLI rail is not usable', () => {
    const r = resolveLazyBotRunModel('claude-sonnet-5', []);
    expect(r).toMatchObject({ model: DEFAULT_LOCAL_MODEL_ID, rail: 'local' });
    expect(r.note).toContain('CLI');
    expect(r.note).toContain(DEFAULT_LOCAL_MODEL_ID);
  });

  it('treats a bare tier word as a hint within the manager rail, never as a rail switch', () => {
    nativeReady.mockReturnValue(true);
    const r = resolveLazyBotRunModel('haiku', ['claude-sonnet-5']);
    expect(r).toMatchObject({ rail: 'cli' });
    expect(r.note).toContain('haiku');
  });

  it('applies a tier hint inside the native catalog when the manager is on the CLI', () => {
    nativeReady.mockReturnValue(true);
    const r = resolveLazyBotRunModel('opus', ['claude-sonnet-5']);
    expect(r).toMatchObject({ model: 'claude-opus-5', rail: 'cli' });
  });

  it('keeps a local model unchanged when a tier hint is applied on the local rail', () => {
    const r = resolveLazyBotRunModel('haiku', ['local/hermes3']);
    expect(r).toMatchObject({ model: 'local/hermes3', rail: 'local' });
  });
});

describe('isExactBotModelId / applyTierHintWithinRail', () => {
  it('knows exact ids from every catalog and rejects bare tier words', () => {
    expect(isExactBotModelId(DEFAULT_MODEL.id)).toBe(true);
    expect(isExactBotModelId('local/hermes3')).toBe(true);
    expect(isExactBotModelId(DEFAULT_DEVIN_MODEL_ID)).toBe(true);
    expect(isExactBotModelId('haiku')).toBe(false);
    expect(isExactBotModelId('Claude Sonnet 5')).toBe(false);
    expect(isExactBotModelId(undefined)).toBe(false);
  });

  it('leaves local models untouched and ignores non-tier hints', () => {
    expect(applyTierHintWithinRail('haiku', { model: 'local/hermes3', rail: 'local' })).toBe('local/hermes3');
    expect(applyTierHintWithinRail('fast please', { model: 'claude-sonnet-5', rail: 'cli' })).toBe('claude-sonnet-5');
  });
});

describe('firstReadyRailDefault (brain failover source)', () => {
  it('prefers CLI when ready, else local', () => {
    nativeReady.mockReturnValue(true);
    expect(firstReadyRailDefault()).toMatchObject({ rail: 'cli' });
    expect(firstReadyRailDefault('cli')).toMatchObject({ rail: 'local', model: DEFAULT_LOCAL_MODEL_ID });
  });

  it('falls to local when CLI is not ready', () => {
    nativeReady.mockReturnValue(false);
    expect(firstReadyRailDefault()).toMatchObject({ rail: 'local', model: DEFAULT_LOCAL_MODEL_ID });
  });

  it('returns undefined when every rail is excluded', () => {
    expect(firstReadyRailDefault(new Set(['cli', 'local']))).toBeUndefined();
  });
});
