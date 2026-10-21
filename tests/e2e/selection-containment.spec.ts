import { expect, test, type Page } from '@playwright/test';
import { chooseTool } from './helpers';
import { elementBounds } from '../../src/core/geometry';
import type { BoardElement } from '../../src/core/model';

async function blank(page: Page): Promise<void> {
  await page.goto('/'); await page.locator('#quick-new').click();
  await expect(page.locator('#element-count')).toHaveText('0 个元素');
}

async function drawRect(page: Page, x = 500, y = 300, w = 200, h = 150): Promise<void> {
  await chooseTool(page, '矩形'); await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.move(x + w, y + h); await page.mouse.up();
  await chooseTool(page, '选择工具');
}

async function marquee(page: Page, x: number, y: number, right: number, bottom: number): Promise<void> {
  await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.move(right, bottom, { steps: 5 }); await page.mouse.up();
}

test('partial, majority and crossing marquees never select an object until its full outline is enclosed', async ({ page }) => {
  await blank(page); await drawRect(page);
  for (const box of [[480, 280, 620, 470], [480, 280, 690, 470], [520, 280, 730, 470], [480, 320, 720, 480]]) {
    await marquee(page, ...box as [number, number, number, number]);
    await expect(page.locator('#selection-actions')).toBeHidden();
  }
  await marquee(page, 480, 280, 720, 470); await expect(page.locator('#selection-label')).toHaveText('已选择 1 个元素');
  await page.mouse.click(1050, 650); await marquee(page, 720, 470, 480, 280); await expect(page.locator('#selection-label')).toHaveText('已选择 1 个元素');
});

test('single clicking and Shift clicking keep their existing hits while Shift marquee adds only fully enclosed objects', async ({ page }) => {
  await blank(page); await drawRect(page); await drawRect(page, 800);
  await page.mouse.click(600, 300); await expect(page.locator('#selection-label')).toHaveText('已选择 1 个元素');
  await page.keyboard.down('Shift'); await marquee(page, 780, 280, 930, 470); await page.keyboard.up('Shift');
  await expect(page.locator('#selection-label')).toHaveText('已选择 1 个元素');
  await page.keyboard.down('Shift'); await marquee(page, 780, 280, 1020, 470); await page.keyboard.up('Shift');
  await expect(page.locator('#selection-label')).toHaveText('已选择 2 个元素');
  await page.keyboard.down('Shift'); await page.mouse.click(900, 300); await page.keyboard.up('Shift');
  await expect(page.locator('#selection-label')).toHaveText('已选择 1 个元素');
  await page.mouse.click(900, 300); await expect(page.locator('#selection-label')).toHaveText('已选择 1 个元素');
  await page.keyboard.press('Delete'); await expect(page.locator('#element-count')).toHaveText('1 个元素');
});

test('rotated shapes require their complete world bounds and containment still works after viewport zoom', async ({ page }) => {
  await blank(page); await drawRect(page);
  await expect(page.locator('#save-status')).toContainText('已保存在本机');
  const rotated: BoardElement = await page.evaluate(async () => {
    const path = '/src/storage/repository.ts'; const { Repository } = await import(/* @vite-ignore */ path);
    const repo = new Repository(), doc = await repo.load(localStorage.getItem('liubai:last-board')); doc.elements[0].rotation = Math.PI / 4;
    await repo.compact(doc); repo.close(); return doc.elements[0];
  });
  await page.reload(); await expect(page.locator('#save-status')).toContainText('已保存在本机');
  const bounds = elementBounds(rotated);
  await marquee(page, bounds.x - 20, bounds.y - 20, bounds.x + bounds.w - 12, bounds.y + bounds.h + 20);
  await expect(page.locator('#selection-actions')).toBeHidden();
  await marquee(page, bounds.x - 20, bounds.y - 20, bounds.x + bounds.w + 20, bounds.y + bounds.h + 20);
  await expect(page.locator('#selection-label')).toHaveText('已选择 1 个元素');
  await page.mouse.click(1100, 700); await page.locator('#zoom-in').click();
  await expect(page.locator('#save-status')).toContainText('已保存在本机');
  const camera = await page.evaluate(async () => {
    const path = '/src/storage/repository.ts'; const { Repository } = await import(/* @vite-ignore */ path);
    const repo = new Repository(), doc = await repo.load(localStorage.getItem('liubai:last-board')); repo.close(); return doc.camera;
  });
  const left = bounds.x * camera.zoom + camera.x, top = bounds.y * camera.zoom + camera.y;
  const right = (bounds.x + bounds.w) * camera.zoom + camera.x, bottom = (bounds.y + bounds.h) * camera.zoom + camera.y;
  await marquee(page, left - 15, top - 15, right - 12, bottom + 15); await expect(page.locator('#selection-actions')).toBeHidden();
  await marquee(page, left - 15, top - 15, right + 15, bottom + 15); await expect(page.locator('#selection-label')).toHaveText('已选择 1 个元素');
});

