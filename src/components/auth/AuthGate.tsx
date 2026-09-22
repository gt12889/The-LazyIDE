/* AuthGate — Forge: no accounts, no sign-in gate. Always passes through.
   Kept as a component so App.tsx's tree shape is unchanged.
*/

import type { ReactNode } from 'react';

interface AuthGateProps {
  children: ReactNode;
}

export function AuthGate({ children }: AuthGateProps) {
  return <>{children}</>;
}
