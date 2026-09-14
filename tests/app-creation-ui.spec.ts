import { test, expect } from '@playwright/test';

test('App creation supports multiple mobile, tablet, and desktop targets', async ({ page }) => {
  await page.goto('/');

  await page.getByRole('group', { name: 'Design type' }).getByRole('button', { name: 'App' }).click();

  const targets = page.getByRole('group', { name: 'App targets' }).first();
  const mobile = targets.getByRole('checkbox', { name: 'Mobile' });
  const tablet = targets.getByRole('checkbox', { name: 'Tablet' });
  const desktop = targets.getByRole('checkbox', { name: 'Desktop' });

  await expect(mobile).toBeChecked();
  await expect(tablet).not.toBeChecked();
  await expect(desktop).not.toBeChecked();

  await tablet.check();
  await desktop.check();
  await expect(mobile).toBeChecked();
  await expect(tablet).toBeChecked();
  await expect(desktop).toBeChecked();

  await mobile.uncheck();
  await tablet.uncheck();
  await expect(desktop).toBeChecked();
  await desktop.click();
  await expect(desktop).toBeChecked();

  await mobile.check();
  await page.getByRole('button', { name: "Let's create" }).click();
  const dialog = page.getByRole('dialog');
  const dialogTargets = dialog.getByRole('group', { name: 'App targets' });
  await expect(dialogTargets.getByRole('checkbox', { name: 'Mobile' })).toBeChecked();
  await expect(dialogTargets.getByRole('checkbox', { name: 'Tablet' })).not.toBeChecked();
  await expect(dialogTargets.getByRole('checkbox', { name: 'Desktop' })).toBeChecked();
});
