import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { app } from '../server/index';
import { FileBucket, SqliteDatabase } from '../server/node-adapters';
import { secret } from '../server/security';
import { designStrategyBodySchema, type StrategyTarget } from '../src/shared/design-strategy';
import type { Bindings } from '../server/types';

async function migrate(db: SqliteDatabase) {
  for (const migration of (await readdir(new URL('../migrations/', import.meta.url))).filter(name => name.endsWith('.sql')).sort())
    await db.exec(await readFile(new URL(`../migrations/${migration}`, import.meta.url), 'utf8'));
}

function strategy(target: StrategyTarget = 'web') {
  return designStrategyBodySchema.parse({
    userJob: { primary: 'Know the current shipment state quickly.', secondary: ['Create a new shipment.'] },
    businessGoal: { primary: 'Increase successful shipment completion.', secondary: ['Increase repeat usage.'] },
    evidence: { facts: ['The product has an active-shipment state.'], measurements: [], assumptions: ['Returning users prioritize current status.'] },
    mechanisms: [{ observation: 'Current status competes with promotional content.', mechanism: 'Competing focal surfaces slow first-glance recognition.', principle: 'Give the dominant recurring task the strongest visual priority.' }],
    informationHierarchy: { primary: ['Active shipment state'], secondary: ['Send parcel'], contextual: ['Pickup promotion'], rare: ['Account management'] },
    attentionStrategy: ['Shipment state wins first glance.', 'Promotion remains visually quieter than task state.'],
    navigationStrategy: ['Keep frequent destinations persistent and shallow.'],
    interactionStrategy: ['Expose the primary action directly and progressively disclose rare actions.'],
    layoutStrategy: { model: 'task-first home', density: 'medium', grouping: ['Identity and search', 'Primary actions', 'Active shipment', 'Contextual services'] },
    visualStrategy: { focalSurface: 'Active shipment', contrast: 'Use strongest contrast for current task state.', brandPresence: 'medium', illustrationRole: 'Explain service context rather than decorate empty space.' },
    platformAdaptation: [{ target, decisions: ['Adapt navigation, density, and persistence to the target capabilities.'] }],
    alternatives: [
      { id: 'tracking_first', name: 'Tracking first', summary: 'Prioritize current shipment state before promotion.', tradeoffs: ['Best for repeat task speed.', 'Less promotional prominence.'] },
      { id: 'conversion_first', name: 'Conversion first', summary: 'Prioritize creating a new shipment before current status.', tradeoffs: ['Stronger conversion pressure.', 'Slower repeat status scanning.'] },
    ],
    decision: { selectedAlternativeId: 'tracking_first', rationale: ['It best matches the assumed dominant returning-user job.'], rejected: ['Conversion first depends on an unverified acquisition assumption.'] },
    successCriteria: ['A returning user can identify shipment state without opening another screen.'],
    validationPlan: ['Measure time-to-identify shipment state; until analytics exist, use a labeled first-glance heuristic review.'],
  });
}

