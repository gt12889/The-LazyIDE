/* Model gateway — entry point (Forge: local-first, no hosted backend).
   Routing priority (auto mode):
     1. Claude Code CLI (subscription, no API key) — default under Tauri when claude is installed
     2. Codex CLI / Devin CLI when detected
     3. Local LLM (Ollama / LM Studio) — always available as last resort;
        a connection failure surfaces loudly from the provider itself
     4. mockProvider (browser / web demo only)

   User-overridable via AccessSettings persisted in localStorage.
*/

import { invoke } from '@tauri-apps/api/core';
import { isTauri as isTauriRuntime } from '../platform/index.js';
import type { ModelInfo, ModelProvider } from './types.js';
import { mockProvider } from './mockProvider.js';
import { claudeCodeProvider } from './claudeCodeProvider.js';
import {
  cliBackendProvider,
  detectAllCliBackends,
  isCliBackendAvailable,
} from './cliBackendProvider.js';
import { loadAccessSettings } from './accessSettings.js';
import { DEFAULT_MODEL, findModelById } from './registry.js';
import { DEFAULT_DEVIN_MODEL_ID, findDevinModel, isDevinModel, refreshDevinCatalog } from './devinCatalog.js';
import { localProvider, DEFAULT_LOCAL_MODEL_ID } from './localProvider.js';

export * from './types.js';
export * from './registry.js';
export * from './costStore.js';
export * from './claudeCodeProvider.js';
export * from './cliBackendProvider.js';
export { localProvider, isLocalAvailable, detectLocalBaseUrl, listLocalModels, DEFAULT_LOCAL_MODEL_ID, createLocalAgentTurnStreamer, toLocalModelName, loadLocalModelName } from './localProvider.js';
// Re-export access settings so existing callers (from '../lib/models') keep working.
export * from './accessSettings.js';
// StreamEvent/StreamPart helpers (structured assistant stream) — see
// assistantStore.tsx and MessageList.tsx.
export * from './streamEvents.js';
export * from './devinCatalog.js';

// ── Runtime state ─────────────────────────────────────────────────

/** Cached claude CLI availability (legacy; now delegates to cliBackendProvider cache). */
let _claudeCodeAvailable: boolean | null = null;

/** Call once at startup to cache all CLI availability + legacy flag. */
export async function initProviderMode(): Promise<void> {
  if (!isTauriRuntime()) return;
  try {
    // Detect all CLI backends (claude, codex, devin, ...)
    await detectAllCliBackends();
    // Keep legacy flag in sync
    _claudeCodeAvailable = isCliBackendAvailable('claude') ?? false;
    // Devin detected: refresh its live model catalog in the background —
    // one short-lived `devin acp` process, results cached for pickers.
    if (isCliBackendAvailable('devin') === true) {
      void refreshDevinCatalog();
    }
  } catch {
    _claudeCodeAvailable = false;
  }

  // Legacy fallback: try claude_available directly
  if (_claudeCodeAvailable === null) {
    try {
      const available = await invoke<boolean>('claude_available');
      _claudeCodeAvailable = available;
    } catch {
      _claudeCodeAvailable = false;
    }
  }
}

// ── ProviderMode (UI badge) ───────────────────────────────────────

export type ProviderMode =
  | 'claude-code'    // CLI subscription via Claude Code
  | 'codex'         // CLI subscription via Codex
  | 'devin'         // Devin CLI over ACP
  | 'local'         // Local LLM (Ollama / LM Studio)
  | 'mock';

export function getProviderMode(): ProviderMode {
  if (!isTauriRuntime()) return 'mock';

  const settings = loadAccessSettings();

  if (settings.accessMode === 'local') return 'local';

  if (settings.accessMode === 'cli') {
    const tool = settings.cliTool ?? 'claude';
    if (tool === 'codex') return 'codex';
    if (tool === 'devin') return 'devin';
    return 'claude-code';
  }

  // Auto-detect: CLI tools first, then local.
  if (_claudeCodeAvailable === true) return 'claude-code';
  if (isCliBackendAvailable('codex') === true) return 'codex';
  // Devin auto-detect sits after claude/codex so an existing setup's engine
  // never silently changes on upgrade — explicit selection (Settings >
  // Models, or picking a Devin model) is the primary path anyway.
  if (isCliBackendAvailable('devin') === true) return 'devin';
  if (settings.model?.startsWith('local/')) return 'local';
  if (_claudeCodeAvailable === null) return 'claude-code';
  // Last resort: local LLM. Optimistic — Ollama usually runs alongside the
  // IDE; a refused connection surfaces loudly from the provider itself.
  return 'local';
}

/**
 * Default model id for a given provider mode — the single source of truth
 * for "which model should we start with before the user picks one".
 *
 * 'codex' is deliberately NOT folded into the native-id branch: ALL_MODELS/
 * DEFAULT_MODEL are Anthropic-only (see registry.ts's module comment), so
 * there is no real "codex default model id" to return here. Returns ''
 * instead: buildRunTurn already treats a falsy req.model.id as "omit the
 * model param" (`model: req.model.id || undefined`), so the Codex CLI falls
 * through to its OWN default model, exactly like an absent id would.
 *
 * Mirrors NewMissionModal's getInitialModelId() so every "pick a starting
 * model for the current mode" call site (New Mission form, mission launcher,
 * manager-launched missions) agrees on the same mapping instead of each
 * hardcoding its own default.
 */
