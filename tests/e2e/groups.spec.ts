import { expect, test, type Page } from '@playwright/test';
import { createDocument, createElement, type BoardDocument } from '../../src/core/model';
import { encodeDocument } from '../../src/core/codec';

async function seed(page: Page): Promise<void> {
  const doc = createDocument('Group fixture');
  doc.elements = [[450, 250], [650, 300], [900, 350]].map(([x, y], i) => createElement('rect', { id: `object-${i}`, x, y, w: 80, h: 60, fill: '#e6eee5', order: i }));
  await page.goto('/'); await expect(page.locator('#save-status')).toContainText('已保存在本机');
  await page.locator('#import-file').setInputFiles({ name: 'groups.inkisle', mimeType: 'application/octet-stream', buffer: Buffer.from(encodeDocument(doc)) });
  await expect(page.locator('#toast')).toContainText('画板已导入');
  await expect(page.locator('#element-count')).toHaveText('3 个元素');
}

async function read(page: Page): Promise<BoardDocument> {
  await expect(page.locator('#save-status')).toContainText('已保存在本机');
  return page.evaluate(async () => {
    const path = '/src/storage/repository.ts'; const { Repository } = await import(/* @vite-ignore */ path);
    const repo = new Repository(); const doc = await repo.load(localStorage.getItem('liubai:last-board')); repo.close(); return doc;
  });
}

async function selectPair(page: Page): Promise<void> {
  await page.mouse.click(490, 280); await page.keyboard.down('Shift'); await page.mouse.click(690, 330); await page.keyboard.up('Shift');
  await expect(page.locator('#selection-label')).toHaveText('已选择 2 个元素');
}

test('nested groups support scoped editing, independent duplication and lossless file round trips', async ({ page }) => {
  await seed(page); await selectPair(page); await page.keyboard.press('Control+g');
  const inner = (await read(page)).elements[0].groupPath![0];
  await page.keyboard.down('Shift'); await page.mouse.click(940, 380); await page.keyboard.up('Shift');
  await page.keyboard.press('Control+g');
  const grouped = await read(page), outer = grouped.elements[0].groupPath![0];
  expect(grouped.elements[0].groupPath).toEqual([outer, inner]);
  expect(grouped.elements[2].groupPath).toEqual([outer]);
  await page.mouse.dblclick(490, 280);
  await expect(page.locator('#group-scope-label')).toHaveText('组合内 · 第 1 层');
  await expect(page.locator('#selection-label')).toHaveText('已选择 1 个对象 · 2 个元素');
  await page.mouse.dblclick(490, 280);
  await expect(page.locator('#group-scope-label')).toHaveText('组合内 · 第 2 层');
  await expect(page.locator('#selection-label')).toHaveText('已选择 1 个元素');
  await page.keyboard.press('Control+z');
  await expect(page.locator('#group-navigation')).toBeHidden();
  await expect(page.locator('#selection-label')).toHaveText('已选择 1 个对象 · 2 个元素');
  await page.keyboard.press('Control+Shift+z');
  await page.mouse.dblclick(490, 280); await page.mouse.dblclick(490, 280);
  await expect(page.locator('#group-scope-label')).toHaveText('组合内 · 第 2 层');
  await page.keyboard.press('ArrowRight');
  expect((await read(page)).elements[0].x).toBe(451);
  expect((await read(page)).elements[1].x).toBe(650);
  await page.keyboard.down('Shift'); await page.mouse.click(690, 330); await page.keyboard.up('Shift');
  await page.mouse.move(490, 280); await page.mouse.down(); await page.mouse.move(510, 290); await page.mouse.up();
  const moved = await read(page);
  expect(moved.elements[0].x).toBe(471); expect(moved.elements[1].x).toBe(670); expect(moved.elements[2].x).toBe(900);
  await page.keyboard.press('Control+g');
  expect((await read(page)).elements[0].groupPath).toHaveLength(3);
  await page.keyboard.press('Escape'); await page.keyboard.press('Escape');
  await expect(page.locator('#group-navigation')).toBeHidden();
  await page.keyboard.press('Control+d');
  await expect(page.locator('#element-count')).toHaveText('6 个元素');
  const duplicated = await read(page);
  const copies = duplicated.elements.filter(el => !el.id.startsWith('object-'));
  expect(copies).toHaveLength(3);
  expect(copies[0].groupPath![0]).not.toBe(outer);
  expect(copies.every(el => el.groupPath![0] === copies[0].groupPath![0])).toBe(true);
  const download = page.waitForEvent('download'); await page.keyboard.press('Control+s'); const source = await download;
  await page.reload(); await expect(page.locator('#element-count')).toHaveText('6 个元素');
  await page.locator('#import-file').setInputFiles((await source.path())!);
  await expect(page.locator('#toast')).toContainText('画板已导入');
  expect((await read(page)).elements.map(el => el.groupPath)).toEqual(duplicated.elements.map(el => el.groupPath));
  await page.keyboard.press('Control+a'); await page.keyboard.press('Control+Shift+g');
  expect((await read(page)).elements[0].groupPath).toHaveLength(2);
  await page.keyboard.press('Control+z'); expect((await read(page)).elements[0].groupPath).toHaveLength(3);
});

