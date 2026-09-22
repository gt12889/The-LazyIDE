/* botApprovalScreenshot — approval page-context enrichment.
   Forge has no cloud VM to screenshot; the enricher is a pass-through kept
   so the approval pipeline keeps compiling unchanged. */

import type { PageContext } from '../agents/approval/approvalTypes.js';

/** Enrich page context — currently a pass-through (no VM screenshots). */
export function enrichApprovalPageContext(
  _missionId: string,
  page: PageContext,
): PageContext {
  void _missionId;
  return page;
}