export function getDefaultModelIdForMode(mode: ProviderMode): string {
  if (mode === 'codex') return '';
  if (mode === 'devin') return DEFAULT_DEVIN_MODEL_ID;
  if (mode === 'local') return DEFAULT_LOCAL_MODEL_ID;
  return DEFAULT_MODEL.id;
}

/**
 * Sentinel returned by getActiveModel() for 'codex' mode — see that
 * function's doc comment. id: '' is intentional, mirroring
 * getDefaultModelIdForMode('codex'): cliBackendProvider.ts's buildRunTurn
 * treats a falsy req.model.id as "omit the model param"
 * (`model: req.model.id || undefined`), letting the Codex CLI use its own
 * default instead of receiving a misrepresented Anthropic id. provider:
 * 'openai' (not 'anthropic') so this is never mistaken for a real
 * ALL_MODELS/registry entry if it ever leaks into UI that expects one.
 */
const CODEX_MANAGED_MODEL: ModelInfo = {
  id: '',
  label: 'Codex (model managed by the CLI)',
  provider: 'openai',
  description: 'The Codex CLI picks its own model — no native id applies.',
};

/**
 * Resolves the model that AI features OUTSIDE the Assistant composer should
 * use — inline edit (Ctrl+K), auto-fix, AI code review, and any future
 * one-shot AI action that isn't wired into assistantStore's React context.
 *
 * Mirrors the exact fallback chain the composer itself already uses so every
 * AI feature agrees on "which model is active" instead of each hardcoding
 * its own id:
 *   - codex mode        -> CODEX_MANAGED_MODEL (id: ''), never a persisted
 *                          or default native id — see that constant's doc
 *                          comment.
 *   - local mode        -> the persisted 'local/<name>' id, falling back to
 *                          DEFAULT_LOCAL_MODEL_ID.
 *   - every other mode  -> the user's persisted native model
 *                          (AccessSettings.model, native id namespace),
 *                          falling back to DEFAULT_MODEL — the same default
 *                          the Ask composer starts with.
 */
export function getActiveModel(): ModelInfo {
  const mode = getProviderMode();
  const settings = loadAccessSettings();

  if (mode === 'codex') {
    return CODEX_MANAGED_MODEL;
  } else if (mode === 'devin') {
    const entry = findDevinModel(settings.model) ?? findDevinModel(DEFAULT_DEVIN_MODEL_ID);
    if (entry) return entry;
  } else if (mode === 'local') {
    const id = settings.model?.startsWith('local/') ? settings.model : DEFAULT_LOCAL_MODEL_ID;
    return { id, label: id.replace(/^local\//, ''), provider: 'local', description: 'Local model (Ollama/LM Studio)' };
  } else if (settings.model) {
    const native = findModelById(settings.model);
    if (native) return native;
  }

  return DEFAULT_MODEL;
}

// ── Provider Readiness ────────────────────────────────────────────

export interface ProviderReadiness {
  ready: boolean;
  reason?: string;
}

/** i18n translate function shape. Optional everywhere: omitting `t` is never
 *  a behavior change (falls back to the hardcoded English copy). */
type Translate = (key: string, params?: Record<string, string | number>) => string;

export function describeProviderReadiness(mode: ProviderMode = getProviderMode(), t?: Translate): ProviderReadiness {
  if (mode === 'mock') {
    return {
      ready: false,
      reason: t
        ? t('models.readiness.noEngine')
        : 'No engine detected. Install Ollama (ships with Hermes 3) or a CLI tool (Claude Code / Codex) — see Settings > Models.',
    };
  }
  return { ready: true };
}

// ── Provider selector ─────────────────────────────────────────────

/**
 * Returns the active model provider.
 *
 * Routing (explicit settings take priority over auto-detect):
 *  1. accessMode === 'cli' + cliTool   → cliBackendProvider(tool)
 *  2. accessMode === 'local'           → localProvider
 *  3. Explicit 'local/<name>' model    → localProvider
 *  4. Devin-catalog model id           → cliBackendProvider('devin')
 *  5. Auto: claude/codex/devin/local   → first available
 */
export function getProvider(t?: Translate): ModelProvider {
  void t;
  if (!isTauriRuntime()) {
    return mockProvider;
  }

  const settings = loadAccessSettings();

  // Devin model routing: a picked Devin-catalog id (e.g. 'swe-2-medium')
  // ALWAYS goes through the Devin backend, so the picker's Devin group
  // keeps working even while accessMode still names another engine.
  if (isDevinModel(settings.model)) {
    return cliBackendProvider('devin');
  }

  if (settings.accessMode === 'cli') {
    const tool = settings.cliTool ?? 'claude';
    return cliBackendProvider(tool);
  }

  if (settings.accessMode === 'local' || settings.model?.startsWith('local/')) {
    return localProvider;
  }

  return autoDetectProvider();
}

/** Resolve the best provider via auto-detection.
 *  Called only on Tauri — web callers never reach this path. Local LLM is
 *  the optimistic last resort: a refused Ollama connection surfaces loudly
 *  from the provider itself instead of failing silently. */
function autoDetectProvider(): ModelProvider {
  if (_claudeCodeAvailable === true) return claudeCodeProvider;
  if (isCliBackendAvailable('codex') === true) return cliBackendProvider('codex');
  if (isCliBackendAvailable('devin') === true) return cliBackendProvider('devin');
  if (_claudeCodeAvailable === null) return claudeCodeProvider;
  return localProvider;
}
