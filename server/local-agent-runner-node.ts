import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  localAgentProviderId,
  type LocalAgentId,
  type LocalAgentRunner,
  type LocalAgentRunInput,
  type LocalAgentRunResult,
  type LocalAgentStatus,
} from '../src/shared/local-agents';

const MAX_STDOUT = 16 * 1024 * 1024;
const MAX_STDERR = 1024 * 1024;

const specs: Record<LocalAgentId, { name: string; envBin: string; fallbackBin: string }> = {
  codex: { name: 'Codex CLI', envBin: 'CODEX_BIN', fallbackBin: 'codex' },
  claude: { name: 'Claude Code', envBin: 'CLAUDE_BIN', fallbackBin: 'claude' },
};

function binary(agent: LocalAgentId) {
  const spec = specs[agent];
  return process.env[spec.envBin]?.trim() || spec.fallbackBin;
}

function childEnvironment(agent: LocalAgentId) {
  const common = new Set([
    'PATH', 'HOME', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'XDG_CONFIG_HOME',
    'LANG', 'LC_ALL', 'TERM', 'SYSTEMROOT', 'COMSPEC', 'PATHEXT', 'TMP', 'TEMP',
    'SSL_CERT_FILE', 'SSL_CERT_DIR', 'HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'NO_PROXY',
  ]);
  const specific = agent === 'codex'
    ? ['CODEX_HOME', 'OPENAI_API_KEY', 'OPENAI_BASE_URL']
    : ['CLAUDE_CONFIG_DIR', 'ANTHROPIC_API_KEY', 'ANTHROPIC_BASE_URL'];
  const allowed = new Set([...common, ...specific]);
  return Object.fromEntries(
    Object.entries(process.env).filter((entry): entry is [string, string] => allowed.has(entry[0]) && typeof entry[1] === 'string'),
  );
}

function killProcess(child: ChildProcessWithoutNullStreams) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  try {
    if (process.platform !== 'win32' && child.pid) process.kill(-child.pid, 'SIGKILL');
    else child.kill('SIGKILL');
  } catch {
    try { child.kill('SIGKILL'); } catch { /* already exited */ }
  }
}

function runProcess(options: {
  agent: LocalAgentId;
  args: string[];
  input?: string;
  cwd: string;
  timeoutMs: number;
  stdoutLimit?: number;
  stderrLimit?: number;
}): Promise<{ code: number; stdout: string; stderr: string; durationMs: number }> {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    let settled = false;
    const child = spawn(binary(options.agent), options.args, {
      cwd: options.cwd,
      env: childEnvironment(options.agent),
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
      detached: process.platform !== 'win32',
    });
    let stdout = '', stderr = '';
    const stdoutLimit = options.stdoutLimit ?? MAX_STDOUT;
    const stderrLimit = options.stderrLimit ?? MAX_STDERR;
    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      killProcess(child);
      reject(error);
    };
    const append = (kind: 'stdout' | 'stderr', chunk: Buffer | string) => {
      const text = chunk.toString();
      if (kind === 'stdout') {
        if (Buffer.byteLength(stdout) + Buffer.byteLength(text) > stdoutLimit) return fail(new Error('Local agent stdout exceeded its size limit.'));
        stdout += text;
      } else {
        if (Buffer.byteLength(stderr) + Buffer.byteLength(text) > stderrLimit) return fail(new Error('Local agent stderr exceeded its size limit.'));
        stderr += text;
      }
    };
    child.stdout.on('data', chunk => append('stdout', chunk));
    child.stderr.on('data', chunk => append('stderr', chunk));
    child.on('error', error => fail(error));
    child.on('close', code => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ code: code ?? -1, stdout, stderr, durationMs: Date.now() - started });
    });
    const timer = setTimeout(() => fail(new Error(`Local agent timed out after ${options.timeoutMs} ms.`)), options.timeoutMs);
    child.stdin.on('error', () => { /* a fast-exiting CLI may close stdin before the write completes */ });
    child.stdin.end(options.input ?? '');
  });
}

