import { createBoard, readBoard as document } from './helpers';
import { expect, test, type Page } from '@playwright/test';
import { PDFDocument, PDFName } from 'pdf-lib';
import { mkdir } from 'node:fs/promises';
import { pdfFixture as fixture } from '../fixtures/pdf';
async function setup(page: Page, count = 3) {
  await page.goto('/'); await createBoard(page);
  await page.locator('#import-file').setInputFiles({ name: 'fixture.pdf', mimeType: 'application/pdf', buffer: await fixture(count) });
  await expect(page.locator('#pdf-import-dialog')).toBeVisible({ timeout: 30000 });
  await page.locator('#pdf-confirm-import').click();
  await expect(page.locator('#pdf-navigation')).toBeVisible();
  await expect(page.locator('#save-status[data-state="saved"]')).toBeVisible();
}
async function expectPreview(page: Page): Promise<void> {
  await expect.poll(() => page.locator('#canvas').evaluate((canvas: HTMLCanvasElement) => {
    const pixels = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data;
    let green = 0;
    for (let i = 0; i < pixels.length; i += 4) if (pixels[i] < 80 && pixels[i + 1] > 150 && pixels[i + 1] < 210 && pixels[i + 2] < 110) green++;
    return green;
  }), { timeout: 15000 }).toBeGreaterThan(100);
}

test('paints PDF content without another gesture after import, navigation, and reload', async ({ page }) => {
  await setup(page);
  await expectPreview(page);
  await page.locator('#pdf-next').click(); await expectPreview(page);
  await page.reload(); await expect(page.locator('#pdf-navigation')).toBeVisible(); await expectPreview(page);
});

test('adds blank paper and undoes deleting a sheet together with its margin annotations', async ({ page }) => {
  await page.goto('/'); await createBoard(page);
  await page.locator('#add-paper-button').click();
  await page.locator('#add-paper-button').click(); await expect(page.locator('#pdf-page-total')).toHaveText('/ 2');
  await page.locator('#pdf-jump').fill('1'); await page.locator('#pdf-jump').dispatchEvent('change');
  const doc = await document(page), sheet = doc.elements[0], camera = doc.camera;
  await page.getByRole('button', { name: '文字', exact: true }).click(); await page.mouse.click((sheet.x - 70) * camera.zoom + camera.x, (sheet.y + 120) * camera.zoom + camera.y);
  await page.locator('#text-editor').fill('Margin annotation'); await page.keyboard.press('Control+Enter');
  await page.keyboard.press('v'); await page.keyboard.press('Control+a'); await expect(page.locator('#selection-label')).toContainText('1 个元素');
  await page.locator('#pdf-remove-paper').click();
  expect((await document(page)).elements).toHaveLength(1);
  await page.keyboard.press('Control+z');
  const restored = await document(page);
  expect(restored.elements).toHaveLength(3); await expect(page.locator('#pdf-page-total')).toHaveText('/ 2');
  const svg = await page.evaluate(async doc => { const path = '/src/engine/export.ts'; return (await import(/* @vite-ignore */ path)).exportSVG(doc).text(); }, restored);
  expect(svg.match(/rx="0" fill="#ffffff"/g)).toHaveLength(2);
});

test('imports hundreds of page references without rasterizing the whole book, and restores originals from source files', async ({ page }) => {
  await setup(page, 300);
  await expectPreview(page);
  const doc = await document(page);
  expect(doc.elements).toHaveLength(300);
  expect(doc.elements.every(el => el.kind === 'paper' && !el.src)).toBe(true);
  expect(new Set(doc.elements.map(el => el.paper!.sourceId)).size).toBe(1);
  const memory = await page.evaluate(() => (window as unknown as { inkisle: { diagnostics(): { pdf: { cachedBytes: number; cachedPages: number; budget: number } } } }).inkisle.diagnostics().pdf);
  expect(memory.cachedPages).toBeGreaterThan(0); expect(memory.cachedPages).toBeLessThan(10); expect(memory.cachedBytes).toBeLessThanOrEqual(memory.budget);
  const pending = page.waitForEvent('download'); await page.keyboard.press('Control+s'); const source = await pending;
  expect((await source.suggestedFilename()).endsWith('.inkisle')).toBe(true);
  await page.evaluate(async () => {
    const path = '/src/storage/assets.ts'; const { pdfAssets } = await import(/* @vite-ignore */ path); pdfAssets.close();
    await new Promise<void>((resolve, reject) => { const req = indexedDB.deleteDatabase('liubai-pdf-assets-v1'); req.onsuccess = () => resolve(); req.onerror = () => reject(req.error); });
  });
  await createBoard(page); await page.locator('#import-file').setInputFiles((await source.path())!);
  await expect(page.locator('#toast')).toContainText('画板已导入');
  expect((await document(page)).elements).toEqual(doc.elements);
  await expectPreview(page);
});

test('keeps margins separate, blocks overflow, and restores layout switching through undo', async ({ page }) => {
  await setup(page);
  await page.locator('#pdf-double').click();
  const before = await document(page);
  const [a, b] = before.elements;
  expect(a.y).toBe(b.y); expect(b.x - b.paper!.margin).toBeGreaterThan(a.x + a.w + a.paper!.margin);
  await page.keyboard.press('p');
  const right = (a.x + a.w + a.paper!.margin) * before.camera.zoom + before.camera.x;
  const y = (a.y + a.h / 2) * before.camera.zoom + before.camera.y;
  await page.mouse.move(right - 15, y); await page.mouse.down(); await page.mouse.move(right + 30, y, { steps: 10 }); await page.mouse.up();
  await expect(page.locator('#pdf-double')).toBeDisabled(); await expect(page.locator('#pdf-locate-overflow')).toBeVisible();
  await page.keyboard.press('Control+z'); await expect(page.locator('#pdf-single')).toBeEnabled();
  await page.locator('#pdf-single').click(); const after = await document(page);
  expect(after.elements[1].y - after.elements[1].paper!.margin).toBeGreaterThan(after.elements[0].y + after.elements[0].h + after.elements[0].paper!.margin);
});

