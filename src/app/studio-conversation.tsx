import { useEffect, useRef, useState } from 'react';
import { ArrowUp, ChevronRight, MessageSquare, Sparkles, Square } from 'lucide-react';
import { api, message, post, put } from './api';
import { Busy } from './ui';
import { AssistantPicker, useAssistantConnection } from './assistant-connection';
import { useAgentSession } from './use-agent-session';
import { scopeSchema, type DesignBrief, type DesignScope } from '../shared/brief';
import type { Project } from '../shared/schema';
import type { AgentProposal, AgentProvider } from '../shared/agents';
import './conversation.css';

type ChatMessage = { id?: string; role: 'user' | 'assistant'; text: string };
const hasAnswer = (answer: string | string[] | undefined) => Array.isArray(answer) ? answer.length > 0 : typeof answer === 'string' && !!answer.trim();
const answerFor = (brief: DesignBrief, id: string) => Object.hasOwn(brief.answers, id) ? brief.answers[id] : undefined;
const emptyScope = (request: string): DesignScope => ({ objective: request, audience: '', direction: '', deliverables: [], constraints: [], acceptanceCriteria: [] });

export function StudioConversation({ accountId, project, brief, startRequested, onBrief, reloadBrief, dirty, onSave, onSettings, onProposal, onAgentProposal, refreshKey, proposalReady, onOpenPreview, showScope, onScopeShown, onRunning }: {
  accountId?: string; project: Project; brief: DesignBrief | null; onBrief: (brief: DesignBrief) => void; reloadBrief: () => Promise<void>;
  startRequested: boolean;
  dirty: boolean; onSave: () => Promise<Project>; onSettings: () => void;
  onProposal: (proposal: AgentProposal) => void; onAgentProposal: (proposal: AgentProposal, sessionId: string) => void;
  refreshKey: number; proposalReady: boolean; onOpenPreview: () => void; showScope: boolean; onScopeShown: () => void; onRunning: (running: boolean) => void;
}) {
  const connection = useAssistantConnection(accountId);
  const [prompt, setPrompt] = useState(''), [busy, setBusy] = useState(''), [error, setError] = useState('');
  const [chat, setChat] = useState<ChatMessage[]>([]), [history, setHistory] = useState<DesignBrief[]>([]);
  const [answer, setAnswer] = useState<string | string[]>(''), [editingQuestion, setEditingQuestion] = useState<string | null>(null);
  const [skipped, setSkipped] = useState<string[]>([]), [scopeDraft, setScopeDraft] = useState<DesignScope | null>(null), [scopeEditing, setScopeEditing] = useState(false);
  const [permissionAnswer, setPermissionAnswer] = useState(''), [historyError, setHistoryError] = useState('');
  const actionLock = useRef(false), initiated = useRef(false), bottom = useRef<HTMLDivElement>(null);
  const needsBrief = !!brief && brief.status !== 'approved';
  const hasDesign = project.document.pages.some(page => page.nodes.length > 0);
  const agent = useAgentSession({ projectId: project.id, revision: project.revision, briefRevision: brief?.revision ?? 0,
    purpose: needsBrief ? 'interview' : 'design', provider: connection.choice?.kind === 'agent' ? connection.choice.provider as AgentProvider : undefined,
    model: connection.model, refreshKey, onBrief: () => void reloadBrief(), onPreview: onAgentProposal });
  const locked = !!busy || agent.running || agent.sending;
  const question = editingQuestion ? brief?.questions.find(q => q.id === editingQuestion) : needsBrief ? brief.questions.find(q => !hasAnswer(brief.answers[q.id]) && !skipped.includes(q.id)) : undefined;
  const canApprove = !!brief?.scope && brief.questions.every(q => !q.required || hasAnswer(brief.answers[q.id]));
  useEffect(() => { onRunning(locked); return () => onRunning(false); }, [locked]);
  useEffect(() => {
    const menus = () => document.querySelectorAll<HTMLDetailsElement>('.conversation-heading details[open], .assistant-options[open], .workspace-more[open]');
    const dismiss = (event: PointerEvent) => { menus().forEach(menu => { if (!menu.contains(event.target as Node)) menu.open = false; }); };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape' && !document.querySelector('[role="dialog"]') && menus().length) { event.preventDefault(); menus().forEach(menu => { menu.open = false; menu.querySelector('summary')?.focus(); }); } };
    document.addEventListener('pointerdown', dismiss); document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('pointerdown', dismiss); document.removeEventListener('keydown', escape); };
  }, []);
  useEffect(() => { setAnswer(question && brief ? answerFor(brief, question.id) ?? (question.type === 'multiple' ? [] : '') : ''); }, [question?.id, editingQuestion]);
  useEffect(() => { setScopeDraft(brief?.scope ?? null); }, [brief?.revision]);
  useEffect(() => { if (showScope) { setScopeEditing(true); setScopeDraft(brief?.scope ?? emptyScope(brief?.request ?? project.description ?? '')); onScopeShown(); } }, [showScope]);
  useEffect(() => {
    let live = true;
    api<{ messages: ChatMessage[] }>(`/api/projects/${project.id}/messages`).then(value => live && setChat(value.messages)).catch(e => live && setHistoryError(message(e)));
    return () => { live = false; };
  }, [project.id]);
  useEffect(() => {
    if (!brief) return;
    let live = true;
    const load = async () => {
      const snapshots: DesignBrief[] = []; let after: number | null = 0;
      while (after !== null && live) {
        const result: { history: DesignBrief[]; nextAfter: number | null } = await api(`/api/projects/${project.id}/brief/history?after=${after}`);
        snapshots.push(...result.history); after = result.nextAfter;
      }
      if (live) { setHistory(snapshots); setHistoryError(''); }
    };
    void load().catch(e => live && setHistoryError(message(e)));
    return () => { live = false; };
  }, [project.id, brief?.revision]);
  useEffect(() => { bottom.current?.scrollIntoView({ block: 'nearest' }); }, [chat.length, question?.id, agent.running]);
  async function perform(label: string, task: () => Promise<void>) {
    if (actionLock.current) return;
    actionLock.current = true; setBusy(label); setError('');
    try { await task(); } catch (e) { setError(message(e)); }
    finally { actionLock.current = false; setBusy(''); }
  }
  async function append(role: ChatMessage['role'], text: string) {
    const result = await post<{ message: ChatMessage }>(`/api/projects/${project.id}/messages`, { role, text });
    setChat(items => [...items, result.message]);
  }
  async function interview(current: DesignBrief) {
    if (!connection.choice?.available) throw new Error('Choose an available AI connection.');
    if (connection.choice.kind === 'agent') {
      await agent.send(current.questions.length ? 'Continue from my saved answers.' : 'Help me clarify this design.', current.revision, 'interview');
    } else {
      const result = await post<{ brief: DesignBrief }>(`/api/projects/${project.id}/brief/interview`, { expectedRevision: current.revision, provider: connection.choice.provider, ...(connection.model ? { model: connection.model } : {}) });
      onBrief(result.brief);
    }
  }
  // The user's initial submission authorizes this first interview. Mount/reload never resumes a paid turn.
  async function startInterview() { if (brief) { initiated.current = true; await interview(brief); } }
  useEffect(() => {
    if (!startRequested || initiated.current || !brief || brief.questions.length || brief.scope || !connection.choice?.available || connection.loading) return;
    initiated.current = true;
    void perform('Preparing questions', startInterview);
  }, [startRequested, brief?.revision, connection.choice?.id, connection.loading]);
  async function saveAnswer(skip = false) {
    if (!question || !brief) return;
    if (skip) { setSkipped(values => [...values, question.id]); return; }
    const next = (await put<{ brief: DesignBrief }>(`/api/projects/${project.id}/brief`, { expectedRevision: brief.revision, answers: { [question.id]: answer } })).brief;
    onBrief(next); setEditingQuestion(null); setAnswer('');
    const unanswered = next.questions.some(q => !hasAnswer(next.answers[q.id]) && !skipped.includes(q.id));
    if (!unanswered && !next.scope && connection.choice?.available) await interview(next);
  }
  async function generate(currentBrief: DesignBrief | null, request: string) {
    if (!connection.choice?.available) throw new Error('Choose an available AI connection.');
    if (currentBrief && currentBrief.status !== 'approved') throw new Error('Review and approve the design scope first.');
    const saved = dirty ? await onSave() : project;
    if (connection.choice.kind === 'agent') await agent.send(request, currentBrief?.revision ?? 0, 'design', saved.revision);
    else {
      await append('user', request);
      // The server reads the approved brief itself; do not duplicate private context into the prompt.
      const result = await post<{ document: Project['document']; baseRevision: number; baseBriefRevision: number }>(`/api/projects/${project.id}/generate`, { prompt: request, provider: connection.choice.provider, ...(connection.model ? { model: connection.model } : {}), expectedRevision: saved.revision });
      onProposal({ ...result, version: 0 });
      await append('assistant', 'Your draft is ready. Review it in the preview, then apply it or ask for another direction.');
    }
    setPrompt('');
  }
  async function approveAndCreate() {
    if (!brief) return;
    const current = brief.status === 'approved' ? brief : (await post<{ brief: DesignBrief }>(`/api/projects/${project.id}/brief/approve`, { expectedRevision: brief.revision })).brief;
    onBrief(current); setScopeEditing(false);
    await generate(current, 'Create the design from this approved brief.');
  }
  const answered = new Map<string, { title: string; answer: string | string[]; id: string }>();
  for (const snapshot of history) for (const q of snapshot.questions) if (hasAnswer(snapshot.answers[q.id])) answered.set(`${q.id}:${q.title}`, { title: q.title, answer: snapshot.answers[q.id], id: q.id });
  const timeline: typeof agent.events = [];
  for (const item of agent.events) { const last = timeline.at(-1); if (item.type === 'text' && last?.type === 'text') last.data.text = String(last.data.text ?? '') + String(item.data.text ?? ''); else timeline.push({ ...item, data: { ...item.data } }); }
  const resolved = new Set(agent.events.filter(e => e.type === 'permission_resolved').map(e => String(e.data.requestId)));
  return <section className="studio-conversation" aria-label="Design conversation">
    <div className="conversation-heading"><span><Sparkles size={16} /> Design with AI</span><details><summary aria-label="Conversation history">History</summary><div>
      <p>Your brief and messages are saved with this project.</p>
      {brief && <button className="text-button" disabled={locked} onClick={() => { setScopeDraft(brief.scope ?? emptyScope(brief.request)); setScopeEditing(true); }}>Review design brief</button>}
      {agent.sessions.length > 0 && <label>Agent session<select aria-label="Agent session" value={agent.active?.id ?? ''} disabled={locked} onChange={e => agent.select(e.target.value)}><option value="">New conversation</option>{agent.sessions.map(s => <option key={s.id} value={s.id}>{s.purpose === 'interview' ? 'Brief' : 'Design'} · {new Date(s.createdAt).toLocaleString()} · {s.status}</option>)}</select></label>}
    </div></details></div>
    <div className="conversation-scroll">
      {!brief && chat.length === 0 && agent.events.length === 0 && <div className="conversation-welcome"><MessageSquare size={24} /><h2>What would you like to change?</h2><p>Describe your idea. We’ll work on the design together.</p><button onClick={() => setPrompt('Make the layout more editorial')} className="conversation-suggestion">Make the layout more editorial <ChevronRight size={15}/></button><button onClick={() => setPrompt('Add a clear call to action')} className="conversation-suggestion">Add a clear call to action <ChevronRight size={15}/></button></div>}
      {brief && <>
        <div className="chat-message user"><span className="chat-author">Your idea</span><p>{brief.request}</p></div>
        {Array.from(answered.values()).map((item, index) => <div className="conversation-answer" key={`${item.id}:${index}`}><p className="conversation-question-label">{item.title}</p><div className="chat-message user"><p>{Array.isArray(item.answer) ? item.answer.join(', ') : item.answer}</p>{brief.questions.some(q => q.id === item.id && q.title === item.title) && <button className="text-button" disabled={locked} onClick={() => setEditingQuestion(item.id)}>Edit answer</button>}</div></div>)}
        {brief.message && needsBrief && <p className="conversation-guidance">{brief.message}</p>}
        {question && <section className="conversation-question" aria-label="Current design question"><h3>{question.title}</h3>{question.description && <p>{question.description}</p>}
          {question.type !== 'text' && <div className="conversation-choices">{question.options.map(option => { const chosen = Array.isArray(answer) ? answer.includes(option) : answer === option; return <button key={option} disabled={locked} aria-pressed={chosen} className={chosen ? 'selected' : ''} onClick={() => setAnswer(question.type === 'multiple' ? chosen ? (Array.isArray(answer) ? answer : []).filter(value => value !== option) : [...(Array.isArray(answer) ? answer : []), option] : option)}>{option}</button>; })}</div>}
          <label>{question.type === 'text' ? 'Your answer' : 'Or use your own words'}<textarea aria-label={`Answer: ${question.title}`} value={Array.isArray(answer) ? '' : answer} disabled={locked} maxLength={4000} onChange={e => setAnswer(e.target.value)} placeholder="Tell us what matters…" /></label>
          <div className="conversation-actions"><button className="button primary" disabled={locked || !hasAnswer(answer)} onClick={() => void perform('Saving answer', () => saveAnswer())}>Send answer <ArrowUp size={15}/></button>{!question.required && <button className="text-button" disabled={locked} onClick={() => void saveAnswer(true)}>Skip</button>}</div>
        </section>}
        {needsBrief && !question && !brief.scope && !scopeEditing && <div className="conversation-start"><p>Let’s clarify the audience, direction and what you want to make.</p><button className="button primary" disabled={locked || !connection.choice?.available} onClick={() => void perform('Preparing questions', startInterview)}>{brief.questions.length ? 'Continue conversation' : 'Start conversation'}</button><button className="text-button" disabled={locked} onClick={() => { setScopeDraft(emptyScope(brief.request)); setScopeEditing(true); }}>Write the brief myself</button></div>}
        {brief.status === 'approved' && hasDesign && !scopeEditing && !error && <button className="text-button" disabled={locked} onClick={() => setScopeEditing(true)}>Review approved brief</button>}
        {(needsBrief || !hasDesign || scopeEditing || !!error) && (brief.scope && (!question || scopeEditing) || scopeEditing) && <section className="conversation-scope" aria-label="Design scope"><div className="conversation-scope-heading"><h3>{brief.status === 'approved' ? 'Approved design brief' : 'Here’s the direction'}</h3>{!scopeEditing && <button className="text-button" disabled={locked} onClick={() => setScopeEditing(true)}>Edit</button>}</div>
          {scopeEditing && scopeDraft ? <form onSubmit={e => { e.preventDefault(); void perform('Saving brief', async () => { const clean = (values: string[]) => values.map(value => value.trim()).filter(Boolean); const scope = scopeSchema.parse({...scopeDraft, deliverables:clean(scopeDraft.deliverables), constraints:clean(scopeDraft.constraints), acceptanceCriteria:clean(scopeDraft.acceptanceCriteria)}); const result = await put<{ brief: DesignBrief }>(`/api/projects/${project.id}/brief`, { expectedRevision: brief.revision, ...(brief.questions.length ? { scope } : { interview: { message: 'Review this design brief before creating.', questions: [], scope } }) }); onBrief(result.brief); setScopeEditing(false); }); }}>
            {(['objective', 'audience', 'direction', 'deliverables', 'constraints', 'acceptanceCriteria'] as const).map(key => <label key={key}>{({objective:'Objective',audience:'Audience',direction:'Visual direction',deliverables:'Deliverables',constraints:'Constraints',acceptanceCriteria:'Acceptance criteria'})[key]}<textarea disabled={locked} aria-label={key === 'direction' ? 'Visual direction' : key === 'acceptanceCriteria' ? 'Acceptance criteria' : key[0].toUpperCase() + key.slice(1)} value={Array.isArray(scopeDraft[key]) ? scopeDraft[key].join('\n') : scopeDraft[key]} onChange={e => setScopeDraft({ ...scopeDraft, [key]: Array.isArray(scopeDraft[key]) ? e.target.value.split('\n') : e.target.value })} /></label>)}
            <div className="conversation-actions"><button className="button" disabled={locked}>Save brief</button><button type="button" className="text-button" disabled={locked} onClick={() => { setScopeEditing(false); setScopeDraft(brief.scope); }}>Cancel</button></div>
          </form> : brief.scope && <><p>{brief.scope.objective}</p><dl><dt>For</dt><dd>{brief.scope.audience}</dd><dt>Direction</dt><dd>{brief.scope.direction}</dd><dt>Deliverables</dt><dd>{brief.scope.deliverables.join(' · ')}</dd></dl><details><summary>Success criteria and constraints</summary><ul>{[...brief.scope.acceptanceCriteria,...brief.scope.constraints].map((value,i) => <li key={i}>{value}</li>)}</ul></details></>}
          {!scopeEditing && <button className="button primary" disabled={locked || !canApprove || !connection.choice?.available || proposalReady} onClick={() => void perform('Creating design', approveAndCreate)}>{brief.status === 'approved' ? 'Create design' : 'Approve and create'}</button>}
        </section>}
      </>}
      {chat.map((item,i) => <div className={`chat-message ${item.role}`} key={item.id ?? i}><span className="chat-author">{item.role === 'user' ? 'You' : 'Studio'}</span><p>{item.text}</p></div>)}
      <div role="log" aria-label="Agent activity" aria-live="polite" aria-relevant="additions">
        {timeline.filter(item => item.type === 'text' || item.type === 'user' || item.type === 'error').map(item => <div key={item.seq} className={`chat-message ${item.type === 'user' ? 'user' : 'assistant'}`} role={item.type === 'error' ? 'alert' : undefined}><span className="chat-author">{item.type === 'user' ? 'You' : connection.choice?.name}</span><p>{String(item.data.text ?? item.data.message ?? '')}</p></div>)}
      </div>
      {agent.events.filter(e => e.type === 'permission' && !resolved.has(String(e.data.requestId)) && agent.active?.status === 'waiting_permission').map(e => <div className="agent-permission" key={e.seq}><p>{String(e.data.description)}</p><label>Answer<input value={permissionAnswer} onChange={e => setPermissionAnswer(e.target.value)} /></label><button className="button" onClick={() => void agent.respond(String(e.data.requestId), 'allow', permissionAnswer)}>Allow / Send answer</button><button className="button" onClick={() => void agent.respond(String(e.data.requestId), 'deny', '')}>Deny</button></div>)}
      {agent.events.some(e => ['tool','tool_result','usage'].includes(e.type)) && <details className="conversation-activity"><summary>Activity details</summary>{agent.events.filter(e => ['tool','tool_result','usage'].includes(e.type)).map(e => <p key={e.seq}>{e.type === 'usage' ? `Reported usage: ${JSON.stringify(e.data)}` : `${e.type === 'tool' ? 'Using' : 'Finished'} ${String(e.data.name)}`}</p>)}</details>}
      {locked && <p role="status" className="conversation-progress"><Busy label={busy || (agent.active?.status === 'waiting_permission' ? 'Waiting for your answer' : 'Working on your design…')} /></p>}
      {agent.active && !agent.connected && <p role="status">Reconnecting to agent activity…</p>}
      {(error || agent.error || historyError) && <div className="conversation-error" role="alert"><p>{error || agent.error || historyError}</p><button className="text-button" disabled={locked} onClick={() => void perform('Refreshing', reloadBrief)}>Reload current brief</button></div>}
      {proposalReady && <div className="conversation-ready"><Sparkles size={18}/><p>Your draft is ready to review.</p><button className="button" onClick={onOpenPreview}>View design <ChevronRight size={15}/></button></div>}
      <div ref={bottom} />
    </div>
    <div className="conversation-compose">
      {!needsBrief && !editingQuestion && <textarea aria-label="Message to AI designer" value={prompt} onChange={e => setPrompt(e.target.value)} placeholder="Describe what you’d like to change…" disabled={locked} onKeyDown={e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && !e.nativeEvent.isComposing && prompt.trim() && !proposalReady) { e.preventDefault(); void perform('Creating draft', () => generate(brief, prompt)); } }} />}
      <AssistantPicker connection={connection} disabled={locked || proposalReady} onSettings={onSettings} />
      <div className="conversation-send-row"><small>{needsBrief ? 'Your answers shape the design.' : proposalReady ? 'Review or discard the draft to continue.' : 'Changes stay in a draft until you apply them.'}</small>{agent.running ? <button className="button" disabled={agent.active?.status === 'stopping'} onClick={() => void agent.stop()}><Square size={13}/> Stop agent</button> : !needsBrief && !editingQuestion && <button className="button primary" disabled={locked || !prompt.trim() || !connection.choice?.available || proposalReady} onClick={() => void perform('Creating draft', () => generate(brief, prompt))}>{dirty ? 'Save and send' : 'Send'} <ArrowUp size={16}/></button>}</div>
    </div>
  </section>;
}
