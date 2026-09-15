import { z } from 'zod';

export const localAgentIdSchema = z.enum(['codex', 'claude']);
export type LocalAgentId = z.infer<typeof localAgentIdSchema>;

export const localAgentProviderIdSchema = z.enum([
  'custom-local-codex',
  'custom-local-claude',
]);
export type LocalAgentProviderId = z.infer<typeof localAgentProviderIdSchema>;

const providerByAgent: Record<LocalAgentId, LocalAgentProviderId> = {
  codex: 'custom-local-codex',
  claude: 'custom-local-claude',
};
const agentByProvider = Object.fromEntries(
  Object.entries(providerByAgent).map(([agent, provider]) => [provider, agent]),
) as Record<LocalAgentProviderId, LocalAgentId>;

export function localAgentProviderId(agent: LocalAgentId): LocalAgentProviderId {
  return providerByAgent[agent];
}

export function localAgentFromProviderId(provider: string): LocalAgentId | null {
  const parsed = localAgentProviderIdSchema.safeParse(provider);
  return parsed.success ? agentByProvider[parsed.data] : null;
}

export function isLocalAgentProviderId(provider: string): provider is LocalAgentProviderId {
  return localAgentProviderIdSchema.safeParse(provider).success;
}

export interface LocalAgentStatus {
  id: LocalAgentId;
  providerId: LocalAgentProviderId;
  name: string;
  available: boolean;
  version?: string;
}

export interface LocalAgentRunInput {
  agent: LocalAgentId;
  prompt: string;
  model?: string;
  outputSchema?: unknown;
  timeoutMs?: number;
}

export interface LocalAgentRunResult {
  output: string;
  durationMs: number;
  version?: string;
}

export interface LocalAgentRunner {
  list(): Promise<LocalAgentStatus[]>;
  run(input: LocalAgentRunInput): Promise<LocalAgentRunResult>;
}
