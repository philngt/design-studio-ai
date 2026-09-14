import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDocument, templates } from '../src/shared/catalog';
import { appTargetManifests } from '../src/shared/app-target-manifests';
import { documentSchema } from '../src/shared/schema';

const targets = {
  mobile: { template: 'app-mobile', width: 393, height: 852 },
  tablet: { template: 'app-tablet', width: 1024, height: 1366 },
  desktop: { template: 'app-desktop', width: 1440, height: 900 },
} as const;

test('single-target app templates create a selected target plus its agent manifest', () => {
  for (const [platform, target] of Object.entries(targets)) {
    const document = createDocument('app', `${platform} app`, 'swiss', target.template);
    assert.equal(document.kind, 'app');
    assert.deepEqual(document.app?.targets, [platform]);
    assert.deepEqual(document.app?.manifests, [appTargetManifests[platform as keyof typeof appTargetManifests]]);
    assert.equal(document.pages[0].width, target.width);
    assert.equal(document.pages[0].height, target.height);
    assert.equal(documentSchema.safeParse(document).success, true);
  }
});

test('one app can target mobile, tablet, and desktop together', () => {
  const document = createDocument('app', 'Everywhere', 'swiss', undefined, ['mobile', 'tablet', 'desktop']);
  assert.deepEqual(document.app?.targets, ['mobile', 'tablet', 'desktop']);
  assert.deepEqual(document.app?.manifests.map(manifest => manifest.target), ['mobile', 'tablet', 'desktop']);
  assert.deepEqual(document.pages.map(page => [page.name, page.width, page.height]), [
    ['Mobile app', 393, 852],
    ['Tablet app', 1024, 1366],
    ['Desktop app', 1440, 900],
  ]);
  assert.ok(document.app?.manifests.every(manifest => manifest.strategy.length > 0));
  assert.equal(documentSchema.safeParse(document).success, true);
});

test('app templates remain implementation presets, not separate project kinds', () => {
  assert.deepEqual(
    templates.filter(template => template.kind === 'app').map(template => template.id),
    ['app-mobile', 'app-tablet', 'app-desktop'],
  );
  assert.equal(new Set(templates.filter(template => template.kind === 'app').map(template => template.kind)).size, 1);
  assert.equal(templates.find(template => template.id === 'app-wireframe')?.kind, 'wireframe');
});

test('app manifest targets and snapshots must stay aligned', () => {
  const app = createDocument('app', 'App', 'swiss', undefined, ['mobile', 'tablet']);
  const missingManifest = structuredClone(app);
  missingManifest.app!.manifests = missingManifest.app!.manifests.slice(0, 1);
  assert.equal(documentSchema.safeParse(missingManifest).success, false);

  const duplicateTarget = structuredClone(app);
  duplicateTarget.app!.targets = ['mobile', 'mobile'];
  assert.equal(documentSchema.safeParse(duplicateTarget).success, false);

  const missingApp = structuredClone(app);
  delete missingApp.app;
  assert.equal(documentSchema.safeParse(missingApp).success, false);

  const web = createDocument('web', 'Site');
  assert.equal(documentSchema.safeParse({ ...web, app: app.app }).success, false);
});