test('exports selected PDF pages to A4 with original content and clipped annotations', async ({ page }) => {
  await setup(page);
  const doc = await document(page), paper = doc.elements[0], camera = doc.camera;
  await page.keyboard.press('p');
  if (await page.getByRole('switch', { name: '压感', exact: true }).isChecked()) await page.getByRole('switch', { name: '压感', exact: true }).click();
  await page.locator('[data-color="#e28165"][data-property="stroke"]').click(); await page.locator('[data-width="7"]').click();
  const right = (paper.x + paper.w + paper.paper!.margin) * camera.zoom + camera.x;
  const y = (paper.y + paper.h / 2) * camera.zoom + camera.y;
  await page.mouse.move(right - 20, y); await page.mouse.down(); await page.mouse.move(right + 25, y, { steps: 10 }); await page.mouse.up();
  await expect(page.locator('#pdf-single')).toBeDisabled();
  await page.locator('#export-button').click(); await page.locator('[data-action="export-pdf"]').click();
  await page.locator('#pdf-export-range').fill('1,3');
  const pending = page.waitForEvent('download'); await page.locator('#pdf-confirm-export').click();
  const file = await pending; await mkdir('.cache/pdf-example', { recursive: true });
  await file.saveAs('.cache/pdf-example/exported-pages.pdf');
  const { readFile } = await import('node:fs/promises');
  const result = await PDFDocument.load(await readFile((await file.path())!));
  expect(result.getPageCount()).toBe(2);
  expect(result.getPage(0).getWidth()).toBeCloseTo(595.28); expect(result.getPage(0).getHeight()).toBeCloseTo(841.89);
  const data = await readFile((await file.path())!);
  const edge = await page.evaluate(async ({ bytes, paper }) => {
    const path = '/node_modules/pdfjs-dist/build/pdf.mjs'; const pdf = await import(/* @vite-ignore */ path);
    pdf.GlobalWorkerOptions.workerSrc = '/node_modules/pdfjs-dist/build/pdf.worker.min.mjs';
    const task = pdf.getDocument({ data: new Uint8Array(bytes) }); const document = await task.promise;
    const page = await document.getPage(1), viewport = page.getViewport({ scale: 1 });
    const canvas = window.document.createElement('canvas'); canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height);
    await page.render({ canvas, viewport }).promise;
    const m = paper.paper!.margin, fit = Math.min(595.28 / (paper.w + 2 * m), 841.89 / (paper.h + 2 * m));
    const pixelY = Math.floor((841.89 - (paper.h + 2 * m) * fit) / 2 + (m + paper.h / 2) * fit);
    const pixel = [...canvas.getContext('2d')!.getImageData(canvas.width - 3, pixelY, 1, 1).data];
    await task.destroy(); return pixel;
  }, { bytes: [...data], paper });
  expect(edge[0]).toBeGreaterThan(180); expect(edge[1]).toBeLessThan(170); expect(edge[2]).toBeLessThan(150);
});

test('preserves existing PDF annotation appearances in the exported document', async ({ page }) => {
  const source = await PDFDocument.load(await fixture(1));
  const appearance = source.context.flateStream('1 0 0 rg 0 0 120 80 re f', { Type: 'XObject', Subtype: 'Form', BBox: [0, 0, 120, 80], Resources: {} });
  const annotation = source.context.obj({ Type: 'Annot', Subtype: 'Stamp', Rect: [40, 40, 160, 120], AP: { N: source.context.register(appearance) }, F: 4 });
  source.getPage(0).node.set(PDFName.of('Annots'), source.context.obj([source.context.register(annotation)]));
  await page.goto('/'); await createBoard(page); await page.locator('#import-file').setInputFiles({ name: 'annotated.pdf', mimeType: 'application/pdf', buffer: Buffer.from(await source.save()) });
  await expect(page.locator('#pdf-import-dialog')).toBeVisible(); await page.locator('#pdf-confirm-import').click();
  await expectPreview(page);
  await page.locator('#export-button').click(); await page.locator('[data-action="export-pdf"]').click();
  const pending = page.waitForEvent('download'); await page.locator('#pdf-confirm-export').click(); const file = await pending;
  const { readFile } = await import('node:fs/promises'); const bytes = [...await readFile((await file.path())!)];
  const red = await page.evaluate(async bytes => {
    const path = '/node_modules/pdfjs-dist/build/pdf.mjs'; const pdf = await import(/* @vite-ignore */ path);
    pdf.GlobalWorkerOptions.workerSrc = '/node_modules/pdfjs-dist/build/pdf.worker.min.mjs';
    const task = pdf.getDocument({ data: new Uint8Array(bytes) }), doc = await task.promise;
    const sheet = await doc.getPage(1), viewport = sheet.getViewport({ scale: 1 });
    const canvas = window.document.createElement('canvas'); canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height);
    await sheet.render({ canvas, viewport }).promise;
    const pixels = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data;
    let red = 0;
    for (let i = 0; i < pixels.length; i += 4) if (pixels[i] > 200 && pixels[i + 1] < 40 && pixels[i + 2] < 40) red++;
    await task.destroy(); return red;
  }, bytes);
  expect(red).toBeGreaterThan(500);
});
