import { expect, test, type Page } from '@playwright/test';
import { chooseTool } from './helpers';

async function blank(page: Page): Promise<void> {
  await page.goto('/'); await page.getByRole('button', { name: '新建画板', exact: true }).first().click();
}

async function camera(page: Page): Promise<{ x: number; y: number; zoom: number }> {
  await expect(page.locator('#save-status')).toContainText('已保存在本机');
  return page.evaluate(async () => {
    const path = '/src/storage/repository.ts'; const { Repository } = await import(/* @vite-ignore */ path);
    const repo = new Repository(); const doc = await repo.load(localStorage.getItem('liubai:last-board')); repo.close(); return doc.camera;
  });
}

test('clicking controls then the canvas never leaves Space bound to the last button', async ({ page }) => {
  await blank(page);
  await page.evaluate(() => {
    (window as unknown as { unwantedClicks: string[] }).unwantedClicks = [];
    document.addEventListener('click', event => {
      const button = (event.target as Element).closest('button');
      if (button && event.detail === 0) (window as unknown as { unwantedClicks: string[] }).unwantedClicks.push(button.id || button.getAttribute('aria-label') || 'button');
    });
  });
  await page.locator('#theme-button').click(); const theme = await page.locator('html').getAttribute('data-theme');
  await page.mouse.click(1100, 650);
  const before = await camera(page);
  await page.keyboard.down('Space'); await page.mouse.move(1050, 600); await page.mouse.down(); await page.mouse.move(1150, 660, { steps: 4 }); await page.mouse.up(); await page.keyboard.up('Space');
  const after = await camera(page);
  expect(after.x - before.x).toBeCloseTo(100, 3); expect(after.y - before.y).toBeCloseTo(60, 3);
  await expect(page.locator('html')).toHaveAttribute('data-theme', theme!);
  await expect(page.locator('#element-count')).toHaveText('0 个元素');
  expect(await page.evaluate(() => (window as unknown as { unwantedClicks: string[] }).unwantedClicks)).toEqual([]);
});

test('ordinary buttons release pointer focus and Space pans even when a toolbar button retained focus', async ({ page }) => {
  await blank(page); await chooseTool(page, '画笔');
  for (const selector of ['#pressure-toggle', '[data-width="7"]', '[data-dash="true"]', '#zoom-in']) {
    await page.locator(selector).click(); await expect(page.locator(selector)).not.toBeFocused();
  }
  const pressure = await page.locator('#pressure-toggle').getAttribute('aria-checked');
  await page.locator('#pressure-toggle').focus();
  const before = await camera(page);
  await page.keyboard.down('Space'); await page.mouse.move(900, 600); await page.mouse.down(); await page.mouse.move(980, 630); await page.mouse.up(); await page.keyboard.up('Space');
  const after = await camera(page);
  expect(after.x - before.x).toBeCloseTo(80, 3); expect(after.y - before.y).toBeCloseTo(30, 3);
  await expect(page.locator('#pressure-toggle')).toHaveAttribute('aria-checked', pressure!);
  await expect(page.locator('#element-count')).toHaveText('0 个元素');
});

test('closed custom selects and menu items do not catch Space after pointer selection', async ({ page }) => {
  await blank(page);
  await page.locator('#font-size').click(); await page.getByRole('option', { name: '40 px', exact: true }).click();
  await expect(page.locator('#font-size')).not.toBeFocused();
  await page.keyboard.down('Space'); await page.keyboard.up('Space'); await expect(page.locator('#font-size')).toHaveAttribute('aria-expanded', 'false');
  await chooseTool(page, '矩形'); await page.mouse.click(1000, 700);
  const before = await camera(page);
  await page.keyboard.down('Space'); await page.mouse.move(950, 600); await page.mouse.down(); await page.mouse.move(1020, 640); await page.mouse.up(); await page.keyboard.up('Space');
  const after = await camera(page); expect(after.x - before.x).toBeCloseTo(70, 3);
  await expect(page.locator('#element-count')).toHaveText('1 个元素');
});

test('text and color inputs keep spaces while canvas clicks restore workspace focus', async ({ page }) => {
  await blank(page); await chooseTool(page, '文字'); await page.mouse.click(600, 400);
  await page.locator('#text-editor').fill('Hello'); await page.keyboard.press('End'); await page.keyboard.press('Space'); await page.keyboard.type('world');
  await expect(page.locator('#text-editor')).toHaveValue('Hello world');
  await page.keyboard.press('Control+Enter'); await chooseTool(page, '选择工具'); await page.mouse.click(1100, 650); await expect(page.locator('#interaction-canvas')).toBeFocused();
  await page.locator('#stroke-palette').click(); await page.locator('#stroke-hex').fill('#123456');
  await page.keyboard.press('Space'); await expect(page.locator('#stroke-picker')).toBeVisible();
  await page.keyboard.press('Escape'); await page.mouse.click(1100, 700); await expect(page.locator('#interaction-canvas')).toBeFocused();
});
