import { beforeEach, expect, it, vi } from 'vitest';
const native = vi.hoisted(() => ({ invoke: vi.fn(), isTauri: vi.fn(() => true) }));
vi.mock('@tauri-apps/api/core', () => ({ ...native, Channel: class { onmessage = (_event: unknown) => {}; } }));
import { localFetch } from '../lib/models/localFetch';

beforeEach(() => { native.invoke.mockReset(); native.isTauri.mockReturnValue(true); });

it('routes Go requests only through its dedicated native command without frontend credentials', async () => {
  native.invoke.mockImplementation(async (_command, args) => {
    args.onEvent.onmessage({ kind: 'headers', status: 200 });
    args.onEvent.onmessage({ kind: 'done' });
  });
  await localFetch('', { body: JSON.stringify({ model: 'kimi-k3' }) }, { endpoint: 'chat/completions', session: 'conversation' });
  expect(native.invoke).toHaveBeenCalledWith('opencode_go_request', expect.objectContaining({ endpoint: 'chat/completions', session: 'conversation' }));
  expect(native.invoke.mock.calls[0][1]).not.toHaveProperty('url');
  expect(native.invoke.mock.calls[0][1]).not.toHaveProperty('headers');
  native.isTauri.mockReturnValue(false);
  await expect(localFetch('', {}, { endpoint: 'models', session: 'conversation' })).rejects.toThrow('desktop');
});

it('forwards native status and streams response bytes', async () => {
  native.invoke.mockImplementation(async (_command, args) => {
    args.onEvent.onmessage({ kind: 'headers', status: 404 });
    args.onEvent.onmessage({ kind: 'data', bytes: [...new TextEncoder().encode('Missing model')] });
    args.onEvent.onmessage({ kind: 'done' });
  });
  const response = await localFetch('http://127.0.0.1:11434/v1/models');
  expect(response.status).toBe(404);
  expect(await response.text()).toBe('Missing model');
});

it('waits for ordered channel messages even when the command resolves first', async () => {
  native.invoke.mockImplementation(async (_command, args) => {
    setTimeout(() => {
      args.onEvent.onmessage({ kind: 'headers', status: 200 });
      args.onEvent.onmessage({ kind: 'data', bytes: [...new TextEncoder().encode('READY')] });
      args.onEvent.onmessage({ kind: 'done' });
    }, 10);
  });
  const response = await localFetch('http://127.0.0.1:11434/v1/models');
  expect(await response.text()).toBe('READY');
});

it('propagates connection failures before headers', async () => {
  native.invoke.mockRejectedValue('Connection refused');
  await expect(localFetch('http://127.0.0.1:11434/v1/models')).rejects.toThrow('Connection refused');
});

it('cancels native generation when the caller aborts', async () => {
  native.invoke.mockImplementation((command, args) => {
    if (command === 'local_llm_cancel') return Promise.resolve();
    args.onEvent.onmessage({ kind: 'headers', status: 200 });
    return new Promise(() => {});
  });
  const abort = new AbortController();
  const response = await localFetch('http://127.0.0.1:11434/v1/chat/completions', { signal: abort.signal });
  abort.abort();
  await expect(response.text()).rejects.toThrow('Aborted');
  expect(native.invoke).toHaveBeenCalledWith('local_llm_cancel', { id: expect.any(String) });
});
