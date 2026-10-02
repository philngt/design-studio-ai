import type { AgentCatalog, AgentEmission, AgentProvider, AgentPurpose, AgentToolName } from '../src/shared/agents';

const claudeToolsFailures = {
  failed: 'the Studio MCP connection failed',
  'needs-auth': 'the Studio MCP connection requires authentication',
  disabled: 'the Studio MCP connection is disabled',
  'missing-tools': 'the connected MCP server did not advertise all required Studio tools',
  timeout: 'timed out waiting for the Studio MCP connection',
  'status-unavailable': 'could not read the Studio MCP connection status',
} as const;

/** Only fixed, credential-free diagnostics may cross the runtime/HTTP boundary. */
export class ClaudeToolsUnavailableError extends Error {
  readonly code = 'agent_tools_unavailable';
  constructor(reason: keyof typeof claudeToolsFailures) {
    super(`Claude Code cannot use Studio tools: ${claudeToolsFailures[reason]}. Check the Claude CLI/MCP setup on the Studio server, then retry. Your prompt was not sent.`);
    this.name = 'ClaudeToolsUnavailableError';
  }
}

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
