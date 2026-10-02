import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,readdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {app} from '../server/index';
import {FileBucket,SqliteDatabase} from '../server/node-adapters';
import {secret,hash} from '../server/security';
import type {Bindings} from '../server/types';
import type {AgentRuntime,AgentRunInput} from '../server/agent-runtime-contract';
import {agentProviders,agentSessionPath,type AgentSession} from '../src/shared/agents';
import {JsonLines} from '../server/agent-jsonl';
import {agentEnvironment} from '../server/agent-runtime-node';

test('JSONL framing handles fragmented UTF-8, CRLF and Unicode separators without splitting records',()=>{
  const values:unknown[]=[];const decoder=new JsonLines(value=>values.push(value));
  const bytes=Buffer.from(JSON.stringify({text:'Thiết kế\u2028works\u2029too'})+'\r\n'+JSON.stringify({id:2})+'\n');
  for(const byte of bytes)decoder.push(Buffer.from([byte]));
  assert.deepEqual(values,[{text:'Thiết kế\u2028works\u2029too'},{id:2}]);
  assert.throws(()=>new JsonLines(()=>{},2).push(Buffer.from('xxxx')),/limit/);
});
test('child process environment excludes application secrets and Studio account credentials',()=>{
  const env=agentEnvironment({PATH:'/bin',HOME:'/agent',ENCRYPTION_KEY:'secret',DESIGN_STUDIO_API_KEY:'secret',GITHUB_CLIENT_SECRET:'secret',ANTHROPIC_API_KEY:'agent-key'});
  assert.deepEqual(env,{PATH:'/bin',HOME:'/agent',ANTHROPIC_API_KEY:'agent-key'});
});

