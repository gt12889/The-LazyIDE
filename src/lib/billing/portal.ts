export type Translate = (key: string, params?: Record<string, string | number>) => string;
export async function openBillingPortal(_t?: Translate) { return { error: 'Billing is not available in lazygt.' }; }
export async function openOrgBillingPortal(_orgId: string, _t?: Translate) { return openBillingPortal(); }
