import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('@tauri-apps/api/core', async (original) => ({
  ...await original<typeof import('@tauri-apps/api/core')>(),
  invoke: vi.fn(), isTauri: () => false,
}));
import { getProvider, getProviderMode, getActiveModel, setManagedAvailability } from '../lib/models';
import { loadAccessSettings, saveAccessSettings } from '../lib/models/accessSettings';
import { getModelPickerOptions } from '../lib/models/modelPickerOptions';
import { localProvider } from '../lib/models/localProvider';
import { isCloudConfigured, getAiProxyUrl } from '../lib/env';
import { ALL_TOOLS } from '../lib/agents/toolRegistry';

describe('lazygt local-only defaults and hosted-service removal', () => {
 beforeEach(() => { localStorage.clear(); vi.restoreAllMocks(); });
 it('routes a fresh browser profile to real local Hermes, never mock or managed', () => {
   expect(loadAccessSettings()).toMatchObject({ accessMode: 'local', model: 'local/hermes3' });
   setManagedAvailability(true);
   expect(getProviderMode()).toBe('local');
   expect(getProvider()).toBe(localProvider);
   expect(getActiveModel().id).toBe('local/hermes3');
 });
 it('normalizes obsolete hosted settings and malformed storage to Local', () => {
   for (const raw of ['null', '{', '{"accessMode":"pro","model":"provider/free"}', '{"accessMode":"byok"}']) {
     localStorage.setItem('lazygt.accessSettings', raw);
     expect(getProvider()).toBe(localProvider);
   }
 });
 it('keeps explicit CLI selection without silently using mock or cloud in the browser', async () => {
   saveAccessSettings({ accessMode: 'cli', cliTool: 'codex' });
   expect(getProviderMode()).toBe('codex');
   expect(getProvider().id).toBe('none');
 });
 it('offers local models without locked hosted catalogs', () => {
   const options = getModelPickerOptions();
   expect(options.groups.map(g => g.id)).toEqual(['local']);
   expect(options.lockedProGroup).toBeUndefined();
   expect(options.defaultModelId).toBe('local/hermes3');
 });
 it('has no cloud configuration or registered cloud tools', () => {
   expect(isCloudConfigured('https://example.com', 'key')).toBe(false);
   expect(() => getAiProxyUrl()).toThrow('Hosted AI');
   expect(ALL_TOOLS.some(t => t.name.startsWith('cloud_'))).toBe(false);
 });
 it('streams the selected local model and propagates server errors', async () => {
   const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('data: {"choices":[{"delta":{"content":"READY"}}]}\n\ndata: [DONE]\n\n'));
   let output = '';
   for await (const part of localProvider.streamChat({ mode: 'ask', messages: [], model: { id: 'local/custom', label: 'custom', provider: 'local' } })) output += part;
   expect(output).toBe('READY');
   expect(JSON.parse(fetchMock.mock.calls[0][1]!.body as string).model).toBe('custom');
   fetchMock.mockResolvedValue(new Response('Missing model', { status: 404 }));
   await expect(async () => { for await (const _ of localProvider.streamChat({ mode: 'ask', messages: [], model: getActiveModel() })) { /* drain */ } }).rejects.toThrow('404');
 });
});
