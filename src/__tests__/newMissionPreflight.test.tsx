/**
 * newMissionPreflight.test.tsx
 *
 * v0.1.5 W2.2 — engine preflight before launching a mission.
 * Submitting the New Mission modal must call getEngineReadiness() first:
 * when the selected engine is not ready, NO mission is added and an inline
 * panel explains why, with actions to configure the engine (Settings >
 * Models) or go Pro (Settings > Account) for entitlement reasons.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import React from 'react';
import { NewMissionModal } from '../components/agents/NewMissionModal';
import { I18nProvider } from '../i18n';
import { fr } from '../i18n/locales/fr';
import { getEngineReadiness } from '../lib/models/entitlement';
import { emit } from '../lib/bus';

const mockAddMission = vi.fn();

vi.mock('../lib/models/entitlement', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/models/entitlement')>();
  return { ...actual, getEngineReadiness: vi.fn() };
});

// Desktop build offers CLI + local rails — same rails the assertions pick.
vi.mock('../lib/models/modelPickerOptions', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/models/modelPickerOptions')>();
  return {
    ...actual,
    getModelPickerOptions: (t?: Parameters<typeof actual.getModelPickerOptions>[0]) =>
      actual.buildModelPickerOptions(
        { claudeSub: true, codexManaged: false, devin: false, local: true },
        t,
      ),
  };
});

vi.mock('../components/agents/agentsStore', () => ({
  useAgentsStore: () => ({ addMission: mockAddMission }),
  useAgentsStoreActions: () => ({ addMission: mockAddMission }),
  useAgentsStoreMissionsOptional: () => null,
}));

vi.mock('../app/AppContext', () => ({
  useAppContext: () => ({ projectRoot: 'C:\\proj\\demo' }),
}));

vi.mock('../lib/bus', () => ({
  emit: vi.fn(),
  on: vi.fn(() => () => {}),
}));

const mockedReadiness = vi.mocked(getEngineReadiness);
const mockedEmit = vi.mocked(emit);

function renderModal(onClose = vi.fn()) {
  render(
    <I18nProvider>
      <NewMissionModal isOpen onClose={onClose} />
    </I18nProvider>,
  );
  return onClose;
}

function fillTitleAndSubmit(title = 'Ma mission de test') {
  const input = document.getElementById('nm-title') as HTMLInputElement;
  fireEvent.change(input, { target: { value: title } });
  fireEvent.click(screen.getByText(fr['agents.modal.submit']));
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  localStorage.setItem('lazy.locale', 'fr');
  mockedReadiness.mockReturnValue({ mode: 'cli', ready: true });
});

describe('NewMissionModal — engine preflight', () => {
  it('not ready (cli-not-found): submit adds NO mission and shows the reason panel', () => {
    mockedReadiness.mockReturnValue({ mode: 'cli', ready: false, reason: 'cli-not-found' });
    renderModal();

    fillTitleAndSubmit();

    expect(mockAddMission).not.toHaveBeenCalled();
    const panel = screen.getByTestId('mission-preflight-panel');
    expect(panel).toHaveTextContent(fr['engine.reason.cli-not-found']);
    expect(screen.getByTestId('preflight-configure')).toBeInTheDocument();
  });

  it('local-unreachable: panel shows the local reason', () => {
    mockedReadiness.mockReturnValue({ mode: 'local', ready: false, reason: 'local-unreachable' });
    renderModal();

    fillTitleAndSubmit();

    expect(mockAddMission).not.toHaveBeenCalled();
    expect(screen.getByTestId('mission-preflight-panel')).toBeInTheDocument();
  });

  it('"Configurer le moteur" navigates to Settings > Models (space id models)', () => {
    mockedReadiness.mockReturnValue({ mode: 'cli', ready: false, reason: 'cli-not-found' });
    const onClose = renderModal();

    fillTitleAndSubmit();
    fireEvent.click(screen.getByTestId('preflight-configure'));

    expect(mockedEmit).toHaveBeenCalledWith('nav:navigateSpace', 'models');
    expect(onClose).toHaveBeenCalled();
  });

  it('ready: submit adds the mission, closes, and never shows the panel', () => {
    mockedReadiness.mockReturnValue({ mode: 'cli', ready: true });
    const onClose = renderModal();

    fillTitleAndSubmit('Mission prete');

    expect(mockAddMission).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalled();
    expect(screen.queryByTestId('mission-preflight-panel')).not.toBeInTheDocument();
  });

  // Helper for the searchable model picker (was a native <select>): open
  // the popover and click the row wrapped in [data-model-id="<id>"].
  function pickModalModel(modelId: string) {
    fireEvent.click(document.getElementById('nm-model') as HTMLElement);
    const row = document.querySelector(`[data-model-id="${modelId}"] button`);
    expect(row).not.toBeNull();
    fireEvent.click(row as HTMLElement);
  }

  // BUG-4: getEngineReadiness must receive the model actually selected for
  // THIS launch, not just the mode — so a native CLI model picked while the
  // global mode is pro/managed with an empty wallet is never false-blocked.
  it('passes the selected model id as the readiness check\'s second argument', () => {
    mockedReadiness.mockReturnValue({ mode: 'cli', ready: true });
    renderModal();

    pickModalModel('claude-sonnet-5');
    fillTitleAndSubmit();

    expect(mockedReadiness).toHaveBeenCalledWith(undefined, 'claude-sonnet-5');
  });

  it('a native model selected while readiness is mocked ready does not block, even if it would represent an empty-wallet pro mode elsewhere', () => {
    // The wiring test above proves the modelId reaches getEngineReadiness;
    // this proves the modal trusts whatever that call returns rather than
    // deriving readiness itself from a separate, possibly stale mode read.
    mockedReadiness.mockReturnValue({ mode: 'cli', ready: true });
    renderModal();

    pickModalModel('claude-sonnet-5');
    fillTitleAndSubmit('Mission modele natif');

    expect(mockAddMission).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('mission-preflight-panel')).not.toBeInTheDocument();
  });

  it('re-checks on each submit: panel disappears once readiness becomes ready', () => {
    mockedReadiness.mockReturnValueOnce({ mode: 'cli', ready: false, reason: 'cli-not-found' });
    renderModal();

    fillTitleAndSubmit();
    expect(screen.getByTestId('mission-preflight-panel')).toBeInTheDocument();

    mockedReadiness.mockReturnValue({ mode: 'cli', ready: true });
    fireEvent.click(screen.getByText(fr['agents.modal.submit']));

    expect(screen.queryByTestId('mission-preflight-panel')).not.toBeInTheDocument();
    expect(mockAddMission).toHaveBeenCalledTimes(1);
  });
});

// ── W2.6 — honest autonomy selector replaces the inert mode row ────

describe('NewMissionModal — autonomy selector', () => {
  it('submitting stores the chosen permissionMode on the mission input', () => {
    renderModal();

    fireEvent.click(
      within(screen.getByRole('radiogroup', { name: fr['agents.modal.autonomyAriaLabel'] })).getByRole(
        'radio',
        { name: fr['agents.modal.autonomy.plan'] },
      ),
    );
    fillTitleAndSubmit('Mission autonomie');

    expect(mockAddMission).toHaveBeenCalledTimes(1);
    expect(mockAddMission.mock.calls[0][0]).toMatchObject({ permissionMode: 'plan' });
  });

  it('renders exactly the three honored options — the dead Ask/Plan/Edit/Agent row is gone', () => {
    renderModal();

    const group = screen.getByRole('radiogroup', {
      name: fr['agents.modal.autonomyAriaLabel'],
    });
    expect(within(group).getAllByRole('radio')).toHaveLength(3);
    expect(screen.queryByText('Ask')).not.toBeInTheDocument();
    expect(screen.queryByText('Agent autonome')).not.toBeInTheDocument();
  });

  it('defaults to acceptEdits and shows the one-line description of the selection', () => {
    renderModal();

    const group = screen.getByRole('radiogroup', {
      name: fr['agents.modal.autonomyAriaLabel'],
    });
    const checked = within(group).getByRole('radio', { checked: true });
    expect(checked).toHaveTextContent(fr['agents.modal.autonomy.acceptEdits']);
    expect(
      screen.getByText(fr['agents.modal.autonomy.acceptEdits.desc']),
    ).toBeInTheDocument();
  });
});

// ── Mission fallback fix — repo carries the real project root, not the
// display basename (root cause proven via instrumented run: a mission
// created with a bare basename like 'demo' has no real path for Rust's
// project-root jail to resolve createWorktree() against, so it correctly
// rejects it and the mission is permanently crippled) ──────────────────

describe('NewMissionModal — mission repo resolution', () => {
  it('submits the absolute projectRoot as repo, not the display basename', () => {
    // useAppContext is mocked above (module scope) to return projectRoot
    // 'C:\\proj\\demo' — the <select>'s displayed basename is 'demo'.
    renderModal();

    fillTitleAndSubmit('Mission repo fix');

    expect(mockAddMission).toHaveBeenCalledTimes(1);
    const missionInput = mockAddMission.mock.calls[0][0];
    expect(missionInput).toMatchObject({ repo: 'C:\\proj\\demo' });
    expect(missionInput.repo).not.toBe('demo');
  });
});
