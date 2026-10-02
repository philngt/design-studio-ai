import {test} from 'node:test';
import assert from 'node:assert/strict';
import type {Query} from '@anthropic-ai/claude-agent-sdk';
import {waitForClaudeStudioTools} from '../server/agent-claude-tools';
import {ClaudeToolsUnavailableError} from '../server/agent-runtime-contract';
import {agentToolNames} from '../src/shared/agents';

type Status = Awaited<ReturnType<Query['mcpServerStatus']>>;
const options={timeoutMs:1000,pollMs:1};
const signal=()=>new AbortController().signal;
const connected=(names:readonly string[]):Status=>[{name:'studio',status:'connected',tools:names.map(name=>({name}))}];
const safeError=(error:unknown)=>{
  assert.ok(error instanceof ClaudeToolsUnavailableError);
  assert.equal(error.code,'agent_tools_unavailable');
  assert.match(error.message,/Your prompt was not sent/);
  assert.doesNotMatch(error.message,/private-credential/);
  return true;
};

for(const purpose of ['interview','design'] as const)test(`Claude waits for the ${purpose} tool inventory, accepting bare and qualified names`,async()=>{
  const tools=agentToolNames(purpose);
  for(const names of [tools,tools.map(name=>`mcp__studio__${name}`)]){
    const states:Status[]=[[],[{name:'other',status:'connected'}],[{name:'studio',status:'pending'}],connected(names)];
    let calls=0;
    await waitForClaudeStudioTools({mcpServerStatus:async()=>states[calls++]},tools,signal(),options);
    assert.equal(calls,4);
  }
});
for(const status of ['failed','needs-auth','disabled'] as const)test(`Claude rejects ${status} without exposing SDK diagnostics`,async()=>{
  await assert.rejects(waitForClaudeStudioTools({mcpServerStatus:async()=>[{name:'studio',status,error:'private-credential',config:{type:'stdio',command:'private-credential'}}]},agentToolNames('interview'),signal(),options),safeError);
});
test('Claude rejects incomplete or missing tool inventory',async()=>{
  for(const names of [[],['studio_brief_context'],agentToolNames('interview')]){
    await assert.rejects(waitForClaudeStudioTools({mcpServerStatus:async()=>connected(names)},agentToolNames('design'),signal(),options),safeError);
  }
  await assert.rejects(waitForClaudeStudioTools({mcpServerStatus:async()=>[{name:'studio',status:'connected'}]},agentToolNames('interview'),signal(),options),safeError);
});
test('Claude bounds pending and hung status checks, and sanitizes control errors',async()=>{
  for(const mcpServerStatus of [async()=>[{name:'studio',status:'pending'}] as Status,()=>new Promise<Status>(()=>{}),async()=>{throw new Error('private-credential');}]){
    await assert.rejects(waitForClaudeStudioTools({mcpServerStatus},agentToolNames('interview'),signal(),{...options,timeoutMs:20}),safeError);
  }
});
test('Stop cancels before polling or during a hung check without a readiness error',async()=>{
  for(const alreadyStopped of [true,false]){
    const controller=new AbortController();let calls=0;
    if(alreadyStopped)controller.abort();
    const pending=waitForClaudeStudioTools({mcpServerStatus:()=>{calls++;return new Promise<Status>(()=>{});}},agentToolNames('interview'),controller.signal,options);
    const rejected=assert.rejects(pending,{name:'AbortError'});
    if(!alreadyStopped){await new Promise(resolve=>setImmediate(resolve));controller.abort();}
    await rejected;assert.equal(calls,alreadyStopped?0:1);
  }
});
