/* localProvider — OpenAI-compatible local LLM provider (Ollama, LM Studio).

   Both Ollama and LM Studio expose an OpenAI-compatible /v1/chat/completions
   endpoint on localhost. This provider streams from either, auto-detecting
   which is available at the configured base URL.

   Configuration (localStorage):
     - 'lazy.local.baseUrl' : the base URL (default: http://localhost:11434/v1 for Ollama)
     - 'lazy.local.model'   : the model name to use (default: 'llama4')

   The provider is zero-cost (local), supports no web search, and does NOT
   support tool loops (the local models don't reliably follow ReAct directives).
   It streams raw SSE text.

   Detection: isLocalAvailable() pings the base URL's /v1/models endpoint
   with a short timeout. Used by the model gateway to decide whether to
   offer the local provider in the picker.
*/

import type { ModelProvider, ModelInfo, StreamChatRequest } from './types.js';
import { buildSystemPrompt } from './systemPrompts.js';

const DEFAULT_OLLAMA_URL = 'http://localhost:11434/v1';
const DEFAULT_LM_STUDIO_URL = 'http://localhost:1234/v1';
const DEFAULT_MODEL = 'hermes3';
const DETECT_TIMEOUT_MS = 2000;

/** Model id the picker and router use when nothing is persisted yet. */
export const DEFAULT_LOCAL_MODEL_ID = `local/${DEFAULT_MODEL}`;

function loadBaseUrl(): string {
  try {
    return localStorage.getItem('lazy.local.baseUrl') ?? DEFAULT_OLLAMA_URL;
  } catch {
    return DEFAULT_OLLAMA_URL;
  }
}

/** Model name configured by the user (`lazy.local.model`), defaulting to the
 *  bundled Hermes 3. Exported for pickers/routers that need the id. */
export function loadLocalModelName(): string {
  return loadModel();
}

function loadModel(): string {
  try {
    return localStorage.getItem('lazy.local.model') ?? DEFAULT_MODEL;
  } catch {
    return DEFAULT_MODEL;
  }
}

/** Ping the local server to check if it's running. */
export async function isLocalAvailable(): Promise<boolean> {
  const baseUrl = loadBaseUrl();
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), DETECT_TIMEOUT_MS);
    const res = await fetch(`${baseUrl}/models`, { signal: controller.signal });
    clearTimeout(timer);
    return res.ok;
  } catch {
    return false;
  }
}

/** Try Ollama first, then LM Studio. Returns the first available base URL, or null. */
export async function detectLocalBaseUrl(): Promise<string | null> {
  for (const url of [DEFAULT_OLLAMA_URL, DEFAULT_LM_STUDIO_URL]) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), DETECT_TIMEOUT_MS);
      const res = await fetch(`${url}/models`, { signal: controller.signal });
      clearTimeout(timer);
      if (res.ok) return url;
    } catch {
      // try next
    }
  }
  return null;
}

/** List models from the local server's /v1/models endpoint.
 *  Async — powers the Settings picker's auto-discovered local rows (see
 *  refreshLocalModels) as well as any future picker enhancement. */
export async function listLocalModels(): Promise<ModelInfo[]> {
  const baseUrl = loadBaseUrl();
  try {
    const res = await fetch(`${baseUrl}/models`);
    if (!res.ok) return [];
    const data = await res.json();
    const models = (data.data ?? data.models ?? []) as Array<{ id: string }>;
    return models.map((m) => ({
      id: `local/${m.id}`,
      label: m.id,
      provider: 'local',
      description: 'Local model (Ollama/LM Studio)',
    }));
  } catch {
    return [];
  }
}

// ── Discovered-model cache (sync pickers + async refresh) ──────────

/** Raw model names from the last successful discovery (`/v1/models`),
 *  null until the first refresh attempt. Module-level on purpose: every
 *  picker instance shares one fetch, and synchronous option builders
 *  (modelPickerOptions.localOptions) can read it without awaiting. */
let discoveredLocalNames: string[] | null = null;

/** Synchronous snapshot of discovered names (no fetch). Empty when no
 *  discovery has succeeded yet — callers fall back to the configured model. */
export function getDiscoveredLocalNames(): string[] {
  return discoveredLocalNames ?? [];
}

/** Probe `/v1/models` once and cache the names. Resolves to the names
 *  (possibly empty when unreachable) — never throws. The configured model
 *  is always prepended so the current selection never vanishes from the
 *  picker even when discovery fails. */
export async function refreshLocalModels(): Promise<string[]> {
  const configured = loadModel();
  try {
    const found = await listLocalModels();
    const names = found.map((m) => toLocalModelName(m.id)).filter(Boolean);
    const merged = [configured, ...names.filter((n) => n !== configured)];
    discoveredLocalNames = merged;
    return merged;
  } catch {
    discoveredLocalNames = [configured];
    return [configured];
  }
}