test('design strategy is versioned, approval-gated, and stale when the brief changes', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'design-studio-strategy-'));
  const db = new SqliteDatabase(join(dir, 'studio.db'));
  await migrate(db);
  const env: Bindings = {
    DB: db,
    ASSETS_BUCKET: new FileBucket(join(dir, 'assets')),
    APP_URL: 'https://studio.example',
    ALLOW_REGISTRATION: 'true',
    ENCRYPTION_KEY: secret(),
  };
  const request = (path: string, method = 'GET', body?: unknown, cookie?: string) => app.request(`https://studio.example${path}`, {
    method,
    headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), Origin: 'https://studio.example', ...(cookie ? { Cookie: cookie } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }, env);
  try {
    const register = await request('/api/auth/register', 'POST', { email: 'strategy@example.com', password: 'A secure strategy password 1', name: 'Strategy' });
    assert.equal(register.status, 201);
    const cookie = register.headers.get('set-cookie')!.split(';')[0];
    const created = await request('/api/projects', 'POST', { name: 'Parcel web', kind: 'web' }, cookie);
    assert.equal(created.status, 201);
    const project = (await created.json() as any).project;
    const scope = { objective: 'Design parcel tracking home', audience: 'Returning customers', direction: 'Task-first and calm', deliverables: ['Home screen'], constraints: ['Keep current data model'], acceptanceCriteria: ['Shipment state is immediately legible'] };
    const briefDraft = await request(`/api/projects/${project.id}/brief`, 'PUT', { expectedRevision: 0, request: 'Design a parcel tracking home', interview: { message: 'Scope ready', questions: [], scope }, scope }, cookie);
    assert.equal(briefDraft.status, 200);
    assert.equal((await briefDraft.json() as any).brief.revision, 1);
    const briefApproved = await request(`/api/projects/${project.id}/brief/approve`, 'POST', { expectedRevision: 1 }, cookie);
    assert.equal(briefApproved.status, 200);
    assert.equal((await briefApproved.json() as any).brief.revision, 2);

    const draft = await request(`/api/projects/${project.id}/strategy`, 'PUT', { expectedRevision: 0, expectedBriefRevision: 2, strategy: strategy() }, cookie);
    assert.equal(draft.status, 200);
    const draftBody = (await draft.json() as any).strategy;
    assert.equal(draftBody.status, 'draft');
    assert.equal(draftBody.revision, 1);
    assert.equal(draftBody.sourceBriefRevision, 2);

    const approved = await request(`/api/projects/${project.id}/strategy/approve`, 'POST', { expectedRevision: 1, expectedBriefRevision: 2 }, cookie);
    assert.equal(approved.status, 200);
    const approvedBody = (await approved.json() as any).strategy;
    assert.equal(approvedBody.status, 'approved');
    assert.equal(approvedBody.revision, 2);
    assert.ok(approvedBody.approvedAt);

    const edited = await request(`/api/projects/${project.id}/strategy`, 'PUT', { expectedRevision: 2, expectedBriefRevision: 2, strategy: strategy() }, cookie);
    assert.equal(edited.status, 200);
    assert.equal((await edited.json() as any).strategy.status, 'draft');

    const changedBrief = await request(`/api/projects/${project.id}/brief`, 'PUT', { expectedRevision: 2, scope: { ...scope, direction: 'Task-first with stronger brand presence' } }, cookie);
    assert.equal(changedBrief.status, 200);
    assert.equal((await changedBrief.json() as any).brief.revision, 3);
    const reapprovedBrief = await request(`/api/projects/${project.id}/brief/approve`, 'POST', { expectedRevision: 3 }, cookie);
    assert.equal(reapprovedBrief.status, 200);
    assert.equal((await reapprovedBrief.json() as any).brief.revision, 4);

    const stale = await request(`/api/projects/${project.id}/strategy/approve`, 'POST', { expectedRevision: 3, expectedBriefRevision: 4 }, cookie);
    assert.equal(stale.status, 409);
    assert.equal((await stale.json() as any).error.code, 'strategy_stale');
  } finally {
    db.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test('App strategy must adapt exactly the selected target manifests', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'design-studio-strategy-app-'));
  const db = new SqliteDatabase(join(dir, 'studio.db'));
  await migrate(db);
  const env: Bindings = { DB: db, ASSETS_BUCKET: new FileBucket(join(dir, 'assets')), APP_URL: 'https://studio.example', ALLOW_REGISTRATION: 'true', ENCRYPTION_KEY: secret() };
  const request = (path: string, method = 'GET', body?: unknown, cookie?: string) => app.request(`https://studio.example${path}`, { method, headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), Origin: 'https://studio.example', ...(cookie ? { Cookie: cookie } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }, env);
  try {
    const register = await request('/api/auth/register', 'POST', { email: 'app-strategy@example.com', password: 'A secure app strategy 1' });
    const cookie = register.headers.get('set-cookie')!.split(';')[0];
    const created = await request('/api/projects', 'POST', { name: 'Parcel app', kind: 'app' }, cookie);
    assert.equal(created.status, 201);
    const project = (await created.json() as any).project;
    const targets = project.document.app.targets as StrategyTarget[];
    assert.ok(targets.length > 0);
    const scope = { objective: 'Design parcel app', audience: 'Customers', direction: 'Task first', deliverables: ['Home'], constraints: [], acceptanceCriteria: ['Works on selected targets'] };
    await request(`/api/projects/${project.id}/brief`, 'PUT', { expectedRevision: 0, request: 'Design parcel app', interview: { message: 'Ready', questions: [], scope }, scope }, cookie);
    await request(`/api/projects/${project.id}/brief/approve`, 'POST', { expectedRevision: 1 }, cookie);

    const wrongTarget: StrategyTarget = targets.includes('web') ? 'mobile' : 'web';
    const invalid = await request(`/api/projects/${project.id}/strategy`, 'PUT', { expectedRevision: 0, expectedBriefRevision: 2, strategy: strategy(wrongTarget) }, cookie);
    assert.equal(invalid.status, 400);
    assert.equal((await invalid.json() as any).error.code, 'strategy_targets_mismatch');
  } finally {
    db.close();
    await rm(dir, { recursive: true, force: true });
  }
});
