import type { User } from '@supabase/supabase-js';
export interface Subscription {
  id: string;
  status: 'active' | 'canceled' | 'past_due' | 'trialing' | string;
  plan: string;
  current_period_end: string | null;
  credits_included_cents: number;
  credits_remaining_cents: number;
  period_start: string | null;
  period_end: string | null;
}

export interface SubscriptionState {
  subscription: Subscription | null;
  loading: boolean;
  isPro: boolean;
  isProPlus: boolean;
  /** True when Pro is active AND there are credits left to spend. */
  hasManagedCredits: boolean;
  refresh: () => Promise<void>;
}


export async function reportAppVersion(_userId: string): Promise<void> {}
export function useSubscription(_user: User | null): SubscriptionState {
 return { subscription: null, loading: false, isPro: false, isProPlus: false, hasManagedCredits: false, refresh: async () => {} };
}
