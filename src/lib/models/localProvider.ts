/* localProvider — OpenAI-compatible local LLM provider (Ollama, LM Studio).

   Both Ollama and LM Studio expose an OpenAI-compatible /v1/chat/completions
   endpoint on localhost. This provider streams from either, auto-detecting
   which is available at the configured base URL.

   Configuration (localStorage):
     - 'lazygt.local.baseUrl' : the base URL (default: http://localhost:11434/v1 for Ollama)
     - 'lazygt.local.model'   : the model name to use (default: 'llama4')

   The provider is zero-cost (local), supports no web search, and does NOT
   support tool loops (the local models don't reliably follow ReAct directives).
   It streams raw SSE text like webAnthropicProvider.

   Detection: isLocalAvailable() pings the base URL's /v1/models endpoint
   with a short timeout. Used by the model gateway to decide whether to
   offer the local provider in the picker.
*/

import type { ModelProvider, ModelInfo, StreamChatRequest } from './types.js';
import { localFetch } from './localFetch.js';
import { isTauri } from '@tauri-apps/api/core';
import { buildSystemPrompt } from './systemPrompts.js';
import { sseLines } from './byokProviders.js';

const DEFAULT_OLLAMA_URL = 'http://127.0.0.1:11434/v1';
const DEFAULT_LM_STUDIO_URL = 'http://localhost:1234/v1';
const DEFAULT_MODEL = 'hermes3';
const DETECT_TIMEOUT_MS = 2000;

function loadBaseUrl(): string {
  try {
    const url = localStorage.getItem('lazygt.local.baseUrl') ?? DEFAULT_OLLAMA_URL;
    return import.meta.env.DEV && !isTauri() && /^http:\/\/(localhost|127\.0\.0\.1):11434\/v1\/?$/.test(url) ? '/ollama/v1' : url;
  } catch {
    return DEFAULT_OLLAMA_URL;
  }
}

function loadModel(): string {
  try {
    return localStorage.getItem('lazygt.local.model') ?? DEFAULT_MODEL;
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
    const res = await localFetch(`${baseUrl}/models`, { signal: controller.signal });
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
      const res = await localFetch(`${url}/models`, { signal: controller.signal });
      clearTimeout(timer);
      if (res.ok) return url;
    } catch {
      // try next
    }
  }
  return null;
}

/** List models from the local server's /v1/models endpoint.
 *  Async — for a future model picker that auto-discovers available local models. */
export async function listLocalModels(): Promise<ModelInfo[]> {
  const baseUrl = loadBaseUrl();
  try {
    const res = await localFetch(`${baseUrl}/models`, { signal: AbortSignal.timeout(5000) });
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

async function* streamChatImpl(req: StreamChatRequest): AsyncIterable<string> {
  const baseUrl = loadBaseUrl();
  const model = req.model.id.startsWith('local/') ? req.model.id.slice(6) : loadModel();

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

  const res = await localFetch(`${baseUrl}/chat/completions`, {
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
    throw new Error(`Local LLM error ${res.status}: ${errText}`);
  }

  const reader = res.body?.getReader();
  if (!reader) {
    throw new Error('No response body from local LLM');
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
    // model name in localStorage ('lazygt.local.model').
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
