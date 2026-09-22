import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// NOTE: models/index.ts imports Tauri directly at the top-level via invoke.
// The global setup.ts already mocks @tauri-apps/api/core, so imports succeed.
// We test the pure/stateless helpers; getProvider() uses module-level state
// so we test routing logic by checking the exported pure functions.

import {
  loadAccessSettings,
  saveAccessSettings,
  getProviderMode,
  getProvider,
  describeProviderReadiness,
  getDefaultModelIdForMode,
  getActiveModel,
} from '../lib/models/index';
import { DEFAULT_MODEL, findModelById } from '../lib/models/registry';
import { DEFAULT_LOCAL_MODEL_ID } from '../lib/models/localProvider';
import { DEFAULT_DEVIN_MODEL_ID, findDevinModel } from '../lib/models/devinCatalog';

// localStorage is provided by jsdom
beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
});

describe('loadAccessSettings / saveAccessSettings', () => {
  it('loadAccessSettings returns empty object when nothing is stored', () => {
    const settings = loadAccessSettings();
    expect(settings).toEqual({});
  });

  it('saveAccessSettings + loadAccessSettings roundtrip', () => {
    saveAccessSettings({ accessMode: 'cli', cliTool: 'codex' });
    const loaded = loadAccessSettings();
    expect(loaded.accessMode).toBe('cli');
    expect(loaded.cliTool).toBe('codex');
  });

  it('saveAccessSettings overwrites previous value', () => {
    saveAccessSettings({ accessMode: 'cli', cliTool: 'claude' });
    saveAccessSettings({ accessMode: 'local' });
    const loaded = loadAccessSettings();
    expect(loaded.accessMode).toBe('local');
    expect(loaded.cliTool).toBeUndefined();
  });

  it('migrates the legacy lazy.accessSettings key once, then removes it', () => {
    localStorage.setItem(
      'lazy.accessSettings',
      JSON.stringify({ accessMode: 'cli', cliTool: 'codex', model: 'claude-opus-5' }),
    );

    const loaded = loadAccessSettings();

    expect(loaded).toEqual({ accessMode: 'cli', cliTool: 'codex', model: 'claude-opus-5' });
    expect(localStorage.getItem('lazy.accessSettings')).toBeNull();
    expect(localStorage.getItem('forge.accessSettings')).not.toBeNull();
  });

  it('legacy migration drops modes that no longer exist (byok/pro collapse to auto-detect)', () => {
    localStorage.setItem(
      'lazy.accessSettings',
      JSON.stringify({ accessMode: 'byok', model: 'claude-opus-5' }),
    );

    const loaded = loadAccessSettings();

    expect(loaded.accessMode).toBeUndefined();
    expect(loaded.model).toBe('claude-opus-5');
  });
});

describe('getProviderMode', () => {
  it('returns "mock" when not in Tauri runtime (jsdom)', () => {
    // No __TAURI_INTERNALS__ in jsdom → should return "mock"
    const mode = getProviderMode();
    expect(mode).toBe('mock');
  });

  it('returns "mock" regardless of accessSettings when not in Tauri', () => {
    saveAccessSettings({ accessMode: 'cli', cliTool: 'claude' });
    const mode = getProviderMode();
    expect(mode).toBe('mock');
  });
});

