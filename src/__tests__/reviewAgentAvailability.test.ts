import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── useAgentAvailable (DiffDrawer.tsx's "Send an agent" affordance gate,
// ReviewSpace.tsx's "Ask reviewer/tester agent" gate) ───────────────────
// Mirrors the exact routing table planAndAct() uses in runtime.ts:
// isLiveAgentAvailable() (CLI) or isLocalLoopAvailable() (local Ollama).

const isLiveAgentAvailable = vi.fn();
const isLocalLoopAvailable = vi.fn();

vi.mock('../lib/agents/runtime', () => ({
  isLiveAgentAvailable: (...args: unknown[]) => isLiveAgentAvailable(...args),
  isLocalLoopAvailable: (...args: unknown[]) => isLocalLoopAvailable(...args),
}));

beforeEach(() => {
  vi.clearAllMocks();
});

describe('useAgentAvailable', () => {
  it('is true when the local engine is available', async () => {
    isLiveAgentAvailable.mockReturnValue(false);
    isLocalLoopAvailable.mockReturnValue(true);
    const { useAgentAvailable } = await import('../lib/review/agentAvailability');
    expect(useAgentAvailable()).toBe(true);
  });

  it('is true when a live CLI backend is available', async () => {
    isLiveAgentAvailable.mockReturnValue(true);
    isLocalLoopAvailable.mockReturnValue(false);
    const { useAgentAvailable } = await import('../lib/review/agentAvailability');
    expect(useAgentAvailable()).toBe(true);
  });

  it('is false when neither backend is available', async () => {
    isLiveAgentAvailable.mockReturnValue(false);
    isLocalLoopAvailable.mockReturnValue(false);
    const { useAgentAvailable } = await import('../lib/review/agentAvailability');
    expect(useAgentAvailable()).toBe(false);
  });
});
