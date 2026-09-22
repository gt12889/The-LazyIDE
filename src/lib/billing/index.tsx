/* billing — Forge: no accounts, no plans, no checkout (local-first IDE).
   Only the pure helpers survive (credits math, top-up validation).
   SubscriptionProvider/useSubscriptionContext are inert stubs kept so
   account/chip UI keeps compiling until it is removed in the settings
   rework — everything reports "no plan", which is the honest state. */

import { createContext, useContext } from 'react';

export { isLowCredit, isOutOfCredits, formatCredits, formatRenewalDate, usdToCredits, LOW_CREDIT_THRESHOLD_CENTS } from './credits.js';
export { TOPUP_MIN_EUR, TOPUP_MAX_EUR, TOPUP_PRESETS_EUR, isValidTopupAmount } from './topup.js';

export interface Subscription {
  status: string;
  creditsRemainingCents: number;
}

export interface SubscriptionState {
  subscription: Subscription | null;
  loading: boolean;
  isPro: boolean;
  isProPlus: boolean;
  /** Always false — there is no hosted wallet. */
  hasManagedCredits: boolean;
  refresh: () => Promise<void>;
}

const DEFAULT_STATE: SubscriptionState = {
  subscription: null,
  loading: false,
  isPro: false,
  isProPlus: false,
  hasManagedCredits: false,
  refresh: async () => {},
};

const SubscriptionContext = createContext<SubscriptionState | null>(null);

interface SubscriptionProviderProps {
  user?: unknown;
  children: React.ReactNode;
}

export function SubscriptionProvider({ children }: SubscriptionProviderProps) {
  return (
    <SubscriptionContext.Provider value={DEFAULT_STATE}>
      {children}
    </SubscriptionContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useSubscriptionContext(): SubscriptionState {
  return useContext(SubscriptionContext) ?? DEFAULT_STATE;
}

/** Inert stubs — checkout/portal no longer exist. Throw honestly if called. */
function gone(name: string): never {
  throw new Error(`Billing is not available in Forge (local-first IDE): ${name}`);
}

export function useSubscription(_user?: unknown): SubscriptionState {
  void _user;
  return DEFAULT_STATE;
}

export async function startProCheckout(): Promise<never> { return gone('startProCheckout'); }
export async function startTopup(): Promise<never> { return gone('startTopup'); }
export async function startPlanChange(): Promise<never> { return gone('startPlanChange'); }
export async function startTeamsCheckout(): Promise<never> { return gone('startTeamsCheckout'); }
export async function startTeamsTopup(): Promise<never> { return gone('startTeamsTopup'); }
export async function openBillingPortal(): Promise<never> { return gone('openBillingPortal'); }
export async function openOrgBillingPortal(): Promise<never> { return gone('openOrgBillingPortal'); }
