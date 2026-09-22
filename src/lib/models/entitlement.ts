import { loadAccessSettings } from './accessSettings.js';
import { describeProviderReadiness, getProviderMode } from './index.js';
export type EngineReadinessReason = 'cli-not-found' | 'byok-no-key' | 'pro-inactive' | 'pro-no-credits';
export type EngineReadiness = { mode: 'cli' | 'byok' | 'pro' | 'local'; ready: boolean; reason?: EngineReadinessReason };
export function engineReasonKey(reason: EngineReadinessReason): string { return `engine.reason.${reason}`; }
export function getEngineReadiness(forMode?: EngineReadiness['mode'], _modelId?: string): EngineReadiness {
 const mode = forMode ?? loadAccessSettings().accessMode ?? 'local';
 if (mode === 'local') return { mode, ready: true };
 if (mode !== 'cli') return { mode, ready: false, reason: mode === 'pro' ? 'pro-inactive' : 'byok-no-key' };
 const ready = describeProviderReadiness(getProviderMode()).ready;
 return { mode, ready, reason: ready ? undefined : 'cli-not-found' };
}
export function isAnyEngineUsable(): boolean { return getEngineReadiness().ready; }
