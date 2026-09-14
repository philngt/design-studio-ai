import type { Context } from 'hono';
import type { Env } from './types';
import { fail, owner, rateLimit } from './security';
import { isBootstrapAdminUserId } from './bootstrap-admin';
import {
  localAgentFromProviderId,
  type LocalAgentRunResult,
} from '../src/shared/local-agents';

const ids = (value?: string) => new Set((value ?? '').split(',').map(item => item.trim()).filter(Boolean));

export function localAgentBridgeEnabled(c: Context<Env>) {
  return c.env.AGENT_BRIDGE_ENABLED === 'true' && !!c.env.AGENT_RUNNER;
}

export async function canUseLocalAgentBridge(c: Context<Env>): Promise<boolean> {
  if (!localAgentBridgeEnabled(c) || c.get('tokenKind') === 'oauth') return false;
  const userId = c.get('user')?.id;
  if (!userId) return false;
  if (ids(c.env.AGENT_BRIDGE_USER_IDS).has(userId)) return true;
  return isBootstrapAdminUserId(c.env, userId);
}

export async function requireLocalAgentBridge(c: Context<Env>) {
  if (c.env.AGENT_BRIDGE_ENABLED !== 'true')
    fail(403, 'agent_bridge_disabled', 'Local agent execution is disabled by the studio operator.');
  if (!c.env.AGENT_RUNNER)
    fail(503, 'agent_bridge_unavailable', 'This deployment cannot launch local agent runtimes. Use a self-hosted Node deployment with an agent runner.');
  if (c.get('tokenKind') === 'oauth')
    fail(403, 'insufficient_scope', 'MCP OAuth access cannot execute host-local agent runtimes. Use the account session or an API key explicitly authorized by the operator.');
  const userId = owner(c);
  if (!ids(c.env.AGENT_BRIDGE_USER_IDS).has(userId) && !await isBootstrapAdminUserId(c.env, userId))
    fail(403, 'agent_bridge_forbidden', 'This account is not allowed to use host-local agent runtimes.');
  return c.env.AGENT_RUNNER;
}

export async function localAgentProviderMetadata(c: Context<Env>) {
  if (!await canUseLocalAgentBridge(c)) return [];
  try {
    const statuses = await c.env.AGENT_RUNNER!.list();
    return statuses.filter(status => status.available).map(status => ({
      provider: status.providerId,
      name: `${status.name} (local)`,
      baseUrl: `local://${status.id}`,
      model: '',
      // Marking these as Anthropic-format metadata keeps them out of the media-provider
      // picker. Text generation is intercepted before any HTTP provider code runs.
      protocol: 'anthropic' as const,
      authMethod: 'none' as const,
      configured: true,
      apiKey: '',
      localAgent: { id: status.id, version: status.version ?? null },
    }));
  } catch {
    return [];
  }
}

export async function runLocalAgentProvider(c: Context<Env>, provider: string, input: {
  system: string;
  prompt: string;
  model?: string;
  outputSchema?: unknown;
}): Promise<LocalAgentRunResult> {
  const agent = localAgentFromProviderId(provider);
  if (!agent) fail(400, 'unsupported_agent', 'Unknown local agent runtime.');
  const runner = await requireLocalAgentBridge(c);
  await rateLimit(c, `local-agent:${owner(c)}`, 20);
  const boundedPrompt = [
    'You are running as a bounded Design Studio generation engine.',
    'Do not modify files, repositories, credentials, or external systems. Do not use tools unless the runtime requires them only to produce the requested text response.',
    'The Design Studio server validates your output before it can become a proposal. Return only the output requested by the studio instructions; never wrap it in Markdown fences.',
    '',
    '<studio-instructions>',
    input.system,
    '</studio-instructions>',
    '',
    '<user-request>',
    input.prompt,
    '</user-request>',
  ].join('\n');
  if (new TextEncoder().encode(boundedPrompt).byteLength > 8 * 1024 * 1024)
    fail(413, 'agent_input_too_large', 'The local agent input exceeds the 8 MB execution limit.');
  try {
    return await runner.run({
      agent,
      prompt: boundedPrompt,
      ...(input.model ? { model: input.model } : {}),
      ...(input.outputSchema === undefined ? {} : { outputSchema: input.outputSchema }),
      timeoutMs: 15 * 60_000,
    });
  } catch (error) {
    console.error('Local agent execution failed', agent, error instanceof Error ? error.name : 'unknown');
    fail(502, 'agent_execution_failed', `${agent === 'codex' ? 'Codex' : 'Claude Code'} could not produce a proposal. Check the host CLI authentication and runtime logs.`);
  }
}
