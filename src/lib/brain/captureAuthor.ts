/* captureAuthor.ts — "who wrote what and when" for every brain capture.
   Forge is single-user: the author is the local profile name (see
   getLocalAuthor below), stamped onto CaptureEvents so the resulting
   neurons carry data-cerveau-author on the article + each fact paragraph.
   Populated automatically when the event doesn't already carry one.

   Single choke point used by:
     - src/lib/brain/capture.ts's dispatch() (IDE captures),
     - src/lib/platform/tauri.ts + web.ts's brain.capture() (agent/manager
       and every other capture path) — so no capture can bypass attribution.
*/

import type { CaptureEvent } from '../platform/types.js';

const LS_AUTHOR_KEY = 'forge.profileName';

/** Local profile name — set once in Settings > General, defaults to the
 *  OS username when available. */
function getLocalAuthor(): string | undefined {
  try {
    const saved = localStorage.getItem(LS_AUTHOR_KEY)?.trim();
    if (saved) return saved;
  } catch {
    // ignore
  }
  return undefined;
}

export function setLocalAuthor(name: string): void {
  try {
    if (name.trim()) localStorage.setItem(LS_AUTHOR_KEY, name.trim());
    else localStorage.removeItem(LS_AUTHOR_KEY);
  } catch {
    // ignore
  }
}

let _cachedAuthor: string | null | undefined;
let _cachedAuthorId: string | null | undefined;
let _cachedDept: string | null | undefined;

/** Resolve the current user's display name (cached after first fetch). */
export async function resolveCaptureAuthor(): Promise<string | undefined> {
  if (_cachedAuthor !== undefined) return _cachedAuthor ?? undefined;
  await populateCaptureCache();
  return _cachedAuthor ?? undefined;
}

/** Resolve the current user's Supabase UUID (cached after first fetch). */
export async function resolveCaptureAuthorId(): Promise<string | undefined> {
  if (_cachedAuthorId !== undefined) return _cachedAuthorId ?? undefined;
  await populateCaptureCache();
  return _cachedAuthorId ?? undefined;
}

/** Resolve both author display name, author id, and department slug. */
export async function resolveCaptureIdentity(): Promise<{
  author?: string;
  authorId?: string;
  dept?: string;
}> {
  if (_cachedAuthor === undefined || _cachedAuthorId === undefined || _cachedDept === undefined) {
    await populateCaptureCache();
  }
  return {
    author: _cachedAuthor ?? undefined,
    authorId: _cachedAuthorId ?? undefined,
    dept: _cachedDept ?? undefined,
  };
}

/** Reset caches to "not yet fetched" (undefined). */
export function invalidateCaptureAuthor(): void {
  _cachedAuthor = undefined;
  _cachedAuthorId = undefined;
  _cachedDept = undefined;
}

async function populateCaptureCache(): Promise<void> {
  _cachedAuthor = getLocalAuthor() ?? null;
  _cachedAuthorId = null;
  _cachedDept = null;
}

/** Stamp `author` (and optionally `authorId`) onto the event unless it
 *  already has one (or no author is provided). */
export function withCaptureAuthor(
  event: CaptureEvent,
  author: string | undefined,
  authorId?: string,
): CaptureEvent {
  if (!author) return event;
  if (authorId && !event.authorId) {
    return { ...event, author: event.author ?? author, authorId };
  }
  if (!event.author) {
    return { ...event, author };
  }
  return event;
}

/** Enrich a capture event with the current user's identity (fire-and-forget
 *  safe: resolves the cached identity, returns the event unchanged on error). */
export async function enrichCaptureAuthor(event: CaptureEvent): Promise<CaptureEvent> {
  const { author, authorId, dept } = await resolveCaptureIdentity();
  let stamped = withCaptureAuthor(event, author, authorId);
  if (dept && !stamped.dept) {
    stamped = { ...stamped, dept };
  }
  return stamped;
}
