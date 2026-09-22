/* solariClient — lazy singletons for the three Solari SDK clients, plus
   vault-backed API key management and typed error mapping.

   Construction is lazy on purpose: importing this module never reads the
   vault and never constructs an SDK client, so it is safe to import (and
   unit-test) with a mocked vault. The Solari API key lives ONLY in the OS
   vault under the "solari" key (see vaultClient.ts); it is never cached or
   persisted anywhere else in the app.
*/

import type { DesktopClient as SolariDesktopClient } from '@solarisdk/desktop';
import type { SandboxClient as SolariSandboxClient } from '@solarisdk/sandbox';
import { emit } from '../bus.js';

export const SOLARI_VAULT_KEY = 'solari';


export interface SolariCdpProxyOpts { isDev?: boolean }
export function solariCdpProxyBase(_opts?: SolariCdpProxyOpts): string { throw new Error('Cloud browser support was removed from lazygt.'); }
export async function hydrateSolariCdpProxy(_opts?: { force?: boolean; isDev?: boolean }): Promise<string | null> { return null; }
export function resetSolariCdpProxyCache(): void {}
export const SOLARI_PROD_CORS_NOTE = 'Cloud browser support was removed from lazygt.';
export interface SolariClients {
  browser: CloudSolariBrowserClient;
  desktop: SolariDesktopClient;
  sandbox: SolariSandboxClient;
}

export type SolariErrorKind =
  | 'auth'
  | 'credit'
  | 'plan'
  | 'conflict'
  | 'concurrency'
  | 'badRequest'
  | 'transient'
  | 'unknown';

/** Thrown when the Solari API key is not (or not yet) configured in the vault. */
export class SolariNotConfiguredError extends Error {
  constructor() {
    super('Solari API key is not configured — set it in Settings > Solari.');
    this.name = 'SolariNotConfiguredError';
  }
}

/** Typed Solari error mapped from an SDK error by status/code fields only. */
export class SolariApiError extends Error {
  readonly kind: SolariErrorKind;
  readonly status?: number;
  readonly code?: string;
  readonly retryable: boolean;

  constructor(kind: SolariErrorKind, status?: number, code?: string) {
    super(kind);
    this.name = 'SolariApiError';
    this.kind = kind;
    this.status = status;
    this.code = code;
    this.retryable = kind === 'transient';
  }

  /** Short, actionable sentence a UI surface can show the user. */
  get userMessage(): string {
    switch (this.kind) {
      case 'auth':
        return 'Your Solari API key is invalid or missing — set it in Settings > Solari.';
      case 'credit':
        return 'Solari credits are exhausted — top up in the Solari console.';
      case 'plan':
        return 'This Solari feature requires a paid plan (desktops/VMs are not on the free tier) — upgrade in the Solari console.';
      case 'conflict':
        return 'A conflict occurred (for example, the profile editor is open) — close it and retry.';
      case 'concurrency':
        return 'Solari concurrency limit reached — close a session before opening another.';
      case 'badRequest':
        return 'The Solari request was rejected — check the request and retry.';
      case 'transient':
        return 'A transient Solari error occurred — retry shortly.';
      case 'unknown':
        return 'An unexpected Solari error occurred — retry or contact support.';
    }
  }
}


/** True when the vault holds a non-empty Solari API key. */
export async function isSolariConfigured(): Promise<boolean> { return false; }
export async function assertSolariConfigured(): Promise<void> { throw new Error('Cloud tools are removed from lazygt.'); }
export async function getSolariClients(): Promise<SolariClients> { throw new Error('Cloud tools are removed from lazygt.'); }
export function resetSolariClients(): void {}

/** Emits 'solari:configuredChange' with the current configured state; call
 *  after the vault key is set or deleted. */
export async function emitSolariConfiguredChange(): Promise<void> {
  emit('solari:configuredChange', { configured: await isSolariConfigured() });
}

/** Maps an SDK error to a SolariApiError by status/code fields only — never
 *  by error prose. Accepts the typed SDK errors (they expose status/code) and
 *  any object carrying those fields as numbers or strings. */
