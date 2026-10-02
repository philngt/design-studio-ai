import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {NodeAgentRuntime} from '../server/agent-runtime-node';
import {agentToolNames} from '../src/shared/agents';

// Opt-in native CLI wiring check. The only configured provider is a loopback
// rejection fixture; no operator credentials or paid model generation are used.
test('installed Claude CLI sees the real Studio MCP tools before sending the interview prompt',{
  skip:!process.env.STUDIO_TEST_CLAUDE_BIN,timeout:60000,
},async()=>{
  const directory=await mkdtemp(join(tmpdir(),'studio-claude-offline-'));
  const requests:{tools?:{name:string}[];messages?:unknown}[]=[];
  const server=createServer(async(req,res)=>{
    let body='';for await(const chunk of req)body+=chunk;
    if(req.url?.startsWith('/v1/messages'))requests.push(JSON.parse(body));
    res.writeHead(400,{'Content-Type':'application/json'});
    res.end(JSON.stringify({type:'error',error:{type:'invalid_request_error',message:'Offline Studio wiring check; no model is called.'}}));
  });
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
  const address=server.address();assert.ok(address&&typeof address!=='string');
  const runtime=new NodeAgentRuntime(directory,{
    PATH:process.env.PATH,HOME:directory,CLAUDE_CONFIG_DIR:join(directory,'claude'),
    ANTHROPIC_API_KEY:'offline-fixture-not-a-credential',ANTHROPIC_BASE_URL:`http://127.0.0.1:${address.port}`,
    STUDIO_AGENT_CLAUDE_BIN:process.env.STUDIO_TEST_CLAUDE_BIN,
  });
  const marker='Studio offline interview wiring check';
  try{
    await assert.rejects(runtime.run({sessionId:crypto.randomUUID(),provider:'claude',purpose:'interview',prompt:marker,
      emit:async()=>{},persistHandle:async()=>{},tool:async()=>{assert.fail('The rejection fixture cannot request a tool call.');},
    }),/Claude turn failed/);
    // Ignore ancillary title-generation requests: they legitimately have no tools.
    const main=requests.filter(request=>{
      const content=JSON.stringify(request.messages);
      return content.includes(marker)&&!content.includes('Write the title');
    });
    assert.ok(main.length>0,'The main prompt must reach the local endpoint.');
    for(const request of main)assert.deepEqual(request.tools?.map(tool=>tool.name).sort(),agentToolNames('interview').map(name=>`mcp__studio__${name}`).sort());
  }finally{
    await runtime.close();server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));
    await rm(directory,{recursive:true,force:true});
  }
});
