import type { Page } from '@playwright/test';

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
