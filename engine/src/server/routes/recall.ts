/**
 * server/routes/recall.ts — GET/POST /_api/recall
 *
 * Turn-mode recall over HTTP: the SAME scoring/intent-routing/token-budget/
 * session-dedup pipeline as `lazybrain inject-context --mode turn` (see
 * runTurnInjectDetailed in commands/inject-context.ts), served by the WARM
 * sidecar process instead of paying a fresh cold CLI subprocess per call.
 *
 * Added because /_api/search (routes/search.ts) only exposes the raw
 * router.ts `route()` call — none of the turn-mode-specific layers (trivial-
 * prompt short-circuit, feature-map fast path, per-level score floors,
 * active-file boost, intent-routed selective stripping, token budget, recall
 * nudge, session dedup) — so the Rust side (src-tauri/src/commands/brain/
 * search.rs) had no warm-sidecar way to reach them and fell back to raw
 * `search --strip --top 6` for per-turn recall. See recall_from_warm_sidecar
 * in that file for the caller.
 */
import { runTurnInjectDetailed } from '../../commands/inject-context.js';
import { parseNudgeStyle } from '../../commands/inject-context/markers.js';
import { getLogger } from '../../util/logger.js';
import { sendJsonCached } from '../cache.js';
import { mapDbError, sendError } from '../security.js';
import type { RouteHandler } from '../types.js';

// ---------------------------------------------------------------------------
type RecallRequest = {
  query: string;
  cwd?: string;
  sessionId?: string;
  maxTokens?: number;
  nudge?: string | null;
};

function readBody(req: Parameters<RouteHandler>[0]): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.setEncoding('utf8');
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > 1024 * 1024) {
        req.destroy(new Error('Request body too large'));
      }
    });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

async function recallRequestFrom(req: Parameters<RouteHandler>[0], url: URL): Promise<RecallRequest> {
  if (req.method === 'POST') {
    const body = await readBody(req);
    const parsed = JSON.parse(body || '{}') as Partial<RecallRequest>;
    return {
      query: typeof parsed.query === 'string' ? parsed.query : '',
      cwd: typeof parsed.cwd === 'string' ? parsed.cwd : undefined,
      sessionId: typeof parsed.sessionId === 'string' ? parsed.sessionId : undefined,
      maxTokens: typeof parsed.maxTokens === 'number' ? parsed.maxTokens : undefined,
      nudge: typeof parsed.nudge === 'string' ? parsed.nudge : null,
    };
  }

  return {
    query: url.searchParams.get('q') ?? '',
    cwd: url.searchParams.get('cwd') ?? undefined,
    sessionId: url.searchParams.get('sessionId') ?? undefined,
    maxTokens: Number.parseInt(url.searchParams.get('maxTokens') ?? '1500', 10),
    nudge: url.searchParams.get('nudge'),
  };
}

// GET /_api/recall?q=...&cwd=...&top=...&maxTokens=...&sessionId=...&nudge=...
// POST /_api/recall { query, cwd, sessionId, maxTokens, nudge }
// ---------------------------------------------------------------------------

export const handleRecall: RouteHandler = (req, res, url) => {
  const log = getLogger();
  try {
    recallRequestFrom(req, url)
      .then(({ query, cwd, sessionId, maxTokens, nudge }) => {
        if (!query) {
          sendError(res, 400, 'Missing q parameter');
          return null;
        }
        // The IDE (Rust caller) always sends its own nudge explicitly — see
        // search.rs's recall_from_warm_sidecar, which passes nudge=tool. A
        // missing/unrecognized value still degrades to the engine-wide default
        // ('skill') rather than throwing, matching every other CLI/route option
        // in this codebase.
        const parsedNudge = parseNudgeStyle(nudge);
        // The sidecar's own background cache-priming probe (see
        // src-tauri/src/commands/brain/sidecar/warmup.rs's
        // spawn_brain_recall_warmup) sends this header on its one synthetic
        // recall per sidecar lifecycle. It is not real user activity, so it
        // must not inflate Settings > Memory's "Queries (24h)" diagnostic —
        // see InjectContextCliOptions.skipTelemetry's doc comment for the full
        // rationale.
        const skipTelemetry = req.headers['x-lazy-warmup'] === '1';

        return runTurnInjectDetailed({
          query,
          cwd,
          sessionId,
          maxTokens: Number.isFinite(maxTokens) ? maxTokens : undefined,
          nudge: parsedNudge,
          skipTelemetry,
        }).then((result) => ({ query, result }));
      })
      .then((result) => {
        if (!result) return;
        const data = {
          query: result.query,
          text: result.result.text,
          level: result.result.levelUsed,
          tokens: result.result.tokens,
        };
        return sendJsonCached(req, res, 200, data);
      })
      .catch((err) => {
        if (mapDbError(res, err)) return;
        log.error({ err }, 'API error in /_api/recall');
        sendError(res, 500, 'Recall failed');
      });
  } catch (err) {
    if (mapDbError(res, err)) return;
    log.error({ err }, 'API error in /_api/recall');
    sendError(res, 500, 'Recall error');
  }
};
