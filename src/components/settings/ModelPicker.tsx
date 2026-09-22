/* ModelPicker — Forge model selector (Settings > Models).
   Renders the live picker groups (local engine, CLI subscription, Devin)
   as radio rows. Selecting a model persists accessMode + model through the
   same saveAccessSettings() path every other picker uses. A reasoning
   effort selector appears for native CLI models; a free-text field lets
   the user point the local rail at any pulled Ollama model.
*/

import { useEffect, useState } from 'react';
import { ALL_MODELS } from '../../lib/models/registry';
import { devinModelInfos } from '../../lib/models/devinCatalog';
import { loadAccessSettings, saveAccessSettings } from '../../lib/models/accessSettings';
import type { ReasoningEffort } from '../../lib/models/accessSettings';
import { loadLocalModelName, refreshLocalModels, DEFAULT_LOCAL_MODEL_ID } from '../../lib/models/localProvider';
import { getModelPickerOptions } from '../../lib/models/modelPickerOptions';
import { getEngineReadiness, engineReasonKey } from '../../lib/models/entitlement';
import { emit } from '../../lib/bus';
import { useI18n } from '../../i18n';

// ── Thinking effort selector ────────────────────────────────────────

type EffortOption = 'off' | ReasoningEffort;

function ThinkingSelector({ effort, onChange, t }: {
  effort: EffortOption;
  onChange: (v: EffortOption) => void;
  t: (key: string) => string;
}) {
  const opts: Array<{ value: EffortOption; label: string }> = [
    { value: 'off', label: t('settings.pro.thinking.off') },
    { value: 'low', label: t('settings.pro.thinking.low') },
    { value: 'medium', label: t('settings.pro.thinking.medium') },
    { value: 'high', label: t('settings.pro.thinking.high') },
  ];
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '8px 10px',
        background: 'rgba(167,139,255,0.06)',
        border: '1px solid rgba(167,139,255,0.2)',
        borderRadius: 8,
        marginTop: 6,
      }}
    >
      <span style={{ fontSize: 11, fontWeight: 600, color: '#A78BFF', flexShrink: 0 }}>
        {t('settings.pro.thinking')}
      </span>
      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
        {opts.map(opt => (
          <button
            key={opt.value}
            onClick={() => onChange(opt.value)}
            style={{
              padding: '3px 10px',
              borderRadius: 5,
              border: effort === opt.value
                ? '1px solid rgba(167,139,255,0.55)'
                : '1px solid var(--color-border)',
              background: effort === opt.value
                ? 'rgba(167,139,255,0.15)'
                : 'var(--color-panel)',
              color: effort === opt.value
                ? '#A78BFF'
                : 'var(--color-text-muted)',
              fontSize: 11,
              fontWeight: effort === opt.value ? 600 : 400,
              cursor: 'pointer',
              fontFamily: 'inherit',
              transition: 'background 0.1s',
            }}
          >
            {opt.label}
          </button>
        ))}
      </div>
    </div>
  );
}

// ── Group ───────────────────────────────────────────────────────────

interface GroupProps {
  name: string;
  color: string;
  models: Array<{ id: string; label: string }>;
  selectedId: string;
  onSelect: (id: string) => void;
  collapsed: boolean;
  onToggle: () => void;
}

