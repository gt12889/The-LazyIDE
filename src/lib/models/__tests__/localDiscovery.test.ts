/**
 * localDiscovery.test.ts
 *
 * Coverage for local-model auto-discovery: refreshLocalModels() probes the
 * local server's /v1/models endpoint and caches names; the picker's
 * localOptions() (via buildModelPickerOptions) lists discovered names with
 * the configured model always first.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  refreshLocalModels,
  getDiscoveredLocalNames,
  DEFAULT_LOCAL_MODEL_ID,
} from '../localProvider';
import { buildModelPickerOptions } from '../modelPickerOptions';

const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

function mockModelsResponse(ids: string[]) {
  fetchMock.mockResolvedValueOnce({
    ok: true,
    json: () => Promise.resolve({ data: ids.map((id) => ({ id })) }),
  });
}

beforeEach(() => {
  fetchMock.mockReset();
  localStorage.clear();
});

afterEach(() => {
  localStorage.clear();
});

describe('refreshLocalModels', () => {
  it('caches discovered names with the configured model first', async () => {
    localStorage.setItem('lazy.local.model', 'hermes3');
    mockModelsResponse(['hermes3:latest', 'qwen3:30b-a3b']);
    const names = await refreshLocalModels();
    expect(names).toEqual(['hermes3', 'hermes3:latest', 'qwen3:30b-a3b']);
    expect(getDiscoveredLocalNames()).toEqual(names);
  });

  it('falls back to just the configured model when unreachable', async () => {
    localStorage.setItem('lazy.local.model', 'hermes3');
    fetchMock.mockRejectedValueOnce(new Error('down'));
    const names = await refreshLocalModels();
    expect(names).toEqual(['hermes3']);
  });

  it('falls back to just the configured model on non-OK status', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false });
    const names = await refreshLocalModels();
    expect(names).toEqual(['hermes3']);
  });
});

describe('local picker group with discovery', () => {
  it('lists discovered models as selectable rows, configured first', async () => {
    localStorage.setItem('lazy.local.model', 'hermes3');
    mockModelsResponse(['hermes3:latest', 'qwen3:30b-a3b']);
    await refreshLocalModels();
    const opts = buildModelPickerOptions({ claudeSub: false, codexManaged: false, local: true });
    const local = opts.groups.find((g) => g.id === 'local');
    expect(local).toBeDefined();
    expect(local!.models.map((m) => m.id)).toEqual([
      'local/hermes3',
      'local/hermes3:latest',
      'local/qwen3:30b-a3b',
    ]);
    expect(opts.defaultModelId).toBe(DEFAULT_LOCAL_MODEL_ID);
  });
});
