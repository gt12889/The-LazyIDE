import type { ModelInfo, ModelProvider, StreamChatRequest, StreamEvent } from './types.js';
import { localFetch } from './localFetch.js';
import { sseLines } from './byokProviders.js';
import { buildSystemPrompt } from './systemPrompts.js';
import { loadAccessSettings } from './accessSettings.js';
import { getSelectedGoKeyId } from './opencodeGoKeys.js';

export { GO_LEGACY_KEY as GO_KEY, getSelectedGoKeyId } from './opencodeGoKeys.js';
export const GO_DEFAULT = 'opencode-go/kimi-k2.7-code';
type Protocol = 'chat/completions' | 'messages' | 'responses';
// Verified against https://opencode.ai/v2/docs/console/go on 2026-09-23.
// Unknown models are excluded until their wire protocol is known.
const protocols: Record<Protocol, string[]> = {
  'chat/completions': ['kimi-k3', 'kimi-k2.7-code', 'kimi-k2.6', 'glm-5.3-flash', 'glm-5.3', 'glm-5.2', 'glm-5.1', 'longcat-2.0', 'deepseek-v4.1-flash', 'deepseek-v4-pro', 'deepseek-v4-flash', 'deepseek-v4-flash-vision-exp', 'mimo-v2.6-flash', 'mimo-v2.6-pro', 'mimo-v2.5', 'mimo-v2.5-pro', 'hy4-preview', 'hy3'],
  messages: ['minimax-m3', 'minimax-m2.7', 'minimax-m2.5', 'qwen3.8-max', 'qwen3.8-flash', 'qwen3.7-max', 'qwen3.7-plus', 'qwen3.6-plus'],
  responses: ['grok-4.7', 'grok-4.6', 'gpt-5.6-luna', 'muse-spark-1.3-contributor', 'muse-spark-1.2-contributor'],
};
export function goProtocol(id: string): Protocol {
  const raw = id.replace(/^opencode-go\//, '');
  const protocol = (Object.keys(protocols) as Protocol[]).find(p => protocols[p].includes(raw));
  if (!protocol) throw new Error('Unsupported OpenCode Go model. Refresh the model list in Settings.');
  return protocol;
}
const catalog: ModelInfo[] = Object.values(protocols).flat().map(id => ({
  id: `opencode-go/${id}`, label: id, provider: 'opencode-go',
  description: id.startsWith('muse-') ? 'OpenCode Go · contributor model: prompts/completions may be used for training; region restricted' : 'OpenCode Go subscription · model-specific usage limits',
}));
export function goModels(): ModelInfo[] {
  try {
    const ids: unknown = JSON.parse(localStorage.getItem('lazygt.go.models') ?? 'null');
    if (Array.isArray(ids)) {
      const found = catalog.filter(m => ids.includes(m.id));
      if (found.length) return found;
    }
  } catch { /* Use the documented catalog until refreshed. */ }
  return catalog;
}
export function activeGoModel(): ModelInfo {
  const chosen = loadAccessSettings().model;
  return goModels().find(m => m.id === chosen) ?? goModels().find(m => m.id === GO_DEFAULT) ?? goModels()[0];
}
export async function discoverGoModels(): Promise<ModelInfo[]> {
  const res = await localFetch('', { signal: AbortSignal.timeout(20000) }, { endpoint: 'models', session: 'lazygt-model-discovery' });
  const data = await res.json();
  if (!Array.isArray(data.data)) throw new Error('OpenCode Go returned an invalid model catalog.');
  const ids = data.data.map((m: { id?: string }) => `opencode-go/${m.id}`);
  const models = catalog.filter(m => ids.includes(m.id));
  if (!models.length) throw new Error('No supported OpenCode Go models are currently available.');
  localStorage.setItem('lazygt.go.models', JSON.stringify(models.map(m => m.id)));
  return models;
}

export function goPayload(req: StreamChatRequest) {
  const selected = req.model.id.startsWith('opencode-go/') ? req.model.id : activeGoModel().id;
  const endpoint = goProtocol(selected);
  const model = selected.replace(/^opencode-go\//, '');
  const system = buildSystemPrompt(req.mode, req.brainRecall, { rulesContext: req.rulesContext, startupContext: req.startupContext, skillContext: req.skillContext, supportsToolLoop: false, basePromptOverride: req.basePromptOverride });
  const messages = req.messages.map(({ role, content }) => ({ role, content }));
  const common = { model, stream: true };
  const body = endpoint === 'messages' ? { ...common, system, messages, max_tokens: 8192 }
    : endpoint === 'responses' ? { ...common, instructions: system, input: messages, max_output_tokens: 8192, store: false }
    : { ...common, messages: [{ role: 'system', content: system }, ...messages], max_tokens: 8192 };
  return { endpoint, body };
}
interface GoEvent {
  type?: string;
  error?: unknown;
  delta?: string | { type?: string; text?: string; [key: string]: unknown };
  choices?: Array<{ delta?: { content?: string } }>;
}
function summarizeGoError(event: GoEvent): string {
  const detail = event.error
    ? typeof event.error === 'string'
      ? event.error
      : JSON.stringify(event.error)
    : JSON.stringify(event);
  const suffix = detail && detail !== '{}'
    ? `: ${detail.slice(0, 500)}`
    : '. Check model availability and subscription usage.';
  return `OpenCode Go could not complete this response${suffix}`;
}

export function goText(event: GoEvent): string {
  if (event.error || event.type === 'error' || event.type === 'response.failed' || event.type === 'response.incomplete') throw new Error(summarizeGoError(event));
  if (event.type === 'response.output_text.delta') return typeof event.delta === 'string' ? event.delta : '';
  if (event.type === 'content_block_delta' && typeof event.delta === 'object' && event.delta?.type === 'text_delta') return event.delta.text ?? '';
  return event.choices?.[0]?.delta?.content ?? '';
}
async function* streamRaw(req: StreamChatRequest): AsyncIterable<string> {
  const { endpoint, body } = goPayload(req);
  // First message id is stable across turns when the caller has no session id.
  const session = (req.sessionId ?? req.messages[0]?.id ?? crypto.randomUUID()).replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 160);
  const res = await localFetch('', { body: JSON.stringify(body), signal: req.signal }, { endpoint, session: session || 'lazygt-chat', keyId: getSelectedGoKeyId() });
  const reader = res.body?.getReader();
  if (!reader) throw new Error('OpenCode Go returned no response stream.');
  try {
    for await (const data of sseLines(reader, new TextDecoder())) {
      if (data === '[DONE]') continue;
      let event: GoEvent;
      try { event = JSON.parse(data); } catch { continue; }
      const text = goText(event);
      if (text) yield text;
    }
  } finally { await reader.cancel().catch(() => {}); }
}
async function* streamChatEvents(req: StreamChatRequest): AsyncIterable<StreamEvent> {
  if (req.mode !== 'transform' && !req.basePromptOverride && (req.projectRoot || req.mode === 'edit')) {
    const { goToolLoop } = await import('./opencodeGoToolLoop.js');
    yield* goToolLoop(req, streamRaw);
    return;
  }
  for await (const text of streamRaw(req)) yield { type: 'text', id: 'answer', text };
}
async function* streamChat(req: StreamChatRequest): AsyncIterable<string> {
  for await (const event of streamChatEvents(req)) {
    if (event.type === 'text') yield event.text;
    if (event.type === 'tool' && event.status !== 'running') yield `\n${event.name}: ${event.resultSummary}\n`;
  }
}
export const opencodeGoProvider: ModelProvider = { id: 'opencode-go', label: 'OpenCode Go', listModels: goModels, streamChat, streamChatEvents };

/** Reuses the IDE's existing action/observation loop with Go as its model. */
export function createGoAgentTurnStreamer(sessionId: string) {
  return (opts: { messages: Array<{ role: string; content: string }>; system: string; model: string; signal?: AbortSignal }) => streamRaw({
    messages: opts.messages.map((m, i) => ({ id: String(i), role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content })),
    model: { id: opts.model, label: opts.model, provider: 'opencode-go' },
    mode: 'ask', basePromptOverride: opts.system, sessionId, signal: opts.signal,
  });
}
