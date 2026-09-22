/* Model registry — selectable models grouped by provider (Forge).

   Native ids only (e.g. 'claude-sonnet-5'): consumed by the CLI backends.
   Local models use 'local/<name>' ids (see localProvider.ts). There is no
   hosted catalog — the managed OpenRouter proxy is gone.
*/

import type { ModelInfo } from './types.js';

/** Reasoning effort level (accepted by CLI tools that support it; local
    Ollama models ignore it). */
export type ReasoningEffort = 'low' | 'medium' | 'high' | 'max';

// ── Native Anthropic ids (CLI path only) ────────────────────
// These ids are consumed by claudeCodeProvider and cliBackendProvider.
const ANTHROPIC_MODELS: ModelInfo[] = [
  {
    id: 'claude-opus-5',
    label: 'Claude Opus 5',
    provider: 'anthropic',
    description: 'Deepest reasoning, complex tasks',
  },
  {
    id: 'claude-fable-5',
    label: 'Claude Fable 5',
    provider: 'anthropic',
    description: 'Mythos-class, autonomous long-horizon tasks',
  },
  {
    id: 'claude-sonnet-5',
    label: 'Claude Sonnet 5',
    provider: 'anthropic',
    description: 'Best coding model, orchestration',
  },
  {
    id: 'claude-haiku-4-5',
    label: 'Claude Haiku 4.5',
    provider: 'anthropic',
    description: 'Fast, cost-efficient (default)',
  },
];

// ── ALL_MODELS (CLI registry — native ids only) ────────────
export const ALL_MODELS: ModelInfo[] = [...ANTHROPIC_MODELS];

export const MODELS_BY_PROVIDER: Record<string, ModelInfo[]> = {
  anthropic: ANTHROPIC_MODELS,
};

// Default model — Haiku for dev/cost efficiency. Resolved by id, NOT array
// index: 'claude-fable-5' was inserted into ANTHROPIC_MODELS (v0.1.7, model
// picker fixes) between Opus and Sonnet, which silently shifted what a
// fixed index pointed at and broke this default (previously
// ANTHROPIC_MODELS[2] — see git history). Resolving by id means a future
// catalog insertion/reorder can never again change the default silently.
const DEFAULT_ANTHROPIC_MODEL_ID = 'claude-haiku-4-5';
export const DEFAULT_MODEL: ModelInfo =
  ANTHROPIC_MODELS.find(m => m.id === DEFAULT_ANTHROPIC_MODEL_ID) ?? ANTHROPIC_MODELS[ANTHROPIC_MODELS.length - 1];

export function findModelById(id: string): ModelInfo | undefined {
  return ALL_MODELS.find(m => m.id === id);
}
