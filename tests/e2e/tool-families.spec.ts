import { expect, test } from '@playwright/test';

test('opens the shapes family and chooses a hexagon', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '新建画板', exact: true }).first().click();
  await page.getByRole('button', { name: '图形', exact: true }).click();
  await expect(page.getByRole('menu', { name: '图形工具' })).toBeVisible();
  await page.getByRole('button', { name: '六边形', exact: true }).click();
  await expect(page.getByRole('menu', { name: '图形工具' })).toBeVisible();
  await page.mouse.move(500, 300); await page.mouse.down(); await page.mouse.move(700, 450); await page.mouse.up();
  await expect(page.locator('#element-count')).toHaveText('1 个元素');
  await expect(page.getByRole('menu', { name: '图形工具' })).toBeVisible();
  await page.getByRole('button', { name: '椭圆', exact: true }).click();
  await expect(page.locator('[data-tool-child="ellipse"]')).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('menu', { name: '图形工具' })).toBeVisible();
});

test('keeps line options available after choosing and closes explicitly with the category button or Escape', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '新建画板', exact: true }).first().click();
  await page.locator('[data-family="lines"]').click();
  await expect(page.getByRole('menu', { name: '直线工具' })).toBeVisible();
  await page.getByRole('button', { name: '双向箭头', exact: true }).click();
  await expect(page.getByRole('menu', { name: '直线工具' })).toBeVisible();
  await page.locator('[data-family="lines"]').click();
  await expect(page.getByRole('menu', { name: '直线工具' })).not.toBeVisible();
  await page.locator('[data-family="lines"]').click();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('menu', { name: '直线工具' })).not.toBeVisible();
  await page.getByRole('button', { name: '图形', exact: true }).click();
  await page.mouse.click(1000, 700);
  await expect(page.getByRole('menu', { name: '图形工具' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('menu', { name: '图形工具' })).not.toBeVisible();
});
