import { expect, test, type Page } from '@playwright/test';
import { createDocument, createElement, type BoardElement } from '../../src/core/model';
import { encodeDocument } from '../../src/core/codec';
import { createBoard, readBoard, selectValue } from './helpers';
import { pdfFixture } from '../fixtures/pdf';

async function setup(page: Page): Promise<BoardElement[]> {
  await page.goto('/');
  const doc = createDocument('Capture fixture');
  doc.elements = [
    createElement('rect', { x: 500, y: 200, w: 400, h: 400, fill: '#0000ff', strokeWidth: 0, locked: true, groupPath: ['outer', 'inner'] }),
    createElement('rect', { x: 600, y: 300, w: 200, h: 150, fill: '#ff0000', strokeWidth: 0, opacity: .5, erasures: [{ points: [{ x: 50, y: 50 }], radiusX: 12, radiusY: 12 }] }),
  ];
  await page.locator('#import-file').setInputFiles({ name: 'capture.inkisle', mimeType: 'application/octet-stream', buffer: Buffer.from(encodeDocument(doc)) });
  await expect(page.locator('#toast')).toContainText('画板已导入');
  return doc.elements;
}
async function rectangle(page: Page, a = { x: 550, y: 250 }, b = { x: 850, y: 550 }): Promise<void> {
  await page.getByRole('button', { name: '截取区域', exact: true }).click(); await page.mouse.move(a.x, a.y); await page.mouse.down(); await page.mouse.move(b.x, b.y, { steps: 5 }); await page.mouse.up();
  await expect(page.locator('[data-capture-action="insert"]')).toBeVisible();
  await expect(page.locator('[data-capture-action="insert"]')).toBeEnabled();
}
async function pixels(page: Page, element: BoardElement, points: number[][]): Promise<number[][]> {
  return page.evaluate(async ({ src, points }) => {
    const image = new Image(); image.src = src!; await image.decode();
    const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
    const ctx = canvas.getContext('2d')!; ctx.drawImage(image, 0, 0);
    return points.map(([x, y]) => [...ctx.getImageData(Math.floor(x * image.width), Math.floor(y * image.height), 1, 1).data]);
  }, { src: element.src, points });
}

test('rectangle capture flattens layer order, opacity and erasures into one undoable portable image', async ({ page }) => {
  const originals = await setup(page);
  await rectangle(page); await page.locator('[data-capture-action="insert"]').click();
  const doc = await readBoard(page), image = doc.elements.at(-1)!;
  expect(doc.elements.slice(0, 2)).toEqual(originals); expect(image.kind).toBe('image'); expect(image.groupPath).toBeUndefined();
  expect([image.x, image.y, image.w, image.h]).toEqual([550, 250, 300, 300]);
  const [blue, purple, hole] = await pixels(page, image, [[.05, .05], [1 / 3, .23], [1 / 3, 1 / 3]]);
  expect(blue).toEqual([0, 0, 255, 255]); expect(purple[0]).toBeGreaterThan(120); expect(purple[2]).toBeGreaterThan(120); expect(hole).toEqual(blue);
  await page.keyboard.press('Control+z'); expect((await readBoard(page)).elements).toEqual(originals);
  await page.keyboard.press('Control+Shift+z'); expect((await readBoard(page)).elements.at(-1)!.src).toBe(image.src);
  const download = page.waitForEvent('download'); await page.keyboard.press('Control+s'); const file = await download;
  await createBoard(page); await page.locator('#import-file').setInputFiles((await file.path())!);
  await expect(page.locator('#toast')).toContainText('画板已导入'); expect((await readBoard(page)).elements.at(-1)!.src).toBe(image.src);
});

test('polygon capture clips outside pixels and closes by origin or Enter with vertex undo', async ({ page }) => {
  await setup(page); await page.keyboard.press('c'); await page.locator('[data-capture-mode="polygon"]').click();
  for (const [x, y] of [[520, 220], [850, 220], [850, 550]]) await page.mouse.click(x, y);
  await page.keyboard.press('Backspace'); await page.mouse.click(520, 550); await page.mouse.click(520, 220);
  await expect(page.locator('[data-capture-action="insert"]')).toBeEnabled();
  await page.screenshot({ path: '.cache/pdf-example/capture-polygon.png' });
  await page.locator('[data-capture-action="insert"]').click();
  const image = (await readBoard(page)).elements.at(-1)!;
  const [inside, outside] = await pixels(page, image, [[.1, .1], [.9, .9]]);
  expect(inside[3]).toBe(255); expect(outside[3]).toBe(0);
  await page.keyboard.press('c');
  for (const [x, y] of [[540, 240], [760, 240], [540, 460]]) await page.mouse.click(x, y);
  await page.keyboard.press('Enter'); await expect(page.locator('[data-capture-action="copy"]')).toBeEnabled();
  await page.keyboard.press('Escape'); await expect(page.locator('#capture-actions')).toBeHidden();
});

test('copy and paste preserves region size, including clipboard permission fallback and zoomed camera', async ({ page }) => {
  await setup(page); await selectValue(page, '#zoom-value', 2);
  // Clipboard permission denial must still allow an independent in-app copy.
  await page.evaluate(() => Object.defineProperty(navigator.clipboard, 'write', { value: () => Promise.reject(new Error('Denied')) }));
  await rectangle(page, { x: 500, y: 260 }, { x: 820, y: 540 });
  await page.locator('[data-capture-action="copy"]').click();
  await page.evaluate(() => {
    const data = new DataTransfer(); data.setData('text/plain', 'stale external clipboard');
    document.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
  });
  const doc = await readBoard(page), image = doc.elements.at(-1)!;
  expect(image.kind).toBe('image'); expect(image.w).toBeCloseTo(160); expect(image.h).toBeCloseTo(140);
  expect(doc.elements).toHaveLength(3);
  await page.reload(); expect((await readBoard(page)).elements.at(-1)!.src).toBe(image.src);
});

