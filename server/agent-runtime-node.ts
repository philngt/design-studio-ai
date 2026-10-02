import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { Readable, Writable } from 'node:stream';
import { ClientSideConnection, ndJsonStream } from '@agentclientprotocol/sdk';
import { agentProviders, agentToolNames, type AgentCatalog, type AgentEmission, type AgentProvider, type AgentToolName } from '../src/shared/agents';
import type { AgentRuntime, AgentRunInput } from './agent-runtime-contract';
import { AgentProcess } from './agent-jsonl';

const execute=promisify(execFile);
const instructions='You are designing in Design Studio AI. Use only the studio draft tools. First call studio_context and studio_schema. Read the approved brief. Edit the canonical draft through studio_edit or studio_replace, inspect it, then describe the proposal. Never claim it was saved or applied. Only the human can Apply. Preserve project identity, owned assets, schema version and brief scope. Do not use filesystem/shell tools or start other agents. Re-read studio_context at the start of every turn.';
function abortError(){return new DOMException('Agent stopped.','AbortError');}
export function agentEnvironment(source:NodeJS.ProcessEnv):NodeJS.ProcessEnv {
  const keys=['PATH','HOME','USER','LOGNAME','SHELL','TMPDIR','LANG','LC_ALL','XDG_CONFIG_HOME','XDG_DATA_HOME','XDG_CACHE_HOME','CODEX_HOME','CLAUDE_CONFIG_DIR','PI_CODING_AGENT_DIR','ANTHROPIC_API_KEY','OPENAI_API_KEY','OPENAI_BASE_URL','ANTHROPIC_BASE_URL','GH_TOKEN','GITHUB_TOKEN','COPILOT_GITHUB_TOKEN','OPENCODE_CONFIG','OPENCODE_CONFIG_DIR','HTTPS_PROXY','HTTP_PROXY','NO_PROXY','NODE_EXTRA_CA_CERTS'];
  return Object.fromEntries(keys.filter(key=>source[key]!==undefined).map(key=>[key,source[key]]));
}
interface Running { abort:AbortController; permission:Map<string,{resolve:(value:{decision:'allow'|'deny';answer?:string})=>void;timer:ReturnType<typeof setTimeout>}>; close?:()=>Promise<void> }

