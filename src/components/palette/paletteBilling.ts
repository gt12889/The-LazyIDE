import type { PaletteItem } from './paletteItems';
export type BillingCommandAction = 'upgradePro' | 'topup' | 'manage' | 'upgradeProPlus';
type Translate = (key: string, params?: Record<string, string | number>) => string;
export function buildBillingCommandItems(_pro: boolean, _plus: boolean, _t: Translate): PaletteItem[] { return []; }
export async function runBillingCommand(_action: BillingCommandAction, _t?: Translate) { return { error: 'Billing is not available in lazygt.' }; }
