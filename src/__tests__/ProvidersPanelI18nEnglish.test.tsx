/* ProvidersPanelI18nEnglish.test.tsx — regression test for hardcoded French
   leaking into Settings > Models > "Available engines".

   ProvidersPanel renders one BackendCard per lib/models/readiness.ts
   descriptor (Claude Code, Codex CLI, local Ollama engine). Those
   descriptors must resolve through the active locale (English here), never
   render raw keys or another locale's copy. This test mounts the real
   component under an English I18nProvider and asserts the English cards.
*/

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import { I18nProvider } from '../i18n';
import { ProvidersPanel } from '../components/settings/ProvidersPanel';

function wrapper({ children }: { children: React.ReactNode }) {
  return <I18nProvider>{children}</I18nProvider>;
}

describe('ProvidersPanel — "Available engines" renders in English with no hardcoded French', () => {
  it('shows the English section title and card labels', async () => {
    localStorage.setItem('lazy.locale', 'en');

    render(<ProvidersPanel />, { wrapper });

    expect(await screen.findByText('Available engines')).toBeInTheDocument();
    expect(screen.getByText('Claude Code (subscription)')).toBeInTheDocument();
    expect(screen.getByText('Codex CLI (OpenAI)')).toBeInTheDocument();
    expect(screen.getByText('Local LLM (Ollama / LM Studio)')).toBeInTheDocument();

    localStorage.removeItem('lazy.locale');
  });

  it('contains none of the known French strings the panel previously hardcoded', async () => {
    localStorage.setItem('lazy.locale', 'en');

    const { container } = render(<ProvidersPanel />, { wrapper });
    await screen.findByText('Available engines');

    const text = container.textContent ?? '';
    expect(text).not.toMatch(/abonnement/i);
    expect(text).not.toMatch(/Clé API/i);
    expect(text).not.toMatch(/géré par Lazy/i);
    expect(text).not.toMatch(/introuvable sur PATH/i);
    expect(text).not.toMatch(/Réglages >/);

    localStorage.removeItem('lazy.locale');
  });
});