export function mapSolariError(err: unknown): SolariApiError {
  // The "no key configured" case has no status/code fields, so recognise it
  // explicitly — otherwise it maps to 'unknown' and hides the actionable
  // "set your key" guidance behind a generic "unexpected error" message.
  if (err instanceof SolariNotConfiguredError) return new SolariApiError('auth');
  // Already-typed errors (thrown by CloudSolariBrowserClient.http) carry a
  // computed kind — re-deriving from status would downgrade statuses outside
  // the switch below (e.g. 404 → 'badRequest' became 'unknown').
  if (err instanceof SolariApiError) return err;
  const status = numericField(err, 'status');
  const code = stringField(err, 'code');
  if (status === 401) return new SolariApiError('auth', status, code);
  if (status === 402) {
    // A 402 can mean credits exhausted OR a feature the account's plan doesn't
    // include (desktops/VMs on the free tier). Distinguish by code so the UI
    // doesn't say "top up credits" for a plan-gated feature.
    if (code === 'FeatureRequiresPlan') return new SolariApiError('plan', status, code);
    return new SolariApiError('credit', status, code);
  }
  if (status === 409) return new SolariApiError('conflict', status, code);
  if (status === 429 || code === 'ConcurrencyLimitExceeded') {
    return new SolariApiError('concurrency', status, code);
  }
  if (status === 400) return new SolariApiError('badRequest', status, code);
  // 501 "not implemented" is a definitive feature-gap, not a transient
  // failure — retrying the identical request can never succeed.
  if (status === 501) return new SolariApiError('badRequest', status, code);
  // Other 5xx and request timeouts are infrastructure problems — retryable.
  if ((status !== undefined && status >= 500) || status === 408) {
    return new SolariApiError('transient', status, code);
  }
  // Remaining 4xx (403, 404, 405, 410, 422…) are request-level rejections —
  // 'badRequest' is more actionable than the opaque 'unknown'.
  if (status !== undefined && status >= 400) {
    return new SolariApiError('badRequest', status, code);
  }
  // SDK transport errors carry no status/code: TimeoutError (a control-channel
  // RPC exceeded its deadline — e.g. a sandbox template that does not serve
  // the `code.*` family lets code.context.create hang until the SDK's 300s
  // cap, real incident M121) and ConnectionError (channel down) are
  // infrastructure problems too — 'transient', never the opaque 'unknown'.
  // The failed RPC method is kept on `code` for diagnostics.
  const errName = stringField(err, 'name');
  if (errName === 'TimeoutError' || errName === 'ConnectionError') {
    return new SolariApiError('transient', status, code ?? stringField(err, 'method'));
  }
  if (asRecord(err).retryable === true) return new SolariApiError('transient', status, code);
  return new SolariApiError('unknown', status, code);
}

function asRecord(err: unknown): Record<string, unknown> {
  return typeof err === 'object' && err !== null ? (err as Record<string, unknown>) : {};
}

function numericField(err: unknown, key: string): number | undefined {
  const value = asRecord(err)[key];
  if (typeof value === 'number') return value;
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) {
    return Number(value);
  }
  return undefined;
}

function stringField(err: unknown, key: string): string | undefined {
  const value = asRecord(err)[key];
  if (typeof value === 'string') return value;
  return typeof value === 'number' ? String(value) : undefined;
}


// ── Cloud browser client (bundle-safe HTTP + CDP, no patchright) ───

import { CloudCdpBrowser, type CdpBrowserSession } from './cdpBrowser.js';

export interface CloudBrowserLaunchOptions {
  profileId?: string;
  stealth?: boolean;
  proxy?: { country?: string; tier?: string; session?: string; sessionDuration?: number };
  captcha?: boolean;
  recording?: boolean;
  webBotAuth?: boolean;
}

/** Minimal Solari browser client over plain HTTP (through /solari-api) + the
 *  CDP driver in cdpBrowser.ts. Exposes the sessions/profiles/launch surface
 *  the LazyBot cloud tools rely on, without the patchright dependency that
 *  cannot bundle in the webview. */
export class CloudSolariBrowserClient {
  constructor(_apiKey: string, _baseUrl: string) { throw new Error('Cloud browser support was removed from lazygt.'); }
  private async http(_method: string, _path: string, _body?: unknown): Promise<Response> { throw new Error('Cloud browser support was removed from lazygt.'); }