function versionLine(value: string) {
  return value.split(/\r?\n/).map(line => line.trim()).find(Boolean)?.slice(0, 160);
}

export function createNodeLocalAgentRunner(): LocalAgentRunner {
  const versionCache = new Map<LocalAgentId, Promise<LocalAgentStatus>>();
  const status = (agent: LocalAgentId) => {
    const existing = versionCache.get(agent);
    if (existing) return existing;
    const promise = (async (): Promise<LocalAgentStatus> => {
      try {
        const result = await runProcess({ agent, args: ['--version'], cwd: process.cwd(), timeoutMs: 5000, stdoutLimit: 128 * 1024, stderrLimit: 128 * 1024 });
        return {
          id: agent,
          providerId: localAgentProviderId(agent),
          name: specs[agent].name,
          available: result.code === 0,
          ...(versionLine(result.stdout || result.stderr) ? { version: versionLine(result.stdout || result.stderr) } : {}),
        };
      } catch {
        return { id: agent, providerId: localAgentProviderId(agent), name: specs[agent].name, available: false };
      }
    })();
    versionCache.set(agent, promise);
    return promise;
  };

  async function run(input: LocalAgentRunInput): Promise<LocalAgentRunResult> {
    const current = await status(input.agent);
    if (!current.available) throw new Error(`${specs[input.agent].name} is not installed or executable.`);
    const timeoutMs = Math.max(1000, Math.min(input.timeoutMs ?? 15 * 60_000, 30 * 60_000));
    const directory = await mkdtemp(join(tmpdir(), 'design-studio-agent-'));
    try {
      if (input.agent === 'codex') {
        const outputPath = join(directory, 'output.json');
        const args = [
          'exec',
          '--ignore-user-config',
          '--sandbox', 'read-only',
          '--ephemeral',
          '--skip-git-repo-check',
          '--output-last-message', outputPath,
          '--cd', directory,
        ];
        if (input.model?.trim()) args.push('--model', input.model.trim());
        if (input.outputSchema !== undefined) {
          const schemaPath = join(directory, 'output.schema.json');
          await writeFile(schemaPath, JSON.stringify(input.outputSchema), { encoding: 'utf8', mode: 0o600 });
          args.push('--output-schema', schemaPath);
        }
        args.push('-');
        const result = await runProcess({ agent: 'codex', args, input: input.prompt, cwd: directory, timeoutMs });
        if (result.code !== 0) throw new Error(`Codex CLI exited with code ${result.code}.`);
        const output = await readFile(outputPath, 'utf8');
        if (Buffer.byteLength(output) > MAX_STDOUT) throw new Error('Codex output exceeded the size limit.');
        if (!output.trim()) throw new Error('Codex returned an empty result.');
        return { output, durationMs: result.durationMs, ...(current.version ? { version: current.version } : {}) };
      }

      const args = [
        '--print',
        '--output-format', 'text',
        '--no-session-persistence',
        '--tools', '',
        '--strict-mcp-config',
      ];
      if (input.model?.trim()) args.push('--model', input.model.trim());
      // Claude Code treats piped stdin as context and the positional query as the instruction.
      args.push('Follow the Design Studio instructions supplied on stdin and return only the requested output.');
      const result = await runProcess({ agent: 'claude', args, input: input.prompt, cwd: directory, timeoutMs });
      if (result.code !== 0) throw new Error(`Claude Code exited with code ${result.code}.`);
      if (!result.stdout.trim()) throw new Error('Claude Code returned an empty result.');
      return { output: result.stdout, durationMs: result.durationMs, ...(current.version ? { version: current.version } : {}) };
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }

  return {
    list: () => Promise.all(([ 'codex', 'claude' ] as const).map(status)),
    run,
  };
}
