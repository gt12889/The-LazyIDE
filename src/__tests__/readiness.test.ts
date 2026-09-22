import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the module that readiness.ts reads from so we can control its output.
vi.mock('../lib/models/cliBackendProvider', () => ({
  isCliBackendAvailable: vi.fn().mockReturnValue(null),
  CLI_BACKENDS: [],
  detectAllCliBackends: vi.fn(),
  cliBackendProvider: vi.fn(),
}));

import { isCliBackendAvailable } from '../lib/models/cliBackendProvider';
import {
  claudeCliReadiness,
  codexCliReadiness,
  localReadiness,
  getAllBackendsReadiness,
  activeBackendId,
} from '../lib/models/readiness';

const mockIsCliBackendAvailable = isCliBackendAvailable as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  mockIsCliBackendAvailable.mockReturnValue(null);
});

// ── claudeCliReadiness ─────────────────────────────────────────────

describe('claudeCliReadiness', () => {
  it('is ready when claude CLI is detected', () => {
    mockIsCliBackendAvailable.mockReturnValue(true);
    const r = claudeCliReadiness();
    expect(r.ready).toBe(true);
    expect(r.id).toBe('claude-code');
    expect(r.label).toBe('Claude Code (subscription)');
    expect(r.reason).toBeUndefined();
    expect(r.howToEnable).toBeUndefined();
  });

  it('is not ready when claude CLI is absent', () => {
    mockIsCliBackendAvailable.mockReturnValue(false);
    const r = claudeCliReadiness();
    expect(r.ready).toBe(false);
    expect(r.reason).toBe('claude binary not found on PATH.');
    expect(r.howToEnable).toMatch(/claude\.ai\/download/i);
  });

  it('is not ready (pending) when detection has not run yet (null)', () => {
    mockIsCliBackendAvailable.mockReturnValue(null);
    const r = claudeCliReadiness();
    expect(r.ready).toBe(false);
    expect(r.reason).toBe('Detecting CLIs...');
  });
});

// ── codexCliReadiness ─────────────────────────────────────────────

describe('codexCliReadiness', () => {
  it('is ready when codex CLI is detected', () => {
    mockIsCliBackendAvailable.mockImplementation((tool: string) =>
      tool === 'codex' ? true : null
    );
    const r = codexCliReadiness();
    expect(r.ready).toBe(true);
    expect(r.id).toBe('codex');
    expect(r.label).toBe('Codex CLI (OpenAI)');
    expect(r.reason).toBeUndefined();
    expect(r.howToEnable).toBeUndefined();
  });

  it('is not ready when codex CLI is absent', () => {
    mockIsCliBackendAvailable.mockReturnValue(false);
    const r = codexCliReadiness();
    expect(r.ready).toBe(false);
    expect(r.reason).toBe('codex binary not found on PATH.');
    expect(r.howToEnable).toMatch(/codex/i);
  });

  it('is not ready (pending) when detection has not run yet (null)', () => {
    mockIsCliBackendAvailable.mockReturnValue(null);
    const r = codexCliReadiness();
    expect(r.ready).toBe(false);
    expect(r.reason).toBe('Detecting CLIs...');
  });
});

// ── localReadiness ────────────────────────────────────────────────
// The local engine is optimistic: Ollama reachability is async and cannot
// be checked from these sync helpers, so it reports ready and lets the
// launch pipeline surface a refused connection loudly.

describe('localReadiness', () => {
  it('is always ready, regardless of CLI detection', () => {
    for (const detected of [true, false, null] as const) {
      mockIsCliBackendAvailable.mockReturnValue(detected);
      const r = localReadiness();
      expect(r.ready).toBe(true);
      expect(r.id).toBe('local');
      expect(r.reason).toBeUndefined();
    }
  });

  it('labels the Ollama / LM Studio engine with setup guidance', () => {
    const r = localReadiness();
    expect(r.label).toBe('Local LLM (Ollama / LM Studio)');
    expect(r.howToEnable).toMatch(/ollama serve/i);
  });
});

// ── getAllBackendsReadiness ────────────────────────────────────────

describe('getAllBackendsReadiness', () => {
  it('returns one descriptor per backend (2 CLI + local)', () => {
    const all = getAllBackendsReadiness();
    expect(all).toHaveLength(3);
  });

  it('returns descriptors with distinct ids in display order', () => {
    const all = getAllBackendsReadiness();
    expect(all.map(r => r.id)).toEqual(['claude-code', 'codex', 'local']);
  });
});

// ── activeBackendId ───────────────────────────────────────────────

describe('activeBackendId', () => {
  it.each([
    ['claude-code', 'claude-code'],
    ['codex', 'codex'],
    ['devin', 'devin'],
    ['local', 'local'],
    ['mock', 'mock'],
  ] as const)('maps mode %s to backend id %s', (mode, expected) => {
    expect(activeBackendId(mode)).toBe(expected);
  });
});
