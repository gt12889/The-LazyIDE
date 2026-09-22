/**
 * modelPickerOptions.test.ts
 *
 * Unit coverage for the shared entitlement -> model options helper used by
 * LazyManager, the New Mission modal, and the assistant Composer (see
 * modelPickerOptions.ts's header: those three pickers used to each derive
 * their option list from getProviderMode() — a single resolved,
 * mutually-exclusive mode — so a user holding BOTH a Claude subscription
 * and a Devin CLI at once only ever saw one catalog).
 *
 * Forge: local-first. Offered groups are the local Ollama model
 * (unconditional) plus the detected CLI backends' catalogs (Claude
 * subscription, Devin CLI). There is no hosted catalog, no free tier, no
 * upsell group.
 *
 * Two layers are tested separately:
 *   - buildModelPickerOptions() — pure, given a synthetic entitlements
 *     snapshot. Covers the required combinations: claude-only,
 *     devin-only, both, neither (local only).
 *   - detectModelEntitlements()/getModelPickerOptions() — live detection,
 *     mirroring entitlement.test.ts's mocking style for the same underlying
 *     signals (CLI detection cache, accessMode localStorage).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  buildModelPickerOptions,
  detectModelEntitlements,
  getModelPickerOptions,
  isSelectablePickerModel,
  isModelRailPending,
  noModelFallbackMessage,
  modelManagedByCodexMessage,
  NO_MODEL_FALLBACK_MESSAGE,
  MODEL_MANAGED_BY_CODEX_MESSAGE,
  CLAUDE_SUB_LABEL,
  DEVIN_LABEL,
  LOCAL_LABEL,
} from '../modelPickerOptions';
import { ALL_MODELS, DEFAULT_MODEL } from '../registry';
import { DEFAULT_DEVIN_MODEL_ID } from '../devinCatalog';
import { DEFAULT_LOCAL_MODEL_ID } from '../localProvider';
import { saveAccessSettings } from '../accessSettings';
import { isCliBackendAvailable } from '../cliBackendProvider';

vi.mock('../cliBackendProvider', () => ({
  isCliBackendAvailable: vi.fn(),
}));

const mockedIsCliBackendAvailable = vi.mocked(isCliBackendAvailable);

beforeEach(() => {
  localStorage.clear();
  mockedIsCliBackendAvailable.mockReturnValue(false);
});

// ── buildModelPickerOptions — pure, given entitlements ─────────────

describe('buildModelPickerOptions', () => {
  // The local group is unconditional: every group-id assertion below
  // therefore starts with 'local'.
  it('offers the local group FIRST even with zero entitlements', () => {
    const result = buildModelPickerOptions({ claudeSub: false, codexManaged: false, local: true });

    expect(result.groups[0].id).toBe('local');
    expect(result.groups[0].models.map((m) => m.id)).toEqual([DEFAULT_LOCAL_MODEL_ID]);
    expect(result.groups[0].models[0].provider).toBe('local');
    expect(result.hasOptions).toBe(true);
  });

  it('claude-only: offers the Claude subscription group next to the local one', () => {
    const result = buildModelPickerOptions({ claudeSub: true, codexManaged: false, local: true });

    expect(result.groups.map((g) => g.id)).toEqual(['local', 'claude-sub']);
    expect(result.groups.find((g) => g.id === 'claude-sub')!.models.map((m) => m.id)).toEqual(ALL_MODELS.map((m) => m.id));
    expect(result.hasOptions).toBe(true);
    expect(result.defaultModelId).toBe(DEFAULT_MODEL.id);
    expect(result.emptyReadiness).toBeUndefined();
    expect(result.codexManaged).toBe(false);
  });

  it('both: offers BOTH groups together (the confirmed bug this fixes)', () => {
    const result = buildModelPickerOptions({ claudeSub: true, codexManaged: false, devin: true, local: true });

    expect(result.groups.map((g) => g.id)).toEqual(['local', 'claude-sub', 'devin']);
    expect(result.groups.flatMap((g) => g.models.map((m) => m.id))).toEqual([
      DEFAULT_LOCAL_MODEL_ID,
      ...ALL_MODELS.map((m) => m.id),
      ...result.groups.find((g) => g.id === 'devin')!.models.map((m) => m.id),
    ]);
    expect(result.hasOptions).toBe(true);
    // Native default wins when both are entitled — mirrors the picker's
    // own precedence (Claude subscription first).
    expect(result.defaultModelId).toBe(DEFAULT_MODEL.id);
  });

  it('devin detected: the Devin group sits after claude-sub, sourced from the devin catalog', () => {
    const result = buildModelPickerOptions({ claudeSub: true, codexManaged: false, devin: true, local: true });

    expect(result.groups.map((g) => g.id)).toEqual(['local', 'claude-sub', 'devin']);
    const devinGroup = result.groups.find((g) => g.id === 'devin')!;
    expect(devinGroup.models.some((m) => m.id === 'swe-2-medium')).toBe(true);
    expect(devinGroup.models.every((m) => m.provider === 'devin')).toBe(true);
    expect(result.hasOptions).toBe(true);
  });

  it('devin-only (no claude): the Devin group is offered and swe-2-medium is the default', () => {
    const result = buildModelPickerOptions({ claudeSub: false, codexManaged: false, devin: true, local: true });

    expect(result.groups.map((g) => g.id)).toEqual(['local', 'devin']);
    expect(result.defaultModelId).toBe(DEFAULT_DEVIN_MODEL_ID);
  });

  it('neither: only the local group remains — still usable via Ollama', () => {
    const result = buildModelPickerOptions({ claudeSub: false, codexManaged: false, local: true });

    expect(result.groups.map((g) => g.id)).toEqual(['local']);
    expect(result.hasOptions).toBe(true);
    expect(result.emptyReadiness).toBeUndefined();
    // CRITICAL fix: must be a member of the only group actually offered
    // ('local'), never the native DEFAULT_MODEL.id — that id belongs to a
    // group this user has no entitlement to see, so a caller seeding a form
    // with it (e.g. NewMissionModal) would silently mismatch the rendered
    // <select> and fail the launch preflight even though Ollama works.
    expect(result.defaultModelId).toBe(DEFAULT_LOCAL_MODEL_ID);
    expect(result.groups.flatMap((g) => g.models.map((m) => m.id))).toContain(result.defaultModelId);
    expect(result.codexManaged).toBe(false);
  });

  it('codex-managed: the local group still gives hasOptions — codexManaged stays false (an empty picker cannot happen)', () => {
    const result = buildModelPickerOptions({ claudeSub: false, codexManaged: true, local: true });

    expect(result.hasOptions).toBe(true);
    // codexManaged is gated on !hasOptions; with the local group always
    // present the honest-Codex empty state is unreachable by construction.
    expect(result.codexManaged).toBe(false);
  });

  it('codexManaged is only ever true when hasOptions is false (claudeSub still wins the group even if codexManaged were somehow also true)', () => {
    const result = buildModelPickerOptions({ claudeSub: true, codexManaged: true, local: true });

    expect(result.hasOptions).toBe(true);
    expect(result.codexManaged).toBe(false);
  });

  it('default labels are the English constants', () => {
    const result = buildModelPickerOptions({ claudeSub: true, codexManaged: false, devin: true, local: true });

    expect(result.groups.find((g) => g.id === 'local')!.label).toBe(LOCAL_LABEL);
    expect(result.groups.find((g) => g.id === 'claude-sub')!.label).toBe(CLAUDE_SUB_LABEL);
    expect(result.groups.find((g) => g.id === 'devin')!.label).toBe(DEVIN_LABEL);
  });

  it('a translator overrides the group labels', () => {
    const t = (key: string): string => `t:${key}`;
    const result = buildModelPickerOptions({ claudeSub: true, codexManaged: false, devin: true, local: true }, t);

    expect(result.groups.find((g) => g.id === 'local')!.label).toBe('t:models.picker.localLabel');
    expect(result.groups.find((g) => g.id === 'claude-sub')!.label).toBe('t:models.picker.claudeSubLabel');
    expect(result.groups.find((g) => g.id === 'devin')!.label).toBe('t:models.picker.devinLabel');
  });
});

// ── fallback / codex messages ───────────────────────────────────────

describe('picker empty-state messages', () => {
  it('noModelFallbackMessage defaults to the English constant', () => {
    expect(noModelFallbackMessage()).toBe(NO_MODEL_FALLBACK_MESSAGE);
    expect(noModelFallbackMessage()).toMatch(/No model available/);
  });

  it('modelManagedByCodexMessage defaults to the English constant', () => {
    expect(modelManagedByCodexMessage()).toBe(MODEL_MANAGED_BY_CODEX_MESSAGE);
    expect(modelManagedByCodexMessage()).toMatch(/Codex manages its own models/);
  });

  it('both messages use the translator when one is supplied', () => {
    const t = (key: string): string => `t:${key}`;
    expect(noModelFallbackMessage(t)).toBe('t:models.picker.noModelFallback');
    expect(modelManagedByCodexMessage(t)).toBe('t:models.picker.codexManaged');
  });
});

// ── detectModelEntitlements — live detection ───────────────────────

describe('detectModelEntitlements', () => {
  afterEach(() => {
    delete (window as unknown as Record<string, unknown>)['__TAURI_INTERNALS__'];
  });

  function simulateTauri(): void {
    (window as unknown as Record<string, unknown>)['__TAURI_INTERNALS__'] = {};
  }

  it('outside Tauri: only the local group is genuinely usable (browser cannot run CLIs)', () => {
    expect(detectModelEntitlements()).toEqual({ claudeSub: false, codexManaged: false, devin: false, local: true });
  });

  it('Tauri + nothing detected or declared: local only', () => {
    simulateTauri();
    expect(detectModelEntitlements()).toEqual({ claudeSub: false, codexManaged: false, devin: false, local: true });
  });

  it('Tauri + claude CLI detected available: claudeSub true', () => {
    simulateTauri();
    mockedIsCliBackendAvailable.mockImplementation((tool: string) => tool === 'claude');

    expect(detectModelEntitlements().claudeSub).toBe(true);
  });

  it('Tauri + accessMode "cli"/"claude" declared (CLI detection not yet confirmed): claudeSub trusted true', () => {
    simulateTauri();
    saveAccessSettings({ accessMode: 'cli', cliTool: 'claude' });

    expect(detectModelEntitlements().claudeSub).toBe(true);
  });

  it('Tauri + accessMode "local" declared: no Claude group (honest local state)', () => {
    simulateTauri();
    saveAccessSettings({ accessMode: 'local' });

    expect(detectModelEntitlements().claudeSub).toBe(false);
  });

  it('Tauri + accessMode "cli" with cliTool "codex": claudeSub stays false — Codex is not a Claude subscription', () => {
    simulateTauri();
    saveAccessSettings({ accessMode: 'cli', cliTool: 'codex' });

    expect(detectModelEntitlements().claudeSub).toBe(false);
  });

  it('Tauri + accessMode "cli" with cliTool "codex": codexManaged is true — the picker must show the honest Codex message, not the generic fallback', () => {
    simulateTauri();
    saveAccessSettings({ accessMode: 'cli', cliTool: 'codex' });

    expect(detectModelEntitlements().codexManaged).toBe(true);
  });

  it('Tauri + devin CLI detected: devin true', () => {
    simulateTauri();
    mockedIsCliBackendAvailable.mockImplementation((tool: string) => tool === 'devin');

    const e = detectModelEntitlements();
    expect(e.devin).toBe(true);
    expect(e.claudeSub).toBe(false);
    expect(buildModelPickerOptions(e).groups.map((g) => g.id)).toEqual(['local', 'devin']);
  });

  it('Tauri + BOTH a Claude subscription and Devin: both entitlements report true at once', () => {
    simulateTauri();
    mockedIsCliBackendAvailable.mockImplementation((tool: string) => tool === 'claude' || tool === 'devin');

    expect(detectModelEntitlements()).toEqual({ claudeSub: true, codexManaged: false, devin: true, local: true });
  });

  it('local is always true, even outside Tauri', () => {
    simulateTauri();
    expect(detectModelEntitlements().local).toBe(true);
  });
});

describe('getModelPickerOptions', () => {
  afterEach(() => {
    delete (window as unknown as Record<string, unknown>)['__TAURI_INTERNALS__'];
  });

  it('wires live entitlement detection into buildModelPickerOptions', () => {
    (window as unknown as Record<string, unknown>)['__TAURI_INTERNALS__'] = {};
    mockedIsCliBackendAvailable.mockImplementation((tool: string) => tool === 'claude');

    const result = getModelPickerOptions();

    expect(result.claudeSub).toBe(true);
    expect(result.groups.some((g) => g.id === 'claude-sub')).toBe(true);
  });

  it('outside Tauri: only the local group is selectable (no native Claude ids)', () => {
    const result = getModelPickerOptions();
    expect(result.groups.map((g) => g.id)).toEqual(['local']);
    expect(result.defaultModelId).toBe(DEFAULT_LOCAL_MODEL_ID);
    expect(result.groups.flatMap((g) => g.models.map((m) => m.id))).not.toContain('claude-sonnet-5');
  });
});

describe('isSelectablePickerModel', () => {
  afterEach(() => {
    delete (window as unknown as Record<string, unknown>)['__TAURI_INTERNALS__'];
  });

  it('outside Tauri: native Sonnet and Devin ids are not selectable; the local rail is', () => {
    expect(isSelectablePickerModel('claude-sonnet-5')).toBe(false);
    expect(isSelectablePickerModel('swe-2-medium')).toBe(false);
    expect(isSelectablePickerModel(DEFAULT_LOCAL_MODEL_ID)).toBe(true);
    // Any non-empty local/ id is selectable: Ollama resolves model names
    // at call time, so a typed-or-discovered name survives validation and
    // fails loudly at launch (not silently reset) when genuinely absent.
    expect(isSelectablePickerModel('local/does-not-exist')).toBe(true);
    expect(isSelectablePickerModel('local/')).toBe(false);
  });

  it('Tauri + Claude CLI: native Sonnet is selectable', () => {
    (window as unknown as Record<string, unknown>)['__TAURI_INTERNALS__'] = {};
    mockedIsCliBackendAvailable.mockImplementation((tool: string) => tool === 'claude');
    expect(isSelectablePickerModel('claude-sonnet-5')).toBe(true);
  });

  it('Tauri + Devin CLI: swe-2-medium is selectable', () => {
    (window as unknown as Record<string, unknown>)['__TAURI_INTERNALS__'] = {};
    mockedIsCliBackendAvailable.mockImplementation((tool: string) => tool === 'devin');
    expect(isSelectablePickerModel('swe-2-medium')).toBe(true);
  });
});

describe('isModelRailPending', () => {
  afterEach(() => {
    delete (window as unknown as Record<string, unknown>)['__TAURI_INTERNALS__'];
  });

  it('returns false for an empty id', () => {
    expect(isModelRailPending('')).toBe(false);
  });

  it('outside Tauri: never pending (the CLI probes never run there)', () => {
    mockedIsCliBackendAvailable.mockReturnValue(null);
    expect(isModelRailPending('claude-sonnet-5')).toBe(false);
    expect(isModelRailPending('swe-2-medium')).toBe(false);
    expect(isModelRailPending(DEFAULT_LOCAL_MODEL_ID)).toBe(false);
  });

  it('Tauri + probes unsettled (null): native and Devin ids are pending, local ids never are', () => {
    (window as unknown as Record<string, unknown>)['__TAURI_INTERNALS__'] = {};
    mockedIsCliBackendAvailable.mockReturnValue(null);
    expect(isModelRailPending('claude-sonnet-5')).toBe(true);
    expect(isModelRailPending('swe-2-medium')).toBe(true);
    expect(isModelRailPending(DEFAULT_LOCAL_MODEL_ID)).toBe(false);
    expect(isModelRailPending('local/custom')).toBe(false);
  });

  it('Tauri + probes settled: nothing is pending', () => {
    (window as unknown as Record<string, unknown>)['__TAURI_INTERNALS__'] = {};
    mockedIsCliBackendAvailable.mockImplementation((tool: string) => tool === 'claude');
    expect(isModelRailPending('claude-sonnet-5')).toBe(false);
    expect(isModelRailPending('swe-2-medium')).toBe(false);
  });
});
