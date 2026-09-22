/* EngineChip — header chip showing the active engine (Forge: no accounts).
   Shows the current provider mode + model (e.g. "Local · hermes3",
   "Claude Code"). Clicking navigates to Settings > Models.
*/

import { useI18n } from '../i18n';
import { getProviderMode, getActiveModel } from '../lib/models';
import { emit } from '../lib/bus';

const ACCENT = '#7C5CFF';
const GREEN = '#66E27A';

export function AccountChip() {
  const { t } = useI18n();
  const mode = getProviderMode();
  const model = getActiveModel();

  const label =
    mode === 'local'
      ? `Local · ${model.id.replace(/^local\//, '')}`
      : mode === 'claude-code'
        ? 'Claude Code'
        : mode === 'codex'
          ? 'Codex'
          : mode === 'devin'
            ? 'Devin'
            : t('account.chip.label');

  const openModels = () => {
    emit('nav:navigateSpace', 'models');
  };

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={label}
      data-tooltip={label}
      data-testid="account-chip"
      onClick={openModels}
      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openModels(); } }}
      style={{
        background: 'rgba(102,226,122,0.10)',
        border: '1px solid rgba(102,226,122,0.28)',
        borderRadius: 8,
        padding: '4px 11px',
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        cursor: 'pointer',
        transition: 'background 0.15s, border-color 0.15s',
        userSelect: 'none',
        whiteSpace: 'nowrap',
      }}
      onMouseEnter={e => {
        const el = e.currentTarget as HTMLDivElement;
        el.style.background = 'rgba(102,226,122,0.18)';
        el.style.borderColor = 'rgba(102,226,122,0.45)';
      }}
      onMouseLeave={e => {
        const el = e.currentTarget as HTMLDivElement;
        el.style.background = 'rgba(102,226,122,0.10)';
        el.style.borderColor = 'rgba(102,226,122,0.28)';
      }}
    >
      <span style={{ width: 7, height: 7, borderRadius: '50%', background: GREEN }} />
      <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.75)', fontWeight: 600 }}>
        {label}
      </span>
      <span style={{ fontSize: 11, color: ACCENT, fontWeight: 600 }}>
        {t('account.chip.models')}
      </span>
    </div>
  );
}