  private async createSession(opts: CloudBrowserLaunchOptions = {}): Promise<CdpBrowserSession> {
    const body: Record<string, unknown> = {};
    if (opts.profileId) body.profileId = opts.profileId;
    if (opts.recording) body.recording = true;
    if (opts.stealth === true) body.stealth = true;
    if (opts.captcha === true) body.captcha = true;
    if (opts.webBotAuth === true) body.webBotAuth = true;
    if (opts.proxy !== undefined) body.proxy = opts.proxy;
    const res = await this.http('POST', '/sessions', body);
    const data = (await res.json()) as {
      sessionId: string;
      wsEndpoint?: string;
      cdpEndpoint?: string;
      expiresAt?: string;
      proxy?: CdpBrowserSession['proxy'];
    };
    if (!data.sessionId) throw new Error('Solari: unexpected session response');
    return {
      id: data.sessionId,
      cdpEndpoint: data.cdpEndpoint ?? data.wsEndpoint ?? '',
      expiresAt: data.expiresAt ?? new Date(Date.now() + 60 * 60_000).toISOString(),
      proxy: data.proxy,
    };
  }

  async launch(opts: CloudBrowserLaunchOptions = {}): Promise<CloudCdpBrowser> {
    const session = await this.createSession(opts);
    const id = session.id;
    return CloudCdpBrowser.connect(session, solariCdpProxyBase(), () => this.release(id));
  }

  async release(id: string): Promise<void> {
    await this.http('DELETE', `/sessions/${encodeURIComponent(id)}`);
  }

  async getReplayUrl(id: string): Promise<{ url: string }> {
    const res = await this.http('GET', `/sessions/${encodeURIComponent(id)}/replay-url`);
    const data = (await res.json()) as { url?: string };
    if (!data.url) throw new Error('Solari: unexpected replay-url response');
    return { url: data.url };
  }

  /** Download the NDJSON replay transcript for a released session.
   *  CREDENTIAL MATERIAL: the replay can embed page content and secrets —
   *  callers must store it under .lazy/ and never log or surface it raw.
   *  Returns raw BYTES (the object is .ndjson.gz) — text-decoding them
   *  would corrupt the archive. In dev the fetch goes through the Vite
   *  /solari-replay proxy: a direct webview fetch to storage.googleapis.com
   *  is CORS-blocked (verified live). Packaged Tauri callers should prefer
   *  the Rust solari_replay_download command instead of this path. */
  async downloadReplay(_id: string): Promise<ArrayBuffer> { throw new Error('Cloud replay support was removed from lazygt.'); }

  async listProfiles(): Promise<Array<{ id: string; name: string }>> {
    const res = await this.http('GET', '/profiles');
    const data = (await res.json()) as { profiles?: Array<{ id: string; name: string }> };
    return data.profiles ?? (data as unknown as Array<{ id: string; name: string }>);
  }

  async createProfile(opts: { name: string }): Promise<{ id: string; name: string }> {
    const res = await this.http('POST', '/profiles', opts);
    return (await res.json()) as { id: string; name: string };
  }

  async deleteProfile(id: string): Promise<void> {
    await this.http('DELETE', `/profiles/${encodeURIComponent(id)}`);
  }

  async saveProfile(id: string, storageState: unknown): Promise<void> {
    await this.http('POST', `/profiles/${encodeURIComponent(id)}/save`, { storageState });
  }

  readonly sessions = {
    create: (opts?: CloudBrowserLaunchOptions): Promise<CdpBrowserSession> => this.createSession(opts ?? {}),
    release: (id: string): void => {
      void this.release(id).catch((err) => console.error('[solari] browser release failed', err));
    },
    releaseAndWait: (id: string): Promise<void> => this.release(id),
    getReplayUrl: (id: string): Promise<{ url: string }> => this.getReplayUrl(id),
    downloadReplay: (id: string): Promise<ArrayBuffer> => this.downloadReplay(id),
  };

  readonly profiles = {
    list: (): Promise<Array<{ id: string; name: string }>> => this.listProfiles(),
    create: (opts: { name: string }): Promise<{ id: string; name: string }> => this.createProfile(opts),
    delete: (id: string): Promise<void> => this.deleteProfile(id),
    save: (id: string, storageState: unknown): Promise<void> => this.saveProfile(id, storageState),
  };
}
