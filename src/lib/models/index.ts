import { isTauri } from '../platform/index.js';
import type { ModelInfo, ModelProvider } from './types.js';
import { loadAccessSettings } from './accessSettings.js';
import { cliBackendProvider, detectAllCliBackends, isCliBackendAvailable } from './cliBackendProvider.js';
import { localProvider } from './localProvider.js';
import { DEFAULT_MODEL, findModelById } from './registry.js';
import { DEFAULT_DEVIN_MODEL_ID, findDevinModel } from './devinCatalog.js';

export * from './types.js';
export * from './registry.js';
export * from './costStore.js';
export * from './claudeCodeProvider.js';
export * from './cliBackendProvider.js';
export * from './managedProvider.js';
export * from './byokProviders.js';
export * from './accessSettings.js';
export * from './streamEvents.js';
export * from './devinCatalog.js';
export { localProvider, isLocalAvailable, detectLocalBaseUrl, listLocalModels } from './localProvider.js';

// Legacy discriminants remain for saved missions and upstream UI type compatibility.
// None of the hosted modes can be selected or routed in lazygt.
export type ProviderMode = 'claude-code' | 'codex' | 'devin' | 'local' | 'live-key' | 'managed' | 'pro' | 'mock';
export type ProPlanState = 'unknown' | 'active' | 'inactive';
export function setManagedAvailability(_active: boolean): void {}
export function setProPlanActive(_active: boolean): void {}
export function isProPlanActive(): boolean { return false; }
export function getProPlanState(): ProPlanState { return 'inactive'; }
export function hasManagedCreditsActive(): boolean { return false; }
export function isManagedActive(): boolean { return false; }

export async function initProviderMode(): Promise<void> {
  if (isTauri()) await detectAllCliBackends();
}
export function getProviderMode(): ProviderMode {
  const settings = loadAccessSettings();
  if (settings.accessMode !== 'cli') return 'local';
  return settings.cliTool === 'codex' ? 'codex' : settings.cliTool === 'devin' ? 'devin' : 'claude-code';
}
export function getDefaultModelIdForMode(mode: ProviderMode): string {
  if (mode === 'local') return localProvider.listModels()[0].id;
  if (mode === 'codex') return '';
  if (mode === 'devin') return DEFAULT_DEVIN_MODEL_ID;
  return DEFAULT_MODEL.id;
}
export function getActiveModel(): ModelInfo {
  const mode = getProviderMode();
  const { model } = loadAccessSettings();
  if (mode === 'local') return localProvider.listModels()[0];
  if (mode === 'codex') return { id: '', label: 'Codex CLI default', provider: 'openai' };
  if (mode === 'devin') return findDevinModel(model) ?? findDevinModel(DEFAULT_DEVIN_MODEL_ID)!;
  return findModelById(model ?? '') ?? DEFAULT_MODEL;
}
export interface ProviderReadiness { ready: boolean; reason?: string }
export function describeProviderReadiness(mode = getProviderMode(), _t?: (key: string, params?: Record<string, string | number>) => string): ProviderReadiness {
  if (mode === 'local') return { ready: true };
  if (!isTauri()) return { ready: false, reason: 'CLI tools require the lazygt desktop app. Use Local in the browser.' };
  const tool = mode === 'codex' ? 'codex' : mode === 'devin' ? 'devin' : 'claude';
  return isCliBackendAvailable(tool) === false ? { ready: false, reason: `Install and sign in to ${tool}, then restart lazygt.` } : { ready: true };
}
export function getProvider(_t?: (key: string, params?: Record<string, string | number>) => string): ModelProvider {
  const settings = loadAccessSettings();
  if (settings.accessMode === 'cli') {
    if (!isTauri()) return { id: 'none', label: 'Desktop required', listModels: () => [], async *streamChat() { throw new Error('CLI tools require the lazygt desktop app. Select Local in Settings.'); } };
    return cliBackendProvider(settings.cliTool ?? 'claude');
  }
  return localProvider;
}
