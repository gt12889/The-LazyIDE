/**
 * SettingsSpace.test.tsx
 *
 * Forge has no accounts/teams/billing: SettingsSpace offers the six local
 * tabs (models|memory|agents|appearance|general|health). This file asserts
 * the tab bar renders those tabs, switches between them, and never offers
 * an account/solari tab.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';

// ── i18n mock — returns the key, so assertions are locale-agnostic ─────

vi.mock('../i18n', () => ({
  useI18n: () => ({
    t: (key: string) => key,
    locale: 'en',
    setLocale: vi.fn(),
    LOCALES: [],
  }),
  useI18nOptional: () => ({
    t: (key: string) => key,
    locale: 'en',
    setLocale: vi.fn(),
    LOCALES: [],
  }),
}));

vi.mock('../components/ui/Toast', () => ({
  useToast: () => ({ toast: vi.fn() }),
  useToastSafe: () => ({ toast: vi.fn() }),
}));

import { SettingsSpace } from '../spaces/SettingsSpace';

describe('SettingsSpace — local tabs', () => {
  it('renders the six local tabs and no account/solari tab', () => {
    render(<SettingsSpace initialTab="models" />);

    for (const tab of ['models', 'memory', 'agents', 'appearance', 'general', 'health']) {
      expect(screen.getByTestId(`settings-tab-${tab}`)).toBeInTheDocument();
    }
    expect(screen.queryByTestId('settings-tab-account')).toBeNull();
    expect(screen.queryByTestId('settings-tab-solari')).toBeNull();
  });

  it('switches tabs on click', () => {
    render(<SettingsSpace initialTab="models" />);

    fireEvent.click(screen.getByTestId('settings-tab-general'));
    expect(screen.getByTestId('settings-tab-general')).toBeInTheDocument();
  });

  it('honors initialTab', () => {
    render(<SettingsSpace initialTab="health" />);

    expect(screen.getByTestId('settings-tab-health')).toBeInTheDocument();
  });
});
