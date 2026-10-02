import type { AgentCatalog, AgentEmission, AgentProvider, AgentPurpose, AgentToolName } from '../src/shared/agents';

export interface AgentRunInput {
  sessionId: string; provider: AgentProvider; model?: string; nativeHandle?: string; prompt: string;
  purpose?: AgentPurpose;
  emit(event: AgentEmission): Promise<void>;
  tool(name: AgentToolName, input: unknown): Promise<unknown>;
  persistHandle(handle: string): Promise<void>;
}
export interface AgentRuntime {
  catalog(): Promise<AgentCatalog>;
  models(provider: AgentProvider): Promise<string[]>;
  run(input: AgentRunInput): Promise<void>;
  interrupt(sessionId: string): Promise<void>;
  respond(sessionId: string, requestId: string, decision: 'allow' | 'deny', answer?: string): Promise<void>;
  close(): Promise<void>;
}
