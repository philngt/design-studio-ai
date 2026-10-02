import {test,expect} from './authenticated-browser';
import type {Page} from '@playwright/test';
import {createDocument} from '../src/shared/catalog';
import {agentProviders,type AgentSession,type AgentEvent} from '../src/shared/agents';
import {ClaudeToolsUnavailableError} from '../server/agent-runtime-contract';

test('Claude tool connection errors stay visible after reload and retry only on request',async({page,baseURL})=>{
  // UI transport fixture; real CLI/MCP startup is exercised separately.
  const headers={Origin:baseURL!};
  const {project}=await (await page.request.post('/api/projects',{headers,data:{name:'Claude connection recovery',kind:'web'}})).json();
  const briefPath=`/api/projects/${project.id}/brief`,path=`/api/projects/${project.id}/agent-sessions`;
  await page.request.put(briefPath,{headers,data:{expectedRevision:0,request:'Clarify my design'}});
  const before=(await (await page.request.get(briefPath)).json()).brief;
  let session:AgentSession|undefined,turns=0;
  const events:AgentEvent[]=[],failure=new ClaudeToolsUnavailableError('missing-tools');
  await page.route('**/api/agent-providers',route=>route.fulfill({json:{enabled:true,providers:agentProviders.map(p=>({...p,installed:true,authentication:'unknown',models:[]}))}}));
  await page.route(`**${path}**`,async route=>{
    const req=route.request(),suffix=new URL(req.url()).pathname.slice(path.length);
    if(!suffix){
      if(req.method()!=='POST')return route.fulfill({json:{sessions:session?[session]:[]}});
      const now=new Date().toISOString();
      session={id:crypto.randomUUID(),projectId:project.id,provider:'claude',purpose:'interview',model:null,status:'idle',baseRevision:project.revision,baseBriefRevision:before.revision,createdAt:now,updatedAt:now,proposal:null};
      return route.fulfill({status:201,json:{session}});
    }
    if(suffix.endsWith('/messages')){
      turns++;session!.status='error';
      for(const [type,data] of [['user',{text:req.postDataJSON().prompt}],['error',{code:failure.code,message:failure.message}],['status',{status:'error'}]] as const){
        events.push({seq:events.length+1,sessionId:session!.id,type,data,createdAt:new Date().toISOString()});
      }
      return route.fulfill({status:202,json:{turnId:crypto.randomUUID(),status:'running'}});
    }
    if(suffix.endsWith('/events'))return route.fulfill({contentType:'text/event-stream',body:events.map(e=>`id: ${e.seq}\nevent: agent\ndata: ${JSON.stringify(e)}\n\n`).join('')});
    return route.fulfill({json:{session}});
  });
  try{
    await page.goto(`/?project=${project.id}`);await openChat(page);
    await page.getByLabel('Design assistant').selectOption('agent:claude');
    const start=page.getByRole('button',{name:'Start conversation',exact:true});
    await start.click();
    await expect(page.getByRole('alert')).toContainText(failure.message);
    await expect(start).toBeEnabled();expect(turns).toBe(1);
    await expect(page.getByRole('button',{name:'View design',exact:true})).toHaveCount(0);
    await page.reload();await openChat(page);
    await expect(page.getByRole('alert')).toContainText(failure.message);expect(turns).toBe(1);
    await start.click();await expect.poll(()=>turns).toBe(2);
    await expect(page.getByRole('alert')).toHaveCount(2);
    expect((await (await page.request.get(briefPath)).json()).brief).toEqual(before);
    expect((await (await page.request.get(`/api/projects/${project.id}`)).json()).project.revision).toBe(project.revision);
  }finally{await page.request.delete(`/api/projects/${project.id}`,{headers});}
});

