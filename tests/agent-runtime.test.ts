import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {NodeAgentRuntime} from '../server/agent-runtime-node';
import {AgentProcess} from '../server/agent-jsonl';
import {agentProviders,type AgentEmission} from '../src/shared/agents';
import {createServer} from 'node:http';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';

const binary=fileURLToPath(new URL('./helpers/agent-protocol-fixture.mjs',import.meta.url));
test('all native adapters connect to contract subprocesses, call the draft gateway and close', {timeout:60000},async t=>{
  const directory=await mkdtemp(join(tmpdir(),'studio-native-agents-'));
  const env={PATH:process.env.PATH,HOME:directory,ENCRYPTION_KEY:'must-not-leak',DESIGN_STUDIO_API_KEY:'must-not-leak',...Object.fromEntries(agentProviders.map(p=>[`STUDIO_AGENT_${p.id.toUpperCase()}_BIN`,binary]))};
  const runtime=new NodeAgentRuntime(directory,env);
  try{
    assert.ok((await runtime.catalog()).providers.every(p=>p.installed));
    for(const {id} of agentProviders)await t.test(id,{timeout:15000},async()=>{
      const events:AgentEmission[]=[],calls:string[]=[],handles:string[]=[];
      await runtime.run({sessionId:crypto.randomUUID(),provider:id,prompt:'Protocol only',emit:async event=>{events.push(event);},persistHandle:async handle=>{handles.push(handle);},tool:async(name,input:any)=>{calls.push(name);if(name==='studio_context')return {version:0};assert.equal(input.version,0);assert.equal(input.operations[0].op,'rename');return {version:1};}});
      assert.deepEqual(calls,['studio_context','studio_edit']);
      assert.ok(events.some(event=>event.type==='text'&&event.data.text==='Protocol fixture text'));
      assert.ok(events.some(event=>event.type==='tool_result'));assert.ok(handles.length);
      if(id==='copilot'){
        assert.deepEqual(events.filter(event=>event.type==='usage').map(event=>event.data),[{context:{used:5,size:100},cost:{amount:0,currency:'USD'},scope:'session'},{usage:{inputTokens:2,outputTokens:3,totalTokens:5},scope:'turn'}]);
      }
      assert.ok((await runtime.models(id)).length);
    });
    await t.test('Stop aborts an owned process and cleans up the session',{timeout:5000},async()=>{
      const sessionId=crypto.randomUUID();let started!:()=>void;
      const ready=new Promise<void>(resolve=>{started=resolve;});
      const turn=runtime.run({sessionId,provider:'codex',prompt:'hold',emit:async()=>{},persistHandle:async()=>started(),tool:async()=>{throw new Error('Unexpected tool');}});
      const rejected=assert.rejects(turn,error=>error instanceof Error&&error.name==='AbortError');
      await ready;await runtime.interrupt(sessionId);await rejected;
    });
    for(const {id} of agentProviders)await t.test(`${id} interviews cannot access the design gateway`,{timeout:15000},async()=>{
      const calls:string[]=[];
      await runtime.run({sessionId:crypto.randomUUID(),provider:id,purpose:'interview',prompt:'Clarify my idea',emit:async()=>{},persistHandle:async()=>{},tool:async(name,input:any)=>{
        calls.push(name);if(name==='studio_brief_context')return {brief:{revision:3}};
        assert.equal(name,'studio_submit_interview');assert.equal(input.expectedRevision,3);assert.equal(input.interview.questions[0].id,'audience');return {brief:{revision:4}};
      }});
      assert.deepEqual(calls,['studio_brief_context','studio_submit_interview']);
    });
  }finally{await runtime.close();await rm(directory,{recursive:true,force:true});}
});
test('missing executable rejects requests and process teardown does not hang',{timeout:3000},async()=>{
  const proc=new AgentProcess('/definitely-missing-studio-agent',[],tmpdir(),{});
  await assert.rejects(proc.request('initialize',{},false,1000));await proc.close();
});

test('the real stdio MCP bridge advertises compact tools and authenticates draft calls',{timeout:15000},async()=>{
  const calls:string[]=[];
  const server=createServer(async(req,res)=>{
    assert.equal(req.headers.authorization,'Bearer contract-token');let body='';for await(const chunk of req)body+=chunk;
    const parsed=JSON.parse(body);calls.push(parsed.name);res.setHeader('Content-Type','application/json');res.end(JSON.stringify({version:7}));
  });
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const address=server.address();assert.ok(address&&typeof address!=='string');
  const client=new Client({name:'bridge-contract-test',version:'1.0.0'});
  const transport=new StdioClientTransport({command:process.execPath,args:['--import','tsx',fileURLToPath(new URL('../server/agent-mcp-bridge.ts',import.meta.url))],env:{PATH:process.env.PATH!,STUDIO_DRAFT_URL:`http://127.0.0.1:${address.port}/call`,STUDIO_DRAFT_TOKEN:'contract-token'},stderr:'ignore'});
  try{
    await client.connect(transport);const tools=await client.listTools();assert.equal(tools.tools.length,6);assert.ok(JSON.stringify(tools).length<8000);
    const result=await client.callTool({name:'studio_edit',arguments:{version:0,operations:[{op:'rename',name:'Bridge contract'}]}}) as any;
    assert.deepEqual(JSON.parse(result.content[0].text),{version:7});assert.deepEqual(calls,['studio_edit']);
  }finally{await client.close();await transport.close();server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));}
});