test('Ctrl+C writes a PNG and size-preserving object data to the system clipboard', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await setup(page); await rectangle(page); await page.keyboard.press('Control+c');
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toContain('data:image/png;base64,');
  const types = await page.evaluate(async () => (await navigator.clipboard.read()).flatMap(item => item.types));
  expect(types).toContain('image/png');
  await page.keyboard.press('Control+v');
  const image = (await readBoard(page)).elements.at(-1)!;
  expect(image.kind).toBe('image'); expect(image.w).toBe(300); expect(image.h).toBe(300);
});

test('rasterization bounds large outputs and reports canceled or unreadable input without inserting objects', async ({ page }) => {
  await setup(page);
  const result = await page.evaluate(async () => {
    const capturePath = '/src/engine/capture.ts', modelPath = '/src/core/model.ts';
    const { captureRegion } = await import(/* @vite-ignore */ capturePath), { createElement } = await import(/* @vite-ignore */ modelPath);
    const shape = createElement('rect', { x: 0, y: 0, w: 40000, h: 100, fill: '#ffffff' });
    const points = [{ x: 0, y: 0 }, { x: 40000, y: 0 }, { x: 40000, y: 100 }, { x: 0, y: 100 }];
    const result = await captureRegion([shape], points), image = new Image(); image.src = result.element.src; await image.decode();
    const controller = new AbortController(); controller.abort();
    const fails = async (run: () => Promise<unknown>) => { try { await run(); return false; } catch { return true; } };
    return { width: image.width, height: image.height, canceled: await fails(() => captureRegion([shape], points, false, controller.signal)), broken: await fails(() => captureRegion([createElement('image', { ...shape, kind: 'image', src: 'data:image/png;base64,AAAA' })], points)) };
  });
  expect(result.width).toBe(8192); expect(result.height).toBeLessThan(100); expect(result.canceled).toBe(true); expect(result.broken).toBe(true);
  expect((await readBoard(page)).elements).toHaveLength(2);
});

test('tool and board changes cancel pending regions, and Space pans without changing polygon vertices', async ({ page }) => {
  await setup(page); await page.keyboard.press('c'); await page.locator('[data-capture-mode="polygon"]').click();
  await page.mouse.click(550, 250); await page.keyboard.down('Space');
  await page.mouse.move(800, 400); await page.mouse.down(); await page.mouse.move(850, 420); await page.mouse.up(); await page.keyboard.up('Space');
  await page.mouse.click(800, 270); await page.mouse.click(600, 500); await page.keyboard.press('Enter');
  await expect(page.locator('[data-capture-action="insert"]')).toBeEnabled();
  await page.keyboard.press('p'); await expect(page.locator('#capture-actions')).toBeHidden();
  await page.keyboard.press('c'); await expect(page.locator('#capture-actions')).toBeHidden();
  await page.mouse.click(550, 250); await createBoard(page); await expect(page.locator('#capture-actions')).toBeHidden();
  await page.keyboard.press('c'); await page.keyboard.press('Enter'); await expect(page.locator('#capture-actions')).toBeHidden();
});

test('PDF capture waits for cold page content and remains independent of PDF assets', async ({ page }) => {
  await page.goto('/'); await createBoard(page);
  await page.locator('#import-file').setInputFiles({ name: 'notes.pdf', mimeType: 'application/pdf', buffer: await pdfFixture(20) });
  await page.locator('#pdf-confirm-import').click(); await expect(page.locator('#pdf-page-total')).toHaveText('/ 20');
  await page.locator('#pdf-jump').fill('15'); await page.locator('#pdf-jump').dispatchEvent('change');
  const doc = await readBoard(page), paper = doc.elements[14], camera = doc.camera;
  const screen = (x: number, y: number) => ({ x: (paper.x + x * paper.w) * camera.zoom + camera.x, y: (paper.y + y * paper.h) * camera.zoom + camera.y });
  const a = screen(.04, .05), b = screen(.92, .8);
  await rectangle(page, a, b); await page.screenshot({ path: '.cache/pdf-example/capture-pdf.png' });
  await page.locator('[data-capture-action="insert"]').click(); const image = (await readBoard(page)).elements.at(-1)!;
  const [green, white] = await pixels(page, image, [[.25, .43], [.8, .8]]);
  expect(green[0]).toBeLessThan(80); expect(green[1]).toBeGreaterThan(150); expect(green[2]).toBeLessThan(110); expect(white).toEqual([255, 255, 255, 255]);
  // Export only the flattened object; no PDF bytes are required to reopen it.
  const independent = createDocument('Independent capture'); independent.elements = [image];
  await createBoard(page); await page.locator('#import-file').setInputFiles({ name: 'independent.inkisle', mimeType: 'application/octet-stream', buffer: Buffer.from(encodeDocument(independent)) });
  await expect(page.locator('#pdf-navigation')).toBeHidden(); expect((await readBoard(page)).elements).toEqual([image]);
});
