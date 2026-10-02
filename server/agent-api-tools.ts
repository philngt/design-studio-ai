import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { agentEndpoints } from '../src/shared/agent-endpoints';
export function registerAgentApiTools(server:McpServer,callApi:(method:string,path:string,body?:unknown)=>Promise<any>){
  for(const endpoint of agentEndpoints){
    const parameters:Record<string,z.ZodType>={};
    for(const match of endpoint.path.matchAll(/\{(\w+)\}/g))parameters[match[1]]=z.string().min(1);
    if(endpoint.name==='agent_events')parameters.after=z.number().int().nonnegative().optional();
    if(endpoint.schema)parameters.body=endpoint.schema;
    server.registerTool(endpoint.name,{description:endpoint.summary+'. Requires the designated owner API key; OAuth studio scope cannot run server agents. Apply only after explicit human review.',inputSchema:parameters,...(endpoint.method==='GET'?{annotations:{readOnlyHint:true}}:{})},async(args:any)=>{
      let path=endpoint.path.replace(/\{(\w+)\}/g,(_,key)=>encodeURIComponent(args[key]));
      if(endpoint.name==='agent_events'&&args.after!==undefined)path+=`?after=${args.after}`;
      return callApi(endpoint.method,path,args.body??(endpoint.method==='POST'?{}:undefined));
    });
  }
}
