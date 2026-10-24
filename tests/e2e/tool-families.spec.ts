import { createBoard } from './helpers';
import { expect, test } from '@playwright/test';

test('choosing a shape or line family leaves the pen and restores the last child tool', async ({ page }) => {
  await page.goto('/'); await createBoard(page);
  for (const [family, child] of [['shapes', 'rect'], ['lines', 'line']]) {
    await page.keyboard.press('p'); await expect(page.locator('[data-family="pen"]')).toHaveAttribute('aria-pressed', 'true');
    await page.locator(`[data-family="${family}"]`).click();
    await expect(page.locator('[data-family="pen"]')).toHaveAttribute('aria-pressed', 'false');
    await expect(page.locator('#pressure-setting')).toBeHidden();
    await expect(page.locator(`[data-family="${family}"]`)).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator(`[data-tool-child="${child}"]`)).toHaveAttribute('aria-selected', 'true');
    await page.mouse.move(500, 300); await page.mouse.down(); await page.mouse.move(700, 450); await page.mouse.up();
    await expect(page.locator('#save-status')).toContainText('已保存在本机');
    const kind = await page.evaluate(async () => {
      const path = '/src/storage/repository.ts'; const { Repository } = await import(/* @vite-ignore */ path);
      const repo = new Repository(); const doc = await repo.load(localStorage.getItem('liubai:last-board')); repo.close(); return doc.elements.at(-1).kind;
    });
    expect(kind).toBe(child);
  }
  await page.locator('[data-family="shapes"]').click(); await page.locator('[data-tool-child="hexagon"]').click();
  await page.keyboard.press('p'); await page.locator('[data-family="shapes"]').click();
  await expect(page.locator('[data-tool-child="hexagon"]')).toHaveAttribute('aria-selected', 'true');
});

test('opens the shapes family and chooses a hexagon', async ({ page }) => {
  await page.goto('/');
  await createBoard(page);
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
  await createBoard(page);
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