describe('cliBackendProvider factory', () => {
  it('claude backend listModels returns only anthropic models', async () => {
    // Import dynamically to get the actual function (Tauri already mocked)
    const { cliBackendProvider } = await import('../lib/models/cliBackendProvider');
    const provider = cliBackendProvider('claude');
    const models = provider.listModels();
    expect(models.every(m => m.provider === 'anthropic')).toBe(true);
    // Non-emptiness guard: `every()` on an empty array is vacuously true, so
    // without this an accidental empty ALL_MODELS/claude filter would still
    // pass the assertion above. This is the exact shape of bug that let the
    // codex assertion below stay green while listModels('codex') silently
    // always returned [] (see that test's comment).
    expect(models.length).toBeGreaterThan(0);
  });

  it('codex backend listModels returns [] — Codex has no in-app model catalog', async () => {
    const { cliBackendProvider } = await import('../lib/models/cliBackendProvider');
    const provider = cliBackendProvider('codex');
    const models = provider.listModels();
    // Documented, intentional contract (see cliBackendProvider.ts's
    // listModels doc comment and modelPickerOptions.ts's
    // MODEL_MANAGED_BY_CODEX_MESSAGE) — NOT a bug: ALL_MODELS is
    // Anthropic-only (registry.ts's module comment), so there is no OpenAI
    // catalog to filter down to; the Codex CLI manages its own model
    // selection. The PREVIOUS assertion here was
    // `models.every(m => m.provider === 'openai')`, which is vacuously true
    // for an empty array — it could never fail even while this always
    // silently returned []. Asserting the exact expected value instead means
    // this test actually fails if someone changes the contract (e.g. by
    // fabricating fake OpenAI entries in the registry).
    expect(models).toEqual([]);
  });

  it('devin backend listModels returns the Devin catalog', async () => {
    const { cliBackendProvider } = await import('../lib/models/cliBackendProvider');
    const provider = cliBackendProvider('devin');
    const models = provider.listModels();
    expect(models.length).toBeGreaterThan(0);
    expect(models.every(m => m.provider === 'devin')).toBe(true);
    expect(models.some(m => m.id === DEFAULT_DEVIN_MODEL_ID)).toBe(true);
  });

  it('isCliBackendAvailable returns null before detectAllCliBackends is called', async () => {
    const { isCliBackendAvailable } = await import('../lib/models/cliBackendProvider');
    // Before detection, should be null (not yet checked)
    const result = isCliBackendAvailable('claude');
    // Either null (not checked) or false (Tauri invoke mock returned undefined)
    expect(result === null || result === false).toBe(true);
  });
});

describe('describeProviderReadiness', () => {
  it('is not ready in a non-Tauri (mock) context', () => {
    const r = describeProviderReadiness();
    expect(r.ready).toBe(false);
    expect(r.reason).toMatch(/No engine detected/);
  });

  it('mock-mode reason points at Ollama or a CLI tool in Settings > Models', () => {
    const r = describeProviderReadiness('mock');
    expect(r.ready).toBe(false);
    expect(r.reason).toMatch(/Ollama|Claude Code \/ Codex/);
    expect(r.reason).toMatch(/Settings > Models/);
  });

  it('mock-mode reason uses the translator when one is supplied', () => {
    const r = describeProviderReadiness('mock', (key) => `t:${key}`);
    expect(r.ready).toBe(false);
    expect(r.reason).toBe('t:models.readiness.noEngine');
  });

  it.each(['claude-code', 'codex', 'devin', 'local'] as const)('is ready when the %s engine is active', (mode) => {
    const r = describeProviderReadiness(mode);
    expect(r.ready).toBe(true);
    expect(r.reason).toBeUndefined();
  });
});

// ── getProviderMode with Tauri runtime ───────────────────────────

describe('getProviderMode (Tauri runtime simulation)', () => {
  afterEach(() => {
    // Remove the Tauri marker we added
    delete (window as unknown as Record<string, unknown>)['__TAURI_INTERNALS__'];
    localStorage.clear();
  });

  function simulateTauri(): void {
    (window as unknown as Record<string, unknown>)['__TAURI_INTERNALS__'] = {};
  }

  it('returns "claude-code" when accessMode is "cli" with the default tool', () => {
    simulateTauri();
    saveAccessSettings({ accessMode: 'cli', cliTool: 'claude' });
    expect(getProviderMode()).toBe('claude-code');
  });

  it('returns "codex" when accessMode is "cli" with cliTool "codex"', () => {
    simulateTauri();
    saveAccessSettings({ accessMode: 'cli', cliTool: 'codex' });
    expect(getProviderMode()).toBe('codex');
  });

  it('returns "devin" when accessMode is "cli" with cliTool "devin"', () => {
    simulateTauri();
    saveAccessSettings({ accessMode: 'cli', cliTool: 'devin' });
    expect(getProviderMode()).toBe('devin');
  });

  it('returns "local" when accessMode is "local"', () => {
    simulateTauri();
    saveAccessSettings({ accessMode: 'local' });
    expect(getProviderMode()).toBe('local');
  });

  it('returns "local" when a local model id is persisted (explicit local routing)', () => {
    simulateTauri();
    saveAccessSettings({ model: 'local/hermes3' });
    expect(getProviderMode()).toBe('local');
  });

  it('returns "claude-code" in auto mode before detection settles (benefit of the doubt)', () => {
    simulateTauri();
    localStorage.clear();
    expect(getProviderMode()).toBe('claude-code');
  });
});

