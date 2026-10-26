import { expect, test } from '@playwright/test';
import { createBoard, readBoard, selectValue } from './helpers';
import { orientationFixture } from '../fixtures/pdf-orientation';

test('import preview confirms rotation, preserves original page orientations, and supports undo after import', async ({ page }) => {
  await page.goto('/'); await createBoard(page);
  await page.locator('#import-file').setInputFiles({ name: 'orientation.pdf', mimeType: 'application/pdf', buffer: await orientationFixture() });
  const preview = page.locator('#pdf-import-orientation-canvas'); await expect(preview).toBeVisible();
  expect(await preview.evaluate((c: HTMLCanvasElement) => c.width < c.height)).toBe(true);
  await selectValue(page, '#pdf-import-orientation-angle', 90);
  await expect.poll(() => preview.evaluate((c: HTMLCanvasElement) => !c.hidden && c.width > c.height)).toBe(true);
  await page.screenshot({ path: '.cache/pdf-example/pdf-orientation-import.png' });
  await page.locator('#pdf-confirm-import').click();
  const before = await readBoard(page); expect(before.elements.map(p => p.w > p.h)).toEqual([true, false, false]);
  expect(before.elements.every(p => p.paper!.sourceRotation === 90)).toBe(true);
  await expect.poll(() => page.locator('#canvas').evaluate((canvas: HTMLCanvasElement, doc) => {
    const paper = doc.elements[0], camera = doc.camera, ratio = canvas.width / innerWidth;
    const color = canvas.getContext('2d')!.getImageData(((paper.x + paper.w * .8) * camera.zoom + camera.x) * ratio, ((paper.y + paper.h * .75) * camera.zoom + camera.y) * ratio, 1, 1).data;
    return color[0] < 40 && color[1] > 120 && color[2] < 40;
  }, before)).toBe(true);
  await page.locator('#pdf-rotate-left').click();
  const after = await readBoard(page); expect(after.elements[0].paper!.sourceRotation).toBe(0); expect(after.elements[0].h).toBeGreaterThan(after.elements[0].w);
  await page.keyboard.press('Control+z'); expect((await readBoard(page)).elements).toEqual(before.elements);
  await page.reload(); expect((await readBoard(page)).elements).toEqual(before.elements);
});

test('default imports preserve landscape and PDF rotation metadata without rasterizing every page', async ({ page }) => {
  await page.goto('/'); await createBoard(page);
  await page.locator('#import-file').setInputFiles({ name: 'mixed.pdf', mimeType: 'application/pdf', buffer: await orientationFixture() });
  await page.locator('#pdf-import-orientation-next').click();
  await expect.poll(() => page.locator('#pdf-import-orientation-canvas').evaluate((c: HTMLCanvasElement) => !c.hidden && c.width > c.height)).toBe(true);
  await page.locator('#pdf-confirm-import').click();
  expect((await readBoard(page)).elements.map(p => p.w > p.h)).toEqual([false, true, true]);
});

test('initial-document creation reuses orientation preview and cancels stale previews when the file is removed', async ({ page }) => {
  await page.goto('/'); await page.locator('#quick-new').click();
  await page.locator('#new-board-document').setInputFiles({ name: 'initial.pdf', mimeType: 'application/pdf', buffer: await orientationFixture() });
  await expect(page.locator('#new-board-orientation-canvas')).toBeVisible();
  await selectValue(page, '#new-board-orientation-angle', 270);
  await page.locator('#new-board-page-range').fill('2');
  await expect(page.locator('#new-board-orientation-page')).toHaveText('第 2 页 / 3 页');
  await page.screenshot({ path: '.cache/pdf-example/pdf-orientation-create.png' });
  await page.locator('#confirm-new-board').click();
  const doc = await readBoard(page); expect(doc.elements).toHaveLength(1); expect(doc.elements[0].paper!.sourceRotation).toBe(270); expect(doc.elements[0].h).toBeGreaterThan(doc.elements[0].w);
  await page.locator('#quick-new').click(); await page.locator('#new-board-document').setInputFiles({ name: 'remove.pdf', mimeType: 'application/pdf', buffer: await orientationFixture() });
  await expect(page.locator('#new-board-pages')).toBeVisible(); await page.locator('#new-board-clear-document').click();
  await expect(page.locator('#new-board-orientation')).toBeHidden(); await expect(page.locator('#confirm-new-board')).toBeEnabled();
});

