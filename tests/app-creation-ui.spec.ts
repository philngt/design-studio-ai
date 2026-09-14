import { test, expect } from '@playwright/test';

test('App creation exposes mobile, tablet, and desktop targets', async ({ page }) => {
  await page.goto('/');

  await page.getByRole('group', { name: 'Design type' }).getByRole('button', { name: 'App' }).click();

  const targets = page.getByRole('group', { name: 'App platform' });
  await expect(targets.getByRole('button', { name: 'Mobile' })).toBeVisible();
  await expect(targets.getByRole('button', { name: 'Tablet' })).toBeVisible();
  await expect(targets.getByRole('button', { name: 'Desktop' })).toBeVisible();
  await expect(targets.getByRole('button', { name: 'Mobile' })).toHaveClass(/selected/);

  await targets.getByRole('button', { name: 'Tablet' }).click();
  await expect(targets.getByRole('button', { name: 'Tablet' })).toHaveClass(/selected/);
});
