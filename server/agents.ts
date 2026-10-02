import { Hono, type Context } from 'hono';
import { streamSSE } from 'hono/streaming';
import { z } from 'zod';
import type { Env } from './types';
import { fail, id, now, owner } from './security';
import { projectRow, saveDocument, validateAssets } from './projects';
import { documentSchema, type DesignDocument } from '../src/shared/schema';
import { mutateDocument, operationSchema } from '../src/shared/operations';
import { blocks, themes, templates } from '../src/shared/catalog';
import { inspectDesign } from '../src/shared/design-checks';
import { renderSvg } from '../src/shared/render';
import { agentProviderSchema, agentCreateSchema, agentMessageSchema, agentPermissionSchema, agentProposalActionSchema, agentTools, agentToolNames, compactOperationsSchema, type AgentEmission, type AgentEvent, type AgentSession, type AgentToolName, type AgentPurpose } from '../src/shared/agents';
import { readBriefHistory, saveBrief } from './briefs';
import { ClaudeToolsUnavailableError } from './agent-runtime-contract';

interface SessionRow {
  id: string; project_id: string; user_id: string; provider: AgentSession['provider']; model: string | null;
  status: AgentSession['status']; native_handle: string | null; draft_document: string; draft_version: number;
  has_proposal: number; base_revision: number; base_brief_revision: number; created_at: string; updated_at: string;
  purpose: AgentPurpose;
}
function access(c: Context<Env>) {
  const user = owner(c);
  if (c.get('tokenKind') === 'oauth') fail(403, 'insufficient_scope', 'The studio OAuth scope does not authorize running server-side coding agents. Use an owner API key.');
  if (c.env.STUDIO_AGENTS_ENABLED !== 'true' || !c.env.AGENT_RUNTIME) fail(503, 'agents_unavailable', 'Coding agents require an enabled self-hosted Node runtime.');
  if (c.env.STUDIO_AGENT_OWNER_ID !== user) fail(403, 'agents_forbidden', 'Coding agents are available only to the operator-designated Studio account.');
  return c.env.AGENT_RUNTIME;
}
function serialize(row: SessionRow): AgentSession {
  return { id: row.id, projectId: row.project_id, provider: row.provider, model: row.model, status: row.status,
    createdAt: row.created_at, updatedAt: row.updated_at, purpose: row.purpose, baseRevision: row.base_revision, baseBriefRevision: row.base_brief_revision,
    proposal: row.has_proposal ? { document: documentSchema.parse(JSON.parse(row.draft_document)), version: row.draft_version, baseRevision: row.base_revision, baseBriefRevision: row.base_brief_revision } : null };
}
async function session(c: Context<Env>, sessionId: string) {
  await projectRow(c, c.req.param('id')!);
  const row = await c.env.DB.prepare('SELECT * FROM agent_sessions WHERE id=? AND project_id=? AND user_id=?').bind(sessionId, c.req.param('id'), owner(c)).first<SessionRow>();
  if (!row) fail(404, 'not_found', 'Agent session not found.');
  return row;
}
async function brief(c: Context<Env>, projectId: string, requireApproval=true) {
  const row = await c.env.DB.prepare('SELECT brief,revision FROM design_briefs WHERE project_id=? AND user_id=?').bind(projectId, owner(c)).first<{brief: string; revision: number}>();
  const value = row ? JSON.parse(row.brief) : null;
  if (requireApproval && value && (value.status !== 'approved' || !value.scope || !value.approvedAt)) fail(409, 'brief_not_approved', 'Review and explicitly approve the current brief before running an agent.');
  return { value, revision: row?.revision ?? 0 };
}
async function event(c: Context<Env>, sessionId: string, emission: AgentEmission) {
  // Persist before delivering; clients resume from the last durable sequence ID.
  await c.env.DB.prepare('INSERT INTO agent_events(session_id,type,data,created_at) VALUES(?,?,?,?)').bind(sessionId, emission.type, JSON.stringify(emission.data), now()).run();
}
async function events(c: Context<Env>, sessionId: string, after: number) {
  const rows = await c.env.DB.prepare('SELECT seq,type,data,created_at FROM agent_events WHERE session_id=? AND seq>? ORDER BY seq LIMIT 200').bind(sessionId, after).all<{seq:number;type:AgentEvent['type'];data:string;created_at:string}>();
  return rows.results.map(row => ({seq:row.seq,sessionId,type:row.type,data:JSON.parse(row.data),createdAt:row.created_at}));
}
async function tool(c: Context<Env>, sessionId: string, name: AgentToolName, input: unknown) {
  const {authenticate}=await import('./security');await authenticate(c);
  access(c);
  const row = await session(c, sessionId);
  if (!['running','waiting_permission'].includes(row.status)) fail(409, 'agent_not_running', 'This turn no longer authorizes tool calls.');
  if (!Object.hasOwn(agentTools, name)) fail(400, 'unknown_tool', 'Unknown Studio draft tool.');
  if (!agentToolNames(row.purpose).includes(name)) fail(403, 'tool_forbidden', 'This tool is not available for this session purpose.');
  const body = agentTools[name].schema.parse(input) as any;
  if (row.purpose === 'interview') {
    const current = await brief(c, row.project_id, false);
    if (!current.value || current.value.status === 'approved') fail(409, 'interview_closed', 'The brief is approved or unavailable. Open its questions to revise it explicitly.');
    if (name === 'studio_brief_context') {
      const project = await projectRow(c, row.project_id);
      return { project: { name: project.name, kind: project.kind, document: JSON.parse(project.document) }, brief: current.value, history: await readBriefHistory(c, row.project_id, Math.max(0, current.revision - 50)) };
    }
    const next = await saveBrief(c, row.project_id, { expectedRevision: body.expectedRevision, interview: body.interview });
    await event(c, row.id, { type: 'brief', data: { revision: next.revision } });
    return { brief: next, message: 'Questions saved. Only the human can approve the scope.' };
  }
  const document = documentSchema.parse(JSON.parse(row.draft_document));
  if (name === 'studio_schema') {
    if(body.operation){const schema=operationSchema.options.find(option=>option.shape.op.value===body.operation);if(!schema)fail(400,'unknown_operation','Unknown operation. Read the operation names first.');return {operation:z.toJSONSchema(schema)};}
    return {document:z.toJSONSchema(documentSchema),operations:z.toJSONSchema(compactOperationsSchema),operationNames:operationSchema.options.map(option=>option.shape.op.value)};
  }
  if (name === 'studio_catalog') return { blocks, themes, templates };
  if (name === 'studio_context') return { document, version:row.draft_version, baseRevision:row.base_revision, brief:(await brief(c,row.project_id)).value, baseBriefRevision:row.base_brief_revision };
  if (name === 'studio_inspect') {
    if (!document.pages[body.pageIndex]) fail(400,'invalid_page','Page does not exist.');
    return { checks:inspectDesign(document), svg:renderSvg(document,body.pageIndex) };
  }
  const current = await projectRow(c,row.project_id), currentBrief = await brief(c,row.project_id);
  if (current.revision !== row.base_revision || currentBrief.revision !== row.base_brief_revision) fail(409,'revision_conflict','The saved design or brief changed. Review the draft, then start a new session from the latest design.');
  if (body.version !== row.draft_version) fail(409,'draft_conflict','Read the latest draft version before editing.');
  const draft: DesignDocument = documentSchema.parse(name === 'studio_edit' ? mutateDocument(document,body.operations) : body.document);
  if (draft.id !== current.id || draft.kind !== current.kind || draft.schemaVersion !== document.schemaVersion) fail(400,'invalid_document','Preserve the project identity, kind and schema version.');
  await validateAssets(c,draft,row.project_id);
  const updated = await c.env.DB.prepare("UPDATE agent_sessions SET draft_document=?,draft_version=draft_version+1,has_proposal=1,updated_at=? WHERE id=? AND draft_version=? AND status IN ('running','waiting_permission')").bind(JSON.stringify(draft),now(),row.id,row.draft_version).run();
  if (!updated.meta.changes) fail(409,'draft_conflict','The draft changed or the turn stopped. Read its current state.');
  await event(c,row.id,{type:'proposal',data:{version:row.draft_version+1}});
  return {version:row.draft_version+1,checks:inspectDesign(draft),message:'Draft updated. The human must review and apply it.'};
}
export const agentRoutes = new Hono<Env>();
agentRoutes.get('/agent-providers', async c => {
  const user = owner(c);
  if (c.env.STUDIO_AGENTS_ENABLED !== 'true' || !c.env.AGENT_RUNTIME) return c.json({enabled:false,reason:'Coding agents require an enabled self-hosted Node runtime.',providers:[]});
  if (c.get('tokenKind') === 'oauth' || c.env.STUDIO_AGENT_OWNER_ID !== user) return c.json({enabled:false,reason:'This account or credential is not authorized to run coding agents.',providers:[]});
  return c.json(await c.env.AGENT_RUNTIME.catalog());
});
const root = '/projects/:id/agent-sessions';
agentRoutes.get('/agent-providers/:provider/models',async c=>{
  const runtime=access(c),provider=agentProviderSchema.parse(c.req.param('provider'));
  try{return c.json({models:await runtime.models(provider),source:'cli'});}catch{fail(502,'agent_catalog_failed','Could not read models from the CLI. Check server-side authentication, or use its configured default.');}
});
agentRoutes.use('/projects/:id/agent-sessions/*',async(c,next)=>{access(c);await next();});
agentRoutes.get(root, async c => {
  access(c);await projectRow(c,c.req.param('id'));
  const rows = await c.env.DB.prepare('SELECT * FROM agent_sessions WHERE project_id=? AND user_id=? ORDER BY created_at DESC LIMIT 100').bind(c.req.param('id'),owner(c)).all<SessionRow>();
  return c.json({sessions:rows.results.map(serialize)});
});
agentRoutes.post(root,async c=>{
  const runtime=access(c), body=agentCreateSchema.parse(await c.req.json()), project=await projectRow(c,c.req.param('id'));
  if(body.expectedRevision!==project.revision)fail(409,'revision_conflict','Save or reload the design before creating a session.');
  const approved=await brief(c,project.id,body.purpose==='design'), catalog=await runtime.catalog();
  if(body.purpose==='interview'&&(!approved.value||approved.value.status==='approved'))fail(409,'interview_closed','Save an unapproved brief before starting its interview.');
  if((body.purpose==='interview'||body.expectedBriefRevision!==undefined)&&body.expectedBriefRevision!==approved.revision)fail(409,'revision_conflict','Reload the current brief before starting its interview.');
  if(!catalog.providers.find(p=>p.id===body.provider)?.installed)fail(400,'agent_unavailable','Install this agent CLI on the server and configure its credentials.');
  const sessionId=id(), timestamp=now();
  await c.env.DB.prepare('INSERT INTO agent_sessions(id,project_id,user_id,provider,model,draft_document,base_revision,base_brief_revision,created_at,updated_at,purpose) VALUES(?,?,?,?,?,?,?,?,?,?,?)').bind(sessionId,project.id,owner(c),body.provider,body.model??null,project.document,project.revision,approved.revision,timestamp,timestamp,body.purpose).run();
  return c.json({session:serialize(await session(c,sessionId))},201);
});
agentRoutes.get(`${root}/:sessionId`,async c=>c.json({session:serialize(await session(c,c.req.param('sessionId')))}));
agentRoutes.post(`${root}/:sessionId/messages`,async c=>{
  const runtime=access(c), body=agentMessageSchema.parse(await c.req.json()), row=await session(c,c.req.param('sessionId'));
  const payload=JSON.stringify(body);
  const existing=await c.env.DB.prepare('SELECT id,payload,status FROM agent_turns WHERE session_id=? AND request_id=?').bind(row.id,body.requestId).first<{id:string;payload:string;status:string}>();
  if(existing){if(existing.payload!==payload)fail(409,'request_conflict','This request ID was used with a different message.');return c.json({turnId:existing.id,status:existing.status},202);}
  const current=await projectRow(c,row.project_id), approved=await brief(c,row.project_id,row.purpose==='design');
  if(row.purpose==='interview'&&(!approved.value||approved.value.status==='approved'))fail(409,'interview_closed','The brief is already approved. Start a design session.');
  if(body.expectedRevision!==current.revision||(row.purpose==='design'&&(row.base_revision!==current.revision||row.base_brief_revision!==approved.revision))||((row.purpose==='interview'||body.expectedBriefRevision!==undefined)&&body.expectedBriefRevision!==approved.revision))fail(409,'revision_conflict','The saved design or brief changed. Reload its current state before continuing.');
  const turnId=id();
  const results=await c.env.DB.batch([
    c.env.DB.prepare("UPDATE agent_sessions SET status='running',updated_at=? WHERE id=? AND status IN ('idle','interrupted','error') AND NOT EXISTS(SELECT 1 FROM agent_sessions WHERE project_id=? AND status IN ('running','waiting_permission','stopping','applying'))").bind(now(),row.id,row.project_id),
    c.env.DB.prepare("INSERT INTO agent_turns(id,session_id,request_id,payload,status,created_at) SELECT ?,?,?,?,'running',? WHERE changes()=1").bind(turnId,row.id,body.requestId,payload,now()),
  ]) as {meta:{changes:number}}[];
  if(!results[0].meta.changes){
    const retry=await c.env.DB.prepare('SELECT id,payload,status FROM agent_turns WHERE session_id=? AND request_id=?').bind(row.id,body.requestId).first<{id:string;payload:string;status:string}>();
    if(retry){if(retry.payload!==payload)fail(409,'request_conflict','This request ID was used with a different message.');return c.json({turnId:retry.id,status:retry.status},202);}
    fail(409,'agent_busy','An agent is already running or applying a proposal in this project.');
  }
  await event(c,row.id,{type:'user',data:{text:body.prompt,turnId}});
  await event(c,row.id,{type:'status',data:{status:'running',turnId}});
  // Runtime work outlives the request/browser. Only Node injects this binding.
  void (async()=>{
    let status: 'idle'|'error'|'interrupted'='idle';
    try{
      await runtime.run({sessionId:row.id,provider:row.provider,purpose:row.purpose,model:row.model??undefined,nativeHandle:row.native_handle??undefined,prompt:body.prompt,
        tool:(name,input)=>tool(c,row.id,name,input),
        persistHandle:async handle=>{await c.env.DB.prepare('UPDATE agent_sessions SET native_handle=? WHERE id=?').bind(handle,row.id).run();},
        emit:async emission=>{
          if(emission.type==='permission')await c.env.DB.prepare("UPDATE agent_sessions SET status='waiting_permission' WHERE id=? AND status='running'").bind(row.id).run();
          if(emission.type==='permission_resolved')await c.env.DB.prepare("UPDATE agent_sessions SET status='running' WHERE id=? AND status='waiting_permission'").bind(row.id).run();
          await event(c,row.id,emission);
        },
      });
    }catch(error){
      status=error instanceof Error&&error.name==='AbortError'?'interrupted':'error';
      const data=status==='interrupted'?{code:'agent_interrupted',message:'Agent stopped. The saved design is unchanged.'}
        :error instanceof ClaudeToolsUnavailableError?{code:error.code,message:error.message}
        :{code:'agent_failed',message:'Agent could not finish. Check CLI authentication, model access and the server configuration, then retry.'};
      await event(c,row.id,{type:'error',data});
    }finally{
      const state=await c.env.DB.prepare('SELECT status FROM agent_sessions WHERE id=?').bind(row.id).first<{status:string}>();
      if(state?.status==='stopping')status='interrupted';
      await c.env.DB.prepare("UPDATE agent_sessions SET status=?,updated_at=? WHERE id=? AND status IN ('running','waiting_permission','stopping')").bind(status,now(),row.id).run();
      await c.env.DB.prepare('UPDATE agent_turns SET status=? WHERE id=?').bind(status,turnId).run();
      if(state)await event(c,row.id,{type:'status',data:{status,turnId}});
    }
  })().catch(()=>{ /* Project deletion cascades its running session; no private diagnostics in client logs. */ });
  return c.json({turnId,status:'running'},202);
});
agentRoutes.get(`${root}/:sessionId/events`,async c=>{
  const row=await session(c,c.req.param('sessionId'));
  const after=z.coerce.number().int().nonnegative().parse(c.req.header('Last-Event-ID')??c.req.query('after')??0);
  if(c.req.query('stream')!=='true')return c.json({events:await events(c,row.id,after)});
  return streamSSE(c,async stream=>{
    let cursor=after;
    while(!stream.aborted){
      // Reauthenticate long streams; logout/token expiry must close access.
      const {authenticate}=await import('./security');await authenticate(c);access(c);await session(c,row.id);
      const batch=await events(c,row.id,cursor);
      for(const item of batch){await stream.writeSSE({id:String(item.seq),event:'agent',data:JSON.stringify(item)});cursor=item.seq;}
      if(batch.length===200)continue;
      await stream.writeSSE({event:'heartbeat',data:'{}'});
      await stream.sleep(1000);
    }
  });
});
agentRoutes.post(`${root}/:sessionId/interrupt`,async c=>{
  const runtime=access(c),row=await session(c,c.req.param('sessionId'));
  if(['running','waiting_permission'].includes(row.status)){
    await c.env.DB.prepare("UPDATE agent_sessions SET status='stopping' WHERE id=? AND status IN ('running','waiting_permission')").bind(row.id).run();
    await runtime.interrupt(row.id);
  }
  return c.json({session:serialize(await session(c,row.id))});
});
agentRoutes.post(`${root}/:sessionId/permissions`,async c=>{
  const runtime=access(c),row=await session(c,c.req.param('sessionId')),body=agentPermissionSchema.parse(await c.req.json());
  if(row.status!=='waiting_permission')fail(409,'permission_expired','This permission request is no longer active.');
  try{await runtime.respond(row.id,body.requestId,body.decision,body.answer);}catch{fail(409,'permission_expired','This permission request is no longer active.');}
  return c.json({ok:true});
});
agentRoutes.get(`${root}/:sessionId/proposal`,async c=>c.json({proposal:serialize(await session(c,c.req.param('sessionId'))).proposal}));
agentRoutes.post(`${root}/:sessionId/proposal/:action`,async c=>{
  const row=await session(c,c.req.param('sessionId')),body=agentProposalActionSchema.parse(await c.req.json());
  if(row.purpose==='interview')fail(403,'tool_forbidden','Interview sessions cannot apply or discard designs.');
  const action=z.enum(['apply','discard']).parse(c.req.param('action'));
  const operationId=`job-agent-${row.id}-${body.proposalVersion}`;
  if(action==='apply'){
    const receipt=await c.env.DB.prepare('SELECT response FROM creative_save_receipts WHERE operation_id=? AND project_id=? AND user_id=?').bind(operationId,row.project_id,owner(c)).first<{response:string}>();
    if(receipt)return c.json({project:JSON.parse(receipt.response)});
  }
  if(!row.has_proposal||row.draft_version!==body.proposalVersion)fail(409,'draft_conflict','Read and review the current proposal before this action.');
  const lock=await c.env.DB.prepare("UPDATE agent_sessions SET status='applying' WHERE id=? AND draft_version=? AND status IN ('idle','error','interrupted') AND NOT EXISTS(SELECT 1 FROM agent_sessions WHERE project_id=? AND status IN ('running','waiting_permission','stopping','applying'))").bind(row.id,row.draft_version,row.project_id).run();
  if(!lock.meta.changes)fail(409,'agent_busy','Stop the running agent before applying or discarding.');
  try{
    if(action==='discard'){
      const current=await projectRow(c,row.project_id),approved=await brief(c,row.project_id,false);
      await c.env.DB.prepare("UPDATE agent_sessions SET draft_document=?,draft_version=draft_version+1,has_proposal=0,base_revision=?,base_brief_revision=?,native_handle=NULL WHERE id=?").bind(current.document,current.revision,approved.revision,row.id).run();
      return c.json({ok:true});
    }
    const approved=await brief(c,row.project_id);
    if(approved.revision!==row.base_brief_revision)fail(409,'revision_conflict','The brief changed. Review and approve the latest scope before making a new proposal.');
    const project=await saveDocument(c,row.project_id,JSON.parse(row.draft_document),row.base_revision,row.base_brief_revision,operationId);
    await c.env.DB.prepare('UPDATE agent_sessions SET draft_document=?,base_revision=?,has_proposal=0 WHERE id=?').bind(JSON.stringify(project.document),project.revision,row.id).run();
    return c.json({project});
  }finally{await c.env.DB.prepare("UPDATE agent_sessions SET status='idle',updated_at=? WHERE id=? AND status='applying'").bind(now(),row.id).run();}
});