test('dragging and double clicking tool UI cannot create native text selections', async ({ page }) => {
  await blank(page);
  const label = (await page.locator('#property-title').boundingBox())!;
  await page.mouse.move(label.x + 2, label.y + label.height / 2); await page.mouse.down();
  await page.mouse.move(label.x + label.width - 2, label.y + label.height / 2, { steps: 5 }); await page.mouse.up();
  expect(await page.evaluate(() => window.getSelection()?.toString())).toBe('');
  await page.locator('#fit-button').hover(); await expect(page.getByRole('tooltip')).toHaveText('适应画布');
  await page.locator('#fit-button').dblclick();
  expect(await page.evaluate(() => window.getSelection()?.toString())).toBe('');
  const selectStartAllowed = await page.locator('#property-title').evaluate(el => el.dispatchEvent(new Event('selectstart', { bubbles: true, cancelable: true })));
  expect(selectStartAllowed).toBe(false);
});

test('selecting board objects clears stray DOM ranges and copies the object rather than tooltip text', async ({ page }) => {
  await blank(page); await drawRect(page);
  await page.evaluate(() => {
    const node = document.querySelector('#property-title')!, range = document.createRange(); range.selectNodeContents(node);
    const selection = window.getSelection()!; selection.removeAllRanges(); selection.addRange(range);
  });
  await page.mouse.click(600, 300); await expect(page.locator('#selection-label')).toHaveText('已选择 1 个元素');
  expect(await page.evaluate(() => window.getSelection()?.toString())).toBe('');
  const copy = await page.evaluate(() => {
    const data = new DataTransfer(), event = new ClipboardEvent('copy', { bubbles: true, cancelable: true, clipboardData: data });
    document.querySelector('#interaction-canvas')!.dispatchEvent(event); return { handled: event.defaultPrevented, text: data.getData('text/plain') };
  });
  expect(copy.handled).toBe(true); expect(JSON.parse(copy.text).type).toBe('inkisle-elements');
  await page.mouse.click(1100, 650);
  const nativeCopy = await page.evaluate(() => {
    const node = document.querySelector('#property-title')!, range = document.createRange(); range.selectNodeContents(node); window.getSelection()!.addRange(range);
    const data = new DataTransfer(), event = new ClipboardEvent('copy', { bubbles: true, cancelable: true, clipboardData: data });
    document.querySelector('#interaction-canvas')!.dispatchEvent(event); return { handled: event.defaultPrevented, text: data.getData('text/plain') };
  });
  expect(nativeCopy.handled).toBe(true); expect(nativeCopy.text).toBe('');
});

test('title, text editor and HEX input still support ordinary text selection and copy', async ({ page }) => {
  await blank(page); const title = page.locator('#board-title'); await title.fill('可以复制标题'); await title.selectText();
  expect(await title.evaluate((el: HTMLInputElement) => el.value.slice(el.selectionStart!, el.selectionEnd!))).toBe('可以复制标题');
  expect(await title.evaluate(el => el.dispatchEvent(new Event('selectstart', { bubbles: true, cancelable: true })))).toBe(true);
  await chooseTool(page, '文字'); await page.mouse.click(600, 400); const editor = page.locator('#text-editor'); await editor.fill('自由编辑文本'); await editor.selectText();
  expect(await editor.evaluate((el: HTMLTextAreaElement) => el.value.slice(el.selectionStart!, el.selectionEnd!))).toBe('自由编辑文本');
  const handled = await editor.evaluate(el => { const event = new ClipboardEvent('copy', { bubbles: true, cancelable: true, clipboardData: new DataTransfer() }); el.dispatchEvent(event); return event.defaultPrevented; });
  expect(handled).toBe(false);
  await page.keyboard.press('Control+Enter'); await page.locator('#stroke-palette').click(); const hex = page.locator('#stroke-hex'); await hex.selectText();
  expect(await hex.evaluate((el: HTMLInputElement) => el.selectionEnd! - el.selectionStart!)).toBe(7);
  expect(await hex.evaluate(el => getComputedStyle(el).userSelect)).toBe('text');
});
