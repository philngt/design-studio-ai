import { z } from 'zod';
import { documentSchema, type DesignDocument } from './schema';
import { operationsSchema, operationSchema } from './operations';

export const agentProviders = [
  { id: 'claude', name: 'Claude Code' }, { id: 'codex', name: 'Codex' },
  { id: 'copilot', name: 'GitHub Copilot' }, { id: 'opencode', name: 'OpenCode' }, { id: 'pi', name: 'Pi' },
] as const;
export const agentProviderSchema = z.enum(['claude', 'codex', 'copilot', 'opencode', 'pi']);
export type AgentProvider = z.infer<typeof agentProviderSchema>;
export const agentCreateSchema = z.object({ provider: agentProviderSchema, model: z.string().trim().min(1).max(200).optional(), expectedRevision: z.number().int().positive() }).strict();
export const agentMessageSchema = z.object({ requestId: z.string().uuid(), prompt: z.string().trim().min(1).max(12000), expectedRevision: z.number().int().positive() }).strict();
export const agentPermissionSchema = z.object({ requestId: z.string().min(1).max(200), decision: z.enum(['allow', 'deny']), answer: z.string().max(12000).optional() }).strict();
export const agentProposalActionSchema = z.object({ proposalVersion: z.number().int().nonnegative() }).strict();
export function agentSchemas() {
  return {create:z.toJSONSchema(agentCreateSchema),message:z.toJSONSchema(agentMessageSchema),permission:z.toJSONSchema(agentPermissionSchema),proposalAction:z.toJSONSchema(agentProposalActionSchema)};
}
export type AgentStatus = 'idle' | 'running' | 'waiting_permission' | 'stopping' | 'applying' | 'interrupted' | 'error';
export interface AgentProviderInfo { id: AgentProvider; name: string; installed: boolean; version?: string; authentication: 'unknown'; models: string[]; diagnostic?: string }
export interface AgentCatalog { enabled: boolean; reason?: string; providers: AgentProviderInfo[] }
export interface AgentProposal { document: DesignDocument; version: number; baseRevision: number; baseBriefRevision: number }
export interface AgentSession { id: string; projectId: string; provider: AgentProvider; model: string | null; status: AgentStatus; createdAt: string; updatedAt: string; proposal: AgentProposal | null }
export interface AgentEvent { seq: number; sessionId: string; type: 'user' | 'text' | 'tool' | 'tool_result' | 'permission' | 'permission_resolved' | 'usage' | 'status' | 'error' | 'proposal'; data: Record<string, unknown>; createdAt: string }
export type AgentEmission = Pick<AgentEvent, 'type' | 'data'>;
export const agentTools = {
  studio_context: { description: 'Read this session’s draft, saved design revision and approved brief. All writes affect only the draft.', schema: z.object({}).strict() },
  studio_schema: { description: 'Read the canonical document schema and operation names. Pass operation to discover one complete operation schema.', schema: z.object({operation:z.string().optional()}).strict() },
  studio_catalog: { description: 'Read Studio templates, themes and blocks.', schema: z.object({}).strict() },
  studio_edit: { description: 'Apply validated operations to the draft. Read context first and supply its draft version.', schema: z.object({ version: z.number().int().nonnegative(), operations: operationsSchema }).strict() },
  studio_replace: { description: 'Replace the draft with a canonical DesignDocument, preserving its identity and owned assets.', schema: z.object({ version: z.number().int().nonnegative(), document: documentSchema }).strict() },
  studio_inspect: { description: 'Inspect the draft for design problems and obtain its rendered SVG for the selected page.', schema: z.object({ pageIndex: z.number().int().min(0).default(0) }).strict() },
};
// Compact registration avoids sending hundreds of KB of nested unions for every tool.
// The gateway still executes the complete canonical validators above.
export const compactOperationsSchema=z.array(z.object({op:z.enum(operationSchema.options.map(option=>option.shape.op.value))}).loose()).min(1).max(100);
export const agentToolRegistrationSchemas={
  ...Object.fromEntries(Object.entries(agentTools).map(([name,tool])=>[name,tool.schema])) as {[K in keyof typeof agentTools]:z.ZodObject},
  studio_edit:z.object({version:z.number().int().nonnegative(),operations:compactOperationsSchema}).strict(),
  studio_replace:z.object({version:z.number().int().nonnegative(),document:z.object({}).loose().describe('Canonical document. Discover studio_schema first.')}).strict(),
};
export type AgentToolName = keyof typeof agentTools;
export const agentSessionPath = (projectId: string, sessionId?: string) => `/api/projects/${encodeURIComponent(projectId)}/agent-sessions${sessionId ? `/${encodeURIComponent(sessionId)}` : ''}`;
