import { expect, type Page } from '@playwright/test';
import type { BoardDocument } from '../../src/core/model';

export async function createBoard(page: Page, layout: 'infinite' | 'single' | 'double' = 'infinite'): Promise<void> {
  await page.locator('#quick-new').click();
  if (layout !== 'infinite') await selectValue(page, '#new-board-layout', layout);
  await page.locator('#confirm-new-board').click();
  await expect(page.locator('#new-board-dialog')).toBeHidden();
}

export async function readBoard(page: Page): Promise<BoardDocument> {
  await expect(page.locator('#save-status[data-state="saved"]')).toBeVisible();
  return page.evaluate(async () => {
    const path = '/src/storage/repository.ts'; const { Repository } = await import(/* @vite-ignore */ path);
    const repo = new Repository(); const doc = await repo.load(localStorage.getItem('liubai:last-board')); repo.close(); return doc!;
  });
}

export async function selectValue(page: Page, selector: string, value: string | number): Promise<void> {
  const trigger = page.locator(selector);
  await trigger.click();
  const list = page.locator(`#${await trigger.getAttribute('aria-controls')}`);
  await list.locator(`[role="option"][data-value="${value}"]`).click();
}

const familyChildren: Record<string, string> = {
  轨迹识别: 'shapes', 矩形: 'shapes', 圆角矩形: 'shapes', 椭圆: 'shapes', 菱形: 'shapes', 三角形: 'shapes', 五边形: 'shapes', 六边形: 'shapes',
  线条: 'lines', 箭头: 'lines', 双向箭头: 'lines',
};
const childIds: Record<string, string> = {
  轨迹识别: 'recognize', 矩形: 'rect', 圆角矩形: 'roundrect', 椭圆: 'ellipse', 菱形: 'diamond', 三角形: 'triangle', 五边形: 'pentagon', 六边形: 'hexagon',
  线条: 'line', 箭头: 'arrow', 双向箭头: 'bidirectional-arrow',
};

export async function chooseTool(page: Page, label: string): Promise<void> {
  const family = familyChildren[label];
  if (!family) { await page.getByRole('button', { name: label, exact: true }).click(); return; }
  const button = page.locator(`[data-family="${family}"]`);
  if (await button.getAttribute('aria-expanded') !== 'true') await button.click();
  await page.locator(`[data-tool-child="${childIds[label]}"]`).click();
}

export async function openContextMenu(page: Page): Promise<void> {
  const viewport = page.viewportSize()!;
  await page.mouse.click(viewport.width - 16, 110, { button: 'right' });
}

export async function contextAction(page: Page, action: string): Promise<void> {
  await openContextMenu(page);
  await page.locator(`#context-menu [data-action="${action}"]`).click();
}