test('native interview continues into a separate design session only after explicit approval',async({page,baseURL})=>{
  // Native transport fixture only; brief persistence, approval and document reads use the real server.
  const headers={Origin:baseURL!};
  const created=await page.request.post('/api/projects',{headers,data:{name:'Continuous agent interview',kind:'web'}});
  const {project}=await created.json();
  const briefPath=`/api/projects/${project.id}/brief`,path=`/api/projects/${project.id}/agent-sessions`;
  await page.request.put(briefPath,{headers,data:{expectedRevision:0,request:'Create a welcoming library homepage'}});
  const sessions:AgentSession[]=[],events=new Map<string,AgentEvent[]>();
  let turns=0;
  await page.route('**/api/agent-providers',route=>route.fulfill({json:{enabled:true,providers:agentProviders.map(p=>({...p,installed:true,authentication:'unknown',models:[]}))}}));
  await page.route(`**${path}**`,async route=>{
    const req=route.request(),suffix=new URL(req.url()).pathname.slice(path.length),body=req.method()==='POST'?req.postDataJSON():undefined;
    if(!suffix){
      if(req.method()!=='POST')return route.fulfill({json:{sessions}});
      const {brief}=await (await page.request.get(briefPath)).json();
      expect(body.expectedBriefRevision).toBe(brief.revision);
      expect(body.purpose).toBe(brief.status==='approved'?'design':'interview');
      const now=new Date().toISOString();
      const session:AgentSession={id:crypto.randomUUID(),projectId:project.id,provider:body.provider,purpose:body.purpose,model:null,status:'idle',baseRevision:project.revision,baseBriefRevision:brief.revision,createdAt:now,updatedAt:now,proposal:null};
      sessions.unshift(session);events.set(session.id,[]);
      return route.fulfill({status:201,json:{session}});
    }
    const session=sessions.find(s=>s.id===suffix.split('/')[1])!;
    const stream=events.get(session.id)!;
    const emit=(type:AgentEvent['type'],data:Record<string,unknown>)=>stream.push({seq:stream.length+1,sessionId:session.id,type,data,createdAt:new Date().toISOString()});
    if(suffix.endsWith('/messages')){
      turns++;emit('user',{text:body.prompt});
      const {brief}=await (await page.request.get(briefPath)).json();
      if(session.purpose==='interview'){
        expect(brief.status).not.toBe('approved');
        const saved=await page.request.put(briefPath,{headers,data:{expectedRevision:brief.revision,interview:{message:'Let’s make the audience clear.',questions:[{id:'audience',title:'Who is this for?',type:'single',required:true,options:['Families','Students']}],scope:{objective:'Welcome readers to the library',audience:'Local readers',direction:'Warm and editorial',deliverables:['Homepage'],constraints:[],acceptanceCriteria:['Clear visit information']}}}});
        expect(saved.status()).toBe(200);emit('brief',{revision:(await saved.json()).brief.revision});
      }else{
        expect(brief.status).toBe('approved');expect(brief.answers.audience).toBe('Families');
        const document=createDocument('web','Library');document.pages[0].nodes=[{id:'title',type:'text',name:'Title',text:'Welcome, readers',x:60,y:60,width:600,height:80,style:{fontSize:40}}];
        session.proposal={document,version:1,baseRevision:project.revision,baseBriefRevision:brief.revision};emit('text',{text:'The library draft is ready.'});emit('proposal',{version:1});
      }
      emit('status',{status:'idle'});return route.fulfill({status:202,json:{turnId:crypto.randomUUID(),status:'running'}});
    }
    if(suffix.endsWith('/events'))return route.fulfill({contentType:'text/event-stream',body:stream.map(e=>`id: ${e.seq}\nevent: agent\ndata: ${JSON.stringify(e)}\n\n`).join('')});
    return route.fulfill({json:{session}});
  });
  try{
    await page.goto(`/?project=${project.id}`);await openChat(page);
    await page.getByLabel('Design assistant').selectOption('agent:codex');
    await page.getByRole('button',{name:'Start conversation',exact:true}).click();
    await expect(page.getByRole('heading',{name:'Who is this for?'})).toBeVisible();
    await page.getByRole('button',{name:'Families',exact:true}).click();
    await page.getByRole('button',{name:'Send answer',exact:true}).click();
    await expect(page.getByRole('button',{name:'Approve and create',exact:true})).toBeEnabled();
    expect(sessions.map(s=>s.purpose)).toEqual(['interview']);
    expect((await (await page.request.get(`/api/projects/${project.id}`)).json()).project.revision).toBe(project.revision);
    await page.reload();await openChat(page);
    await expect(page.locator('.conversation-answer')).toContainText('Families');expect(turns).toBe(1);
    await page.getByRole('button',{name:'Approve and create',exact:true}).click();
    await expect(page.getByRole('button',{name:'View design',exact:true})).toBeVisible();
    expect(sessions.map(s=>s.purpose)).toEqual(['design','interview']);expect(turns).toBe(2);
    await page.getByRole('button',{name:'View design',exact:true}).click();
    await expect(page.locator('.canvas-paper').getByText('Welcome, readers',{exact:true})).toBeVisible();
    expect((await (await page.request.get(`/api/projects/${project.id}`)).json()).project.revision).toBe(project.revision);
    await page.reload();await openChat(page);
    await expect(page.getByRole('button',{name:'View design',exact:true})).toBeVisible();expect(turns).toBe(2);
  }finally{await page.request.delete(`/api/projects/${project.id}`,{headers});}
});

async function openChat(page:Page){
  await expect(page.getByRole('button',{name:'Back to workspace'})).toBeVisible();
  const nav=page.locator('.mobile-editor-nav');if(await nav.isVisible())await nav.getByRole('button',{name:'Chat',exact:true}).click();
}
test('disabled self-host runtime is explicit and existing API mode remains available',async({page,baseURL})=>{
  const response=await page.request.post('/api/projects',{headers:{Origin:baseURL!},data:{name:'Disabled coding agent',kind:'web'}});expect(response.status()).toBe(201);
  const {project}=await response.json();
  try{
    await page.goto(`/?project=${project.id}`);await openChat(page);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1)).toBe(true);
    await expect(page.getByLabel('Design assistant').locator('optgroup[label="Coding agents"] option')).toHaveCount(0);
    await expect(page.getByRole('button',{name:'Send',exact:true})).toBeDisabled();
    await page.getByRole('button',{name:'Connections',exact:true}).click();await expect(page.getByRole('dialog')).toContainText('AI providers');
  }finally{await page.request.delete(`/api/projects/${project.id}`,{headers:{Origin:baseURL!}});}
});

