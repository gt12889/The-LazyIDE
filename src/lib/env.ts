// Compatibility exports for dormant upstream modules. No hosted configuration.
export const supabaseUrl = '';
export const supabaseAnonKey = '';
export { isCloudConfigured } from './envCloud.js';
export function getAiProxyUrl(): string { throw new Error('Hosted AI is not available in lazygt. Select Local or CLI.'); }
