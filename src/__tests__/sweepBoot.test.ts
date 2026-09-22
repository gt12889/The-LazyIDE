/* sweepBoot.test.ts — boot hook is a no-op (Forge: no cloud sessions to sweep). */

import { describe, it, expect, beforeEach } from 'vitest';
import { bootSweepOrphans, resetSweepBoot } from '../lib/bots/sweepBoot';

beforeEach(() => {
  resetSweepBoot();
});

describe('bootSweepOrphans', () => {
  it('resolves without doing anything', async () => {
    await expect(bootSweepOrphans()).resolves.toBeUndefined();
  });

  it('is idempotent — subsequent calls are also no-ops', async () => {
    await bootSweepOrphans();
    await expect(bootSweepOrphans()).resolves.toBeUndefined();
  });

  it('resetSweepBoot allows calling again', async () => {
    await bootSweepOrphans();
    resetSweepBoot();
    await expect(bootSweepOrphans()).resolves.toBeUndefined();
  });
});
