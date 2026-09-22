import { useState, useEffect } from 'react';
import { useI18n } from '../i18n';
import { MemoryPanel } from '../components/settings/MemoryPanel';
import { AgentsPanel } from '../components/settings/AgentsPanel';
import { HealthPanel } from '../components/settings/HealthPanel';
import { LocalCliSettings } from '../components/settings/LocalCliSettings';
import { ACCENT_PRESETS, loadStoredAccent, setAccent } from '../lib/theme/accentTheme';
export type SettingsTab = 'models' | 'account' | 'appearance' | 'general' | 'memory' | 'agents' | 'health' | 'solari';
interface SettingsSpaceProps { initialTab?: SettingsTab; initialAuthMode?: 'signin' | 'signup' }
function TabBar({ active, onChange }: { active: SettingsTab; onChange: (t: SettingsTab) => void }) {
  const { t } = useI18n();
  const TABS: Array<{ id: SettingsTab; labelKey: string }> = [
    { id: 'models',     labelKey: 'settings.tab.models' },
    { id: 'memory',     labelKey: 'settings.tab.memory' },
    { id: 'agents',     labelKey: 'settings.tab.agents' },
    { id: 'appearance', labelKey: 'settings.tab.appearance' },
    { id: 'general',    labelKey: 'settings.tab.general' },
    { id: 'health',     labelKey: 'settings.tab.health' },
  ];
  return (
    <div style={{
      display: 'flex',
      borderBottom: '1px solid var(--color-border)',
      background: 'var(--color-panel)',
      padding: '0 24px',
      overflowX: 'auto',
      overflowY: 'hidden',
    }}>
      {TABS.map(tab => (
        <button
          key={tab.id}
          type="button"
          data-testid={`settings-tab-${tab.id}`}
          onClick={() => onChange(tab.id)}
          style={{
            padding: '12px 14px',
            background: 'transparent',
            border: 'none',
            borderBottom: `2px solid ${active === tab.id ? 'var(--color-accent)' : 'transparent'}`,
            color: active === tab.id ? 'var(--color-accent-light)' : 'var(--color-text-muted)',
            fontSize: 13,
            fontWeight: active === tab.id ? 600 : 400,
            cursor: 'pointer',
            fontFamily: 'inherit',
            transition: 'color 0.12s',
            marginBottom: -1,
            whiteSpace: 'nowrap',
            flexShrink: 0,
          }}
        >
          {t(tab.labelKey)}
        </button>
      ))}
    </div>
  );
}

function AppearanceTab() {
  const { t } = useI18n();
  const [accent, setAccentState] = useState<string>(loadStoredAccent);

  function selectAccent(color: string): void {
    setAccent(color);
    setAccentState(color);
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{
        padding: '16px',
        background: 'var(--color-panel-2)',
        border: '1px solid var(--color-border)',
        borderRadius: 10,
      }}>
        <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginBottom: 10 }}>{t('settings.appearance.theme')}</div>
        <div style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 10,
          padding: '8px 12px',
          background: 'var(--color-accent-soft)',
          border: '1px solid var(--color-accent-border)',
          borderRadius: 7,
        }}>
          <span style={{ width: 14, height: 14, borderRadius: '50%', background: '#0E0E12', border: '1px solid rgba(255,255,255,0.2)', display: 'inline-block' }} />
          <span style={{ fontSize: 13, color: 'var(--color-text)' }}>{t('settings.appearance.darkDefault')}</span>
        </div>
      </div>
      <div style={{
        padding: '16px',
        background: 'var(--color-panel-2)',
        border: '1px solid var(--color-border)',
        borderRadius: 10,
      }}>
        <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginBottom: 10 }}>{t('settings.appearance.accentColor')}</div>
        <div style={{ display: 'flex', gap: 8 }} data-testid="accent-swatches">
          {ACCENT_PRESETS.map((color) => {
            const active = accent === color;
            return (
              <button
                key={color}
                type="button"
                data-testid="accent-swatch"
                onClick={() => selectAccent(color)}
                style={{
                  width: 28,
                  height: 28,
                  borderRadius: '50%',
                  background: color,
                  border: active ? '2px solid white' : '2px solid transparent',
                  cursor: 'pointer',
                  outline: 'none',
                }}
                aria-label={`Accent ${color}`}
                aria-pressed={active}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
}

// Injected at build/test time from package.json's version — see the `define`
// block in vite.config.ts / vitest.config.ts, kept in lockstep with
// tauri.conf.json's "version" field. QA fix: this used to read
// `?? '0.1.0'` with NO `define` anywhere actually setting the env var, so it
// was always undefined and the settings page silently showed the stale
// '0.1.0' fallback regardless of the real shipping version (0.1.5 at time of
// fix). The literal below is a type-safe last-resort default only — it
// should never actually be hit once the `define` above is wired everywhere
// the app builds, runs, or tests from.
interface StaticToggleRowProps {
  label: string;
  sub: string;
  value: boolean;
}

function StaticToggleRow({ label, sub, value }: StaticToggleRowProps) {
  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: 14,
      padding: '12px 16px',
      background: 'var(--color-panel-2)',
      border: '1px solid var(--color-border)',
      borderRadius: 8,
    }}>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 13, color: 'var(--color-text)', fontWeight: 500, marginBottom: 2 }}>{label}</div>
        <div style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>{sub}</div>
      </div>
      <div style={{
        width: 36,
        height: 20,
        borderRadius: 10,
        background: value ? 'var(--color-accent)' : 'rgba(255,255,255,0.12)',
        flexShrink: 0,
        position: 'relative',
        cursor: 'pointer',
      }}>
        <div style={{
          position: 'absolute',
          top: 3,
          left: value ? 19 : 3,
          width: 14,
          height: 14,
          borderRadius: '50%',
          background: '#fff',
          transition: 'left 0.15s',
        }} />
      </div>
    </div>
  );
}

