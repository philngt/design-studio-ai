import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,readdir,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {promisify} from 'node:util';
import {execFile} from 'node:child_process';
import {serve} from '@hono/node-server';
import {chromium} from '@playwright/test';
import {build} from 'esbuild';
import {app} from '../server/index';
import {FileBucket,SqliteDatabase} from '../server/node-adapters';
import {secret} from '../server/security';
import {agentProviders} from '../src/shared/agents';
import type {Bindings} from '../server/types';

test('coding-agent REST, MCP, CLI and compact WebMCP share real owner/session and proposal contracts',{timeout:60000},async()=>{
  const directory=await mkdtemp(join(tmpdir(),'studio-agent-clients-')),db=new SqliteDatabase(':memory:');
  let browser:Awaited<ReturnType<typeof chromium.launch>>|undefined,server:ReturnType<typeof serve>|undefined;
  let turns=0;
  const env:Bindings={DB:db,ASSETS_BUCKET:new FileBucket(join(directory,'assets')),ALLOW_REGISTRATION:'true',ENCRYPTION_KEY:secret(),STUDIO_AGENTS_ENABLED:'true',AGENT_RUNTIME:{
    catalog:async()=>({enabled:true,providers:agentProviders.map(p=>({...p,installed:true,authentication:'unknown',models:[]}))}),models:async()=>['contract-model'],
    run:async input=>{turns++;const context=await input.tool('studio_context',{}) as any;await input.tool('studio_edit',{version:context.version,operations:[{op:'rename',name:'Client-reviewed draft'}]});},interrupt:async()=>{},respond:async()=>{},close:async()=>{},
  }};
  try{
    for(const name of (await readdir(new URL('../migrations/',import.meta.url))).filter(n=>n.endsWith('.sql')).sort())await db.exec(await readFile(new URL('../migrations/'+name,import.meta.url),'utf8'));
    server=serve({fetch:request=>app.fetch(request,env),hostname:'127.0.0.1',port:0});if(!server.listening)await new Promise<void>(resolve=>server!.once('listening',resolve));
    const address=server.address();assert.ok(address&&typeof address!=='string');const base=`http://127.0.0.1:${address.port}`;env.APP_URL=base;
    const registered=await fetch(base+'/api/auth/register',{method:'POST',headers:{Origin:base,'Content-Type':'application/json'},body:JSON.stringify({email:'clients@agent.test',password:secret()})});assert.equal(registered.status,201);const cookie=registered.headers.get('set-cookie')!.split(';')[0];env.STUDIO_AGENT_OWNER_ID=(await registered.json() as any).user.id;
    const issued=await fetch(base+'/api/tokens',{method:'POST',headers:{Origin:base,Cookie:cookie,'Content-Type':'application/json'},body:JSON.stringify({name:'Client parity'})});const token=(await issued.json() as any).token;
    const cli=async(...args:string[])=>{const result=await promisify(execFile)(process.execPath,['packages/cli/dist/dsa.js',...args],{env:{PATH:process.env.PATH,DESIGN_STUDIO_URL:base,DESIGN_STUDIO_API_KEY:token},timeout:20000});return JSON.parse(result.stdout);};
    let rpc=0;
    const mcp=async(name:string,args:Record<string,unknown>={})=>{
      const response=await fetch(base+'/mcp',{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json',Accept:'application/json, text/event-stream','MCP-Protocol-Version':'2025-11-25'},body:JSON.stringify({jsonrpc:'2.0',id:++rpc,method:'tools/call',params:{name,arguments:args}})});
      assert.equal(response.status,200);const result=(await response.json() as any).result;assert.ok(!result.isError,JSON.stringify(result));return JSON.parse(result.content[0].text);
    };
    assert.deepEqual(await cli('agents','providers'),await mcp('agent_providers'));
    assert.deepEqual(await cli('agents','models','codex'),await mcp('agent_models',{provider:'codex'}));
    const {project}=await cli('projects','create','--kind','web','--name','Client parity');
    const {session}=await mcp('agent_create',{id:project.id,body:{provider:'codex',expectedRevision:project.revision}});
    assert.equal((await cli('agents','get',project.id,session.id)).session.id,session.id);
    const turn={requestId:crypto.randomUUID(),prompt:'Draft contract',expectedRevision:project.revision};const file=join(directory,'turn.json');await writeFile(file,JSON.stringify(turn));
    const accepted=await cli('agents','send',project.id,session.id,'--file',file);
    for(let i=0;i<100;i++){if((await mcp('agent_session',{id:project.id,sessionId:session.id})).session.status==='idle')break;await new Promise(resolve=>setTimeout(resolve,10));}
    assert.equal((await mcp('agent_message',{id:project.id,sessionId:session.id,body:turn})).turnId,accepted.turnId);assert.equal(turns,1);
    const bundled=await build({stdin:{contents:'import {registerDesignTools} from "./src/app/browser-design-tools";export function init(doc){globalThis.tools=new Map();registerDesignTools({registerTool:t=>globalThis.tools.set(t.name,t)},()=>doc,()=>{});}',resolveDir:process.cwd(),loader:'ts'},bundle:true,write:false,platform:'browser',format:'iife',globalName:'clientTools'});
    browser=await chromium.launch({headless:true});const page=await browser.newPage();await page.context().addCookies([{name:'studio_session',value:cookie.slice(cookie.indexOf('=')+1),url:base}]);await page.goto(base+'/api/health');await page.addScriptTag({content:bundled.outputFiles[0].text});await page.evaluate(doc=>(globalThis as any).clientTools.init(doc),project.document);
    const web=async(operation:string,body?:unknown)=>{
      const result=await page.evaluate(async args=>(globalThis as any).tools.get('studio_agents').execute(args),{operation,parameters:{id:project.id,sessionId:session.id},...(body?{body}:{})});assert.ok(!result.isError,JSON.stringify(result));return JSON.parse(result.content[0].text);
    };
    assert.deepEqual(await web('agent_proposal'),await cli('agents','proposal',project.id,session.id));
    const {proposal}=await web('agent_proposal');assert.equal(proposal.document.name,'Client-reviewed draft');
    assert.equal((await cli('projects','get',project.id)).project.document.name,'Client parity');
    const applied=await web('agent_apply',{proposalVersion:proposal.version});assert.equal(applied.project.revision,project.revision+1);
    assert.deepEqual(await cli('agents','apply',project.id,session.id,'--proposal-version',String(proposal.version)),applied);
    assert.equal((await mcp('agent_proposal',{id:project.id,sessionId:session.id})).proposal,null);
    assert.ok((await web('agent_events')).events.some((e:any)=>e.type==='proposal'));
  }finally{await browser?.close();if(server)await new Promise<void>(resolve=>server!.close(()=>resolve()));db.close();await rm(directory,{recursive:true,force:true});}
});
