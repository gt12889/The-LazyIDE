import type { User, Session } from '@supabase/supabase-js';
export interface AuthState {
  user: User | null;
  session: Session | null;
  loading: boolean;
}

export interface SignUpResult {
  error: string | null;
  /** True when Supabase created the user but no session yet (email confirmation
      is enabled server-side). The UI must then show a "check your email" state. */
  needsConfirmation: boolean;
}

export interface ResendResult {
  error: string | null;
  /** When rate-limited (HTTP 429), the number of seconds to wait before retry. */
  retryAfterSec: number | null;
}

export interface AuthActions {
  signUp: (email: string, password: string) => Promise<SignUpResult>;
  signIn: (email: string, password: string) => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
  signInWithGoogle: () => Promise<{ error: string | null }>;
  /** Resend the signup confirmation email. */
  resendConfirmation: (email: string) => Promise<ResendResult>;
}


const error = 'Accounts are not used in lazygt. Configure Local or CLI in Settings.';
export function useAuth(): AuthState & AuthActions {
 return { user: null, session: null, loading: false,
   signUp: async () => ({ error, needsConfirmation: false }), signIn: async () => ({ error }),
   signOut: async () => {}, signInWithGoogle: async () => ({ error }),
   resendConfirmation: async () => ({ error, retryAfterSec: null }) };
}
