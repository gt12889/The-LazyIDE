/* useAuth — Forge: no accounts. Stub hook kept so existing components
   keep compiling unchanged. Always reports a null user (guest-equivalent);
   every consumer already handles the null-user path. */

export interface ForgeUser {
  id: string;
  email?: string | null;
}

export interface UseAuthResult {
  user: ForgeUser | null;
  session: null;
  loading: boolean;
  /** No-op — there is no session to end. Kept for call-site compatibility. */
  signOut: () => Promise<void>;
}

export function useAuth(): UseAuthResult {
  return { user: null, session: null, loading: false, signOut: async () => {} };
}
