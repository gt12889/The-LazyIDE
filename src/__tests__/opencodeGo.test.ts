import { beforeEach, expect, it, vi } from 'vitest';
vi.mock('../lib/models/localFetch', () => ({ localFetch: vi.fn() }));
import { localFetch } from '../lib/models/localFetch';
import { goPayload, goText, goProtocol, goModels, discoverGoModels, opencodeGoProvider } from '../lib/models/opencodeGoProvider';
import { loadAccessSettings, saveAccessSettings } from '../lib/models/accessSettings';
import { getProvider, getActiveModel } from '../lib/models';
import { getModelPickerOptions } from '../lib/models/modelPickerOptions';

beforeEach(() => { localStorage.clear(); vi.clearAllMocks(); });
it('persists Go selection and exposes its catalog without enabling old hosted rails', () => {
  saveAccessSettings({ accessMode: 'opencode-go', model: 'opencode-go/glm-5.2' });
  expect(loadAccessSettings().accessMode).toBe('opencode-go');
  expect(getProvider()).toBe(opencodeGoProvider);
  expect(getActiveModel().id).toBe('opencode-go/glm-5.2');
  expect(getModelPickerOptions().groups[0].id).toBe('opencode-go');
  expect(goModels().length).toBeGreaterThan(25);
});
it.each([
  ['kimi-k2.7-code', 'chat/completions'], ['minimax-m3', 'messages'], ['gpt-5.6-luna', 'responses'],
])('uses the documented protocol for %s', (model, endpoint) => {
  const request = goPayload({ mode: 'ask', model: { id: `opencode-go/${model}`, label: model, provider: 'opencode-go' }, messages: [{ id: 'one', role: 'user', content: 'Help with code' }] });
  expect(request.endpoint).toBe(endpoint);
  expect(request.body.model).toBe(model);
  expect(JSON.stringify(request.body)).not.toContain('apiKey');
  if (endpoint === 'responses') expect(request.body).toHaveProperty('input');
  if (endpoint === 'messages') expect(request.body).toHaveProperty('system');
});
it('rejects unknown models and surfaces API stream failures', () => {
  expect(() => goProtocol('unknown')).toThrow('Unsupported');
  expect(() => goText({ type: 'response.failed' })).toThrow('could not complete');
  expect(goText({ choices: [{ delta: { content: 'A' } }] })).toBe('A');
  expect(goText({ type: 'content_block_delta', delta: { type: 'text_delta', text: 'B' } })).toBe('B');
  expect(goText({ type: 'response.output_text.delta', delta: 'C' })).toBe('C');
  expect(goText({ type: 'content_block_delta', delta: { type: 'thinking_delta', thinking: 'hidden' } })).toBe('');
});
it('refreshes only models with a supported wire protocol', async () => {
  vi.mocked(localFetch).mockResolvedValue(new Response(JSON.stringify({ data: [{ id: 'kimi-k3' }, { id: 'unknown' }] })));
  expect((await discoverGoModels()).map(m => m.id)).toEqual(['opencode-go/kimi-k3']);
});
it('keeps a stable session header and streams text through the dedicated native transport', async () => {
  vi.mocked(localFetch).mockResolvedValue(new Response('data: {"choices":[{"delta":{"content":"READY"}}]}\n\ndata: [DONE]\n\n'));
  let output = '';
  for await (const text of opencodeGoProvider.streamChat({ mode: 'ask', sessionId: 'conversation-1', model: goModels()[0], messages: [] })) output += text;
  expect(output).toBe('READY');
  expect(localFetch).toHaveBeenCalledWith('', expect.any(Object), { endpoint: 'chat/completions', session: 'conversation-1' });
});
it('requires a project for autonomous editing', async () => {
  await expect(async () => { for await (const _ of opencodeGoProvider.streamChat({ mode: 'edit', model: goModels()[0], messages: [] })) { /* drain */ } }).rejects.toThrow('Open a project');
  expect(localFetch).not.toHaveBeenCalled();
});
