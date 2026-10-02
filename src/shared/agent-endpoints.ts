import { agentCreateSchema, agentMessageSchema, agentPermissionSchema, agentProposalActionSchema } from './agents';
export const agentEndpoints = [
  {name:'agent_providers',method:'GET',path:'/api/agent-providers',summary:'Discover self-hosted coding agents and availability',body:undefined,schema:undefined},
  {name:'agent_models',method:'GET',path:'/api/agent-providers/{provider}/models',summary:'Discover model IDs from the server CLI; catalog membership does not guarantee access',body:undefined,schema:undefined},
  {name:'agent_sessions',method:'GET',path:'/api/projects/{id}/agent-sessions',summary:'List coding-agent sessions owned by the configured operator',body:undefined,schema:undefined},
  {name:'agent_create',method:'POST',path:'/api/projects/{id}/agent-sessions',summary:'Create a design session (default) or an interview session with purpose=interview and expectedBriefRevision; only design sessions can edit drafts',body:{provider:'codex',expectedRevision:1},schema:agentCreateSchema},
  {name:'agent_session',method:'GET',path:'/api/projects/{id}/agent-sessions/{sessionId}',summary:'Read an agent session and its current proposal',body:undefined,schema:undefined},
  {name:'agent_message',method:'POST',path:'/api/projects/{id}/agent-sessions/{sessionId}/messages',summary:'Run a turn for the session purpose; interviews require expectedBriefRevision. Retain requestId for exact retries; incurs agent usage',body:{requestId:'00000000-0000-4000-8000-000000000001',prompt:'Refine the header spacing',expectedRevision:1},schema:agentMessageSchema},
  {name:'agent_events',method:'GET',path:'/api/projects/{id}/agent-sessions/{sessionId}/events',summary:'Read durable events after a sequence ID; stream=true enables SSE',body:undefined,schema:undefined},
  {name:'agent_interrupt',method:'POST',path:'/api/projects/{id}/agent-sessions/{sessionId}/interrupt',summary:'Stop the agent and retain its draft for review',body:{},schema:undefined},
  {name:'agent_permission',method:'POST',path:'/api/projects/{id}/agent-sessions/{sessionId}/permissions',summary:'Answer a pending agent permission or input request',body:{requestId:'pending-request-id',decision:'deny'},schema:agentPermissionSchema},
  {name:'agent_proposal',method:'GET',path:'/api/projects/{id}/agent-sessions/{sessionId}/proposal',summary:'Read the draft proposal without changing the saved design',body:undefined,schema:undefined},
  {name:'agent_apply',method:'POST',path:'/api/projects/{id}/agent-sessions/{sessionId}/proposal/apply',summary:'Apply a human-reviewed proposal, checking document and brief revisions',body:{proposalVersion:1},schema:agentProposalActionSchema},
  {name:'agent_discard',method:'POST',path:'/api/projects/{id}/agent-sessions/{sessionId}/proposal/discard',summary:'Discard the reviewed draft and reset to the current saved design',body:{proposalVersion:1},schema:agentProposalActionSchema},
] as const;
