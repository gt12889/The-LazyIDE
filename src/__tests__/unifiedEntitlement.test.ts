/**
 * unifiedEntitlement.test.ts
 *
 * Unit coverage for getEntitlements() (Forge: single tier, no teams).
 * Verifies the permissive local-first contract: every feature gate is
 * open, engine readiness follows the CLI/local detection, and the tier
 * setters are harmless no-ops kept for call-site compatibility.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  getEntitlements,
  hasFeature,
  setOrgScope,
  setPlanTier,
  getPlanTier,
} from '../lib/entitlements/unifiedEntitlement';

vi.mock('../lib/models/accessSettings', () => ({
  loadAccessSettings: vi.fn().mockReturnValue({}),
}));
vi.mock('../lib/models/cliBackendProvider', () => ({
  isCliBackendAvailable: vi.fn().mockReturnValue(false),
}));

beforeEach(() => {
  setOrgScope('solo');
  setPlanTier('free');
});

describe('getEntitlements() — local-first contract', () => {
  it('planTier is always free', () => {
    expect(getPlanTier()).toBe('free');
    expect(getEntitlements().planTier).toBe('free');
  });

  it('every feature gate is open', () => {
    const ents = getEntitlements();
    expect(ents.features.canLaunchMissions).toBe(true);
    expect(ents.features.canUseFederatedRecall).toBe(true);
    expect(ents.features.canUseDecisionRegistry).toBe(true);
    expect(ents.features.canUseNightShift).toBe(true);
    expect(ents.features.canUseCockpitV2).toBe(true);
    expect(ents.features.canUseLoops).toBe(true);
  });

  it('engine falls back to local when no CLI is detected', () => {
    const ents = getEntitlements();
    expect(ents.engineMode).toBe('local');
    expect(ents.engineReady).toBe(true);
  });

  it('hasFeature mirrors getEntitlements().features', () => {
    expect(hasFeature('canUseLoops')).toBe(getEntitlements().features.canUseLoops);
    expect(hasFeature('canUseLoops')).toBe(true);
  });

  it('setPlanTier/setOrgScope are accepted without effect', () => {
    setPlanTier('free');
    setOrgScope('solo');
    expect(getPlanTier()).toBe('free');
    expect(getEntitlements().planTier).toBe('free');
  });
});
