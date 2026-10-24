import { expect, test, type Page } from '@playwright/test';
import { selectValue } from './helpers';

async function camera(page: Page): Promise<{ x: number; y: number; zoom: number }> {
  await expect(page.locator('#save-status')).toHaveAttribute('data-state', 'saved');
  return page.evaluate(async () => {
    const path = '/src/storage/repository.ts'; const { Repository } = await import(/* @vite-ignore */ path);
    const repo = new Repository(); try { return (await repo.load(localStorage.getItem('liubai:last-board'))).camera; } finally { repo.close(); }
  });
}

test('zoom presets open upward at the original width and preserve the world point at the screen center', async ({ page }) => {
  await page.goto('/'); await expect(page.locator('#save-status')).toHaveAttribute('data-state', 'saved');
  await page.locator('#zoom-in').click();
  await page.keyboard.down('Space'); await page.mouse.move(950, 500); await page.mouse.down(); await page.mouse.move(1080, 560); await page.mouse.up(); await page.keyboard.up('Space');
  const before = await camera(page);
  const trigger = page.locator('#zoom-value'); const box = (await trigger.boundingBox())!;
  expect(box.width).toBe(49); await expect(trigger.locator('svg')).toHaveCount(0);
  await trigger.click(); await expect(trigger).toHaveText(`${Number((before.zoom * 100).toFixed(1))}%`);
  const list = page.locator('#zoom-value-options'); const menu = (await list.boundingBox())!;
  const row = (await page.locator('.zoom-steps').boundingBox())!;
  expect(menu.y + menu.height).toBeLessThanOrEqual(row.y);
  expect(menu.x).toBeCloseTo(row.x, 2); expect(menu.width).toBeCloseTo(row.width, 2);
  await expect(list.getByRole('option')).toHaveText(['25%', '50%', '75%', '100%', '125%', '150%', '200%', '400%']);
  await list.getByRole('option', { name: '200%', exact: true }).click();
  const after = await camera(page); expect(after.zoom).toBe(2);
  for (const [axis, center] of [['x', 720], ['y', 480]] as const) expect((center - after[axis]) / after.zoom).toBeCloseTo((center - before[axis]) / before.zoom, 7);
  await page.reload(); await expect(trigger).toHaveText('200%');
});

test('wheel zoom shows exact nonpreset values without growing the menu and keyboard presets retain canvas shortcuts', async ({ page }) => {
  await page.goto('/'); await expect(page.locator('#save-status')).toHaveAttribute('data-state', 'saved');
  await page.mouse.move(800, 500); await page.keyboard.down('Control'); await page.mouse.wheel(0, -100); await page.keyboard.up('Control');
  await camera(page);
  const label = await page.locator('#zoom-value').textContent(); expect(label).toMatch(/^[\d.]+%$/);
  await page.locator('#zoom-value').click(); await expect(page.locator('#zoom-value-options [role="option"]')).toHaveCount(8);
  await page.locator('#zoom-value').press('End'); await page.locator('#zoom-value').press('Enter'); await expect(page.locator('#zoom-value')).toHaveText('400%');
  await page.mouse.click(1200, 700); await page.keyboard.press('Shift+0'); await expect(page.locator('#zoom-value')).toHaveText('100%');
});

test('workspace and export controls share the combobox, work inside modals, and close menus before dialogs', async ({ page }) => {
  await page.goto('/'); await expect(page.locator('#save-status')).toHaveAttribute('data-state', 'saved');
  await expect(page.locator('select')).toHaveCount(0);
  for (const id of ['font-size', 'zoom-value', 'library-sort', 'toolbar-position', 'export-scope', 'export-format', 'export-background', 'export-scale']) await expect(page.locator(`#${id}`)).toHaveAttribute('role', 'combobox');
  await page.locator('#workspace-settings-button').click(); await page.locator('#toolbar-position').click();
  await expect(page.locator('#workspace-settings-dialog #toolbar-position-options')).toBeVisible();
  await page.locator('#toolbar-position').press('Escape'); await expect(page.locator('#toolbar-position-options')).toBeHidden(); await expect(page.locator('#workspace-settings-dialog')).toBeVisible();
  await selectValue(page, '#toolbar-position', 'top'); await expect(page.locator('html')).toHaveAttribute('data-toolbar-position', 'top');
  await page.getByRole('button', { name: '关闭工作区设置', exact: true }).click();
  await page.locator('#export-button').click(); await page.locator('[data-action="export-png"]').click();
  await selectValue(page, '#export-background', 'transparent'); await selectValue(page, '#export-scale', 3);
  await expect(page.locator('#confirm-export')).toBeEnabled();
  await selectValue(page, '#export-format', 'svg'); await expect(page.locator('#export-scale')).toBeDisabled();
  await expect(page.locator('#export-dimensions')).toContainText('矢量图'); await expect(page.locator('#confirm-export')).toHaveText('导出 SVG');
  await selectValue(page, '#export-format', 'png'); await expect(page.locator('#export-scale')).toBeEnabled();
  await expect(page.locator('#export-scale')).toHaveText('3×');
  await page.locator('#export-scope').click(); await expect(page.getByRole('option', { name: '已选对象', exact: true })).toBeDisabled();
  await page.locator('#export-scope').press('End'); await page.locator('#export-scope').press('Enter');
  await expect(page.locator('#export-scope')).toHaveText('整个画板'); await expect(page.locator('#confirm-export')).toBeEnabled();
  await page.locator('#export-format').focus(); await page.keyboard.press('Enter'); await page.keyboard.press('s'); await page.keyboard.press('Enter');
  await expect(page.locator('#export-format')).toHaveText('SVG 矢量图'); await expect(page.locator('#export-options-dialog')).toBeVisible();
  await page.reload(); await expect(page.locator('html')).toHaveAttribute('data-toolbar-position', 'top');
});

test('only one menu opens and zoom and modal menus remain aligned inside mobile viewports', async ({ page }) => {
  await page.goto('/'); await expect(page.locator('#save-status')).toHaveAttribute('data-state', 'saved');
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    for (const dark of [false, true]) {
      if ((await page.locator('html').getAttribute('data-theme') === 'dark') !== dark) await page.locator('#theme-button').click();
      await page.locator('#zoom-value').click();
      const row = (await page.locator('.zoom-steps').boundingBox())!, menu = (await page.locator('#zoom-value-options').boundingBox())!;
      expect(menu.x).toBeCloseTo(row.x, 2); expect(menu.width).toBeCloseTo(row.width, 2);
      expect((await page.locator('#zoom-value').boundingBox())!.width).toBe(42);
      await page.locator('#zoom-value').press('Escape');
      await page.locator('#workspace-settings-button').click(); await page.locator('#toolbar-position').click();
      const options = (await page.locator('#toolbar-position-options').boundingBox())!;
      expect(options.x).toBeGreaterThanOrEqual(8); expect(options.x + options.width).toBeLessThanOrEqual(width - 8);
      expect(options.y).toBeGreaterThanOrEqual(8); expect(options.y + options.height).toBeLessThanOrEqual(836);
      await page.getByRole('option', { name: '底部', exact: true }).click(); await page.getByRole('button', { name: '关闭工作区设置', exact: true }).click();
    }
  }
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.locator('#font-size').click(); await page.locator('#zoom-value').click();
  await expect(page.locator('.select-options:visible')).toHaveCount(1); await expect(page.locator('#font-size-options')).toBeHidden();
  await page.setViewportSize({ width: 1000, height: 800 }); await expect(page.locator('.select-options:visible')).toHaveCount(0);
});
