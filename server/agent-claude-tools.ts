import { setTimeout as delay } from 'node:timers/promises';
import type { Query } from '@anthropic-ai/claude-agent-sdk';
import type { AgentToolName } from '../src/shared/agents';
import { ClaudeToolsUnavailableError } from './agent-runtime-contract';
function abortable<T>(operation: () => Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => reject(new DOMException('Agent stopped.', 'AbortError'));
    if (signal.aborted) { abort(); return; }
    signal.addEventListener('abort', abort, { once: true });
    Promise.resolve().then(() => { signal.throwIfAborted(); return operation(); }).then(resolve, reject)
      .finally(() => signal.removeEventListener('abort', abort));
  });
}

/** Check this query's actual MCP connection, not a separate bridge health check. */
export async function waitForClaudeStudioTools(
  query: Pick<Query, 'mcpServerStatus'>,
  expected: readonly AgentToolName[],
  signal: AbortSignal,
  { timeoutMs = 30_000, pollMs = 200 } = {},
) {
  const deadline = new AbortController();
  const timer = setTimeout(() => deadline.abort(), timeoutMs);
  const waiting = AbortSignal.any([signal, deadline.signal]);
  try {
    while (true) {
      const servers = await abortable(() => query.mcpServerStatus(), waiting);
      const studio = servers.find(server => server.name === 'studio');
      if (studio?.status === 'connected') {
        const names = new Set(studio.tools?.map(tool => tool.name.replace(/^mcp__studio__/, '')));
        const missing = expected.filter(name => !names.has(name));
        if (missing.length) throw new ClaudeToolsUnavailableError('missing-tools');
        return;
      }
      if (studio && (studio.status === 'failed' || studio.status === 'needs-auth' || studio.status === 'disabled')) {
        throw new ClaudeToolsUnavailableError(studio.status);
      }
      await delay(pollMs, undefined, { signal: waiting });
    }
  } catch (error) {
    if (signal.aborted) throw new DOMException('Agent stopped.', 'AbortError');
    if (deadline.signal.aborted) throw new ClaudeToolsUnavailableError('timeout');
    if (error instanceof ClaudeToolsUnavailableError) throw error;
    throw new ClaudeToolsUnavailableError('status-unavailable');
  } finally {
    clearTimeout(timer);
  }
}
