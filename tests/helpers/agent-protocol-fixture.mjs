#!/usr/bin/env node
// Contract-only subprocess. Never installed or selected by production defaults.
import {createInterface} from 'node:readline';
import {createServer} from 'node:http';
const args=process.argv.slice(2),session='fixture-session';
if(args.includes('--acp')&&args.includes('--stdio'))throw new Error('Copilot ACP uses stdio implicitly, not a --stdio flag.');
if(args.includes('--acp')&&process.env.STUDIO_DRAFT_URL){for(const flag of ['--allow-tool=studio','--deny-tool=read','--deny-tool=write','--deny-tool=shell','--deny-tool=url'])if(!args.includes(flag))throw new Error('Copilot draft tool permissions must be explicit.');}
if(process.env.DESIGN_STUDIO_API_KEY||process.env.ENCRYPTION_KEY)throw new Error('Application secrets reached the child.');
if(args.includes('--version')){console.log('contract-fixture');process.exit(0);}
if(args[0]==='models'){console.log('fixture/model');process.exit(0);}
const write=value=>process.stdout.write(JSON.stringify(value)+'\n');
async function edit(){
  const call=async(name,input)=>{
    const response=await fetch(process.env.STUDIO_DRAFT_URL,{method:'POST',headers:{Authorization:`Bearer ${process.env.STUDIO_DRAFT_TOKEN}`,'Content-Type':'application/json'},body:JSON.stringify({name,input})});
    if(!response.ok)throw new Error('Gateway rejected fixture tool.');return response.json();
  };
  if(process.env.STUDIO_AGENT_PURPOSE==='interview'){
    const blocked=await fetch(process.env.STUDIO_DRAFT_URL,{method:'POST',headers:{Authorization:`Bearer ${process.env.STUDIO_DRAFT_TOKEN}`,'Content-Type':'application/json'},body:JSON.stringify({name:'studio_edit',input:{version:0,operations:[{op:'rename',name:'Forbidden'}]}})});
    if(blocked.ok)throw new Error('Interview gateway exposed design tools.');
    const context=await call('studio_brief_context',{});
    await call('studio_submit_interview',{expectedRevision:context.brief.revision,interview:{message:'Who is this for?',questions:[{id:'audience',title:'Who is this for?',type:'text',options:[],required:true}],scope:null}});
    return;
  }
  const context=await call('studio_context',{});
  await call('studio_edit',{version:context.version,operations:[{op:'rename',name:'Protocol fixture draft'}]});
}
if(args[0]==='serve'){
  let stream;
  const server=createServer(async(req,res)=>{
    if(req.headers.authorization!==`Basic ${Buffer.from(`opencode:${process.env.OPENCODE_SERVER_PASSWORD}`).toString('base64')}`){res.writeHead(403).end();return;}
    const path=req.url.split('?')[0];
    if(path==='/event'){res.writeHead(200,{'Content-Type':'text/event-stream'});res.write(`data: ${JSON.stringify({type:'server.connected',properties:{}})}\n\n`);stream=res;return;}
    let body='';for await(const chunk of req)body+=chunk;
    res.setHeader('Content-Type','application/json');
    if(path==='/session'){res.end(JSON.stringify(req.method==='GET'?[]:{id:session}));return;}
    if(path===`/session/${session}/message`){
      if(body.includes('hold'))return;
      await edit();
      stream?.write(`data: ${JSON.stringify({type:'message.part.updated',properties:{sessionID:session,part:{type:'text',sessionID:session},delta:'Protocol fixture text'}})}\n\n`);
      res.end(JSON.stringify({info:{id:'fixture-message',sessionID:session,tokens:{input:2,output:3}},parts:[{type:'text',text:'Protocol fixture text'}]}));return;
    }
    res.end('{}');
  });
  server.listen(Number(args[args.indexOf('--port')+1]),'127.0.0.1');
}else{
  const copilot=args.includes('--acp'),codex=args[0]==='app-server',pi=args.includes('--mode');
  const reply=(input,result)=>write(copilot?{jsonrpc:'2.0',id:input.id,result}:pi?{type:'response',id:input.id,command:input.type,success:true,data:result}:{id:input.id,result});
  let copilotPrompt;
  for await(const line of createInterface({input:process.stdin,terminal:false})){
    const input=JSON.parse(line),method=input.method??input.type;
    if(copilot&&input.id==='fixture-unsupported-permission'){
      if(input.result?.outcome?.outcome!=='cancelled')throw new Error('A display title mentioning Studio must not authorize a shell tool.');
      write({jsonrpc:'2.0',method:'session/update',params:{sessionId:session,update:{sessionUpdate:'agent_message_chunk',content:{type:'text',text:'Protocol fixture text'}}}});
      write({jsonrpc:'2.0',method:'session/update',params:{sessionId:session,update:{sessionUpdate:'usage_update',used:5,size:100,cost:{amount:0,currency:'USD'}}}});
      reply(copilotPrompt,{stopReason:'end_turn',usage:{inputTokens:2,outputTokens:3,totalTokens:5}});continue;
    }
    if(method==='control_request'){
      const subtype=input.request.subtype;
      write({type:'control_response',response:{subtype:'success',request_id:input.request_id,response:subtype==='initialize'?{commands:[],agents:[],models:[{value:'fixture-model',displayName:'Fixture',description:'Contract test'}]}:subtype==='list_models'?{models:[{value:'fixture-model',displayName:'Fixture',description:'Contract test'}]}:{}}});continue;
    }
    if(method==='initialize'){reply(input,copilot?{protocolVersion:1,agentCapabilities:{loadSession:true}}:{capabilities:{}});continue;}
    if(method==='model/list'){reply(input,{data:[{id:'fixture-model'}]});continue;}
    if(method==='get_available_models'){reply(input,{models:[{provider:'fixture',id:'model'}]});continue;}
    if(method==='session/new'){reply(input,{sessionId:session,models:{currentModelId:'fixture-model',availableModels:[{modelId:'fixture-model',name:'Fixture'}]}});continue;}
    if(method==='session/load'||method==='session/set_model'){reply(input,{});continue;}
    if(method==='thread/start'||method==='thread/resume'){reply(input,{thread:{id:session}});continue;}
    if(method==='get_state'){reply(input,{sessionFile:'/fixture/session.jsonl'});continue;}
    if(method==='turn/start'||method==='prompt'||method==='session/prompt'||method==='user'){
      if(JSON.stringify(input).includes('hold')){if(pi||codex)reply(input,{});continue;}
      await edit();
      if(codex){reply(input,{turn:{id:'fixture-turn'}});write({method:'item/agentMessage/delta',params:{delta:'Protocol fixture text'}});write({method:'turn/completed',params:{turn:{status:'completed'}}});}
      else if(pi){reply(input,{});write({type:'message_update',assistantMessageEvent:{type:'text_delta',delta:'Protocol fixture text'}});write({type:'agent_end'});write({type:'agent_settled'});}
      else if(copilot){copilotPrompt=input;write({jsonrpc:'2.0',id:'fixture-unsupported-permission',method:'session/request_permission',params:{sessionId:session,toolCall:{toolCallId:'unsafe-shell',title:'bash echo studio_edit',kind:'execute'},options:[{optionId:'allow',name:'Allow',kind:'allow_once'},{optionId:'deny',name:'Deny',kind:'reject_once'}]}});}
      else {write({type:'system',subtype:'init',session_id:session});write({type:'stream_event',event:{type:'content_block_delta',delta:{type:'text_delta',text:'Protocol fixture text'}},session_id:session});write({type:'result',subtype:'success',is_error:false,session_id:session,usage:{input_tokens:2,output_tokens:3},total_cost_usd:0});}
      continue;
    }
    if(input.id!==undefined)reply(input,{});
  }
}
