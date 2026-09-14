import { test, expect } from '@playwright/test';

test('App creation exposes mobile, tablet, and desktop as one target choice', async ({ page }) => {
  await page.goto('/');

  await page.getByRole('group', { name: 'Design type' }).getByRole('button', { name: 'App' }).click();

  const target = page.getByRole('combobox', { name: 'App target' });
  await expect(target).toBeVisible();
  await expect(target).toHaveValue('mobile');
  await expect(target.locator('option')).toHaveText(['Mobile', 'Tablet', 'Desktop']);

  await target.selectOption('tablet');
  await expect(target).toHaveValue('tablet');
});
