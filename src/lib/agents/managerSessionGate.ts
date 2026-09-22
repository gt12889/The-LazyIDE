/* managerSessionGate — Forge: no hosted backend, so no turn ever needs a
   session. managerTurnNeedsSession/hasManagedSession survive as
   always-false/always-true call-site-compatible stubs until their last
   callers are reworked (Phase 3 removes them). The error-format helpers
   below are still live (chat bubbles, message list).
*/

import type { ProviderMode } from '../models/index.js';

/** No manager turn needs a session — Forge has no accounts. */
export function managerTurnNeedsSession(_model: string, _mode: ProviderMode): boolean {
  void _model;
  void _mode;
  return false;
}

/** Always true — there is no session to check. */
export async function hasManagedSession(): Promise<boolean> {
  return true;
}

/** Chat-bubble budget for a formatted manager error. 120 chars (the old
 *  pending-action label budget) cut the live DeepSeek-rail message mid
 *  sentence ("you may n…") after prefixes were already stripped. */
export const MANAGER_ERROR_MAX_CHARS = 400;

const STRIP = [
  /^(Error:\s*)+/i,
  /^Erreur\s*:\s*/i,
  /^Fehler:\s*/i,
  /^错误[：:]\s*/,
  /^エラー:\s*/i,
  /^ForgeManager error:\s*/i,
  /^LazyManager error:\s*/i,
  /^ManagedUnavailableError:\s*/i,
];

/** Innermost human message — strips nested Error:/manager error: wrappers.
 *  Appends the error's diagnostic `code` when it is informative and not
 *  already present in the message text. */
export function formatManagerUserError(err: unknown): string {
  const seen = new Set<unknown>();
  let current: unknown = err;
  let msg = '';
  let code: string | undefined;
  while (current !== null && current !== undefined && !seen.has(current)) {
    seen.add(current);
    if (current instanceof Error) {
      msg = current.message || String(current);
      const maybeCode = (current as { code?: unknown }).code;
      if (typeof maybeCode === 'string' && maybeCode && !code) code = maybeCode;
      current = current.cause;
    } else {
      msg = String(current);
      break;
    }
  }
  const stripped = stripManagerErrorPrefixes(msg) || 'unknown error';
  return decorateWithDiagnosticCode(stripped, code);
}

/** Appends the diagnostic code to the stripped message — with named
 *  translations for codes where the bare string is not actionable. */
function decorateWithDiagnosticCode(stripped: string, code: string | undefined): string {
  if (code === 'upstream_error_429') {
    return 'Rate limit reached on the engine side — retry in a bit or switch engine (upstream_error_429)';
  }
  if (code && code !== 'managed_unavailable' && !stripped.includes(code)) {
    return `${stripped} (${code})`;
  }
  return stripped;
}

/** Render-time backstop for persisted bubbles that still carry nested
 *  `Error: Error: LazyManager error:` wrappers from before ingest sanitizing. */
export function stripManagerErrorPrefixes(raw: string): string {
  let msg = raw.trim();
  let prev = '';
  while (msg !== prev) {
    prev = msg;
    for (const re of STRIP) msg = msg.replace(re, '').trim();
  }
  return msg;
}
