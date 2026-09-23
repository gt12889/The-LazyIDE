import { useEffect, useMemo, useState } from 'react';
import { GO_DEFAULT, goModels, discoverGoModels, opencodeGoProvider } from '../../lib/models/opencodeGoProvider';
import { loadAccessSettings, saveAccessSettings } from '../../lib/models/accessSettings';
import {
  deleteOpenCodeGoKey,
  getSelectedGoKeyId,
  listOpenCodeGoKeys,
  saveOpenCodeGoKey,
  setSelectedGoKeyId,
  type OpenCodeGoKeyRecord,
} from '../../lib/models/opencodeGoKeys';

function keyLabel(key: OpenCodeGoKeyRecord): string {
  return `${key.name}${key.hint ? ` (${key.hint})` : ''}${key.legacy ? ' · existing' : ''}`;
}

export function OpenCodeGoSettings() {
  const [keys, setKeys] = useState<OpenCodeGoKeyRecord[]>([]);
  const [selectedKeyId, setSelectedKeyIdState] = useState(getSelectedGoKeyId() ?? '');
  const [newKeyName, setNewKeyName] = useState('');
  const [newKeyValue, setNewKeyValue] = useState('');
  const [models, setModels] = useState(goModels);
  const [model, setModel] = useState(loadAccessSettings().model?.startsWith('opencode-go/') ? loadAccessSettings().model! : GO_DEFAULT);
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);

  async function refreshKeys() {
    const found = await listOpenCodeGoKeys();
    setKeys(found);
    const selected = getSelectedGoKeyId() ?? found[0]?.id ?? '';
    setSelectedKeyIdState(selected);
  }

  useEffect(() => { void refreshKeys().catch(() => setStatus('Could not read the credential vault.')); }, []);

  const selectedKey = useMemo(() => keys.find(k => k.id === selectedKeyId), [keys, selectedKeyId]);

  function selectKey(id: string) {
    setSelectedGoKeyId(id);
    setSelectedKeyIdState(id);
    setStatus('OpenCode Go key selected.');
  }

  async function addKey() {
    setBusy(true); setStatus('Saving OpenCode Go key…');
    try {
      const record = await saveOpenCodeGoKey({ name: newKeyName || `Go key ${keys.length + 1}`, value: newKeyValue });
      setNewKeyName(''); setNewKeyValue('');
      await refreshKeys();
      setSelectedKeyIdState(record.id);
      setStatus(`Saved and selected ${record.name}.`);
    } catch (error) { setStatus(String(error)); }
    finally { setBusy(false); }
  }

  async function removeSelectedKey() {
    if (!selectedKey) return;
    setBusy(true); setStatus(`Removing ${selectedKey.name}…`);
    try {
      await deleteOpenCodeGoKey(selectedKey.id);
      await refreshKeys();
      setStatus(`${selectedKey.name} removed.`);
    } catch (error) { setStatus(String(error)); }
    finally { setBusy(false); }
  }

  async function check() {
    setBusy(true); setStatus('Checking OpenCode Go…');
    try {
      if (newKeyValue.trim()) await addKey();
      const refreshed = await listOpenCodeGoKeys();
      if (!refreshed.length) throw new Error('Add an OpenCode Go API key first.');
      if (!getSelectedGoKeyId()) setSelectedGoKeyId(refreshed[0].id);
      const found = await discoverGoModels(); setModels(found);
      const selected = found.find(m => m.id === model);
      if (!selected) throw new Error('Selected model is no longer available. Choose another model.');
      let response = '';
      for await (const part of opencodeGoProvider.streamChat({ model: selected, mode: 'ask', messages: [{ id: crypto.randomUUID(), role: 'user', content: 'Coding assistant connection test. Reply READY.' }], signal: AbortSignal.timeout(90000) })) response += part;
      if (!response.trim()) throw new Error('The model returned no text. Try another model.');
      await refreshKeys();
      setStatus(`Connected with ${refreshed.find(k => k.id === getSelectedGoKeyId())?.name ?? 'selected key'}: ${selected.label}. ${found.length} supported Go models available.`);
    } catch (error) { setStatus(String(error)); }
    finally { setBusy(false); }
  }

  async function apply() {
    setBusy(true);
    try {
      if (newKeyValue.trim()) await addKey();
      const refreshed = await listOpenCodeGoKeys();
      if (!refreshed.length) throw new Error('Add an OpenCode Go API key first.');
      if (!getSelectedGoKeyId()) setSelectedGoKeyId(refreshed[0].id);
      saveAccessSettings({ ...loadAccessSettings(), accessMode: 'opencode-go', model });
      window.location.reload();
    } catch (error) { setStatus(String(error)); setBusy(false); }
  }

  return <div style={{ display: 'grid', gap: 12 }}>
    <p>Use your OpenCode Go subscription for coding agents, file edits, shell commands, and missions. You can save multiple subscription keys and choose which one lazygt uses.</p>

    <label>Saved OpenCode Go keys
      <select value={selectedKeyId} disabled={busy || keys.length === 0} onChange={e => selectKey(e.target.value)} style={{ display: 'block', width: '100%' }}>
        {keys.length === 0 && <option value="">No key saved</option>}
        {keys.map(k => <option key={k.id} value={k.id}>{keyLabel(k)}</option>)}
      </select>
    </label>
    {selectedKey && <p>Active key: {keyLabel(selectedKey)}</p>}

    <div style={{ display: 'grid', gap: 8, padding: 10, border: '1px solid var(--color-border)', borderRadius: 8 }}>
      <strong>Add another OpenCode Go key</strong>
      <label>Key name<input value={newKeyName} onChange={e => setNewKeyName(e.target.value)} placeholder="Personal Go key, Work Go key…" style={{ display: 'block', width: '100%' }} /></label>
      <label>API key<input type="password" autoComplete="off" value={newKeyValue} onChange={e => setNewKeyValue(e.target.value)} placeholder="Paste new OpenCode Go key" style={{ display: 'block', width: '100%' }} /></label>
      <button disabled={busy || !newKeyValue.trim()} onClick={addKey}>Add and select key</button>
    </div>

    <p>Keys are stored in Windows Credential Manager. The list stores only names and masked hints, never the raw key.</p>
    <label>Model<select value={model} onChange={e => setModel(e.target.value)} style={{ display: 'block', width: '100%' }}>{models.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}</select></label>
    <p>{models.find(m => m.id === model)?.description}</p>
    <button disabled={busy || (!selectedKeyId && !newKeyValue.trim())} onClick={check}>Test selected key and model (uses subscription quota)</button>
    <button disabled={busy || (!selectedKeyId && !newKeyValue.trim())} onClick={apply}>Use OpenCode Go with selected key</button>
    {selectedKey && <button disabled={busy} onClick={removeSelectedKey}>Remove selected key</button>}
    <p role="status">{status}</p>
  </div>;
}
