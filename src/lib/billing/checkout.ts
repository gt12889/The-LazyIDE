const removed = async () => ({ error: 'Billing is not available in lazygt.' });
export async function startTeamsCheckout(_orgId: string, _seats: number, _monthlyCredits: number) { return removed(); }
export async function startTeamsTopup(_orgId: string, _amount: number) { return removed(); }
export async function startProCheckout(_plan: 'pro' | 'pro_plus' = 'pro') { return removed(); }
export async function startPlanChange(_plan: 'pro' | 'pro_plus') { return removed(); }
export async function startTopup(_amount: number) { return removed(); }
