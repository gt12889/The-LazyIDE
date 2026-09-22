/* useOnboarding — first-run detection hook (Forge: single local profile).
   The "onboarded" flag is a single local key — there are no accounts.
   The flag is written ONLY when the user finishes or explicitly skips —
   never merely on mount. Onboarding is gated to the desktop build.
*/

import { useState, useCallback, useEffect } from 'react';
import { isTauri } from '../../lib/platform';

const LS_KEY = 'forge.onboarded';

function readOnboarded(): boolean {
  try {
    return localStorage.getItem(LS_KEY) === '1';
  } catch {
    return true; // If storage is unavailable, don't block the user.
  }
}

function writeOnboarded(): void {
  try {
    localStorage.setItem(LS_KEY, '1');
  } catch {
    // localStorage unavailable — silently ignore.
  }
}

/** Clear the onboarding flag. */
export function resetOnboarding(): void {
  try {
    localStorage.removeItem(LS_KEY);
  } catch {
    // Silently ignore.
  }
}

interface UseOnboardingResult {
  /** True on first run on this device (no local onboarded flag yet) — the
      signal that should decide which onboarding steps render. */
  showOnboarding: boolean;
  completeOnboarding: () => void;
  rerunOnboarding: () => void;
  userEmail: string | null;
  /** Always false — there are no accounts. Kept for call-site compatibility. */
  isNewAccount: boolean;
}

export function useOnboarding(): UseOnboardingResult {
  const [showOnboarding, setShowOnboarding] = useState(false);

  useEffect(() => {
    if (!isTauri()) {
      setShowOnboarding(false);
      return;
    }
    setShowOnboarding(!readOnboarded());
  }, []);

  const completeOnboarding = useCallback(() => {
    writeOnboarded();
    setShowOnboarding(false);
  }, []);

  const rerunOnboarding = useCallback(() => {
    resetOnboarding();
    setShowOnboarding(true);
  }, []);

  return {
    showOnboarding,
    completeOnboarding,
    rerunOnboarding,
    userEmail: null,
    isNewAccount: false,
  };
}