export class NodeAgentRuntime implements AgentRuntime {
  private running=new Map<string,Running>();
  private cached?:{time:number;catalog:AgentCatalog};
  constructor(private root:string,private source:NodeJS.ProcessEnv=process.env){}
  private binary(provider:AgentProvider){return this.source[`STUDIO_AGENT_${provider.toUpperCase()}_BIN`]||provider;}
  async catalog():Promise<AgentCatalog>{
    if(this.cached&&Date.now()-this.cached.time<30000)return this.cached.catalog;
    const providers=await Promise.all(agentProviders.map(async provider=>{
      try{const {stdout}=await execute(this.binary(provider.id),['--version'],{env:agentEnvironment(this.source),timeout:5000,maxBuffer:8192});return {...provider,installed:true,version:stdout.trim().slice(0,160),authentication:'unknown' as const,models:[]};}
      catch{return {...provider,installed:false,authentication:'unknown' as const,models:[],diagnostic:'CLI not found or did not respond. Install it and authenticate on the server.'};}
    }));
    const catalog={enabled:true,providers};this.cached={time:Date.now(),catalog};return catalog;
  }
  async models(provider:AgentProvider):Promise<string[]>{
    const cwd=resolve(this.root,'catalog');await mkdir(cwd,{recursive:true,mode:0o700});
    const env=agentEnvironment(this.source);
    if(provider==='opencode'){
      const {stdout}=await execute(this.binary(provider),['models'],{cwd,env,timeout:20000,maxBuffer:1024*1024});
      return stdout.split(/\r?\n/).filter(line=>/^[\w.-]+\/[^\s]+$/.test(line)).slice(0,1000);
    }
    if(provider==='claude'){
      const {query}=await import('@anthropic-ai/claude-agent-sdk');
      const abort=new AbortController(),timer=setTimeout(()=>abort.abort(),20000);
      async function* noPrompts():AsyncGenerator<any>{await new Promise<void>(resolve=>abort.signal.addEventListener('abort',()=>resolve(),{once:true}));}
      const q=query({prompt:noPrompts(),options:{cwd,env,pathToClaudeCodeExecutable:this.binary(provider),abortController:abort,tools:[]}});
      try{return (await q.supportedModels()).map(model=>model.value);}finally{abort.abort();q.close();clearTimeout(timer);}
    }
    const proc=new AgentProcess(this.binary(provider),provider==='codex'?['app-server']:provider==='pi'?['--mode','rpc','--no-session','--no-tools','--no-extensions','--no-skills']:['--acp'],cwd,env,provider!=='copilot');
    const deadline=setTimeout(()=>void proc.close(),20000);
    try{
      if(provider==='codex'){
        await proc.request('initialize',{clientInfo:{name:'design_studio_ai',version:'0.4.3'}},false,20000);proc.write({method:'initialized',params:{}});
        return (await proc.request('model/list',{},false,20000)).data.map((model:any)=>model.id);
      }
      if(provider==='pi')return (await proc.request('get_available_models',{},true,20000)).models.map((model:any)=>`${model.provider}/${model.id}`);
      const connection=new ClientSideConnection(()=>({sessionUpdate:async()=>{},requestPermission:async()=>({outcome:{outcome:'cancelled'}})}),ndJsonStream(Writable.toWeb(proc.child.stdin),Readable.toWeb(proc.child.stdout) as unknown as ReadableStream<Uint8Array>));
      await connection.initialize({protocolVersion:1,clientCapabilities:{}});
      const session=await connection.newSession({cwd,mcpServers:[]});
      return session.models?.availableModels.map(model=>model.modelId)??[];
    }finally{clearTimeout(deadline);await proc.close();}
  }
  async respond(sessionId:string,requestId:string,decision:'allow'|'deny',answer?:string){
    const run=this.running.get(sessionId),pending=run?.permission.get(requestId);
    if(!pending)throw new Error('Permission request expired.');
    clearTimeout(pending.timer);run!.permission.delete(requestId);pending.resolve({decision,answer});
  }
  async interrupt(sessionId:string){const run=this.running.get(sessionId);if(!run)return;run.abort.abort();await run.close?.();}
  async close(){await Promise.all([...this.running.keys()].map(id=>this.interrupt(id)));}
  async run(input:AgentRunInput){
    const availableTools = agentToolNames(input.purpose);
    const turnInstructions = input.purpose === 'interview'
      ? 'You clarify a design brief in Design Studio AI. First call studio_brief_context on every turn and read the saved answers and history. Ask concise questions only when information is missing. Use studio_submit_interview to save questions or a concrete scope using the observed brief revision. Questions are shown one at a time by Studio. Never invent user answers or approval. Never edit a design, use filesystem/shell tools or start other agents. Only the human can approve the scope.'
      : instructions;
    if(this.running.has(input.sessionId))throw new Error('Session already running.');
    const run:Running={abort:new AbortController(),permission:new Map()};this.running.set(input.sessionId,run);
    const directory=resolve(this.root,input.sessionId);
    const timeout=setTimeout(()=>run.abort.abort(),30*60*1000);
    let emissionQueue=Promise.resolve();
    const emit=(event:AgentEmission)=>{emissionQueue=emissionQueue.then(()=>input.emit(event));return emissionQueue;};
    const ask=async(description:string)=>{
      const requestId=randomBytes(16).toString('hex');
      const result=new Promise<{decision:'allow'|'deny';answer?:string}>(resolve=>{
        const timer=setTimeout(()=>{run.permission.delete(requestId);resolve({decision:'deny'});},5*60*1000);
        run.permission.set(requestId,{resolve,timer});
      });
      await emit({type:'permission',data:{requestId,description}});
      const answer=await result;
      await emit({type:'permission_resolved',data:{requestId,decision:answer.decision}});
      return answer;
    };
    const token=randomBytes(32).toString('hex');
    // A turn-scoped loopback gateway exposes draft tools only, never the Studio account API.
    const gateway=createServer(async(req,res)=>{
      const actual=Buffer.from(req.headers.authorization??''),expected=Buffer.from(`Bearer ${token}`);
      if(req.method!=='POST'||req.url!=='/call'||actual.length!==expected.length||!timingSafeEqual(actual,expected)||run.abort.signal.aborted){res.writeHead(403);res.end();return;}
      try{
        const chunks:Buffer[]=[];let size=0;
        for await(const chunk of req){size+=chunk.length;if(size>21*1024*1024)throw new Error('Tool input too large.');chunks.push(chunk);}
        const {name,input:args}=JSON.parse(Buffer.concat(chunks).toString());
        if(!availableTools.includes(name))throw new Error('Tool unavailable for this session purpose.');
        await emit({type:'tool',data:{name}});
        const result=await input.tool(name as AgentToolName,args);
        await emit({type:'tool_result',data:{name,success:true}});
        res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify(result));
      }catch(error){res.writeHead(400,{'Content-Type':'application/json'});res.end(JSON.stringify({error:error instanceof Error?error.message:'Draft tool failed.'}));}
    });
    const onAbort=()=>{for(const pending of run.permission.values()){clearTimeout(pending.timer);pending.resolve({decision:'deny'});}run.permission.clear();void run.close?.().catch(()=>{});};
    run.abort.signal.addEventListener('abort',onAbort,{once:true});
    try{
    await mkdir(directory,{recursive:true,mode:0o700});
    if(run.abort.signal.aborted)throw abortError();
    await new Promise<void>((yes,no)=>{gateway.once('error',no);gateway.listen(0,'127.0.0.1',yes);});
    const address=gateway.address() as {port:number};
    const env={...agentEnvironment(this.source),STUDIO_AGENT_PURPOSE:input.purpose??'design',STUDIO_DRAFT_URL:`http://127.0.0.1:${address.port}/call`,STUDIO_DRAFT_TOKEN:token};
    const bridge=fileURLToPath(new URL('./agent-mcp-bridge.ts',import.meta.url));
    const mcp={command:process.execPath,args:['--import',fileURLToPath(new URL('../node_modules/tsx/dist/loader.mjs',import.meta.url)),bridge],env:{STUDIO_AGENT_PURPOSE:env.STUDIO_AGENT_PURPOSE,STUDIO_DRAFT_URL:env.STUDIO_DRAFT_URL,STUDIO_DRAFT_TOKEN:token}};
    if(run.abort.signal.aborted)throw abortError();
      if(input.provider==='claude'){
        const {query}=await import('@anthropic-ai/claude-agent-sdk');
        const q=query({prompt:turnInstructions+'\n\n'+input.prompt,options:{cwd:directory,env,pathToClaudeCodeExecutable:this.binary('claude'),model:input.model,resume:input.nativeHandle,includePartialMessages:true,abortController:run.abort,tools:[],settingSources:[],strictMcpConfig:true,mcpServers:{studio:mcp},canUseTool:async(name,args)=>{
          if(name.startsWith('mcp__studio__'))return {behavior:'allow' as const,updatedInput:args};
          return {behavior:'deny' as const,message:'Only Studio draft tools are enabled for this session.'};
        }}});
        run.close=async()=>{q.close();};
        for await(const raw of q){
          const message=raw as any;
          if(message.session_id)await input.persistHandle(message.session_id);
          if(message.type==='stream_event'&&message.event?.delta?.type==='text_delta')await emit({type:'text',data:{text:message.event.delta.text}});
          if(message.type==='result'){
            if(message.is_error)throw new Error('Claude turn failed.');
            await emit({type:'usage',data:{usage:message.usage??{},cost:message.total_cost_usd??null}});
          }
        }
      }else if(input.provider==='copilot'){
        const proc=new AgentProcess(this.binary('copilot'),['--acp','--disable-builtin-mcps','--no-custom-instructions','--no-auto-update','--allow-tool=studio','--deny-tool=read','--deny-tool=write','--deny-tool=shell','--deny-tool=url','--deny-tool=memory','--excluded-tools','bash,powershell,list_bash,list_powershell,read_bash,read_powershell,stop_bash,stop_powershell,write_bash,write_powershell,apply_patch,create,edit,view,glob,grep,rg,list_agents,read_agent,task,write_agent,skill,web_fetch'],directory,env,false);
        let acceptingUpdates=false;
        const connection=new ClientSideConnection(()=>({
          sessionUpdate:async({update})=>{
            if(!acceptingUpdates)return;
            if(update.sessionUpdate==='agent_message_chunk'&&update.content.type==='text')await emit({type:'text',data:{text:update.content.text}});
            if(update.sessionUpdate==='tool_call'||update.sessionUpdate==='tool_call_update')await emit({type:'tool',data:{name:update.title??update.toolCallId,status:update.status}});
            if(update.sessionUpdate==='usage_update')await emit({type:'usage',data:{context:{used:update.used,size:update.size},cost:update.cost??null,scope:'session'}});
          },
          // Studio MCP is explicitly allowed above. Display titles are not tool identities:
          // never grant another capability because its command/text mentions "studio_".
          requestPermission:async()=>({outcome:{outcome:'cancelled'}}),
        }),ndJsonStream(Writable.toWeb(proc.child.stdin),Readable.toWeb(proc.child.stdout) as unknown as ReadableStream<Uint8Array>));
        let sessionId=input.nativeHandle;
        run.close=async()=>{if(run.abort.signal.aborted&&sessionId)void connection.cancel({sessionId}).catch(()=>{});await proc.close();};
        const init=await connection.initialize({protocolVersion:1,clientCapabilities:{},clientInfo:{name:'design-studio-ai',version:'0.4.3'}});
        const mcpServers=[{name:'studio',command:mcp.command,args:mcp.args,env:Object.entries(mcp.env).map(([name,value])=>({name,value}))}];
        if(sessionId){if(!init.agentCapabilities?.loadSession)throw new Error('This Copilot version cannot resume sessions.');await connection.loadSession({sessionId,cwd:directory,mcpServers});}
        else sessionId=(await connection.newSession({cwd:directory,mcpServers})).sessionId;
        await input.persistHandle(sessionId);
        if(input.model)await connection.unstable_setSessionModel({sessionId,modelId:input.model});
        acceptingUpdates=true;
        const result=await connection.prompt({sessionId,prompt:[{type:'text',text:turnInstructions+'\n\n'+input.prompt}]});
        if(result.stopReason==='cancelled')throw abortError();
        if(result.usage)await emit({type:'usage',data:{usage:result.usage,scope:'turn'}});
      }else if(input.provider==='opencode'){
        const {createOpencodeClient}=await import('@opencode-ai/sdk');
        const password=randomBytes(24).toString('hex');
        const portServer=createServer();await new Promise<void>(yes=>portServer.listen(0,'127.0.0.1',yes));
        const port=(portServer.address() as {port:number}).port;await new Promise<void>(yes=>portServer.close(()=>yes()));
        // The SDK talks only to our own authenticated loopback process.
        const proc=new AgentProcess(this.binary('opencode'),['serve','--hostname','127.0.0.1','--port',String(port)],directory,{...env,OPENCODE_SERVER_PASSWORD:password,OPENCODE_CONFIG_CONTENT:JSON.stringify({mcp:{studio:{type:'local',command:[mcp.command,...mcp.args],environment:mcp.env}},tools:{'*':false,'studio_*':true},permission:{edit:'deny',bash:'deny',webfetch:'deny',external_directory:'deny'}})},false);
        const child=proc.child;child.stdout.resume();
        let spawnError:Error|undefined;child.on('error',error=>{spawnError=error;});
        run.close=()=>proc.close();
        const client=createOpencodeClient({baseUrl:`http://127.0.0.1:${port}`,headers:{Authorization:`Basic ${Buffer.from(`opencode:${password}`).toString('base64')}`},fetch:(request:Request)=>fetch(request,{signal:AbortSignal.any([run.abort.signal,request.signal])})}) as any;
        let ready=false;
        for(let attempt=0;attempt<50&&!run.abort.signal.aborted;attempt++){
          if(spawnError||child.exitCode!==null||child.signalCode!==null)throw spawnError??new Error('OpenCode exited.');
          try{const r=await client.session.list({signal:AbortSignal.any([run.abort.signal,AbortSignal.timeout(500)])});if(!r.error){ready=true;break;}}catch{}
          await new Promise(r=>setTimeout(r,200));
        }
        if(!ready)throw new Error('OpenCode did not become ready.');
        const created=input.nativeHandle?{data:{id:input.nativeHandle}}:await client.session.create({body:{title:'Studio design'}});
        const sessionId=created.data?.id;if(!sessionId)throw new Error('OpenCode session unavailable.');await input.persistHandle(sessionId);
        const subscriptionAbort=new AbortController();
        run.close=async()=>{subscriptionAbort.abort();await proc.close();};
        const subscription=await client.event.subscribe({signal:AbortSignal.any([run.abort.signal,subscriptionAbort.signal])});
        let streamReady!:()=>void;const connected=new Promise<void>(resolve=>{streamReady=resolve;});let streamedText='';
        const consume=(async()=>{for await(const raw of subscription.stream){
          const event=raw.payload??raw;
          if(event.type==='server.connected'){streamReady();continue;}
          if(event.properties?.sessionID!==sessionId&&event.properties?.part?.sessionID!==sessionId)continue;
          if((event.type==='message.part.updated'&&event.properties.part?.type==='text'||event.type==='message.part.delta'&&event.properties.field==='text')&&event.properties.delta){streamedText+=event.properties.delta;await emit({type:'text',data:{text:event.properties.delta}});}
          if(event.type==='permission.updated')await client.postSessionIdPermissionsPermissionId({path:{id:sessionId,permissionID:event.properties.id},body:{response:'reject'}});
        }})();
        consume.catch(()=>{});
        let readyTimer:ReturnType<typeof setTimeout>|undefined;
        try{await Promise.race([connected,consume.then(()=>{throw new Error('OpenCode stream closed before ready.');}),new Promise<void>((_,reject)=>{readyTimer=setTimeout(()=>reject(new Error('OpenCode stream did not connect.')),10000);})]);}finally{clearTimeout(readyTimer);}
        const slash=input.model?.indexOf('/')??-1;
        if(input.model&&slash<=0)throw new Error('OpenCode models must use provider/model.');
        const model=input.model&&slash>0?{providerID:input.model.slice(0,slash),modelID:input.model.slice(slash+1)}:undefined;
        const result=await client.session.prompt({path:{id:sessionId},body:{parts:[{type:'text',text:turnInstructions+'\n\n'+input.prompt}],...(model?{model}: {})},signal:run.abort.signal});
        if(result.error||result.data?.info?.error)throw new Error('OpenCode turn failed.');
        // Finish the consumer before reconciling the final text, avoiding late-delta duplicates.
        subscriptionAbort.abort();await consume.catch(()=>{});
        const finalText=(result.data?.parts??[]).filter((part:any)=>part.type==='text').map((part:any)=>part.text).join('');
        if(finalText.startsWith(streamedText)&&finalText.length>streamedText.length)await emit({type:'text',data:{text:finalText.slice(streamedText.length)}});
        if(result.data?.info?.tokens)await emit({type:'usage',data:{usage:result.data.info.tokens}});
        // Close the event subscription without marking a successful turn interrupted.
        await run.close();
      }else{
        const args=input.provider==='codex'?['app-server','--listen','stdio://','-c','features.shell_tool=false','-c',`mcp_servers.studio=${JSON.stringify(mcp).replace(/"([^"\\]+)":/g,'$1=')}`]
          :['--mode','rpc','--tools',availableTools.join(','),'--no-extensions','--no-skills','--extension',fileURLToPath(new URL('./agent-pi-extension.ts',import.meta.url)),'--session-dir',directory,...(input.nativeHandle?['--session',input.nativeHandle]:[]),...(input.model?['--model',input.model]:[])];
        const proc=new AgentProcess(this.binary(input.provider),args,directory,env);run.close=()=>proc.close();
        let finish!:()=>void,fail!:(error:Error)=>void;
        const completed=new Promise<void>((yes,no)=>{finish=yes;fail=no;});completed.catch(()=>{});
        proc.onExit=error=>fail(run.abort.signal.aborted?abortError():error);
        let providerSession=input.nativeHandle;
        let pendingEvents=Promise.resolve();
        proc.onMessage=message=>{pendingEvents=pendingEvents.then(async()=>{
          const method=message.method,params=message.params??{};
          if(input.provider==='codex'){
            if(method==='item/agentMessage/delta')await emit({type:'text',data:{text:params.delta}});
            if(method==='turn/completed'){if(params.turn?.status==='completed')finish();else fail(new Error('Codex turn failed or interrupted.'));}
            if(method==='thread/tokenUsage/updated')await emit({type:'usage',data:{usage:params.tokenUsage??{}}});
            if(message.id!==undefined&&method){
              if(method==='item/tool/requestUserInput'){
                const answer=await ask(JSON.stringify(params.questions??[]));
                proc.reply(message.id,{answers:Object.fromEntries((params.questions??[]).map((q:any)=>[q.id,{answers:answer.decision==='allow'?[answer.answer??'']:[]}]))});
              }else if(method.includes('requestApproval'))proc.reply(message.id,{decision:'decline'});
              else proc.write({id:message.id,error:{code:-32601,message:'This capability is not enabled in Studio.'}});
            }
          }else{
            if(message.type==='message_update'&&message.assistantMessageEvent?.type==='text_delta')await emit({type:'text',data:{text:message.assistantMessageEvent.delta}});
            // agent_end may precede an automatic retry/compaction; only settled ends the turn.
            if(message.type==='agent_settled')finish();
            if(message.type==='extension_ui_request'){
              const answer=await ask(message.message??message.title??'Agent requests input');
              proc.write({type:'extension_ui_response',id:message.id,...(message.method==='confirm'?{confirmed:answer.decision==='allow'}:{value:answer.answer,cancelled:answer.decision==='deny'})});
            }
            if(message.type==='message_end'&&message.message?.stopReason==='error')fail(new Error('Pi turn failed.'));
          }
        }).catch(fail);};
        if(input.provider==='codex'){
          await proc.request('initialize',{clientInfo:{name:'design_studio_ai',title:'Design Studio AI',version:'0.4.3'}});proc.write({method:'initialized',params:{}});
          const thread=await proc.request(providerSession?'thread/resume':'thread/start',{...(providerSession?{threadId:providerSession}:{}),cwd:directory,...(input.model?{model:input.model}:{}),approvalPolicy:'untrusted',sandbox:'read-only',developerInstructions:turnInstructions});
          providerSession=thread.thread.id;await input.persistHandle(providerSession!);
          await proc.request('turn/start',{threadId:providerSession,input:[{type:'text',text:input.prompt}]});await completed;
        }else{
          const state=await proc.request('get_state',{},true);if(state.sessionFile)await input.persistHandle(state.sessionFile);
          const response=await proc.request('prompt',{message:turnInstructions+'\n\n'+input.prompt},true);
          if(response.disposition!=='handled')await completed;
          const settled=await proc.request('get_state',{},true);if(settled.sessionFile)await input.persistHandle(settled.sessionFile);
          try{const stats=await proc.request('get_session_stats',{},true,5000);if(stats.tokens||typeof stats.cost==='number')await emit({type:'usage',data:{usage:stats.tokens??null,cost:stats.cost??null,scope:'session'}});}catch{ /* Missing accounting does not invalidate a completed draft. */ }
        }
        await pendingEvents;
      }
      if(run.abort.signal.aborted)throw abortError();
      await emissionQueue;
    }catch(error){if(run.abort.signal.aborted)throw abortError();throw error;}finally{
      clearTimeout(timeout);run.abort.signal.removeEventListener('abort',onAbort);
      for(const pending of run.permission.values()){clearTimeout(pending.timer);pending.resolve({decision:'deny'});}
      run.permission.clear();
      try{await run.close?.();}finally{gateway.closeAllConnections();if(gateway.listening)await new Promise<void>(yes=>gateway.close(()=>yes()));this.running.delete(input.sessionId);}
    }
  }
}