// ── getProvider with Tauri runtime ───────────────────────────────

describe('getProvider (Tauri runtime simulation)', () => {
  afterEach(() => {
    delete (window as unknown as Record<string, unknown>)['__TAURI_INTERNALS__'];
    localStorage.clear();
  });

  function simulateTauri(): void {
    (window as unknown as Record<string, unknown>)['__TAURI_INTERNALS__'] = {};
  }

  it('returns the mock provider outside Tauri', () => {
    const provider = getProvider();
    expect(provider.id).toBe('mock');
  });

  it('returns cli provider when accessMode is "cli"', () => {
    simulateTauri();
    saveAccessSettings({ accessMode: 'cli', cliTool: 'claude' });
    const provider = getProvider();
    // cliBackendProvider('claude') has id 'cli-claude'
    expect(provider.id).toBe('cli-claude');
  });

  it('returns the local provider when accessMode is "local"', () => {
    simulateTauri();
    saveAccessSettings({ accessMode: 'local' });
    const provider = getProvider();
    expect(provider.id).toBe('local');
  });

  it('routes a picked Devin-catalog id through the Devin backend whatever the ambient mode is', () => {
    simulateTauri();
    saveAccessSettings({ model: 'swe-2-medium' });
    const provider = getProvider();
    expect(provider.id).toBe('cli-devin');
  });
});

// ── getDefaultModelIdForMode ──────────────────────────────────────
// The single source of truth for "which model should we start with before
// the user picks one" — mirrors NewMissionModal's getInitialModelId() so
// every "pick a starting model for the current mode" call site agrees.

describe('getDefaultModelIdForMode', () => {
  it('returns the Devin default id in "devin" mode', () => {
    expect(getDefaultModelIdForMode('devin')).toBe(DEFAULT_DEVIN_MODEL_ID);
  });

  it('returns the local default id in "local" mode', () => {
    expect(getDefaultModelIdForMode('local')).toBe(DEFAULT_LOCAL_MODEL_ID);
  });

  it('returns the native Anthropic default id in "claude-code" mode', () => {
    expect(getDefaultModelIdForMode('claude-code')).toBe(DEFAULT_MODEL.id);
  });

  // 'codex' is deliberately NOT the same as claude-code/mock: the
  // registry (ALL_MODELS/DEFAULT_MODEL) is Anthropic-only (see registry.ts's
  // module comment), so there is no real "codex default model id" in there.
  // Returning DEFAULT_MODEL.id used to silently forward an Anthropic model
  // id to the OpenAI Codex CLI via agent_cli_chat_stream
  // (cliBackendProvider.ts) — a genuine cross-provider mismatch this
  // resolves.
  it('returns an empty id (never an Anthropic id) in "codex" mode — the Codex CLI picks its own default', () => {
    expect(getDefaultModelIdForMode('codex')).toBe('');
  });

  it('the "codex" empty id is never one of the Anthropic registry ids', () => {
    const anthropicIds = new Set(
      ['claude-opus-5', 'claude-fable-5', 'claude-sonnet-5', 'claude-haiku-4-5'],
    );
    const codexId = getDefaultModelIdForMode('codex');
    expect(codexId === undefined || !anthropicIds.has(codexId)).toBe(true);
  });

  it('returns the native Anthropic default id in "mock" mode', () => {
    expect(getDefaultModelIdForMode('mock')).toBe(DEFAULT_MODEL.id);
  });
});

