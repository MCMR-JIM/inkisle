import { expect, test, type Page } from '@playwright/test';
import { chooseTool, contextAction } from './helpers';

async function centered(page: Page, selector = '#properties'): Promise<void> {
  await expect.poll(async () => {
    const box = (await page.locator(selector).boundingBox())!;
    return Math.abs(box.y + box.height / 2 - page.viewportSize()!.height / 2);
  }).toBeLessThan(1);
}

test('the style panel and collapsed launcher stay vertically centered as viewport and content heights change', async ({ page }) => {
  await page.goto('/'); await expect(page.locator('#save-status')).toContainText('已保存在本机');
  await page.locator('#quick-new').click();
  for (const viewport of [{ width: 1440, height: 960 }, { width: 1920, height: 1080 }, { width: 1024, height: 720 }, { width: 390, height: 844 }, { width: 320, height: 568 }]) {
    await page.setViewportSize(viewport);
    if (await page.locator('#properties').isHidden()) await page.locator('#expand-properties').click();
    await centered(page);
    await chooseTool(page, '画笔'); await expect(page.locator('#pressure-setting')).toBeVisible(); await centered(page);
    const box = (await page.locator('#properties').boundingBox())!;
    expect(box.y).toBeGreaterThanOrEqual(150); expect(box.y + box.height).toBeLessThan(viewport.height - 65);
    await page.locator('#collapse-properties').click(); await centered(page, '#expand-properties');
    await page.locator('#expand-properties').click(); await centered(page);
    await page.locator('#theme-button').click(); await centered(page);
  }
});

test('styles scroll inside a centered short panel while object commands remain in the context menu', async ({ page }) => {
  await page.goto('/'); await page.locator('#quick-new').click(); await chooseTool(page, '矩形');
  await page.mouse.move(500, 300); await page.mouse.down(); await page.mouse.move(720, 450); await page.mouse.up();
  await chooseTool(page, '选择工具'); await page.mouse.click(600, 300); await centered(page);
  await page.setViewportSize({ width: 1024, height: 600 }); await centered(page);
  const scrolling = await page.locator('#property-content').evaluate(el => ({ content: el.scrollHeight, viewport: el.clientHeight, overflow: getComputedStyle(el).overflowY }));
  expect(scrolling.content).toBeGreaterThan(scrolling.viewport); expect(scrolling.overflow).toBe('auto');
  await page.locator('#opacity').scrollIntoViewIfNeeded(); await expect(page.locator('#opacity')).toBeInViewport();
  const panel = (await page.locator('#properties').boundingBox())!, bottom = (await page.locator('.bottom-left').boundingBox())!;
  expect(panel.y + panel.height).toBeLessThan(bottom.y);
  await contextAction(page, 'delete'); await expect(page.locator('#element-count')).toHaveText('0 个元素'); await centered(page);
});

test('an open color picker tracks the panel when its content height changes without resizing the viewport', async ({ page }) => {
  await page.goto('/'); await page.locator('#quick-new').click(); await page.locator('#stroke-palette').click();
  const before = (await page.locator('#properties').boundingBox())!;
  // A click activation without pointerdown leaves the popover open while the
  // actual tool state changes and reveals pressure settings.
  await page.locator('[data-family="pen"]').dispatchEvent('click');
  await expect(page.locator('#pressure-setting')).toBeVisible();
  await expect(page.locator('#stroke-picker')).toBeVisible();
  await expect.poll(async () => {
    const panel = (await page.locator('#properties').boundingBox())!, picker = (await page.locator('#stroke-picker').boundingBox())!;
    return Math.abs(panel.y - picker.y);
  }).toBeLessThan(1);
  expect((await page.locator('#properties').boundingBox())!.y).toBeLessThan(before.y);
});