test('multi-selection has separate frames and no transform handles while a group requires full containment', async ({ page }) => {
  await seed(page); await selectPair(page);
  const frames = await page.locator('#interaction-canvas').evaluate((canvas: HTMLCanvasElement) => {
    const ctx = canvas.getContext('2d')!, ratio = canvas.width / canvas.clientWidth;
    const blue = (x: number, y: number) => {
      const pixels = ctx.getImageData(Math.round(x * ratio), Math.round(y * ratio), 30, 3).data;
      let count = 0; for (let i = 0; i < pixels.length; i += 4) if (pixels[i + 2] > pixels[i] + 20) count++;
      return count;
    };
    return { a: blue(475, 243), b: blue(675, 293), gap: blue(575, 243) };
  });
  expect(frames.a).toBeGreaterThan(0); expect(frames.b).toBeGreaterThan(0); expect(frames.gap).toBe(0);
  await page.mouse.move(444, 244); await page.mouse.down(); await page.mouse.move(400, 200); await page.mouse.up();
  const unchanged = await read(page); expect(unchanged.elements[0].w).toBe(80); expect(unchanged.elements[1].w).toBe(80);
  await seed(page); await selectPair(page); await page.keyboard.press('Control+g');
  await page.mouse.click(1100, 500);
  await page.mouse.move(430, 230); await page.mouse.down(); await page.mouse.move(550, 330); await page.mouse.up();
  await expect(page.locator('#selection-actions')).toBeHidden();
  await page.mouse.move(430, 230); await page.mouse.down(); await page.mouse.move(750, 380); await page.mouse.up();
  await expect(page.locator('#selection-label')).toHaveText('已选择 1 个对象 · 2 个元素');
  await page.mouse.dblclick(490, 280);
  await page.mouse.move(490, 218); await page.mouse.down(); await page.mouse.move(550, 280); await page.mouse.up();
  const rotated = await read(page);
  expect(Math.abs(rotated.elements[0].rotation)).toBeGreaterThan(1);
  expect(rotated.elements[1].rotation).toBe(0);
  await page.keyboard.press('Escape');
  await page.keyboard.down('Control'); await page.mouse.click(490, 280); await page.keyboard.up('Control');
  await expect(page.locator('#selection-label')).toHaveText('已选择 1 个元素');
  await expect(page.locator('#group-scope-label')).toHaveText('组合内 · 第 1 层');
});

test('alignment and spacing act on groups as units and remain undoable', async ({ page }) => {
  await seed(page); await selectPair(page); await page.keyboard.press('Control+g');
  await page.keyboard.down('Shift'); await page.mouse.click(940, 380); await page.keyboard.up('Shift');
  await page.locator('#alignment-trigger').click();
  await page.getByRole('button', { name: '顶端对齐', exact: true }).click();
  const doc = await read(page);
  expect(doc.elements[0].y).toBe(250); expect(doc.elements[1].y).toBe(300); expect(doc.elements[2].y).toBe(250);
  await page.keyboard.press('Control+z'); expect((await read(page)).elements[2].y).toBe(350);
  await page.keyboard.press('Control+Shift+g'); await page.locator('#alignment-trigger').click(); await page.getByRole('button', { name: '水平等距', exact: true }).click();
  expect((await read(page)).elements[1].x).toBe(675);
});
