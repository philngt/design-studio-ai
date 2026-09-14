import { test, expect } from '@playwright/test';

test('App creation exposes mobile, tablet, and desktop as one target choice', async ({ page }) => {
  await page.goto('/');

  await page.getByRole('group', { name: 'Design type' }).getByRole('button', { name: 'App' }).click();

  const target = page.getByRole('combobox', { name: 'App target' });
  await expect(target).toBeVisible();
  await expect(target).toHaveValue('mobile');
  await expect(target.locator('option')).toHaveCount(3);
  await expect(target.locator('option').nth(0)).toHaveText('Mobile');
  await expect(target.locator('option').nth(1)).toHaveText('Tablet');
  await expect(target.locator('option').nth(2)).toHaveText('Desktop');

  await target.selectOption('tablet');
  await expect(target).toHaveValue('tablet');
});
