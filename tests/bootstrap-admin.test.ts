import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { app } from '../server/index';
import { FileBucket, SqliteDatabase } from '../server/node-adapters';
import { ensureBootstrapAdmin } from '../server/bootstrap-admin';
import { passwordMatches, secret } from '../server/security';
import type { Bindings } from '../server/types';

async function migrate(db: SqliteDatabase) {
  for (const migration of (await readdir(new URL('../migrations/', import.meta.url))).filter(name => name.endsWith('.sql')).sort())
    await db.exec(await readFile(new URL(`../migrations/${migration}`, import.meta.url), 'utf8'));
}

test('bootstrap admin is pre-created, can sign in, and receives operator privileges', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'design-studio-admin-'));
  const db = new SqliteDatabase(join(dir, 'studio.db'));
  await migrate(db);
  const env: Bindings = {
    DB: db,
    ASSETS_BUCKET: new FileBucket(join(dir, 'assets')),
    APP_URL: 'https://studio.example',
    ALLOW_REGISTRATION: 'false',
    ENCRYPTION_KEY: secret(),
    COMMUNITY_ENABLED: 'true',
    BOOTSTRAP_ADMIN_EMAIL: 'Admin@Example.com',
    BOOTSTRAP_ADMIN_PASSWORD: 'A bootstrap password 1',
    BOOTSTRAP_ADMIN_NAME: 'Studio Admin',
  };
  try {
    assert.equal((await db.prepare('SELECT count(*) AS count FROM users').first<{ count: number }>())?.count, 0);

    // Any API request can trigger provisioning in serverless runtimes; self-hosted Node also
    // provisions explicitly before it starts accepting traffic.
    const login = await app.request('https://studio.example/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: 'https://studio.example' },
      body: JSON.stringify({ email: 'admin@example.com', password: 'A bootstrap password 1' }),
    }, env);
    assert.equal(login.status, 200);
    const cookie = login.headers.get('set-cookie')!.split(';')[0];

    const stored = await db.prepare('SELECT id,email,name,password FROM users WHERE email=?')
      .bind('admin@example.com')
      .first<{ id: string; email: string; name: string; password: string }>();
    assert.ok(stored);
    assert.equal(stored.email, 'admin@example.com');
    assert.equal(stored.name, 'Studio Admin');
    assert.ok(stored.password.startsWith('pbkdf2:100000:'));
    assert.ok(!stored.password.includes('A bootstrap password 1'));

    const config = await app.request('https://studio.example/api/config', {
      headers: { Cookie: cookie },
    }, env);
    assert.equal(config.status, 200);
    const body = await config.json() as any;
    assert.equal(body.community.operator, true);
    assert.equal(body.observability.operator, true);
  } finally {
    db.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test('bootstrap admin is idempotent and never resets an existing password', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'design-studio-admin-existing-'));
  const path = join(dir, 'studio.db');
  let db = new SqliteDatabase(path);
  await migrate(db);
  const first: Bindings = {
    DB: db,
    ASSETS_BUCKET: new FileBucket(join(dir, 'assets')),
    BOOTSTRAP_ADMIN_EMAIL: 'admin@example.com',
    BOOTSTRAP_ADMIN_PASSWORD: 'Original password 123',
    BOOTSTRAP_ADMIN_NAME: 'Admin',
  };
  try {
    const created = await ensureBootstrapAdmin(first);
    assert.equal(created?.created, true);
    const originalHash = (await db.prepare('SELECT password FROM users WHERE email=?').bind('admin@example.com').first<{ password: string }>())!.password;
    assert.equal(await passwordMatches('Original password 123', originalHash), true);
    db.close();

    // Simulate a process restart with a new database binding and a changed environment secret.
    db = new SqliteDatabase(path);
    const restarted: Bindings = {
      ...first,
      DB: db,
      BOOTSTRAP_ADMIN_PASSWORD: 'Different password 456',
      BOOTSTRAP_ADMIN_NAME: 'Renamed by env',
    };
    const existing = await ensureBootstrapAdmin(restarted);
    assert.equal(existing?.created, false);
    const afterHash = (await db.prepare('SELECT password,name FROM users WHERE email=?').bind('admin@example.com').first<{ password: string; name: string }>())!;
    assert.equal(afterHash.password, originalHash);
    assert.equal(afterHash.name, 'Admin');
    assert.equal(await passwordMatches('Original password 123', afterHash.password), true);
    assert.equal(await passwordMatches('Different password 456', afterHash.password), false);
  } finally {
    db.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test('bootstrap admin requires email and password together', () => {
  const fake = {
    DB: {} as Bindings['DB'],
    ASSETS_BUCKET: {} as Bindings['ASSETS_BUCKET'],
    BOOTSTRAP_ADMIN_EMAIL: 'admin@example.com',
  } satisfies Bindings;
  assert.throws(() => ensureBootstrapAdmin(fake), /must be configured together/);
});