test('coding-agent HTTP contract uses real SQLite, owner checks, draft tools and revision-checked saves',async t=>{
  const directory=await mkdtemp(join(tmpdir(),'studio-agents-')),db=new SqliteDatabase(join(directory,'db.sqlite'));
  let calls=0,hold:undefined|(()=>void),onRun:(input:AgentRunInput)=>Promise<void>=async()=>{};
  // Deterministic runtime driver exercises the application boundary, not live provider generation.
  const runtime:AgentRuntime={catalog:async()=>({enabled:true,providers:agentProviders.map(p=>({...p,installed:true,authentication:'unknown',models:[]}))}),models:async()=>[],run:async input=>{calls++;await onRun(input);},interrupt:async()=>{hold?.();},respond:async()=>{},close:async()=>{hold?.();}};
  const env:Bindings={DB:db,ASSETS_BUCKET:new FileBucket(join(directory,'assets')),APP_URL:'https://studio.test',ENCRYPTION_KEY:secret(),ALLOW_REGISTRATION:'true',STUDIO_AGENTS_ENABLED:'true',AGENT_RUNTIME:runtime};
  let cookie='';
  const request=(path:string,method='GET',body?:unknown,auth=cookie)=>app.request('https://studio.test'+path,{method,headers:{Origin:'https://studio.test',...(auth.startsWith('Bearer ')?{Authorization:auth}:{Cookie:auth}),'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})},env);
  const json=async(response:Response,status=200)=>{assert.equal(response.status,status,await response.clone().text());return await response.json() as any;};
  const settle=async(sessionId:string,projectId:string)=>{for(let i=0;i<100;i++){const {session}=await json(await request(agentSessionPath(projectId,sessionId)));if(!['running','waiting_permission','stopping'].includes(session.status))return session as AgentSession;await new Promise(r=>setTimeout(r,5));}throw new Error('Test runtime did not settle.');};
  try{
    for(const name of (await readdir(new URL('../migrations/',import.meta.url))).filter(n=>n.endsWith('.sql')).sort())await db.exec(await readFile(new URL('../migrations/'+name,import.meta.url),'utf8'));
    const register=await request('/api/auth/register','POST',{email:'agent-owner@studio.test',password:secret()});
    cookie=register.headers.get('set-cookie')!.split(';')[0];env.STUDIO_AGENT_OWNER_ID=(await json(register,201)).user.id;
    const other=await request('/api/auth/register','POST',{email:'agent-other@studio.test',password:secret()});const otherCookie=other.headers.get('set-cookie')!.split(';')[0];
    const project=(await json(await request('/api/projects','POST',{name:'Agent contract',kind:'web'}),201)).project;
    const root=agentSessionPath(project.id);
    const create=async()=> (await json(await request(root,'POST',{provider:'codex',expectedRevision:project.revision}),201)).session as AgentSession;
    await t.test('unavailable runtime and operator checks apply before starting processes',async()=>{
      assert.equal((await json(await request('/api/agent-providers','GET',undefined,otherCookie))).enabled,false);
      await json(await request(root,'POST',{provider:'codex',expectedRevision:project.revision},otherCookie),403);
      env.STUDIO_AGENTS_ENABLED='false';await json(await request(root,'GET'),503);env.STUDIO_AGENTS_ENABLED='true';
      await json(await request(root,'GET',undefined,''),401);assert.equal(calls,0);
    });
    let session=await create();const path=agentSessionPath(project.id,session.id);
    await t.test('OAuth studio credentials cannot run host agents, and cross-owner sessions stay private',async()=>{
      const token=secret();await db.prepare('INSERT INTO oauth_clients(id,name,redirect_uris,created_at) VALUES(?,?,?,?)').bind('agent-oauth','Contract','[]',new Date().toISOString()).run();
      await db.prepare('INSERT INTO oauth_tokens(hash,user_id,client_id,resource,kind,expires_at,family) VALUES(?,?,?,?,?,?,?)').bind(await hash(token),env.STUDIO_AGENT_OWNER_ID,'agent-oauth','https://studio.test/mcp','access',Date.now()+60000,'agent-test').run();
      assert.equal((await json(await request('/api/agent-providers','GET',undefined,`Bearer ${token}`))).enabled,false);
      await json(await request(path,'GET',undefined,`Bearer ${token}`),403);
      const operator=env.STUDIO_AGENT_OWNER_ID;
      env.STUDIO_AGENT_OWNER_ID=(await json(await request('/api/auth/me','GET',undefined,otherCookie))).user.id;
      try{await json(await request(path,'GET',undefined,otherCookie),404);}finally{env.STUDIO_AGENT_OWNER_ID=operator;}
    });
    await t.test('draft tools edit only the proposal and exact retry never starts a second turn',async()=>{
      onRun=async input=>{
        const context=await input.tool('studio_context',{}) as any;
        await input.tool('studio_edit',{version:context.version,operations:[{op:'rename',name:'Reviewed proposal'}]});
        await input.emit({type:'text',data:{text:'Contract-test event'}});
      };
      const body={requestId:crypto.randomUUID(),prompt:'Contract test',expectedRevision:project.revision};
      const first=await json(await request(path+'/messages','POST',body),202);await settle(session.id,project.id);
      const retry=await json(await request(path+'/messages','POST',body),202);assert.equal(first.turnId,retry.turnId);assert.equal(calls,1);
      await json(await request(path+'/messages','POST',{...body,prompt:'Changed request'}),409);
      const saved=(await json(await request(`/api/projects/${project.id}`))).project;assert.equal(saved.document.name,'Agent contract');assert.equal(saved.revision,project.revision);
      session=(await json(await request(path))).session;assert.equal(session.proposal?.document.name,'Reviewed proposal');
      const all=(await json(await request(path+'/events'))).events;assert.ok(all.some((e:any)=>e.type==='proposal'));assert.ok(all.some((e:any)=>e.type==='text'));
      assert.deepEqual((await json(await request(path+`/events?after=${all.at(-1).seq}`))).events,[]);
      const sse=await app.request('https://studio.test'+path+'/events?stream=true&after=0',{headers:{Cookie:cookie,'Last-Event-ID':String(all.at(-2).seq)}},env);
      const reader=sse.body!.getReader();
      try{const chunk=await reader.read();assert.match(new TextDecoder().decode(chunk.value),new RegExp(`id: ${all.at(-1).seq}`));}finally{await reader.cancel();}
    });
    await t.test('Apply requires the reviewed draft version and returns the same receipt on retry',async()=>{
      await json(await request(path+'/proposal/apply','POST',{proposalVersion:0}),409);
      const body={proposalVersion:session.proposal!.version};
      const applied=await json(await request(path+'/proposal/apply','POST',body));
      assert.equal(applied.project.revision,project.revision+1);project.revision=applied.project.revision;
      assert.deepEqual(await json(await request(path+'/proposal/apply','POST',body)),applied);
      assert.equal((await json(await request(path))).session.proposal,null);
    });
    await t.test('single project lock prevents concurrent sessions and Apply during a running turn',async()=>{
      const second=await create();
      onRun=async()=>await new Promise<void>(resolve=>{hold=resolve;});
      await json(await request(path+'/messages','POST',{requestId:crypto.randomUUID(),prompt:'Wait',expectedRevision:project.revision}),202);
      await json(await request(agentSessionPath(project.id,second.id)+'/messages','POST',{requestId:crypto.randomUUID(),prompt:'Race',expectedRevision:project.revision}),409);
      await json(await request(path+'/interrupt','POST',{}));await settle(session.id,project.id);hold=undefined;
      assert.equal((await json(await request(path))).session.status,'interrupted');
    });
    await t.test('manual changes produce conflicts; Discard recovers from a stale design',async()=>{
      onRun=async input=>{const context=await input.tool('studio_context',{}) as any;await input.tool('studio_edit',{version:context.version,operations:[{op:'rename',name:'Stale proposal'}]});};
      await json(await request(path+'/messages','POST',{requestId:crypto.randomUUID(),prompt:'Draft',expectedRevision:project.revision}),202);const current=await settle(session.id,project.id);
      const saved=(await json(await request(`/api/projects/${project.id}`))).project;saved.document.name='Manual edit';
      const edited=await json(await request(`/api/projects/${project.id}/document`,'PUT',{document:saved.document,expectedRevision:saved.revision}));project.revision=edited.project.revision;
      await json(await request(path+'/proposal/apply','POST',{proposalVersion:current.proposal!.version}),409);
      assert.ok((await json(await request(path))).session.proposal);
      await json(await request(path+'/proposal/discard','POST',{proposalVersion:current.proposal!.version}));
      assert.equal((await json(await request(path))).session.proposal,null);
    });
    await t.test('invalid document identity and stale draft edits are rejected by server tools',async()=>{
      onRun=async input=>{
        const context=await input.tool('studio_context',{}) as any;
        await assert.rejects(input.tool('studio_replace',{version:context.version,document:{...context.document,id:crypto.randomUUID()}}),/identity/);
        await assert.rejects(input.tool('studio_edit',{version:context.version+1,operations:[{op:'rename',name:'Invalid'}]}),/latest draft/);
      };
      await json(await request(path+'/messages','POST',{requestId:crypto.randomUUID(),prompt:'Validate',expectedRevision:project.revision}),202);await settle(session.id,project.id);
      assert.equal((await json(await request(path))).session.proposal,null);
    });
    await t.test('an unapproved brief prevents starting a session',async()=>{
      onRun=async input=>{const context=await input.tool('studio_context',{}) as any;await input.tool('studio_edit',{version:context.version,operations:[{op:'rename',name:'Old scope draft'}]});};
      await json(await request(path+'/messages','POST',{requestId:crypto.randomUUID(),prompt:'Before brief change',expectedRevision:project.revision}),202);const current=await settle(session.id,project.id);
      await json(await request(`/api/projects/${project.id}/brief`,'PUT',{expectedRevision:0,request:'New scope'}));
      await json(await request(root,'POST',{provider:'codex',expectedRevision:project.revision}),409);
      await json(await request(path+'/proposal/apply','POST',{proposalVersion:current.proposal!.version}),409);
      await json(await request(path+'/proposal/discard','POST',{proposalVersion:current.proposal!.version}));
      assert.equal((await json(await request(path))).session.proposal,null);
    });
    await t.test('project deletion revokes draft access and stops only its owned sessions',async()=>{
      const deleting=(await json(await request('/api/projects','POST',{name:'Delete active agent',kind:'web'}),201)).project;
      const deletingSession=(await json(await request(agentSessionPath(deleting.id),'POST',{provider:'codex',expectedRevision:deleting.revision}),201)).session;
      let started!:()=>void;const ready=new Promise<void>(resolve=>{started=resolve;});
      let deletedInput!:AgentRunInput;
      onRun=async input=>{deletedInput=input;started();await new Promise<void>(resolve=>{hold=resolve;});};
      const deletingPath=agentSessionPath(deleting.id,deletingSession.id);
      await json(await request(deletingPath+'/messages','POST',{requestId:crypto.randomUUID(),prompt:'Wait for deletion',expectedRevision:deleting.revision}),202);await ready;
      const stopped:string[]=[],interrupt=runtime.interrupt;
      runtime.interrupt=async id=>{stopped.push(id);await assert.rejects(deletedInput.tool('studio_context',{}));await interrupt(id);};
      try{await json(await request(`/api/projects/${deleting.id}`,'DELETE'));}finally{runtime.interrupt=interrupt;hold=undefined;}
      assert.deepEqual(stopped,[deletingSession.id]);
      assert.equal(await db.prepare('SELECT id FROM agent_sessions WHERE id=?').bind(deletingSession.id).first(),null);
      await json(await request(deletingPath),404);
      assert.equal((await json(await request(path))).session.id,session.id);
    });
  }finally{hold?.();await runtime.close();db.close();await rm(directory,{recursive:true,force:true});}
});
