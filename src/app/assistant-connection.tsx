import { useEffect, useState } from 'react';
import { api, message, type Provider } from './api';
import { builtInProviders, isTextProvider } from '../shared/providers';
import { type AgentCatalog, type AgentProvider } from '../shared/agents';
import { ModelPicker } from './model-picker';

export type AssistantChoice = { id: string; name: string; kind: 'api' | 'agent'; provider: string; available: boolean };
export function useAssistantConnection(accountId?: string) {
  const [choices, setChoices] = useState<AssistantChoice[]>([]);
  const [selected, setSelected] = useState(''), [model, setModel] = useState('');
  const [loading, setLoading] = useState(true), [error, setError] = useState('');
  const key = `design-studio:assistant:${accountId ?? 'anonymous'}`;
  useEffect(() => { setSelected(''); setModel(''); setLoading(true); }, [key]);
  useEffect(() => {
    let live = true;
    const load = async () => {
      setError('');
      const results = await Promise.allSettled([api<{ providers: Provider[] }>('/api/providers'), api<AgentCatalog>('/api/agent-providers')]);
      if (!live) return;
      const [providers, agents] = results;
      const next: AssistantChoice[] = [
        ...(providers.status === 'fulfilled' ? providers.value.providers.filter(p => isTextProvider(p.provider)).map(p => ({ id: `api:${p.provider}`, name: p.name || builtInProviders.find(b => b.id === p.provider)?.name || p.provider, kind: 'api' as const, provider: p.provider, available: p.configured })) : []),
        ...(agents.status === 'fulfilled' && agents.value.enabled ? agents.value.providers.map(p => ({ id: `agent:${p.id}`, name: p.name, kind: 'agent' as const, provider: p.id, available: p.installed })) : []),
      ];
      setChoices(next);
      if (results.some(r => r.status === 'rejected')) setError('Some AI connections could not load. Refresh to try again.');
      let remembered = '';
      try { remembered = localStorage.getItem(key) || ''; } catch { /* Storage is optional. */ }
      setSelected(current => {
        if (current) return current;
        if (remembered) return remembered;
        const available = next.filter(p => p.available);
        return available.length === 1 ? available[0].id : '';
      });
      setLoading(false);
    };
    void load();
    window.addEventListener('studio-providers-updated', load);
    return () => { live = false; window.removeEventListener('studio-providers-updated', load); };
  }, [key]);
  const choose = (value: string) => {
    setSelected(value); setModel('');
    try { localStorage.setItem(key, value); } catch { /* Continue without remembering. */ }
  };
  return { choices, selected, choose, choice: choices.find(p => p.id === selected), model, setModel, loading, error };
}

export function AssistantPicker({ connection, disabled, onSettings }: { connection: ReturnType<typeof useAssistantConnection>; disabled?: boolean; onSettings: () => void }) {
  const { choices, selected, choose, choice, model, setModel, loading, error } = connection;
  const [models, setModels] = useState<string[]>([]), [status, setStatus] = useState(''), [fetching, setFetching] = useState(false);
  useEffect(() => { setModels([]); setStatus(''); }, [selected]);
  return <div className="assistant-picker">
    <label className="assistant-choice"><span>AI</span><select aria-label="Design assistant" value={selected} disabled={disabled || loading} onChange={e => choose(e.target.value)}>
      <option value="">{loading ? 'Loading connections…' : 'Choose AI'}</option>
      {selected && !choice && <option value={selected}>Previous connection unavailable</option>}
      {(['agent', 'api'] as const).map(kind => <optgroup key={kind} label={kind === 'agent' ? 'Coding agents' : 'API connections'}>{choices.filter(p => p.kind === kind).map(p => <option key={p.id} value={p.id} disabled={!p.available}>{p.name}{!p.available ? ' — unavailable' : ''}</option>)}</optgroup>)}
    </select></label>
    <details className="assistant-options"><summary>Options</summary><div>
      {choice?.kind === 'api' ? <ModelPicker provider={choice.provider} value={model} onChange={setModel} label="Model override" disabled={disabled} placeholder="Use connection default" /> : choice && <>
        <label>Model<input aria-label="Agent model" list="assistant-models" value={model} disabled={disabled} onChange={e => setModel(e.target.value)} placeholder="Use CLI default" /></label>
        <datalist id="assistant-models">{models.map(value => <option key={value} value={value} />)}</datalist>
        <button className="text-button" disabled={disabled || fetching} onClick={async () => {
          setFetching(true); setStatus('');
          try { const result = await api<{ models: string[] }>(`/api/agent-providers/${choice.provider as AgentProvider}/models`); setModels(result.models); setStatus(`${result.models.length} model choices. Access is checked when used.`); }
          catch (e) { setStatus(message(e)); } finally { setFetching(false); }
        }}>{fetching ? 'Loading models…' : 'Load model choices'}</button>
        {status && <p role="status">{status}</p>}
        <small>Uses the CLI signed in on this server. Installation does not confirm model access.</small>
      </>}
      <button className="text-button" onClick={e => { e.currentTarget.closest('details')?.removeAttribute('open'); onSettings(); }}>Manage AI connections</button>
    </div></details>
    {!loading && (!choice?.available || error) && <p className="assistant-connection-note" role="status">{error || (selected ? 'This connection is unavailable. Choose another or check its setup.' : 'Choose an AI connection to start.')} <button className="text-button" onClick={onSettings}>Connections</button>{error && <button className="text-button" onClick={() => window.dispatchEvent(new Event('studio-providers-updated'))}>Refresh</button>}</p>}
  </div>;
}
