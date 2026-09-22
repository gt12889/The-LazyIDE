/* unifiedEntitlement.ts — Single source of truth for feature entitlements
   (Forge: no accounts, no tiers — everything local is enabled).

   Unifies the previously-separate gating systems into one synchronous
   `getEntitlements()` call returning a complete feature map, used by UI
   components to gate visibility. The module is pure/synchronous — all
   runtime signals are cached elsewhere and only read here, same pattern
   as entitlement.ts.

   Every gate that used to depend on a plan tier now resolves permissively:
   on a local-first IDE there is nothing to upsell.
*/

import { loadAccessSettings } from '../models/accessSettings.js';
import { isCliBackendAvailable } from '../models/cliBackendProvider.js';

// ── Types ───────────────────────────────────────────────────────────

export type PlanTier = 'free';
export type EngineMode = 'cli' | 'local';

export interface UnifiedEntitlements {
  planTier: PlanTier;
  engineMode: EngineMode;
  engineReady: boolean;
  features: {
    canLaunchMissions: boolean;
    canUseFederatedRecall: boolean;
    canUseDecisionRegistry: boolean;
    canUseNightShift: boolean;
    canUseCockpitV2: boolean;
    canUseLoops: boolean;
    maxConcurrentMissions: number;
    maxProjects: number;
  };
}

// ── Plan tier (single tier — kept as a type so call sites compile) ──

export function setPlanTier(_tier: PlanTier): void {
  void _tier;
}

export function getPlanTier(): PlanTier {
  return 'free';
}

export function setOrgScope(_scope: string): void {
  void _scope;
}

export function getOrgScopeCached(): string {
  return 'solo';
}

// ── Unified entitlements ────────────────────────────────────────────

/**
 * Get the complete entitlement snapshot. Synchronous, safe to call
 * on every render/submit. Reads only cached state.
 */
export function getEntitlements(): UnifiedEntitlements {
  const settings = loadAccessSettings();

  // Engine readiness — mirrors entitlement.ts logic
  let engineMode: EngineMode;
  let engineReady: boolean;

  if (isCliBackendAvailable('claude') === true || isCliBackendAvailable('codex') === true) {
    engineMode = 'cli';
    engineReady = true;
  } else if (isCliBackendAvailable('claude') === null) {
    // Startup window — optimistic
    engineMode = 'cli';
    engineReady = true;
  } else {
    engineMode = 'local';
    engineReady = true;
  }

  // If an explicit mode is set, respect it
  if (settings.accessMode) {
    engineMode = settings.accessMode;
    if (engineMode === 'cli') {
      const tool = settings.cliTool ?? 'claude';
      const avail = isCliBackendAvailable(tool);
      engineReady = avail !== false;
    } else {
      engineReady = true;
    }
  }

  return {
    planTier: 'free',
    engineMode,
    engineReady,
    features: {
      canLaunchMissions: engineReady,
      canUseFederatedRecall: true,
      canUseDecisionRegistry: true,
      canUseNightShift: true,
      canUseCockpitV2: true,
      canUseLoops: true,
      maxConcurrentMissions: 3,
      maxProjects: 25,
    },
  };
}

/**
 * Check a single feature gate. Convenience wrapper for getEntitlements().
 */
export function hasFeature(feature: keyof UnifiedEntitlements['features']): boolean {
  const ents = getEntitlements();
  return ents.features[feature] === true;
}
