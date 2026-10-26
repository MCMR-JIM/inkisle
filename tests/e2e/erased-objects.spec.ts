import { expect, test, type Page } from '@playwright/test';
import { createBoard, readBoard } from './helpers';
import { createDocument, createElement, type BoardElement } from '../../src/core/model';
import { encodeDocument } from '../../src/core/codec';

async function text(page: Page): Promise<void> {
  await page.goto('/'); await createBoard(page);
  await page.locator('#board-title').fill('Erasure regression'); await page.keyboard.press('Enter');
  await page.keyboard.press('t'); await page.mouse.click(500, 300);
  await page.locator('#text-editor').fill('Erase me'); await page.keyboard.press('Control+Enter');
}

async function wipe(page: Page): Promise<void> {
  await page.keyboard.press('e'); await page.locator('#eraser-size').fill('120');
  await page.mouse.move(480, 320); await page.mouse.down(); await page.mouse.move(680, 320, { steps: 10 }); await page.mouse.up();
}

test('fully erased text leaves no selectable object and undo restores its original content', async ({ page }) => {
  await text(page); const original = (await readBoard(page)).elements[0]; await wipe(page);
  await expect(page.locator('#element-count')).toHaveText('0 个元素');
  await page.keyboard.press('v'); await page.keyboard.press('Control+a'); await expect(page.locator('#selection-label')).toHaveText('已选择 0 个元素');
  await page.keyboard.press('Control+z'); expect((await readBoard(page)).elements).toEqual([original]);
  await page.keyboard.press('Control+Shift+z'); await expect(page.locator('#element-count')).toHaveText('0 个元素');
  expect((await readBoard(page)).elements).toHaveLength(0);
  await page.reload(); await expect(page.locator('#element-count')).toHaveText('0 个元素');
});

async function importElements(page: Page, elements: BoardElement[]): Promise<void> {
  const doc = createDocument('Erasure fixtures'); doc.elements = elements;
  await page.locator('#import-file').setInputFiles({ name: 'erase.inkisle', mimeType: 'application/octet-stream', buffer: Buffer.from(encodeDocument(doc)) });
  await expect(page.locator('#toast')).toContainText('画板已导入');
}

for (const kind of ['note', 'image', 'rect'] as const) test(`fully erased ${kind} is removed instead of leaving its original selection frame`, async ({ page }) => {
  await page.goto('/'); await expect(page.locator('#save-status[data-state="saved"]')).toBeVisible();
  const src = await page.evaluate(() => {
    const canvas = document.createElement('canvas'); canvas.width = 96; canvas.height = 64;
    const ctx = canvas.getContext('2d')!; ctx.fillStyle = '#00ff00'; ctx.fillRect(10, 10, 20, 20); return canvas.toDataURL();
  });
  const element = createElement(kind, { x: 500, y: 300, w: 240, h: 100, text: kind === 'image' ? '' : 'Erase all', ...(kind === 'image' ? { src } : {}) });
  await importElements(page, [element]);
  await page.keyboard.press('e'); await page.locator('#eraser-size').fill('120');
  await page.mouse.move(460, 350); await page.mouse.down(); await page.mouse.move(820, 350, { steps: 15 }); await page.mouse.up();
  await expect(page.locator('#element-count')).toHaveText('0 个元素');
  await page.keyboard.press('Control+z'); expect((await readBoard(page)).elements).toEqual([element]);
});

test('visibility checking keeps small remnants, decode failures and oversized objects conservatively', async ({ page }) => {
  await page.goto('/'); await expect(page.locator('#save-status[data-state="saved"]')).toBeVisible();
  const result = await page.evaluate(async () => {
    const visibilityPath = '/src/engine/visibility.ts', modelPath = '/src/core/model.ts';
    const { removeErasedParts } = await import(/* @vite-ignore */ visibilityPath), { createElement } = await import(/* @vite-ignore */ modelPath);
    const note = createElement('note', { w: 100, h: 100, erasures: [{ points: [{ x: 49, y: 50 }], radiusX: 49, radiusY: 1000 }] });
    const broken = createElement('image', { w: 100, h: 100, src: 'data:image/png;base64,AAAA', erasures: [{ points: [{ x: 50, y: 50 }], radiusX: 200, radiusY: 200 }] });
    const large = createElement('text', { w: 40000, h: 1000, text: 'Keep', erasures: [{ points: [{ x: 50, y: 50 }], radiusX: 100000, radiusY: 100000 }] });
    return (await removeErasedParts([[note], [broken], [large]])).map((group: BoardElement[]) => group.length);
  });
  expect(result).toEqual([1, 1, 1]);
});

test('partial text remains editable and cleanup works when the geometry worker is unavailable', async ({ page }) => {
  await page.addInitScript(() => {
    window.Worker = new Proxy(window.Worker, { construct(target, args) {
      if (String(args[0]).includes('cutter.worker')) throw new Error('Worker blocked');
      return Reflect.construct(target, args);
    } });
  });
  await text(page); await page.keyboard.press('e'); await page.mouse.click(502, 312);
  await expect(page.locator('#element-count')).toHaveText('1 个元素');
  expect((await readBoard(page)).elements[0].kind).toBe('text');
  await wipe(page); await expect(page.locator('#element-count')).toHaveText('0 个元素');
});

test('rotated grouped text is removed in its local mask coordinates without deleting surviving group members', async ({ page }) => {
  await page.goto('/'); await expect(page.locator('#save-status[data-state="saved"]')).toBeVisible();
  const erased = createElement('text', { x: 500, y: 300, w: 180, h: 80, text: 'Rotate', rotation: Math.PI / 4, groupPath: ['outer', 'inner'] });
  const survivor = createElement('note', { x: 900, y: 300, w: 180, h: 100, text: 'Keep', groupPath: ['outer', 'inner'] });
  await importElements(page, [erased, survivor]); await page.keyboard.press('e'); await page.locator('#eraser-size').fill('120');
  for (const y of [270, 350, 430]) {
    await page.mouse.move(440, y); await page.mouse.down(); await page.mouse.move(740, y, { steps: 12 }); await page.mouse.up();
  }
  await expect(page.locator('#element-count')).toHaveText('1 个元素'); expect((await readBoard(page)).elements).toEqual([survivor]);
});