// ── getActiveModel ──────────────────────────────────────────────────
// The fix for DEFECT #1 (real-app QA): InlineEditBar, autoFix, AiReview and
// SettingsPanel used to hardcode 'claude-sonnet-4-20250514' — a stale id the
// Claude Code CLI subscription path rejects outright ("may not exist or you
// may not have access to it"), so Ctrl+K inline-edit never produced a diff.
// getActiveModel() replaces every one of those literals; it must resolve
// exactly like the working Ask composer does so every AI feature agrees on
// "the active model" instead of each hardcoding its own id.

describe('getActiveModel', () => {
  it('defaults to DEFAULT_MODEL (Haiku) when no override is persisted — the same default the Ask composer starts with', () => {
    expect(getActiveModel()).toEqual(DEFAULT_MODEL);
  });

  it('never returns the stale hardcoded literal that broke inline-edit under Claude Code CLI', () => {
    expect(getActiveModel().id).not.toBe('claude-sonnet-4-20250514');
  });

  it('honors a persisted native model id (CLI id namespace)', () => {
    saveAccessSettings({ model: 'claude-opus-5' });
    expect(getActiveModel()).toEqual(findModelById('claude-opus-5'));
  });

  it('falls back to DEFAULT_MODEL when the persisted id is unknown (e.g. removed from the registry)', () => {
    saveAccessSettings({ model: 'gpt-999-does-not-exist' });
    expect(getActiveModel()).toEqual(DEFAULT_MODEL);
  });

  describe('codex mode (Tauri runtime simulation)', () => {
    afterEach(() => {
      delete (window as unknown as Record<string, unknown>)['__TAURI_INTERNALS__'];
      localStorage.clear();
    });

    function simulateTauri(): void {
      (window as unknown as Record<string, unknown>)['__TAURI_INTERNALS__'] = {};
    }

    it('returns the Codex-managed sentinel (empty id), never a persisted or default native id', () => {
      simulateTauri();
      saveAccessSettings({ accessMode: 'cli', cliTool: 'codex', model: 'claude-opus-5' });
      const active = getActiveModel();
      expect(active.id).toBe('');
      expect(active.provider).toBe('openai');
    });
  });

  describe('local mode (Tauri runtime simulation)', () => {
    afterEach(() => {
      delete (window as unknown as Record<string, unknown>)['__TAURI_INTERNALS__'];
      localStorage.clear();
    });

    function simulateTauri(): void {
      (window as unknown as Record<string, unknown>)['__TAURI_INTERNALS__'] = {};
    }

    it('resolves the local default when no model is persisted', () => {
      simulateTauri();
      saveAccessSettings({ accessMode: 'local' });
      const active = getActiveModel();
      expect(active.id).toBe(DEFAULT_LOCAL_MODEL_ID);
      expect(active.provider).toBe('local');
    });

    it('honors a persisted local model id', () => {
      simulateTauri();
      saveAccessSettings({ accessMode: 'local', model: 'local/mymodel' });
      const active = getActiveModel();
      expect(active.id).toBe('local/mymodel');
      expect(active.provider).toBe('local');
    });
  });

  describe('devin mode (Tauri runtime simulation)', () => {
    afterEach(() => {
      delete (window as unknown as Record<string, unknown>)['__TAURI_INTERNALS__'];
      localStorage.clear();
    });

    function simulateTauri(): void {
      (window as unknown as Record<string, unknown>)['__TAURI_INTERNALS__'] = {};
    }

    it('resolves the Devin catalog default when no model is persisted', () => {
      simulateTauri();
      saveAccessSettings({ accessMode: 'cli', cliTool: 'devin' });
      const active = getActiveModel();
      expect(active.id).toBe(DEFAULT_DEVIN_MODEL_ID);
      expect(findDevinModel(active.id)).toBeDefined();
    });

    it('honors a persisted Devin model id', () => {
      simulateTauri();
      saveAccessSettings({ accessMode: 'cli', cliTool: 'devin', model: 'swe-2-high' });
      const active = getActiveModel();
      expect(active.id).toBe('swe-2-high');
    });
  });
});
