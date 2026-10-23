import { expect, test, type Page } from '@playwright/test';
import { createDocument, createElement } from '../../src/core/model';
import { encodeDocument } from '../../src/core/codec';

async function seed(page: Page, mobile = false): Promise<void> {
  const doc = createDocument('Selection toolbar');
  doc.elements = [[450, 250], [650, 300], [900, 350]].map(([x, y], i) => createElement('rect', { id: `object-${i}`, x, y, w: 80, h: 60, fill: '#e6eee5', order: i }));
  if (mobile) doc.camera = { x: -200, y: 0, zoom: .5 };
  await page.goto('/'); await expect(page.locator('#save-status')).toContainText('已保存在本机');
  await page.locator('#import-file').setInputFiles({ name: 'selection.inkisle', mimeType: 'application/octet-stream', buffer: Buffer.from(encodeDocument(doc)) });
  await expect(page.locator('#toast')).toContainText('画板已导入');
}

test('the original left panel keeps its controls and order while new commands appear beside a multi-selection', async ({ page }) => {
  await seed(page);
  await expect(page.locator('#properties #group-button, #properties #ungroup-button, #properties [data-align]')).toHaveCount(0);
  expect(await page.locator('#property-content > div').evaluateAll(nodes => ({ first: nodes[0].querySelector('#stroke-colors') !== null, actionsAtEnd: nodes[nodes.length - 2].id === 'selection-actions' }))).toEqual({ first: true, actionsAtEnd: true });
  await page.mouse.click(490, 280); await expect(page.locator('#selection-toolbar')).toBeHidden();
  const singleHeight = await page.locator('#property-content').evaluate(el => el.scrollHeight);
  await page.keyboard.press('Control+a');
  await expect(page.locator('#selection-toolbar')).toBeVisible();
  expect(await page.locator('#property-content').evaluate(el => el.scrollHeight)).toBe(singleHeight);
  await expect(page.locator('#group-button')).toBeVisible(); await expect(page.locator('#ungroup-button')).toBeHidden();
  const bar = (await page.locator('#selection-toolbar').boundingBox())!, panel = (await page.locator('#properties').boundingBox())!;
  expect(bar.x).toBeGreaterThan(panel.x + panel.width);
  expect(bar.y + bar.height).toBeLessThan(250);
  await page.locator('#group-button').click();
  await expect(page.locator('#ungroup-button')).toBeVisible(); await expect(page.locator('#group-button')).toBeHidden();
  await page.locator('#ungroup-button').click();
  await expect(page.locator('#selection-label')).toHaveText('已选择 3 个元素');
});

test('the selection toolbar follows edits and the camera, hiding during dragging and outside the viewport', async ({ page }) => {
  await seed(page); await page.keyboard.press('Control+a');
  await expect(page.locator('#selection-toolbar')).toBeVisible();
  const before = (await page.locator('#selection-toolbar').boundingBox())!;
  await page.mouse.move(490, 280); await page.mouse.down(); await page.mouse.move(520, 300);
  await expect(page.locator('#selection-toolbar')).toBeHidden(); await page.mouse.up();
  await expect(page.locator('#selection-toolbar')).toBeVisible();
  const moved = (await page.locator('#selection-toolbar').boundingBox())!;
  expect(moved.x - before.x).toBeCloseTo(30, 0); expect(moved.y - before.y).toBeCloseTo(20, 0);
  await page.mouse.move(1100, 600); await page.mouse.wheel(100, 80);
  await expect.poll(async () => Math.round((await page.locator('#selection-toolbar').boundingBox())!.x)).not.toBe(Math.round(moved.x));
  await page.mouse.wheel(5000, 5000); await expect(page.locator('#selection-toolbar')).toBeHidden();
});

test('the floating controls and alignment menu remain usable in a small viewport', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 }); await seed(page, true);
  await page.keyboard.press('Control+a'); await expect(page.locator('#selection-toolbar')).toBeVisible();
  await page.locator('#alignment-trigger').click();
  for (const selector of ['#selection-toolbar', '#alignment-controls']) {
    const rect = (await page.locator(selector).boundingBox())!;
    expect(rect.x).toBeGreaterThanOrEqual(12); expect(rect.x + rect.width).toBeLessThanOrEqual(308);
    expect(rect.y).toBeGreaterThanOrEqual(12); expect(rect.y + rect.height).toBeLessThanOrEqual(556);
  }
  await page.keyboard.press('Escape'); await expect(page.locator('#alignment-controls')).toBeHidden();
  await expect(page.locator('#selection-label')).toHaveText('已选择 3 个元素');
  await page.keyboard.press('Enter'); await expect(page.locator('#alignment-controls')).toBeVisible();
  await page.getByRole('button', { name: '顶端对齐', exact: true }).focus(); await page.keyboard.press('Enter');
  await expect(page.locator('#alignment-controls')).toBeHidden();
  await expect(page.locator('#save-status')).toContainText('已保存在本机');
});