test('PDF vector export matches the original PDF renderer for every quarter turn including intrinsic rotations', async ({ page }) => {
  await page.goto('/'); await expect(page.locator('#save-status[data-state="saved"]')).toBeVisible(); const source = [...await orientationFixture()];
  const results = await page.evaluate(async bytes => {
    const pdfPath = '/src/engine/pdf.ts', modelPath = '/src/core/model.ts', geometryPath = '/src/core/geometry.ts', paperPath = '/src/core/paper.ts';
    const pdf = await import(/* @vite-ignore */ pdfPath), { fitPaperSource } = await import(/* @vite-ignore */ paperPath);
    const { createDocument } = await import(/* @vite-ignore */ modelPath), { elementBounds } = await import(/* @vite-ignore */ geometryPath);
    const source = await pdf.inspectPdf(new File([new Uint8Array(bytes)], 'rotate.pdf', { type: 'application/pdf' }));
    const pdfjsPath = '/node_modules/pdfjs-dist/build/pdf.mjs', pdfjs = await import(/* @vite-ignore */ pdfjsPath);
    pdfjs.GlobalWorkerOptions.workerSrc = '/node_modules/pdfjs-dist/build/pdf.worker.min.mjs';
    const sourceTask = pdfjs.getDocument({ data: new Uint8Array(bytes) }), sourceDoc = await sourceTask.promise;
    const green = (canvas: HTMLCanvasElement) => {
      const data = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data;
      let x = 0, y = 0, count = 0;
      for (let i = 0; i < data.length; i += 4) if (data[i] < 40 && data[i + 1] > 120 && data[i + 2] < 40 && data[i + 3] > 240) { x += (i / 4) % canvas.width; y += Math.floor(i / 4 / canvas.width); count++; }
      return { x: x / count, y: y / count, count };
    };
    const results = [];
    for (const number of [1, 3]) for (const rotation of [0, 90, 180, 270]) {
      const doc = createDocument(); doc.elements = await pdf.importedPages(source.id, [number], 0, 0, rotation);
      const paper = doc.elements[0], bounds = elementBounds(paper);
      const originalPage = await sourceDoc.getPage(number), originalViewport = originalPage.getViewport({ scale: 1, rotation: (originalPage.rotate + rotation) % 360 });
      const canvas = document.createElement('canvas'); canvas.width = originalViewport.width; canvas.height = originalViewport.height;
      await originalPage.render({ canvas, viewport: originalViewport }).promise; const original = green(canvas);
      const target = fitPaperSource(paper, originalViewport.width, originalViewport.height);
      const exported = await pdf.exportPdf(doc, '1', new AbortController().signal, () => {});
      const task = pdfjs.getDocument({ data: new Uint8Array(await exported.arrayBuffer()) }), output = await task.promise;
      const outputPage = await output.getPage(1), viewport = outputPage.getViewport({ scale: 1 });
      const surface = document.createElement('canvas'); surface.width = Math.ceil(viewport.width); surface.height = Math.ceil(viewport.height);
      await outputPage.render({ canvas: surface, viewport }).promise; const actual = green(surface);
      const fit = Math.min(viewport.width / bounds.w, viewport.height / bounds.h);
      const expected = { x: (target.x - bounds.x + original.x / canvas.width * target.w) * fit + (viewport.width - bounds.w * fit) / 2, y: (target.y - bounds.y + original.y / canvas.height * target.h) * fit + (viewport.height - bounds.h * fit) / 2 };
      results.push({ number, rotation, original, actual, count: actual.count, dx: Math.abs(actual.x - expected.x), dy: Math.abs(actual.y - expected.y), landscape: viewport.width > viewport.height, expectedLandscape: paper.w > paper.h });
      canvas.width = surface.width = 0; await task.destroy();
    }
    await sourceTask.destroy();
    return results;
  }, source);
  for (const result of results) {
    expect(result.count, JSON.stringify(result)).toBeGreaterThan(100); expect(result.dx, JSON.stringify(result)).toBeLessThan(2); expect(result.dy, JSON.stringify(result)).toBeLessThan(2); expect(result.landscape).toBe(result.expectedLandscape);
  }
});
