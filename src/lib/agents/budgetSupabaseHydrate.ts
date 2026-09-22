/* budgetLedger — local ledger math for budgetTracker (Forge: no cloud ledger).
 *
 *  chargedUsdSum/sumLedgerCredits are pure helpers over caller-supplied
 *  rows (kept for the journal-backed ledger views). There is no hosted
 *  usage ledger anymore, so hydrateBudgetFromLedger resolves null (never
 *  invent 0 spend that would look like a successful empty ledger) and
 *  startBudgetLedgerReconcile is a no-op timer kept for call-site
 *  compatibility until Cockpit is reworked.
 */

import { usdToCredits } from '../billing/credits.js';

export interface LedgerRow {
  cost_charged_usd: number | string | null;
}

export interface LedgerPageQuery {
  fetchPage: (offset: number, limit: number) => Promise<{
    rows: LedgerRow[] | null;
    error: boolean;
  }>;
}

const PAGE_SIZE = 1000;
const MAX_PAGES = 10;

/** Net charged USD across rows. Non-finite values are skipped, never invented.
    Negative rows (refunds) count — the ledger is a real sum. */
export function chargedUsdSum(rows: readonly LedgerRow[]): number {
  let usd = 0;
  for (const r of rows) {
    const n = Number(r.cost_charged_usd ?? 0);
    if (!Number.isFinite(n)) continue;
    usd += n;
  }
  return usd;
}

/** Page the ledger until a short page or the hard cap. error → null. */
export async function sumLedgerCredits(query: LedgerPageQuery): Promise<number | null> {
  let usd = 0;
  for (let page = 0; page < MAX_PAGES; page++) {
    const { rows, error } = await query.fetchPage(page * PAGE_SIZE, PAGE_SIZE);
    if (error || !rows) return null;
    usd += chargedUsdSum(rows);
    if (rows.length < PAGE_SIZE) break;
  }
  if (usd < 0) return 0;
  return usdToCredits(usd);
}

export interface SessionUserClient {
  auth: {
    getSession: () => Promise<{
      data: { session: { user: { id: string } } | null };
    }>;
  };
  from: (table: string) => {
    select: (cols: string) => {
      eq: (col: string, val: string) => {
        range: (from: number, to: number) => Promise<{
          data: LedgerRow[] | null;
          error: { message: string } | null;
        }>;
      };
    };
  };
}

export async function fetchLedgerChargedCredits(
  client: SessionUserClient,
): Promise<number | null> {
  const { data } = await client.auth.getSession();
  const userId = data.session?.user.id;
  if (!userId) return null;
  return sumLedgerCredits({
    fetchPage: async (offset, limit) => {
      const { data: rows, error } = await client
        .from('usage_events')
        .select('cost_charged_usd')
        .eq('user_id', userId)
        .range(offset, offset + limit - 1);
      if (error) return { rows: null, error: true };
      return { rows: rows ?? [], error: false };
    },
  });
}

/** No hosted ledger exists — always resolves null (never invent spend).
 *  Kept for call-site compatibility. */
export async function hydrateBudgetFromSupabase(
  _client?: SessionUserClient,
): Promise<number | null> {
  void _client;
  return null;
}

/** No-op timer (see hydrateBudgetFromSupabase). Returns a stop function for
 *  call-site compatibility. */
export const LEDGER_RECONCILE_MS = 60_000;

export function startBudgetLedgerReconcile(
  _client?: SessionUserClient,
  _intervalMs: number = LEDGER_RECONCILE_MS,
): () => void {
  void _client;
  void _intervalMs;
  return () => {};
}