test('client transport contract streams a draft, previews, applies and restores session without automatic saves',async({page,baseURL},info)=>{
  // Fixture transport exercises UI states only. Server draft/Apply security is tested with SQLite separately.
  const document=createDocument('web','Agent review workflow');document.pages[0].nodes=[{id:'headline',type:'text',name:'Headline',text:'Saved headline',x:80,y:80,width:600,height:100,style:{fontSize:42,fill:'#1e293b'}}];
  const created=await page.request.post('/api/projects',{headers:{Origin:baseURL!},data:{name:document.name,kind:'web',document}});expect(created.status()).toBe(201);
  let {project}=await created.json();
  const path=`/api/projects/${project.id}/agent-sessions`,events:AgentEvent[]=[];
  let session:AgentSession|undefined;
  const emit=(type:AgentEvent['type'],data:Record<string,unknown>)=>events.push({seq:events.length+1,sessionId:session!.id,type,data,createdAt:new Date().toISOString()});
  await page.route('**/api/agent-providers',route=>route.fulfill({json:{enabled:true,providers:agentProviders.map(p=>({...p,installed:true,authentication:'unknown',models:[]}))}}));
  await page.route(`**${path}**`,async route=>{
    const req=route.request(),suffix=new URL(req.url()).pathname.slice(path.length),body=req.method()==='POST'?req.postDataJSON():undefined;
    if(!suffix){if(req.method()==='POST'){session={id:crypto.randomUUID(),projectId:project.id,provider:body.provider,model:null,status:'idle',createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),proposal:null};return route.fulfill({status:201,json:{session}});}return route.fulfill({json:{sessions:session?[session]:[]}});}
    if(suffix.endsWith('/messages')){
      emit('user',{text:body.prompt});emit('text',{text:'I prepared a draft'});emit('text',{text:' for review.'});
      const next=structuredClone(project.document);next.pages[0].nodes[0].text='Draft headline';session!.proposal={document:next,version:1,baseRevision:project.revision,baseBriefRevision:0};emit('proposal',{version:1});emit('status',{status:'idle'});
      return route.fulfill({status:202,json:{turnId:crypto.randomUUID(),status:'running'}});
    }
    if(suffix.endsWith('/events'))return route.fulfill({contentType:'text/event-stream',body:events.map(e=>`id: ${e.seq}\nevent: agent\ndata: ${JSON.stringify(e)}\n\n`).join('')});
    if(suffix.endsWith('/proposal/apply')){
      expect(body.proposalVersion).toBe(session!.proposal!.version);
      const saved=await page.request.put(`/api/projects/${project.id}/document`,{headers:{Origin:baseURL!},data:{document:session!.proposal!.document,expectedRevision:session!.proposal!.baseRevision}});expect(saved.status()).toBe(200);({project}=await saved.json());session!.proposal=null;
      return route.fulfill({json:{project}});
    }
    if(suffix.endsWith('/proposal/discard')){session!.proposal=null;return route.fulfill({json:{ok:true}});}
    return route.fulfill({json:{session}});
  });
  try{
    await page.goto(`/?project=${project.id}`);await openChat(page);
    await page.getByLabel('Design assistant',{exact:true}).selectOption('agent:codex');await page.getByLabel('Message to AI designer').fill('Refine the headline');await page.getByRole('button',{name:'Send',exact:true}).click();
    await expect(page.getByRole('log',{name:'Agent activity'})).toContainText('I prepared a draft for review.');
    expect((await (await page.request.get(`/api/projects/${project.id}`)).json()).project.document.pages[0].nodes[0].text).toBe('Saved headline');
    await page.getByRole('button',{name:'View design',exact:true}).click();await expect(page.getByText('Previewing an AI proposal',{exact:true})).toBeVisible();
    await expect(page.locator('.canvas-paper').getByText('Draft headline',{exact:true})).toBeVisible();
    await page.screenshot({path:info.outputPath('agent-draft-preview.png'),fullPage:true});
    await page.getByRole('button',{name:'Apply proposal',exact:true}).click();await expect(page.getByText('Previewing an AI proposal',{exact:true})).toHaveCount(0);
    expect((await (await page.request.get(`/api/projects/${project.id}`)).json()).project.document.pages[0].nodes[0].text).toBe('Draft headline');
    await page.reload();await expect(page.getByRole('button',{name:'Back to workspace'})).toBeVisible();
    await openChat(page);
    await expect(page.getByLabel('Design assistant')).toHaveValue('agent:codex');
    await page.getByLabel('Conversation history').click();
    await expect(page.getByLabel('Agent session')).toHaveValue(session!.id);await expect(page.getByRole('button',{name:'View design',exact:true})).toHaveCount(0);
  }finally{await page.request.delete(`/api/projects/${project.id}`,{headers:{Origin:baseURL!}});}
});
