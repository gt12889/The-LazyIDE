import type { SupabaseClient } from '@supabase/supabase-js';
// No SDK client, session refresh, or network transport is created in this fork.
const unavailable = () => { throw new Error('Hosted accounts and billing are not available in lazygt.'); };
export const supabase = new Proxy({} as SupabaseClient, {
  get(_target, prop) { if (prop === 'then') return undefined; return unavailable; },
});
