import {test,expect} from './authenticated-browser';
import type {Page} from '@playwright/test';
import {createDocument} from '../src/shared/catalog';
import {agentProviders,type AgentSession,type AgentEvent} from '../src/shared/agents';

async function openChat(page:Page){
  await expect(page.getByRole('button',{name:'Back to workspace'})).toBeVisible();
  const nav=page.locator('.mobile-editor-nav');if(await nav.isVisible())await nav.getByRole('button',{name:'Chat & layers',exact:true}).click();
  await page.getByRole('button',{name:'Coding agent',exact:true}).click();
}
test('disabled self-host runtime is explicit and existing API mode remains available',async({page,baseURL})=>{
  const response=await page.request.post('/api/projects',{headers:{Origin:baseURL!},data:{name:'Disabled coding agent',kind:'web'}});expect(response.status()).toBe(201);
  const {project}=await response.json();
  try{
    await page.goto(`/?project=${project.id}`);await openChat(page);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1)).toBe(true);
    await expect(page.getByRole('region',{name:'Coding agent conversation'})).toContainText('enabled self-hosted Node runtime');
    await expect(page.getByRole('button',{name:'Send to agent'})).toHaveCount(0);
    await page.getByRole('button',{name:'API provider',exact:true}).click();await expect(page.getByLabel('Generate proposal')).toBeVisible();
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
    await page.getByLabel('Coding agent',{exact:true}).selectOption('codex');await page.getByLabel('Message to coding agent').fill('Refine the headline');await page.getByRole('button',{name:'Send to agent',exact:true}).click();
    await expect(page.getByRole('log',{name:'Agent activity'})).toContainText('I prepared a draft for review.');
    expect((await (await page.request.get(`/api/projects/${project.id}`)).json()).project.document.pages[0].nodes[0].text).toBe('Saved headline');
    await page.getByRole('button',{name:'Preview proposal on canvas'}).click();await expect(page.getByText('Previewing an AI proposal',{exact:true})).toBeVisible();
    await expect(page.locator('.canvas-paper').getByText('Draft headline',{exact:true})).toBeVisible();
    await page.screenshot({path:info.outputPath('agent-draft-preview.png'),fullPage:true});
    await page.getByRole('button',{name:'Apply proposal',exact:true}).click();await expect(page.getByText('Previewing an AI proposal',{exact:true})).toHaveCount(0);
    expect((await (await page.request.get(`/api/projects/${project.id}`)).json()).project.document.pages[0].nodes[0].text).toBe('Draft headline');
    await page.reload();await expect(page.getByRole('button',{name:'Back to workspace'})).toBeVisible();
    await expect(page).toHaveURL(/assistant=agent/);await openChat(page);
    await expect(page.getByRole('button',{name:'Coding agent',exact:true})).toHaveAttribute('aria-pressed','true');
    await expect(page.getByLabel('Agent session')).toHaveValue(session!.id);await expect(page.getByRole('button',{name:'Preview proposal on canvas'})).toHaveCount(0);
  }finally{await page.request.delete(`/api/projects/${project.id}`,{headers:{Origin:baseURL!}});}
});
