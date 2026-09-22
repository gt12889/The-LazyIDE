import { useState } from 'react';
import { isTauri } from '../../lib/platform';
import { loadAccessSettings, saveAccessSettings, listLocalModels } from '../../lib/models';
import type { CliTool } from '../../lib/models';

export function LocalCliSettings() {
  const [mode, setMode] = useState(loadAccessSettings().accessMode ?? 'local');
  const [tool, setTool] = useState<CliTool>(loadAccessSettings().cliTool ?? 'claude');
  const [baseUrl, setBaseUrl] = useState(() => localStorage.getItem('lazygt.local.baseUrl') ?? 'http://127.0.0.1:11434/v1');
  const [model, setModel] = useState(() => localStorage.getItem('lazygt.local.model') ?? 'hermes3');
  const [status, setStatus] = useState('');
  const [models, setModels] = useState<string[]>([]);
  const [checking, setChecking] = useState(false);
  function persist() {
    const url = new URL(baseUrl);
    if (!['http:', 'https:'].includes(url.protocol) || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) throw new Error('Use a loopback URL for your local model server.');
    if (!model.trim()) throw new Error('Enter a model name.');
    localStorage.setItem('lazygt.local.baseUrl', baseUrl.replace(/\/+$/, ''));
    localStorage.setItem('lazygt.local.model', model.trim().replace(/^local\//, ''));
    saveAccessSettings({ ...loadAccessSettings(), accessMode: mode === 'cli' ? 'cli' : 'local', cliTool: tool, model: mode === 'local' ? `local/${model.trim().replace(/^local\//, '')}` : undefined });
  }
  async function check() {
    setChecking(true);
    try {
      persist();
      const found = await listLocalModels();
      setModels(found.map(m => m.label));
      setStatus(found.length ? `Connected. ${found.length} model(s) available.` : 'No models found. Start Ollama and run: ollama pull hermes3');
    } catch (error) { setStatus(String(error)); }
    finally { setChecking(false); }
  }
  const field = { display: 'block', padding: 10, marginTop: 6, width: '100%', background: 'var(--color-panel-2)', color: 'var(--color-text)', border: '1px solid var(--color-border)', borderRadius: 6 };
  return <section style={{ maxWidth: 720, display: 'grid', gap: 20 }}>
    <h2>lazygt engines</h2>
    <p>Use Ollama or LM Studio on this computer, or a signed-in CLI in the desktop app. No lazygt account or API key is needed.</p>
    <label>Engine<select style={field} value={mode} onChange={e => setMode(e.target.value as 'local' | 'cli')}>
      <option value="local">Local model</option><option value="cli" disabled={!isTauri()}>CLI (desktop app)</option>
    </select></label>
    {mode === 'local' ? <>
      <label>Server URL<input style={field} value={baseUrl} onChange={e => setBaseUrl(e.target.value)} /></label>
      <label>Model<input style={field} list="local-models" value={model} onChange={e => setModel(e.target.value)} /><datalist id="local-models">{models.map(m => <option key={m} value={m}/>)}</datalist></label>
      <button disabled={checking} onClick={check}>{checking ? 'Checking…' : 'Check connection and discover models'}</button>
      <p>Hermes supports local chat and code suggestions. Autonomous missions require a CLI engine.</p>
    </> : <label>CLI<select style={field} value={tool} onChange={e => setTool(e.target.value as CliTool)}><option value="claude">Claude Code</option><option value="codex">Codex</option><option value="devin">Devin</option></select></label>}
    <button onClick={() => { try { persist(); window.location.reload(); } catch (e) { setStatus(String(e)); } }}>Save and apply</button>
    <p role="status">{status}</p>
  </section>;
}
