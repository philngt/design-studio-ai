import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDocument, templates } from '../src/shared/catalog';
import { documentSchema } from '../src/shared/schema';

const targets = {
  mobile: { template: 'app-mobile', width: 393, height: 852 },
  tablet: { template: 'app-tablet', width: 1024, height: 1366 },
  desktop: { template: 'app-desktop', width: 1440, height: 900 },
} as const;

test('app templates create platform-specific valid documents', () => {
  for (const [platform, target] of Object.entries(targets)) {
    const document = createDocument('app', `${platform} app`, 'swiss', target.template);
    assert.equal(document.kind, 'app');
    assert.equal(document.app?.platform, platform);
    assert.equal(document.pages[0].width, target.width);
    assert.equal(document.pages[0].height, target.height);
    assert.equal(documentSchema.safeParse(document).success, true);
  }
});

test('app templates are discoverable without replacing legacy wireframes', () => {
  assert.deepEqual(
    templates.filter(template => template.kind === 'app').map(template => template.id),
    ['app-mobile', 'app-tablet', 'app-desktop'],
  );
  assert.equal(templates.find(template => template.id === 'app-wireframe')?.kind, 'wireframe');
});

test('app platform metadata is required only for app documents', () => {
  const app = createDocument('app', 'App', 'swiss', 'app-mobile');
  const missingPlatform = { ...app };
  delete missingPlatform.app;
  assert.equal(documentSchema.safeParse(missingPlatform).success, false);

  const web = createDocument('web', 'Site');
  assert.equal(documentSchema.safeParse({ ...web, app: { platform: 'mobile' } }).success, false);
});
