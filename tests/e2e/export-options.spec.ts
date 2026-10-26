import { expect, test } from '@playwright/test';
import { createBoard, chooseTool, selectValue } from './helpers';

test('PNG scope, padding, resolution and transparency match the export preview', async ({ page }) => {
  await page.goto('/'); await expect(page.locator('#save-status')).toContainText('已保存在本机');
  await createBoard(page); await expect(page.locator('#element-count')).toHaveText('0 个元素');
  await chooseTool(page, '矩形');
  for (const x of [500, 900]) { await page.mouse.move(x, 300); await page.mouse.down(); await page.mouse.move(x + 200, 400); await page.mouse.up(); }
  await chooseTool(page, '选择工具'); await page.mouse.click(600, 300);
  await page.locator('#export-button').click(); await page.locator('[data-action="export-png"]').click();
  await expect(page.locator('#export-scope')).toHaveText('已选对象');
  await selectValue(page, '#export-background', 'transparent'); await page.locator('#export-padding').fill('10');
  await selectValue(page, '#export-scale', '1');
  await expect(page.locator('#export-dimensions')).toContainText('222 × 122 px · 1 个元素');
  await selectValue(page, '#export-scope', 'all');
  await expect(page.locator('#export-dimensions')).toContainText('622 × 122 px · 2 个元素');
  await selectValue(page, '#export-scope', 'selection');
  const pending = page.waitForEvent('download'); await page.locator('#confirm-export').click(); const download = await pending;
  const stream = await download.createReadStream(); const parts = []; for await (const part of stream!) parts.push(part);
  const pixels = await page.evaluate(async base64 => {
    const image = new Image(); image.src = `data:image/png;base64,${base64}`; await image.decode();
    const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
    const ctx = canvas.getContext('2d')!; ctx.drawImage(image, 0, 0);
    return { width: image.width, height: image.height, cornerAlpha: ctx.getImageData(0, 0, 1, 1).data[3], strokeAlpha: ctx.getImageData(110, 10, 1, 1).data[3] };
  }, Buffer.concat(parts).toString('base64'));
  expect(pixels).toEqual({ width: 222, height: 122, cornerAlpha: 0, strokeAlpha: 255 });
});

test('SVG supports transparent export and an empty board cannot start an image export', async ({ page }) => {
  await page.goto('/'); await expect(page.locator('#save-status')).toContainText('已保存在本机');
  await createBoard(page); await expect(page.locator('#element-count')).toHaveText('0 个元素');
  await page.locator('#export-button').click(); await page.locator('[data-action="export-svg"]').click();
  await expect(page.locator('#confirm-export')).toBeDisabled(); await expect(page.locator('#export-dimensions')).toContainText('没有内容');
  await page.getByRole('button', { name: '关闭导出设置', exact: true }).click();
  await chooseTool(page, '矩形'); await page.mouse.move(500, 300); await page.mouse.down(); await page.mouse.move(700, 400); await page.mouse.up();
  await page.locator('#export-button').click(); await page.locator('[data-action="export-svg"]').click();
  await selectValue(page, '#export-background', 'transparent'); await page.locator('#export-padding').fill('0');
  await expect(page.locator('#export-scale')).toBeDisabled();
  const pending = page.waitForEvent('download'); await page.locator('#confirm-export').click(); const download = await pending;
  const stream = await download.createReadStream(); const parts = []; for await (const part of stream!) parts.push(part);
  const svg = Buffer.concat(parts).toString('utf8');
  expect(svg).not.toContain('fill="#f8f9f6"'); expect(svg).toContain('width="202"');
});