function Group({ name, color, models, selectedId, onSelect, collapsed, onToggle }: GroupProps) {
  return (
    <div style={{ marginBottom: 8 }}>
      <button
        type="button"
        onClick={onToggle}
        style={{
          display: 'flex', alignItems: 'center', gap: 7, padding: '4px 8px',
          marginBottom: 3, width: '100%', background: 'transparent',
          border: 'none', cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left',
        }}
      >
        <span style={{ width: 6, height: 6, borderRadius: '50%', background: color, flexShrink: 0 }} />
        <span style={{ fontSize: 10, fontWeight: 700, color, textTransform: 'uppercase', letterSpacing: '0.08em', flex: 1 }}>
          {name}
        </span>
        <span style={{ fontSize: 9, color: 'var(--color-text-muted)' }}>
          {models.length} {collapsed ? '▸' : '▾'}
        </span>
      </button>
      {!collapsed && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2, paddingLeft: 8 }}>
          {models.map(model => (
            <label
              key={model.id}
              style={{
                display: 'flex', alignItems: 'center', gap: 9, padding: '6px 8px',
                borderRadius: 6, cursor: 'pointer',
                background: selectedId === model.id ? 'var(--color-accent-soft)' : 'transparent',
                border: `1px solid ${selectedId === model.id ? 'var(--color-accent-border)' : 'transparent'}`,
                transition: 'background 0.1s',
              }}
            >
              <input
                type="radio"
                name="forge-model"
                value={model.id}
                checked={selectedId === model.id}
                onChange={() => onSelect(model.id)}
                style={{ accentColor: 'var(--color-accent)', cursor: 'pointer', flexShrink: 0 }}
              />
              <span style={{
                fontSize: 12, fontWeight: 500, color: 'var(--color-text)', flex: 1,
                whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
              }}>
                {model.label}
              </span>
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

// ── ModelPicker ─────────────────────────────────────────────────────

const GROUP_COLOR: Record<string, string> = {
  local: '#66E27A',
  'claude-sub': '#A78BFF',
  devin: '#2DD4BF',
};

export function ModelPicker() {
  const { t } = useI18n();
  const initial = loadAccessSettings();
  const pickerOptions = getModelPickerOptions(t);

  const [selectedId, setSelectedId] = useState<string>(
    initial.model ?? pickerOptions.defaultModelId,
  );
  const [effort, setEffort] = useState<EffortOption>(initial.reasoningEffort ?? 'medium');
  const [localName, setLocalName] = useState<string>(loadLocalModelName());
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({});
  // Auto-discover pulled Ollama models once per mount so the local group
  // lists what is actually installed (not just the configured name).
  // The tick re-renders with the discovered rows; failures keep the
  // single configured row (refreshLocalModels never throws).
  const [, setLocalTick] = useState(0);
  useEffect(() => {
    let live = true;
    refreshLocalModels().then(() => { if (live) setLocalTick((n) => n + 1); });
    return () => { live = false; };
  }, []);

  const readiness = getEngineReadiness();
  const supportsReasoning = ALL_MODELS.some((m) => m.id === selectedId);

  function persist(model: string, nextEffort: EffortOption) {
    const current = loadAccessSettings();
    if (model.startsWith('local/')) {
      saveAccessSettings({ ...current, accessMode: 'local', model });
    } else if (devinModelInfos().some((m) => m.id === model)) {
      saveAccessSettings({ ...current, accessMode: 'cli', cliTool: 'devin', model });
    } else {
      saveAccessSettings({ ...current, accessMode: 'cli', model });
    }
    void nextEffort;
  }

  function handleSelectModel(id: string) {
    setSelectedId(id);
    const current = loadAccessSettings();
    if (id.startsWith('local/')) {
      try { localStorage.setItem('lazy.local.model', id.slice('local/'.length)); } catch { /* ignore */ }
      setLocalName(id.slice('local/'.length));
      saveAccessSettings({ ...current, accessMode: 'local', model: id });
      return;
    }
    persist(id, effort);
  }

  function handleLocalNameApply() {
    const name = localName.trim() || 'hermes3';
    try { localStorage.setItem('lazy.local.model', name); } catch { /* ignore */ }
    const id = `local/${name}`;
    setSelectedId(id);
    const current = loadAccessSettings();
    saveAccessSettings({ ...current, accessMode: 'local', model: id });
  }

  function handleEffortChange(v: EffortOption) {
    setEffort(v);
    const current = loadAccessSettings();
    saveAccessSettings({ ...current, reasoningEffort: v === 'off' ? undefined : v });
  }

  return (
    <div
      data-testid="model-picker"
      style={{
        padding: '12px 14px', background: 'var(--color-panel-2)',
        border: '1px solid var(--color-border)', borderRadius: 8, marginTop: 10,
      }}
    >
      <div style={{
        fontSize: 11, fontWeight: 700, color: 'var(--color-text-muted)',
        textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 10,
      }}>
        {t('settings.pro.modelPicker')}
      </div>

      {!readiness.ready && readiness.reason && (
        <div
          role="note"
          style={{
            display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10,
            padding: '8px 10px', borderRadius: 7,
            background: 'rgba(246,169,69,0.08)', border: '1px solid rgba(246,169,69,0.3)',
          }}
        >
          <span style={{ flex: 1, fontSize: 11, lineHeight: 1.45, color: '#F6A945' }}>
            {t(engineReasonKey(readiness.reason))}
          </span>
          <button
            type="button"
            onClick={() => emit('nav:navigateSpace', 'models')}
            style={{
              padding: '5px 12px', borderRadius: 6, border: 'none',
              background: 'var(--color-accent)', color: '#fff', fontSize: 11,
              fontWeight: 600, fontFamily: 'inherit', cursor: 'pointer', whiteSpace: 'nowrap',
            }}
          >
            {t('engine.preflight.configure')}
          </button>
        </div>
      )}

      {pickerOptions.groups.map((group) => (
        <Group
          key={group.id}
          name={group.label}
          color={GROUP_COLOR[group.id] ?? '#888'}
          models={group.models}
          selectedId={selectedId}
          onSelect={handleSelectModel}
          collapsed={collapsedGroups[group.id] ?? !group.models.some((m) => m.id === selectedId)}
          onToggle={() => setCollapsedGroups((c) => ({
            ...c,
            [group.id]: !(c[group.id] ?? !group.models.some((m) => m.id === selectedId)),
          }))}
        />
      ))}

      {/* Local model name — point the local rail at any pulled Ollama model */}
      <div style={{ marginTop: 6, padding: '8px 10px', background: 'rgba(102,226,122,0.06)', border: '1px solid rgba(102,226,122,0.2)', borderRadius: 8 }}>
        <span style={{ fontSize: 11, fontWeight: 600, color: '#66E27A' }}>
          {t('settings.models.localModel')}
        </span>
        <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
          <input
            value={localName}
            onChange={(e) => setLocalName(e.target.value)}
            placeholder="hermes3"
            spellCheck={false}
            style={{
              flex: 1, background: 'var(--color-panel)', border: '1px solid var(--color-border)',
              borderRadius: 5, color: 'var(--color-text)', fontSize: 12, padding: '5px 9px',
              fontFamily: 'var(--font-mono)', outline: 'none', minWidth: 0,
            }}
          />
          <button
            type="button"
            onClick={handleLocalNameApply}
            style={{
              padding: '5px 12px', borderRadius: 5, border: '1px solid rgba(102,226,122,0.45)',
              background: 'rgba(102,226,122,0.15)', color: '#66E27A', fontSize: 11,
              fontWeight: 600, fontFamily: 'inherit', cursor: 'pointer', whiteSpace: 'nowrap',
            }}
          >
            {t('settings.models.useLocal')}
          </button>
        </div>
      </div>

      {supportsReasoning && (
        <ThinkingSelector effort={effort} onChange={handleEffortChange} t={t} />
      )}

      <div style={{ marginTop: 10, fontSize: 10, color: 'var(--color-text-muted)', lineHeight: 1.5 }}>
        {t('settings.models.localNote', { default: DEFAULT_LOCAL_MODEL_ID })}
      </div>
    </div>
  );
}
