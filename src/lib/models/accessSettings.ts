/* accessSettings — persistence of the user's provider/model preferences.

   Forge: local-first IDE. Access modes are 'cli' (claude/codex/devin CLIs
   on PATH) and 'local' (Ollama / LM Studio on localhost). There is no
   hosted backend, no BYOK, no subscription — see models/index.ts.
*/

import type { CavemanIntensity } from '../compression/types.js';
import type { OutputStyleSelectionEntry } from '../assistant/outputStyles.js';
import type { ReasoningEffort } from './registry.js';

export type { ReasoningEffort } from './registry.js';

export type AccessMode = 'cli' | 'local';
export type CliTool = 'claude' | 'codex' | 'devin';

export interface AccessSettings {
  /** Which access mode is selected. Undefined = auto-detect. */
  accessMode?: AccessMode;
  /** Which CLI tool to use when accessMode === 'cli'. Default: 'claude'. */
  cliTool?: CliTool;
  /** Preferred model id (used across all modes when set).
      CLI modes use a native provider id (e.g. 'claude-sonnet-5');
      local mode uses a 'local/<name>' id (e.g. 'local/hermes3'). */
  model?: string;
  /** Reasoning effort sent to the CLI tool when the selected model supports
      reasoning. Default: 'medium'. */
  reasoningEffort?: ReasoningEffort;
  /** Enable web search plugin for requests when the model supports it. */
  webSearch?: boolean;
  /** Enable response healing plugin for JSON repair. */
  responseHealing?: boolean;
  /** Enable Caveman prose compression before sending to the LLM. Default: false. */
  compressionEnabled?: boolean;
  /** Caveman compression intensity. Default: 'full'. */
  compressionIntensity?: CavemanIntensity;
  /** Selected output styles to inject into the system prompt. */
  outputStyles?: OutputStyleSelectionEntry[];
}

const LS_ACCESS_KEY = 'forge.accessSettings';

/** Legacy key from the Lazy IDE this was forked from — migrated once, then
    removed, so existing installs keep their cliTool/model choices. */
const LEGACY_LS_ACCESS_KEY = 'lazy.accessSettings';

function migrateLegacy(): AccessSettings {
  try {
    const raw = localStorage.getItem(LEGACY_LS_ACCESS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const next: AccessSettings = {};
    // Only carry over fields that still exist. 'byok'/'pro' modes collapse
    // to auto-detect (undefined) — the router re-resolves to cli/local.
    if (parsed.accessMode === 'cli' || parsed.accessMode === 'local') {
      next.accessMode = parsed.accessMode;
    }
    if (parsed.cliTool === 'claude' || parsed.cliTool === 'codex' || parsed.cliTool === 'devin') {
      next.cliTool = parsed.cliTool;
    }
    if (typeof parsed.model === 'string' && parsed.model) {
      next.model = parsed.model;
    }
    try {
      localStorage.setItem(LS_ACCESS_KEY, JSON.stringify(next));
      localStorage.removeItem(LEGACY_LS_ACCESS_KEY);
    } catch {
      // storage unavailable — ignore
    }
    return next;
  } catch {
    return {};
  }
}

export function loadAccessSettings(): AccessSettings {
  try {
    const raw = localStorage.getItem(LS_ACCESS_KEY);
    if (raw) return JSON.parse(raw) as AccessSettings;
  } catch {
    // localStorage unavailable or invalid JSON — fall through
  }
  return migrateLegacy();
}

export function saveAccessSettings(settings: AccessSettings): void {
  try {
    localStorage.setItem(LS_ACCESS_KEY, JSON.stringify(settings));
  } catch {
    // localStorage unavailable — silently ignore
  }
}
