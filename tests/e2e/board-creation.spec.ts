import { expect, test } from '@playwright/test';
import { createBoard, readBoard, selectValue, chooseTool } from './helpers';
import { pdfFixture } from '../fixtures/pdf';
import { elementBounds, intersects } from '../../src/core/geometry';

test('canceling board creation preserves the current board and exposes all three layouts', async ({ page }) => {
  await page.goto('/'); await expect(page.locator('#save-status')).toHaveAttribute('data-state', 'saved');
  const before = await readBoard(page);
  await page.locator('#quick-new').click(); await expect(page.locator('#new-board-dialog')).toBeVisible();
  await expect(page.locator('#board-title')).toHaveValue(before.title);
  await page.locator('#new-board-layout').click();
  await expect(page.locator('#new-board-layout-options [role="option"]')).toHaveCount(3);
  await expect(page.locator('#new-board-layout')).toBeFocused();
  await page.keyboard.press('Escape'); await expect(page.locator('#new-board-dialog')).toBeVisible(); await page.locator('#new-board-close').click();
  expect((await readBoard(page)).id).toBe(before.id);
  await createBoard(page); await expect(page.locator('#pdf-navigation')).toBeHidden();
  await expect(page.locator('#add-paper-button')).toBeVisible();
  await expect(page.locator('#save-status')).toHaveAttribute('data-state', 'draft');
});

for (const layout of ['single', 'double'] as const) test(`a new ${layout} board starts with one blank sheet and retains its layout`, async ({ page }) => {
  await page.goto('/'); await createBoard(page, layout);
  const doc = await readBoard(page);
  expect(doc.elements).toHaveLength(1); expect(doc.elements[0].kind).toBe('paper'); expect(doc.elements[0].paper?.sourceId).toBeUndefined();
  expect(doc.paperLayout).toBe(layout); await expect(page.locator(`#pdf-${layout}`)).toHaveAttribute('aria-pressed', 'true');
  await page.reload(); await expect(page.locator(`#pdf-${layout}`)).toHaveAttribute('aria-pressed', 'true');
  await page.locator('#add-paper-button').click();
  const appended = await readBoard(page), [a, b] = appended.elements;
  expect(appended.elements).toHaveLength(2); expect(intersects(elementBounds(a), elementBounds(b))).toBe(false);
  if (layout === 'double') expect(a.y).toBe(b.y); else expect(b.y).toBeGreaterThan(a.y + a.h);
});

test('importing PDF pages extends the current board without changing existing objects or identity', async ({ page }) => {
  await page.goto('/'); await createBoard(page); await chooseTool(page, '矩形');
  await page.mouse.move(500, 280); await page.mouse.down(); await page.mouse.move(700, 400); await page.mouse.up();
  const before = await readBoard(page);
  await page.locator('#import-file').setInputFiles({ name: 'notes.pdf', mimeType: 'application/pdf', buffer: await pdfFixture() });
  await expect(page.locator('#pdf-import-dialog')).toBeVisible(); await expect(page.locator('#pdf-import-target')).toHaveCount(0);
  await page.locator('#pdf-confirm-import').click();
  const after = await readBoard(page), papers = after.elements.filter(el => el.kind === 'paper');
  expect(after.id).toBe(before.id); expect(after.title).toBe(before.title); expect(after.paperLayout).toBe('single');
  expect(after.elements.find(el => el.id === before.elements[0].id)).toEqual(before.elements[0]);
  expect(papers).toHaveLength(3); expect(elementBounds(papers[0]).y).toBeGreaterThan(elementBounds(before.elements[0]).y + elementBounds(before.elements[0]).h);
  await expect(page.locator('#pdf-page-total')).toHaveText('/ 3');
});

test('creation can preload selected PDF pages and use a double-column layout', async ({ page }) => {
  await page.goto('/'); const before = await readBoard(page);
  await page.locator('#quick-new').click();
  await page.locator('#new-board-document').setInputFiles({ name: 'workbook.pdf', mimeType: 'application/pdf', buffer: await pdfFixture(5) });
  await expect(page.locator('#new-board-pages')).toBeVisible(); await expect(page.locator('#new-board-layout')).toHaveText('单页连续');
  await selectValue(page, '#new-board-layout', 'double'); await page.locator('#new-board-page-range').fill('2-3');
  await page.locator('#confirm-new-board').click(); await expect(page.locator('#new-board-dialog')).toBeHidden();
  const doc = await readBoard(page); expect(doc.id).not.toBe(before.id); expect(doc.title).toBe('workbook');
  expect(doc.paperLayout).toBe('double'); expect(doc.elements.map(el => el.paper?.sourcePage)).toEqual([2, 3]);
  expect(doc.elements[0].y).toBe(doc.elements[1].y); await expect(page.locator('#pdf-double')).toHaveAttribute('aria-pressed', 'true');
});

test('page controls stay in the lower left and history controls stay in the header at desktop widths', async ({ page }) => {
  await page.goto('/'); await createBoard(page, 'single');
  for (const width of [1920, 1440, 1280, 1024, 900]) {
    await page.setViewportSize({ width, height: 844 });
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const geometry = await page.evaluate(() => {
      const box = (selector: string) => document.querySelector(selector)!.getBoundingClientRect().toJSON();
      return { nav: box('#pdf-navigation'), zoom: box('.bottom-right'), toolbar: box('.toolbar'), header: box('.app-header'), history: ['#undo-button', '#redo-button', '#help-button'].map(box) };
    });
    expect(geometry.nav.x).toBeLessThan(30); expect(geometry.nav.y).toBeGreaterThan(600);
    expect(geometry.nav.right).toBeLessThan(geometry.zoom.x); expect(geometry.toolbar.bottom).toBeLessThan(geometry.nav.y);
    for (const box of geometry.history) { expect(box.x).toBeGreaterThanOrEqual(0); expect(box.right).toBeLessThanOrEqual(width); expect(box.bottom).toBeLessThanOrEqual(geometry.header.bottom); }
  }
});
