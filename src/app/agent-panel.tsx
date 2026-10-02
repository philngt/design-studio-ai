import { useEffect, useRef, useState } from 'react';
import { api, message, post } from './api';
import { agentProviders, agentSessionPath, type AgentCatalog, type AgentEvent, type AgentProposal, type AgentProvider, type AgentSession } from '../shared/agents';
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
export function AgentPanel({projectId,revision,blocked,onPreview,initialPrompt,refreshKey=0}:{projectId:string;revision:number;blocked?:string;onPreview:(proposal:AgentProposal,sessionId:string)=>void;initialPrompt?:string;refreshKey?:number}){
  const [catalog,setCatalog]=useState<AgentCatalog>(),[sessions,setSessions]=useState<AgentSession[]>([]),[selected,setSelected]=useState('');
  const [provider,setProvider]=useState<AgentProvider>('claude'),[model,setModel]=useState(''),[prompt,setPrompt]=useState(initialPrompt??'');
  const [models,setModels]=useState<string[]>([]),[modelStatus,setModelStatus]=useState('');
  const [events,setEvents]=useState<AgentEvent[]>([]),[error,setError]=useState(''),[busy,setBusy]=useState(false),[connected,setConnected]=useState(false),[answer,setAnswer]=useState('');
  const cursor=useRef(0), pending=useRef<{requestId:string;prompt:string;expectedRevision:number;sessionId:string}|null>(null);
  const active=sessions.find(s=>s.id===selected),running=!!active&&['running','waiting_permission','stopping','applying'].includes(active.status);
  const refresh=async()=>{const value=await api<{sessions:AgentSession[]}>(agentSessionPath(projectId));setSessions(value.sessions);return value.sessions;};
  useEffect(()=>{let live=true;Promise.all([api<AgentCatalog>('/api/agent-providers'),api<{sessions:AgentSession[]}>(agentSessionPath(projectId)).catch(()=>({sessions:[]}))]).then(([cap,data])=>{if(!live)return;setCatalog(cap);setSessions(data.sessions);setSelected(data.sessions[0]?.id??'');setProvider(cap.providers.find(p=>p.installed)?.id??'claude');}).catch(e=>live&&setError(message(e)));return()=>{live=false;};},[projectId]);
  useEffect(()=>{if(initialPrompt)setPrompt(initialPrompt);},[initialPrompt]);
  useEffect(()=>{if(catalog?.enabled)void refresh().catch(e=>setError(message(e)));},[refreshKey,revision]);
  useEffect(()=>{setModels([]);setModelStatus('');setModel('');},[provider]);
  useEffect(()=>{
    setEvents([]);cursor.current=0;setConnected(false);if(!selected)return;
    let live=true;const abort=new AbortController();
    const receive=(item:AgentEvent)=>{
      if(!live||item.seq<=cursor.current)return;cursor.current=item.seq;
      setEvents(current=>[...current,item].slice(-2000));
      if(['status','permission','permission_resolved','proposal'].includes(item.type))void refresh().catch(e=>live&&setError(message(e)));
    };
    if(typeof EventSource!=='undefined'){
      const source=new EventSource(`${agentSessionPath(projectId,selected)}/events?stream=true`,{withCredentials:true});
      source.onopen=()=>live&&setConnected(true);source.onerror=()=>live&&setConnected(false);
      source.addEventListener('agent',event=>{try{receive(JSON.parse((event as MessageEvent).data));}catch{setError('The agent event stream returned invalid data. Reopen the session.');}});
      return()=>{live=false;source.close();};
    }
    const poll=async()=>{try{const result=await api<{events:AgentEvent[]}>(`${agentSessionPath(projectId,selected)}/events?after=${cursor.current}`,{signal:abort.signal});result.events.forEach(receive);if(live)setConnected(true);}catch(e){if(live)setError(message(e));}};
    void poll();const timer=setInterval(()=>void poll(),1500);return()=>{live=false;abort.abort();clearInterval(timer);};
  },[projectId,selected]);
  async function action(fn:()=>Promise<void>){setBusy(true);setError('');try{await fn();}catch(e){setError(message(e));}finally{setBusy(false);}}
  async function send(){
    if(blocked)throw new Error(blocked);
    let sessionId=selected;
    if(!sessionId){const result=await post<{session:AgentSession}>(agentSessionPath(projectId),{provider,...(model.trim()?{model:model.trim()}:{}),expectedRevision:revision});sessionId=result.session.id;setSessions(current=>[result.session,...current]);setSelected(sessionId);}
    if(!pending.current||pending.current.prompt!==prompt||pending.current.sessionId!==sessionId)pending.current={requestId:crypto.randomUUID(),prompt,expectedRevision:revision,sessionId};
    const {sessionId:_,...body}=pending.current;
    await post(`${agentSessionPath(projectId,sessionId)}/messages`,body);pending.current=null;setPrompt('');await refresh();
  }
  const resolved=new Set(events.filter(e=>e.type==='permission_resolved').map(e=>String(e.data.requestId)));
  const timeline:AgentEvent[]=[];
  for(const item of events){const previous=timeline.at(-1);if(item.type==='text'&&previous?.type==='text')previous.data={text:String(previous.data.text??'')+String(item.data.text??'')};else timeline.push({...item,data:{...item.data}});}
  return <section className="agent-panel" aria-label="Coding agent conversation">
    {!catalog?<p>Loading coding agents…</p>:!catalog.enabled?<p role="status">{catalog.reason}</p>:<>
      <div className="agent-controls"><label>Session<select aria-label="Agent session" value={selected} disabled={busy} onChange={e=>{setSelected(e.target.value);pending.current=null;}}><option value="">New session</option>{sessions.map(s=><option key={s.id} value={s.id}>{agentProviders.find(p=>p.id===s.provider)?.name} · {new Date(s.createdAt).toLocaleString()} · {s.status}</option>)}</select></label>
      {!selected&&<><label>Agent<select aria-label="Coding agent" value={provider} onChange={e=>setProvider(e.target.value as AgentProvider)}>{catalog.providers.map(p=><option key={p.id} value={p.id} disabled={!p.installed}>{p.name}{!p.installed?' — not installed':''}</option>)}</select></label><label>Model<input aria-label="Agent model" list="studio-agent-models" value={model} onChange={e=>setModel(e.target.value)} placeholder="Use CLI default; OpenCode: provider/model"/><datalist id="studio-agent-models">{models.map(id=><option key={id} value={id}/>)}</datalist></label><button className="text-button" disabled={busy} onClick={()=>void action(async()=>{const result=await api<{models:string[]}>(`/api/agent-providers/${provider}/models`);setModels(result.models);setModelStatus(`${result.models.length} model IDs from CLI; access is checked when used.`);})}>Load model choices</button>{modelStatus&&<p role="status">{modelStatus}</p>}</>}
      {active&&<p className="agent-status" role="status">{agentProviders.find(p=>p.id===active.provider)?.name} · {active.model??'CLI default'} · {active.status}{!connected?' · reconnecting…':''}</p>}</div>
      <div className="agent-timeline" role="log" aria-label="Agent activity" aria-live="polite" aria-relevant="additions">
        {!timeline.length&&<p>Ask the agent to shape your design. Changes stay in a draft until you review and apply them.</p>}
        {timeline.map(item=>item.type==='text'||item.type==='user'?<div key={item.seq} className={`chat-message ${item.type==='user'?'user':'assistant'}`}><span className="chat-author">{item.type==='user'?'You':'Agent'}</span><p>{String(item.data.text??'')}</p></div>:item.type==='permission'&&!resolved.has(String(item.data.requestId))&&active?.status==='waiting_permission'?<div key={item.seq} className="agent-permission"><p>{String(item.data.description??'Agent requests permission')}</p><label>Answer (if requested)<input value={answer} onChange={e=>setAnswer(e.target.value)}/></label>{(['allow','deny'] as const).map(decision=><button className="button small" disabled={busy} key={decision} onClick={()=>void action(async()=>{await post(`${agentSessionPath(projectId,selected)}/permissions`,{requestId:item.data.requestId,decision,answer});setAnswer('');await refresh();})}>{decision==='allow'?'Allow / Send answer':'Deny'}</button>)}</div>:item.type==='tool'||item.type==='tool_result'?<p className="agent-tool" key={item.seq}>{item.type==='tool'?'Using':'Finished'} {String(item.data.name??'tool')}</p>:item.type==='error'?<p role="alert" key={item.seq}>{String(item.data.message)}</p>:item.type==='usage'?<details key={item.seq}><summary>Reported usage</summary><pre>{JSON.stringify(item.data,null,2)}</pre></details>:null)}
      </div>
      {active?.proposal&&<button className="button" disabled={busy||running||!!blocked} onClick={()=>onPreview(active.proposal!,active.id)}>Preview proposal on canvas</button>}
      {blocked&&<p role="status">{blocked}</p>}
      <div className="chat-compose"><textarea aria-label="Message to coding agent" value={prompt} onChange={e=>setPrompt(e.target.value)} placeholder="Describe the design you want…"/><div className="agent-compose-actions"><button className="button primary" disabled={busy||running||!!blocked||!prompt.trim()||(!selected&&!catalog.providers.some(p=>p.id===provider&&p.installed))} onClick={()=>void action(send)}>Send to agent</button>{running&&<button className="button" disabled={busy||active?.status==='stopping'} onClick={()=>void action(async()=>{await post(`${agentSessionPath(projectId,selected)}/interrupt`);await refresh();})}>Stop agent</button>}</div></div>
    </>}{error&&<p role="alert">{error}</p>}
  </section>;
}