// ── Settings section ────────────────────────────────────────────────
//
// A labelled group of cards — the General tab's own extensibility seam.
// Previously every setting here (9 of them, and growing) sat in one flat
// list with no grouping at all. The next new General-tab setting should
// join whichever <SettingsSection> below already matches it (Brain,
// Agents, Preferences, Privacy, Updates); only add a new section if it
// genuinely doesn't fit any existing one — never go back to appending to
// one flat list.

interface SettingsSectionProps {
  title: string;
  children: React.ReactNode;
}

function SettingsSection({ title, children }: SettingsSectionProps) {
  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{
        fontSize: 11,
        fontWeight: 600,
        color: 'var(--color-text-muted)',
        textTransform: 'uppercase',
        letterSpacing: '0.06em',
      }}>
        {title}
      </div>
      {children}
    </section>
  );
}

function GeneralTab() {
  const { t, locale, setLocale, LOCALES } = useI18n();

  const BRAIN_TOGGLES = [
    { label: t('settings.general.autoMemory'), sub: t('settings.general.autoMemory.desc'), value: true },
    { label: t('settings.general.tokenSaverBadge'), sub: t('settings.general.tokenSaverBadge.desc'), value: true },
  ];
  const AGENT_TOGGLES = [
    { label: t('settings.general.dualJudge'), sub: t('settings.general.dualJudge.desc'), value: true },
    { label: t('settings.general.agentNotifications'), sub: t('settings.general.agentNotifications.desc'), value: false },
  ];


  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <SettingsSection title={t('settings.section.brain')}>
        {BRAIN_TOGGLES.map(toggle => (
          <StaticToggleRow key={toggle.label} {...toggle} />
        ))}
      </SettingsSection>

      <SettingsSection title={t('settings.section.agents')}>
        {AGENT_TOGGLES.map(toggle => (
          <StaticToggleRow key={toggle.label} {...toggle} />
        ))}
      </SettingsSection>

      <SettingsSection title={t('settings.section.preferences')}>
        {/* Language switcher */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: 14,
          padding: '12px 16px',
          background: 'var(--color-panel-2)',
          border: '1px solid var(--color-border)',
          borderRadius: 8,
        }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 13, color: 'var(--color-text)', fontWeight: 500, marginBottom: 2 }}>
              {t('settings.language')}
            </div>
            <div style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>
              {t('settings.language.desc')}
            </div>
          </div>
          <select
            value={locale}
            onChange={(e) => setLocale(e.target.value as typeof locale)}
            style={{
              padding: '6px 12px',
              background: 'var(--color-panel)',
              border: '1px solid var(--color-border)',
              borderRadius: 6,
              color: 'var(--color-text)',
              fontSize: 12,
              fontWeight: 500,
              cursor: 'pointer',
              fontFamily: 'inherit',
              flexShrink: 0,
            }}
          >
            {LOCALES.map(l => (
              <option key={l.code} value={l.code}>
                {l.flag} {l.label}
              </option>
            ))}
          </select>
        </div>


      </SettingsSection>




    </div>
  );
}

export function SettingsSpace({ initialTab = 'general' }: SettingsSpaceProps) {
  const [activeTab, setActiveTab] = useState<SettingsTab>(initialTab);
  const { t } = useI18n();

  useEffect(() => {
    setActiveTab(initialTab); // eslint-disable-line react-hooks/set-state-in-effect
  }, [initialTab]);

  function renderTab() {
    switch (activeTab) {
      case 'models':     return <LocalCliSettings />;
      case 'account':    return <LocalCliSettings />;
      case 'memory':     return <MemoryPanel />;
      case 'agents':     return <AgentsPanel />;
      case 'appearance': return <AppearanceTab />;
      case 'general':    return <GeneralTab />;
      case 'health':     return <HealthPanel />;
      case 'solari':     return <LocalCliSettings />;
    }
  }

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', background: 'var(--color-bg)' }}>
      {/* Header */}
      <div style={{ padding: '16px 24px 0', borderBottom: '1px solid var(--color-border)', background: 'var(--color-panel)' }}>
        <h1 style={{ fontSize: 16, fontWeight: 700, color: 'var(--color-text)', marginBottom: 12 }}>
          {t('nav.settings')}
        </h1>
        <TabBar active={activeTab} onChange={setActiveTab} />
      </div>

      {/* Tab content */}
      <div style={{ flex: 1, overflow: 'auto', padding: '20px 24px' }}>
        {renderTab()}
      </div>
    </div>
  );
}
