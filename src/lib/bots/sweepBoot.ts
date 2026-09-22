/* sweepBoot — app-boot hook for bot runtime hygiene (Forge: no cloud
   sessions to sweep; the module survives as the boot hook's call-site
   contract so BotBootService keeps compiling unchanged).
*/

let swept = false;

/** Run once at app boot. Idempotent — calling it multiple times is safe
 *  but only the first call does anything (currently nothing). */
export async function bootSweepOrphans(): Promise<void> {
  if (swept) return;
  swept = true;
}

/** Reset the swept flag — tests only. */
export function resetSweepBoot(): void {
  swept = false;
}
