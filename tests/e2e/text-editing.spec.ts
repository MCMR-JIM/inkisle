import { expect, test, type Page } from '@playwright/test';
import { createDocument, createElement, type BoardElement } from '../../src/core/model';
import { encodeDocument } from '../../src/core/codec';

async function seed(page: Page, element: BoardElement, zoom = 1): Promise<void> {
  const doc = createDocument('Text editing alignment');
  doc.elements = [element]; doc.camera = { x: 480, y: 220, zoom };
  await page.goto('/'); await expect(page.locator('#save-status')).toContainText('已保存在本机');
  await page.locator('#import-file').setInputFiles({ name: 'text.inkisle', mimeType: 'application/octet-stream', buffer: Buffer.from(encodeDocument(doc)) });
  await expect(page.locator('#toast')).toContainText('画板已导入');
  // Exclude the blinking insertion caret from glyph comparisons.
  await page.addStyleTag({ content: '#text-editor { caret-color: transparent; }' });
}

async function inkBounds(page: Page) {
  const png = (await page.screenshot()).toString('base64');
  return page.evaluate(async png => {
    const image = new Image(); image.src = `data:image/png;base64,${png}`; await image.decode();
    const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
    const ctx = canvas.getContext('2d')!; ctx.drawImage(image, 0, 0);
    const pixels = ctx.getImageData(0, 0, image.width, image.height).data;
    let left = image.width, top = image.height, right = 0, bottom = 0;
    const rows: number[] = [];
    for (let y = 150; y < image.height - 140; y++) for (let x = 400; x < image.width - 20; x++) {
      const i = (y * image.width + x) * 4;
      if (Math.abs(pixels[i] - 161) + Math.abs(pixels[i + 1] - 35) + Math.abs(pixels[i + 2] - 103) > 50) continue;
      left = Math.min(left, x); right = Math.max(right, x); top = Math.min(top, y); bottom = Math.max(bottom, y);
      rows[y] = (rows[y] ?? 0) + 1;
    }
    return { left, right, top, bottom, occupiedRows: rows.filter(Boolean).length };
  }, png);
}

for (const example of [
  { name: 'large welcome title', kind: 'text' as const, text: '让想法，自由生长。', fontSize: 46, w: 650, h: 72, zoom: .85 },
  { name: 'multiline note', kind: 'note' as const, text: '01 / 捕捉灵感\n\n一个词、一条线，\n先把想法留下来。', fontSize: 18, w: 218, h: 194, zoom: 1.65 },
  { name: 'short centered shape', kind: 'rect' as const, text: '慢慢想想', fontSize: 14, w: 166, h: 47, zoom: 1.65 },
  { name: 'narrow mixed text', kind: 'text' as const, text: 'Hello世界，\nTest text', fontSize: 18, w: 74, h: 150, zoom: 1.3 },
  { name: 'rotated note', kind: 'note' as const, text: '便签内容\n保持位置', fontSize: 24, w: 220, h: 200, zoom: .9, rotation: .35 },
]) {
  test(`${example.name} keeps its glyph positions when entering and leaving editing`, async ({ page }) => {
    const { name: _name, zoom, ...props } = example;
    await seed(page, createElement(example.kind, { ...props, x: 0, y: 0, stroke: '#a12367', strokeWidth: 0, fill: 'transparent' }), zoom);
    const before = await inkBounds(page); expect(before.right).toBeGreaterThan(before.left);
    await page.keyboard.press('Control+a'); await page.keyboard.press('Enter');
    await expect(page.locator('#text-editor')).toBeVisible();
    const editing = await inkBounds(page);
    for (const key of ['left', 'right', 'top', 'bottom', 'occupiedRows'] as const) expect(Math.abs(editing[key] - before[key]), key).toBeLessThanOrEqual(2);
    await page.keyboard.press('Control+Enter'); await expect(page.locator('#text-editor')).toBeHidden();
    const after = await inkBounds(page);
    for (const key of ['left', 'right', 'top', 'bottom', 'occupiedRows'] as const) expect(Math.abs(after[key] - before[key]), key).toBeLessThanOrEqual(2);
  });
}

test('editing existing text preserves its wrap width and editing a rotated note keeps its text anchor', async ({ page }) => {
  const read = async () => {
    await expect(page.locator('#save-status')).toContainText('已保存在本机');
    return page.evaluate(async () => {
      const path = '/src/storage/repository.ts'; const { Repository } = await import(/* @vite-ignore */ path);
      const repo = new Repository(); const doc = await repo.load(localStorage.getItem('liubai:last-board')); repo.close(); return doc.elements[0] as BoardElement;
    });
  };
  const el = createElement('text', { x: 0, y: 0, w: 420, h: 80, fontSize: 46, text: '让想法生长' });
  await seed(page, el); await page.keyboard.press('Control+a');
  for (const text of ['让想法生长。', '让想法生长。继续。']) {
    await page.keyboard.press('Enter'); await page.locator('#text-editor').fill(text); await page.keyboard.press('Control+Enter');
    const saved = await read(); expect(saved.w).toBe(el.w); expect(saved.x).toBe(el.x); expect(saved.y).toBe(el.y);
  }
  const note = createElement('note', { x: 0, y: 0, w: 230, h: 100, fontSize: 20, text: '便签', rotation: .45 });
  await seed(page, note); await page.keyboard.press('Control+a'); await page.keyboard.press('Enter');
  await page.locator('#text-editor').fill('便签\n第二行\n第三行\n第四行'); await page.keyboard.press('Control+Enter');
  const saved = await read(); expect(saved.h).toBeGreaterThan(note.h);
  const { worldPoint } = await import('../../src/core/transforms');
  const before = worldPoint(note, { x: 22, y: 22 }), after = worldPoint(saved, { x: 22, y: 22 });
  expect(after.x).toBeCloseTo(before.x, 5); expect(after.y).toBeCloseTo(before.y, 5);
});

test('focusing an editor near the viewport edge does not scroll the workspace', async ({ page }) => {
  await seed(page, createElement('text', { x: 500, y: 450, w: 650, h: 120, fontSize: 46, text: '让想法，自由生长。\n保持画布原位。' }));
  const header = await page.locator('.app-header').boundingBox();
  await page.keyboard.press('Control+a'); await page.keyboard.press('Enter');
  await expect(page.locator('#text-editor')).toBeVisible();
  await expect.poll(() => page.evaluate(() => [window.scrollX, window.scrollY])).toEqual([0, 0]);
  expect(await page.locator('.app-header').boundingBox()).toEqual(header);
  await page.keyboard.press('Control+Enter');
  expect(await page.locator('.app-header').boundingBox()).toEqual(header);
});
