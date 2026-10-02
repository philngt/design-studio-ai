import { useEffect, useState } from 'react';
import { api, message } from './api';
import { type AgentCatalog } from '../shared/agents';
import './agents.css';

export function CodingAgentSettings() {
  const [catalog,setCatalog]=useState<AgentCatalog>(),[error,setError]=useState('');
  const load=()=>api<AgentCatalog>('/api/agent-providers').then(setCatalog).catch(e=>setError(message(e)));
  useEffect(()=>{void load();},[]);
  return <section className="coding-agent-settings"><h3>Coding agents on this server</h3>
    {error&&<p role="alert">{error}</p>}
    {!catalog?<p>Checking coding agents…</p>:!catalog.enabled?<p>{catalog.reason}</p>:<>
      <p>Sign in to each CLI on the server. A detected installation does not confirm model access. The operator’s designated Studio account can run these agents.</p>
      <ul>{catalog.providers.map(p=><li key={p.id}><strong>{p.name}</strong> — {p.installed?`Installed${p.version?` (${p.version})`:''}; authentication checked when used`:'Not installed'}{p.diagnostic&&<p>{p.diagnostic}</p>}</li>)}</ul>
    </>}
    <button className="button small" onClick={()=>void load()}>Refresh agent status</button>
    <p>Setup: <code>STUDIO_AGENTS_ENABLED=true</code> and <code>STUDIO_AGENT_OWNER_ID</code>. See <a href="/docs#coding-agents" target="_blank" rel="noreferrer">coding agent setup</a>.</p>
  </section>;
}
