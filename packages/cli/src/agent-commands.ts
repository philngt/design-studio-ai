import type {Command} from 'commander';
import {z} from 'zod';
import {Client,inputJson,output,positiveInteger,nonnegativeNumber} from './client';
import {agentEndpoints} from '../../../src/shared/agent-endpoints';
import {agentCreateSchema,agentMessageSchema,agentPermissionSchema,agentProposalActionSchema,agentSessionPath,agentProviderSchema} from '../../../src/shared/agents';
export function registerAgentCommands(program:Command,client:()=>Client){
  const group=program.command('agents').description('Self-hosted coding agents; requires the designated owner API key');
  group.command('schema').action(()=>output(Object.fromEntries(agentEndpoints.filter(e=>e.schema).map(e=>[e.name,z.toJSONSchema(e.schema!)]))));
  group.command('providers').action(async()=>output(await client().json('/api/agent-providers')));
  group.command('models <provider>').action(async provider=>output(await client().json(`/api/agent-providers/${agentProviderSchema.parse(provider)}/models`)));
  group.command('list <projectId>').action(async project=>output(await client().json(agentSessionPath(project))));
  group.command('create <projectId>').requiredOption('--provider <id>','claude, codex, copilot, opencode or pi').requiredOption('--revision <number>','Observed project revision').option('--model <id>','CLI model override').option('--purpose <purpose>','design or interview','design').option('--brief-revision <number>','Observed brief revision; required for interview').action(async(project,options)=>output(await client().json(agentSessionPath(project),'POST',agentCreateSchema.parse({provider:options.provider,expectedRevision:positiveInteger(options.revision),model:options.model,purpose:options.purpose,...(options.briefRevision!==undefined?{expectedBriefRevision:nonnegativeNumber(options.briefRevision)}:{})}))));
  group.command('get <projectId> <sessionId>').action(async(project,session)=>output(await client().json(agentSessionPath(project,session))));
  group.command('send <projectId> <sessionId>').requiredOption('--file <path>','JSON: requestId, prompt, expectedRevision; interviews also need expectedBriefRevision. - for stdin. Retain requestId for retries.').action(async(project,session,options)=>output(await client().json(agentSessionPath(project,session)+'/messages','POST',agentMessageSchema.parse(await inputJson(options.file)))));
  group.command('events <projectId> <sessionId>').option('--after <number>','Last observed sequence ID','0').action(async(project,session,options)=>output(await client().json(`${agentSessionPath(project,session)}/events?after=${z.number().int().nonnegative().parse(nonnegativeNumber(options.after))}`)));
  group.command('stop <projectId> <sessionId>').action(async(project,session)=>output(await client().json(agentSessionPath(project,session)+'/interrupt','POST',{})));
  group.command('respond <projectId> <sessionId>').requiredOption('--file <path>','Permission response JSON or - for stdin').action(async(project,session,options)=>output(await client().json(agentSessionPath(project,session)+'/permissions','POST',agentPermissionSchema.parse(await inputJson(options.file)))));
  group.command('proposal <projectId> <sessionId>').action(async(project,session)=>output(await client().json(agentSessionPath(project,session)+'/proposal')));
  for(const action of ['apply','discard'])group.command(`${action} <projectId> <sessionId>`).description(`${action} the human-reviewed proposal`).requiredOption('--proposal-version <number>','Observed proposal version').action(async(project,session,options)=>output(await client().json(`${agentSessionPath(project,session)}/proposal/${action}`,'POST',agentProposalActionSchema.parse({proposalVersion:nonnegativeNumber(options.proposalVersion)}))));
}