/** Splits a fetch ReadableStream into decoded `data: ` SSE payloads,
 *  buffering partial lines across chunks and skipping the `[DONE]`
 *  sentinel. */
export function sseLines(reader: ReadableStreamDefaultReader<Uint8Array>, decoder: TextDecoder): AsyncGenerator<string> {
  let buffer = '';
  return (async function* () {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const data = line.slice(6).trim();
        if (!data || data === '[DONE]') continue;
        yield data;
      }
    }
  })();
}

async function* streamChatImpl(req: StreamChatRequest): AsyncIterable<string> {
  const baseUrl = loadBaseUrl();
  const model = loadModel();

  const system = buildSystemPrompt(req.mode, req.brainRecall, {
    rulesContext: req.rulesContext,
    startupContext: req.startupContext,
    skillContext: req.skillContext,
    tools: req.tools,
    supportsToolLoop: false,
  });

  const messages = [
    { role: 'system', content: system },
    ...req.messages.map((m) => ({ role: m.role, content: m.content })),
  ];

  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      messages,
      stream: true,
      max_tokens: 4096,
    }),
    signal: req.signal,
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => res.statusText);
    yield `❌ Local LLM error ${res.status}: ${errText}\n`;
    return;
  }

  const reader = res.body?.getReader();
  if (!reader) {
    yield '❌ No response body from local LLM\n';
    return;
  }

  const decoder = new TextDecoder();

  for await (const data of sseLines(reader, decoder)) {
    try {
      const event = JSON.parse(data);
      if (event.choices?.[0]?.delta?.content) {
        yield event.choices[0].delta.content;
      }
    } catch {
      // skip malformed JSON
    }
  }
}
export const localProvider: ModelProvider = {
  id: 'local',
  label: 'Local LLM (Ollama / LM Studio)',
  listModels(): ModelInfo[] {
    // Synchronous — returns the configured model. The actual list of
    // available models can be fetched asynchronously via listLocalModels()
    // for a future model picker enhancement; for now the user sets the
    // model name in localStorage ('lazy.local.model').
    return [{
      id: `local/${loadModel()}`,
      label: loadModel(),
      provider: 'local',
      description: 'Local model (Ollama/LM Studio)',
    }];
  },

  streamChat(req: StreamChatRequest): AsyncIterable<string> {
    return streamChatImpl(req);
  },
};

// ── Agent-turn streamer (mission ReAct loop) ─────────────────────

/** Options shape for one ReAct-loop turn — mirrors the streamTurn contract
 *  planAndActManaged requires (see managedAgent.ts). Structural (not
 *  imported) so this module stays dependency-free of the agent loop. */
export interface LocalAgentTurnOpts {
  messages: Array<{ role: string; content: string }>;
  system: string;
  model: string;
  signal?: AbortSignal;
  cacheableSystem?: { core: string; dynamic: string };
  maxTokens?: number;
  onNativeAction?: () => void;
  worktreePath?: string;
}

/** Strips the picker's `local/` prefix to the raw Ollama model name. */
export function toLocalModelName(modelId: string): string {
  return modelId.startsWith('local/') ? modelId.slice('local/'.length) : modelId;
}

/** Builds a planAndActManaged `streamTurn` backed by the local engine: one
 *  OpenAI-compatible chat-completions call per turn, no CLI, no account.
 *  HTTP errors (Ollama down → fetch throws; unknown model → 404) propagate
 *  as thrown Errors so the loop's classifier (managedAgentTurnError.ts)
 *  records a turn failure and retries/fails over instead of parsing an
 *  error banner as a THOUGHT/ACTION block. */
export function createLocalAgentTurnStreamer() {
  return async function* localTurn(opts: LocalAgentTurnOpts): AsyncGenerator<string> {
    const baseUrl = loadBaseUrl();
    const model = toLocalModelName(opts.model || loadModel());
    const res = await fetch(`${baseUrl.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages: [{ role: 'system', content: opts.system }, ...opts.messages],
        stream: true,
        max_tokens: opts.maxTokens ?? 8192,
      }),
      signal: opts.signal,
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => res.statusText);
      throw new Error(`Local engine error ${res.status}: ${errText.slice(0, 200)}`);
    }
    const reader = res.body?.getReader();
    if (!reader) throw new Error('Local engine returned no response body');
    const decoder = new TextDecoder();
    for await (const data of sseLines(reader, decoder)) {
      try {
        const event = JSON.parse(data);
        const delta = event.choices?.[0]?.delta?.content;
        if (typeof delta === 'string' && delta) yield delta;
      } catch {
        // skip malformed JSON
      }
    }
  };
}
