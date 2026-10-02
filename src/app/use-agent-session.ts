import { useEffect, useRef, useState } from 'react';
import { api, message, post } from './api';
import { agentSessionPath, type AgentEvent, type AgentProposal, type AgentProvider, type AgentPurpose, type AgentSession } from '../shared/agents';

export const isAgentRunning = (session?: AgentSession) => !!session && ['running', 'waiting_permission', 'stopping', 'applying'].includes(session.status);
export function useAgentSession({ projectId, revision, briefRevision, purpose, provider, model, refreshKey, onBrief, onPreview }: {
  projectId: string; revision: number; briefRevision: number; purpose: AgentPurpose; provider?: AgentProvider; model: string; refreshKey: number;
  onBrief: () => void; onPreview: (proposal: AgentProposal, sessionId: string) => void;
}) {
  const [sessions, setSessions] = useState<AgentSession[]>([]), [selected, setSelected] = useState<string | null>(null);
  const [events, setEvents] = useState<AgentEvent[]>([]), [error, setError] = useState(''), [connected, setConnected] = useState(false), [sending, setSending] = useState(false);
  const callbacks = useRef({ onBrief, onPreview }); callbacks.current = { onBrief, onPreview };
  const previewed = useRef(''), pending = useRef<{ sessionId: string; body: { requestId: string; prompt: string; expectedRevision: number; expectedBriefRevision: number } } | null>(null);
  const sendLock = useRef(false);
  const refresh = async () => { const value = await api<{ sessions: AgentSession[] }>(agentSessionPath(projectId)); setSessions(value.sessions); return value.sessions; };
  const matching = sessions.filter(s => (s.purpose ?? 'design') === purpose && s.provider === provider && (s.model || '') === model.trim());
  const automatic = matching.find(s => isAgentRunning(s) || !!s.proposal || (purpose === 'interview' || (s.baseRevision === undefined || s.baseRevision === revision) && (s.baseBriefRevision === undefined || s.baseBriefRevision === briefRevision)));
  const active = selected === null ? automatic : sessions.find(s => s.id === selected);
  const activeId = active?.id;
  const running = isAgentRunning(active);
  useEffect(() => { setSelected(null); pending.current = null; setError(''); }, [projectId, provider, model, purpose]);
  useEffect(() => {
    if (!provider) return;
    let live = true;
    api<{ sessions: AgentSession[] }>(agentSessionPath(projectId)).then(value => { if (live) setSessions(value.sessions); }).catch(e => { if (live) setError(message(e)); });
    return () => { live = false; };
  }, [projectId, provider, purpose, revision, refreshKey]);
  useEffect(() => {
    setEvents([]); setConnected(false);
    if (!activeId) return;
    let live = true, cursor = 0;
    const receive = (item: AgentEvent) => {
      if (!live || item.seq <= cursor) return;
      cursor = item.seq;
      setEvents(items => [...items, item].slice(-2000));
      if (item.type === 'brief') callbacks.current.onBrief();
      if (['status', 'permission', 'permission_resolved', 'proposal'].includes(item.type)) void refresh().catch(e => live && setError(message(e)));
    };
    if (typeof EventSource !== 'undefined') {
      const source = new EventSource(`${agentSessionPath(projectId, activeId)}/events?stream=true`, { withCredentials: true });
      source.onopen = () => live && setConnected(true);
      source.onerror = () => live && setConnected(false);
      source.addEventListener('agent', event => { try { receive(JSON.parse((event as MessageEvent).data)); } catch { if (live) setError('Could not read agent activity. Reopen this conversation.'); } });
      return () => { live = false; source.close(); };
    }
    const abort = new AbortController();
    const poll = async () => {
      try { const result = await api<{ events: AgentEvent[] }>(`${agentSessionPath(projectId, activeId)}/events?after=${cursor}`, { signal: abort.signal }); result.events.forEach(receive); if (live) setConnected(true); }
      catch (e) { if (live) { setConnected(false); setError(message(e)); } }
    };
    void poll(); const timer = setInterval(() => void poll(), 1500);
    return () => { live = false; abort.abort(); clearInterval(timer); };
  }, [projectId, activeId]);
  useEffect(() => {
    if (purpose !== 'design' || !active?.proposal || running) return;
    const key = `${active.id}:${active.proposal.version}`;
    if (previewed.current === key) return;
    previewed.current = key;
    callbacks.current.onPreview(active.proposal, active.id);
  }, [active, running, purpose]);
  async function send(prompt: string, observedBriefRevision = briefRevision, requestedPurpose = purpose, observedRevision = revision) {
    if (!provider || sendLock.current || running) throw new Error('Wait for the current agent turn to finish.');
    sendLock.current = true; setSending(true); setError('');
    try {
      let sessionId = active && (active.purpose ?? 'design') === requestedPurpose && (requestedPurpose === 'interview' || (active.baseRevision === undefined || active.baseRevision === observedRevision) && (active.baseBriefRevision === undefined || active.baseBriefRevision === observedBriefRevision)) ? activeId : undefined;
      if (active?.proposal && !sessionId) throw new Error('Review or discard the current draft before starting another design.');
      if (!sessionId) {
        const result = await post<{ session: AgentSession }>(agentSessionPath(projectId), { provider, purpose: requestedPurpose, ...(model.trim() ? { model: model.trim() } : {}), expectedRevision: observedRevision, expectedBriefRevision: observedBriefRevision });
        sessionId = result.session.id; setSessions(items => [result.session, ...items]); setSelected(sessionId);
      }
      if (!pending.current || pending.current.sessionId !== sessionId || pending.current.body.prompt !== prompt) pending.current = { sessionId, body: { requestId: crypto.randomUUID(), prompt, expectedRevision: observedRevision, expectedBriefRevision: observedBriefRevision } };
      await post(`${agentSessionPath(projectId, sessionId)}/messages`, pending.current.body);
      pending.current = null;
      await refresh();
    } catch (e) { setError(message(e)); throw e; }
    finally { sendLock.current = false; setSending(false); }
  }
  async function perform(suffix: string, body = {}) {
    if (!activeId) return;
    setError('');
    try { await post(`${agentSessionPath(projectId, activeId)}/${suffix}`, body); await refresh(); }
    catch (e) { setError(message(e)); }
  }
  return { sessions: sessions.filter(s => s.provider === provider && (s.model || '') === model.trim()), active, events, running, sending, connected, error, send, stop: () => perform('interrupt'), respond: (requestId: string, decision: 'allow' | 'deny', answer: string) => perform('permissions', { requestId, decision, answer }), select: (id: string) => { setSelected(id); pending.current = null; previewed.current = ''; } };
}
