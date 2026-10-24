import { expect, test } from '@playwright/test';
import { chooseTool } from './helpers';

test('InkIsle branding and .inkisle exports are consistent, while source files round-trip', async ({ page }) => {
  await page.goto('/'); await expect(page.locator('#save-status')).toContainText('已保存在本机');
  await expect(page.locator('#brand-button')).toContainText('墨屿');
  await expect(page).toHaveTitle(/墨屿/);
  await page.locator('#quick-new').click(); await expect(page.locator('#empty-state h1')).toContainText('墨屿');
  await chooseTool(page, '矩形'); await page.mouse.move(500, 300); await page.mouse.down(); await page.mouse.move(720, 450); await page.mouse.up();
  await page.locator('#board-title').fill('墨屿往返'); await page.locator('#board-title').dispatchEvent('change');
  await expect(page).toHaveTitle('墨屿往返 — 墨屿');
  await page.locator('#export-button').click();
  const downloading = page.waitForEvent('download'); await page.locator('[data-action="export-file"]').click(); const file = await downloading;
  expect(file.suggestedFilename()).toBe('墨屿往返.inkisle');
  await page.locator('#import-file').setInputFiles((await file.path())!); await expect(page.locator('#toast')).toContainText('画板已导入');
  await expect(page.locator('#element-count')).toHaveText('1 个元素');
  await expect(page.locator('#import-file')).toHaveAttribute('accept', '.inkisle,.liubai,.pdf');
  await page.locator('#export-button').click(); await expect(page.locator('[data-action="export-file"]')).toContainText('墨屿源文件');
  await expect(page.locator('[data-action="export-file"]')).toContainText('.inkisle');
  expect(await page.evaluate(() => (window as unknown as { inkisle: unknown; liubai: unknown }).inkisle === (window as unknown as { liubai: unknown }).liubai)).toBe(true);
});

test('legacy filename imports and new/old uppercase dropped files keep the same board payload', async ({ page }) => {
  await page.goto('/'); await expect(page.locator('#save-status')).toContainText('已保存在本机');
  const encoded = await page.evaluate(async () => {
    const load = (path: string) => import(/* @vite-ignore */ path);
    const { encodeDocument } = await load('/src/core/codec.ts'), { createDocument, createElement } = await load('/src/core/model.ts');
    const doc = createDocument('旧文件保留'); doc.elements = [createElement('note', { x: 500, y: 300, w: 230, h: 200, text: '从留白版本导入' })];
    return [...encodeDocument(doc)];
  });
  // LWB1 remains a stable container, irrespective of the marketing name.
  expect(encoded.slice(0, 4)).toEqual([0x4c, 0x57, 0x42, 0x31]);
  await page.locator('#import-file').setInputFiles({ name: '历史.LIUBAI', mimeType: 'application/octet-stream', buffer: Buffer.from(encoded) });
  await expect(page.locator('#board-title')).toHaveValue('旧文件保留');
  for (const suffix of ['INKISLE', 'LIUBAI']) {
    await page.locator('#quick-new').click(); await expect(page.locator('#element-count')).toHaveText('0 个元素');
    await page.locator('#workspace').evaluate((element, { bytes, suffix }) => {
      const data = new DataTransfer(); data.items.add(new File([new Uint8Array(bytes)], `画板.${suffix}`, { type: 'application/octet-stream' }));
      element.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: data, clientX: 800, clientY: 400 }));
    }, { bytes: encoded, suffix });
    await expect(page.locator('#board-title')).toHaveValue('旧文件保留'); await expect(page.locator('#element-count')).toHaveText('1 个元素');
  }
});

test('existing local preferences, board identity and both clipboard protocols survive the rename', async ({ page }) => {
  await page.addInitScript(() => { localStorage.setItem('liubai:theme', 'dark'); localStorage.setItem('liubai:pressure', 'false'); });
  await page.goto('/'); await expect(page.locator('#save-status')).toContainText('已保存在本机');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.locator('#quick-new').click(); await chooseTool(page, '矩形');
  await page.mouse.move(500, 300); await page.mouse.down(); await page.mouse.move(720, 450); await page.mouse.up();
  await chooseTool(page, '选择工具'); await page.mouse.click(600, 300);
  await expect(page.locator('#save-status')).toContainText('已保存在本机');
  const board = await page.evaluate(() => localStorage.getItem('liubai:last-board'));
  const data = await page.locator('#interaction-canvas').evaluate(element => {
    const clipboard = new DataTransfer(); element.dispatchEvent(new ClipboardEvent('copy', { bubbles: true, cancelable: true, clipboardData: clipboard }));
    return clipboard.getData('text/plain');
  });
  expect(JSON.parse(data).type).toBe('inkisle-elements');
  for (const type of ['liubai-elements', 'inkisle-elements']) {
    await page.locator('#interaction-canvas').evaluate((element, { data, type }) => {
      const payload = JSON.parse(data); payload.type = type; const clipboard = new DataTransfer(); clipboard.setData('text/plain', JSON.stringify(payload));
      element.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: clipboard }));
    }, { data, type });
  }
  await expect(page.locator('#element-count')).toHaveText('3 个元素'); await expect(page.locator('#save-status')).toContainText('已保存在本机');
  await page.reload(); await expect(page.locator('#element-count')).toHaveText('3 个元素');
  expect(await page.evaluate(() => localStorage.getItem('liubai:last-board'))).toBe(board);
});
