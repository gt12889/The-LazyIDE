import { expect, it, vi } from 'vitest';
import { localProvider } from '../lib/models/localProvider';
import { runManagerTurn } from '../lib/agents/managerEngine';

it('returns short local replies once without action repair, hosted fallback, or fabricated actions', async () => {
 localStorage.clear();
 const stream = vi.spyOn(localProvider, 'streamChat').mockImplementation(async function* () { yield 'READY'; });
 const onPartial = vi.fn();
 const result = await runManagerTurn({ messages: [{ id: 'test', role: 'user', content: 'Reply READY', timestamp: new Date().toISOString() }], context: { agents: [], missions: [] }, model: 'local/hermes3', onPartial });
 expect(result.responseText).toBe('READY');
 expect(result.actions).toEqual([]);
 expect(result.announcementNudged).toBe(false);
 expect(stream).toHaveBeenCalledTimes(1);
 expect(onPartial).toHaveBeenCalledWith('READY');
 stream.mockRestore();
});
