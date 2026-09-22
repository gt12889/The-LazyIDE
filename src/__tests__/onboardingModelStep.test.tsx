/**
 * onboardingModelStep.test.tsx
 *
 * Onboarding "model" step honesty. The step presents the 2 real access
 * modes (local/cli) with LIVE detection via the same getEngineReadiness()
 * used everywhere else (mission/composer preflight). Local is marked
 * "recommended" — it ships with the Forge setup. Picking a mode writes
 * accessMode through the same saveAccessSettings() path Settings uses.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import { ModelCheckStep } from '../components/onboarding/steps/ModelCheckStep';
import { I18nProvider } from '../i18n';
import { fr } from '../i18n/locales/fr';
import { getEngineReadiness } from '../lib/models/entitlement';
import { loadAccessSettings } from '../lib/models/accessSettings';

vi.mock('../lib/models/entitlement', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/models/entitlement')>();
  return { ...actual, getEngineReadiness: vi.fn() };
});

vi.mock('../lib/models/cliBackendProvider', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/models/cliBackendProvider')>();
  return { ...actual, detectAllCliBackends: vi.fn().mockResolvedValue(undefined) };
});

const mockedReadiness = vi.mocked(getEngineReadiness);

function readinessFor(mode: string): { mode: 'cli' | 'local'; ready: boolean; reason?: 'cli-not-found' | 'local-unreachable' } {
  if (mode === 'cli') return { mode: 'cli', ready: true };
  return { mode: 'local', ready: true };
}

function renderStep(onNext = vi.fn(), onBack = vi.fn()) {
  render(
    <I18nProvider>
      <ModelCheckStep onNext={onNext} onBack={onBack} />
    </I18nProvider>,
  );
  return { onNext, onBack };
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  localStorage.setItem('lazy.locale', 'fr');
  mockedReadiness.mockImplementation((forMode) => readinessFor(forMode ?? 'local'));
});

describe('ModelCheckStep — 2-mode live detection', () => {
  it('renders both modes with their live detection state', async () => {
    renderStep();

    expect(await screen.findByText(fr['onboarding.model.mode.cli'])).toBeInTheDocument();
    expect(screen.getByText(fr['onboarding.model.mode.local'])).toBeInTheDocument();

    // Both ready -> honest "ready" one-liners.
    expect(screen.getAllByText(fr['onboarding.model.ready']).length).toBeGreaterThanOrEqual(1);
  });

  it('shows the CLI reason copy when the CLI is not detected', async () => {
    mockedReadiness.mockImplementation((forMode) => {
      if (forMode === 'cli') return { mode: 'cli', ready: false, reason: 'cli-not-found' };
      return { mode: 'local', ready: true };
    });
    renderStep();
    await screen.findByText(fr['onboarding.model.mode.cli']);
    expect(screen.getByText(fr['engine.reason.cli-not-found'])).toBeInTheDocument();
  });

  it('marks local as "recommended"', async () => {
    renderStep();
    await screen.findByText(fr['onboarding.model.mode.local']);
    expect(screen.getAllByText(fr['onboarding.model.recommended'])).toHaveLength(1);
  });

  it('selecting a mode writes accessMode through saveAccessSettings (same path Settings uses)', async () => {
    renderStep();
    fireEvent.click(await screen.findByText(fr['onboarding.model.mode.cli']));

    await waitFor(() => {
      expect(loadAccessSettings().accessMode).toBe('cli');
    });
  });

  it('never hard-blocks: Continuer always proceeds regardless of readiness', async () => {
    const { onNext } = renderStep();
    fireEvent.click(await screen.findByText(fr['onboarding.model.continue']));
    expect(onNext).toHaveBeenCalled();
  });

  it('Retour calls onBack', async () => {
    const { onBack } = renderStep();
    fireEvent.click(await screen.findByText(fr['onboarding.model.back']));
    expect(onBack).toHaveBeenCalled();
  });
});
