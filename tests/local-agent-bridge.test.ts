import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { app } from '../server/index';
import { FileBucket, SqliteDatabase } from '../server/node-adapters';
import { secret } from '../server/security';
import type { Bindings } from '../server/types';
import type { LocalAgentRunInput, LocalAgentRunner } from '../src/shared/local-agents';

async function migrate(db: SqliteDatabase) {
  for (const migration of (await readdir(new URL('../migrations/', import.meta.url))).filter(name => name.endsWith('.sql')).sort())
    await db.exec(await readFile(new URL(`../migrations/${migration}`, import.meta.url), 'utf8'));
}

function cookie(response: Response) {
  return response.headers.get('set-cookie')!.split(';')[0];
}

test('trusted bootstrap admin can use local agent proposals without direct writes', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'design-studio-local-agent-'));
  const db = new SqliteDatabase(join(dir, 'studio.db'));
  await migrate(db);
  let output = '';
  let lastInput: LocalAgentRunInput | null = null;
  const runner: LocalAgentRunner = {
    async list() {
      return [
        { id: 'codex', providerId: 'custom-local-codex', name: 'Codex CLI', available: true, version: 'codex-test 1.0' },
        { id: 'claude', providerId: 'custom-local-claude', name: 'Claude Code', available: false },
      ];
    },
    async run(input) {
      lastInput = input;
      return { output, durationMs: 17, version: 'codex-test 1.0' };
    },
  };
  const env: Bindings = {
    DB: db,
    ASSETS_BUCKET: new FileBucket(join(dir, 'assets')),
    APP_URL: 'https://studio.example',
    ALLOW_REGISTRATION: 'true',
    ENCRYPTION_KEY: secret(),
    BOOTSTRAP_ADMIN_EMAIL: 'admin@example.com',
    BOOTSTRAP_ADMIN_PASSWORD: 'A secure bootstrap password 1',
    BOOTSTRAP_ADMIN_NAME: 'Admin',
    AGENT_BRIDGE_ENABLED: 'true',
    AGENT_RUNNER: runner,
  };
  const request = (path: string, method = 'GET', body?: unknown, session?: string) => app.request(
    `https://studio.example${path}`,
    {
      method,
      headers: {
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...(method === 'GET' ? {} : { Origin: 'https://studio.example' }),
        ...(session ? { Cookie: session } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    },
    env,
  );
  try {
    const login = await request('/api/auth/login', 'POST', {
      email: 'admin@example.com',
      password: 'A secure bootstrap password 1',
    });
    assert.equal(login.status, 200);
    const admin = cookie(login);

    const connections = await request('/api/providers', 'GET', undefined, admin);
    assert.equal(connections.status, 200);
    const providerBody = await connections.json() as any;
    assert.equal(providerBody.providers.some((item: any) => item.provider === 'custom-local-codex' && item.configured), true);
    assert.equal(providerBody.providers.some((item: any) => item.provider === 'custom-local-claude'), false);

    const status = await request('/api/providers/local-agents', 'GET', undefined, admin);
    assert.equal(status.status, 200);
    const statusBody = await status.json() as any;
    assert.equal(statusBody.enabled, true);
    assert.equal(statusBody.authorized, true);
    assert.deepEqual(statusBody.runtimes.map((item: any) => [item.id, item.available]), [['codex', true], ['claude', false]]);

    const created = await request('/api/projects', 'POST', { name: 'Agent design', kind: 'web' }, admin);
    assert.equal(created.status, 201);
    const project = (await created.json() as any).project;
    output = JSON.stringify(project.document);

    const generated = await request('/api/providers/local-agents/generate', 'POST', {
      projectId: project.id,
      prompt: 'Keep the structure and return a valid proposal.',
      provider: 'custom-local-codex',
      expectedRevision: project.revision,
    }, admin);
    assert.equal(generated.status, 200);
    const proposal = await generated.json() as any;
    assert.equal(proposal.document.id, project.id);
    assert.equal(proposal.baseRevision, project.revision);
    assert.equal(proposal.agent.id, 'codex');
    assert.equal(lastInput?.agent, 'codex');
    assert.ok(lastInput?.prompt.includes('<studio-instructions>'));
    assert.ok(lastInput?.outputSchema);

    const unchanged = await request(`/api/projects/${project.id}`, 'GET', undefined, admin);
    assert.equal(unchanged.status, 200);
    assert.equal((await unchanged.json() as any).project.revision, project.revision, 'generation returns a proposal and does not save it');

    const reserved = await request('/api/providers/custom-local-codex', 'PUT', {
      name: 'Takeover', baseUrl: 'https://example.com/v1', model: 'x', protocol: 'openai', authMethod: 'none',
    }, admin);
    assert.equal(reserved.status, 400);
    assert.equal((await reserved.json() as any).error.code, 'local_agent_managed');

    const invalid = structuredClone(project.document);
    invalid.id = crypto.randomUUID();
    output = JSON.stringify(invalid);
    const rejected = await request('/api/providers/local-agents/generate', 'POST', {
      projectId: project.id,
      prompt: 'Try an invalid identity change.',
      provider: 'custom-local-codex',
      expectedRevision: project.revision,
    }, admin);
    assert.equal(rejected.status, 502);
    assert.equal((await rejected.json() as any).error.code, 'invalid_generation');

    const bobRegister = await request('/api/auth/register', 'POST', {
      email: 'bob@example.com', password: 'B secure password 123', name: 'Bob',
    });
    assert.equal(bobRegister.status, 201);
    const bob = cookie(bobRegister);
    const bobProviders = await request('/api/providers', 'GET', undefined, bob);
    assert.equal((await bobProviders.json() as any).providers.some((item: any) => item.provider === 'custom-local-codex'), false);
    const bobProject = (await (await request('/api/projects', 'POST', { name: 'Bob design', kind: 'web' }, bob)).json() as any).project;
    output = JSON.stringify(bobProject.document);
    const forbidden = await request('/api/providers/local-agents/generate', 'POST', {
      projectId: bobProject.id,
      prompt: 'Use the host subscription.',
      provider: 'custom-local-codex',
      expectedRevision: bobProject.revision,
    }, bob);
    assert.equal(forbidden.status, 403);
    assert.equal((await forbidden.json() as any).error.code, 'agent_bridge_forbidden');
  } finally {
    db.close();
    await rm(dir, { recursive: true, force: true });
  }
});
