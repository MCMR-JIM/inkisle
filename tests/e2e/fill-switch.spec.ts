import { expect, test, type Page } from '@playwright/test';
import { chooseTool, contextAction } from './helpers';

async function blank(page: Page): Promise<void> {
  await page.goto('/'); await page.getByRole('button', { name: '新建画板', exact: true }).first().click();
}

async function rect(page: Page, x = 500): Promise<void> {
  await chooseTool(page, '矩形'); await page.mouse.move(x, 300); await page.mouse.down(); await page.mouse.move(x + 180, 430); await page.mouse.up();
}

async function elements(page: Page) {
  await expect(page.locator('#save-status')).toContainText('已保存在本机');
  return page.evaluate(async () => {
    const path = '/src/storage/repository.ts'; const { Repository } = await import(/* @vite-ignore */ path);
    const repo = new Repository(); const doc = await repo.load(localStorage.getItem('liubai:last-board')); repo.close(); return doc.elements;
  });
}

test('fill presets contain only colors and choosing one while off keeps new shapes transparent', async ({ page }) => {
  await blank(page);
  await expect(page.getByRole('switch', { name: '填充', exact: true })).not.toBeChecked();
  const colors = await page.locator('#fill-colors [data-color]').evaluateAll(nodes => nodes.map(node => (node as HTMLElement).dataset.color));
  expect(colors).toHaveLength(10); expect(colors).not.toContain('transparent');
  await page.locator('[data-property="fill"][data-color="#deedf5"]').click();
  await expect(page.getByRole('switch', { name: '填充', exact: true })).not.toBeChecked();
  await expect(page.locator('#fill-colors [data-color="#deedf5"]')).toHaveAttribute('aria-pressed', 'true');
  await rect(page); const [off] = await elements(page); expect(off.fill).toBe('transparent'); expect(off.fillColor).toBe('#deedf5');
  await page.locator('#fill-toggle').click(); await rect(page, 800);
  const [, on] = await elements(page); expect(on.fill).toBe('#deedf5');
  await page.locator('#fill-toggle').click(); await expect(page.locator('#fill-colors [data-color="#deedf5"]')).toHaveAttribute('aria-pressed', 'true');
});

test('a selected shape remembers its color across disabling, changing it while off, undo and reload', async ({ page }) => {
  await blank(page); await page.locator('#fill-toggle').click(); await page.locator('[data-property="fill"][data-color="#deedf5"]').click(); await rect(page);
  await chooseTool(page, '选择工具'); await page.mouse.click(590, 300); await page.locator('#fill-toggle').click();
  let [el] = await elements(page); expect(el.fill).toBe('transparent'); expect(el.fillColor).toBe('#deedf5');
  await page.locator('[data-property="fill"][data-color="#f8e3dc"]').click();
  [el] = await elements(page); expect(el.fill).toBe('transparent'); expect(el.fillColor).toBe('#f8e3dc');
  await page.locator('#fill-toggle').click(); [el] = await elements(page); expect(el.fill).toBe('#f8e3dc');
  await page.keyboard.press('Control+z'); await expect(page.locator('#fill-toggle')).not.toBeChecked();
  await page.keyboard.press('Control+Shift+z'); await expect(page.locator('#fill-toggle')).toBeChecked();
  await page.locator('#fill-toggle').click(); await elements(page); await page.reload(); await expect(page.locator('#save-status')).toContainText('已保存在本机'); await page.keyboard.press('Control+a');
  await expect(page.locator('#fill-toggle')).not.toBeChecked(); await expect(page.locator('#fill-colors [data-color="#f8e3dc"]')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('#fill-toggle').click(); [el] = await elements(page); expect(el.fill).toBe('#f8e3dc');
});

test('palette editing while fill is disabled edits the remembered color without enabling fill', async ({ page }) => {
  await blank(page); await page.locator('#fill-palette').click();
  const picker = page.locator('#fill-picker'); await expect(picker.locator('[data-no-fill]')).toHaveCount(0);
  await expect(picker.locator('[data-preset-index][data-color="transparent"]')).toHaveCount(0);
  await picker.locator('[data-preset-index="2"]').click(); await picker.getByLabel('HEX 颜色').fill('#123abc');
  await picker.getByRole('button', { name: '应用颜色' }).click();
  await expect(page.locator('#fill-toggle')).not.toBeChecked(); await expect(page.locator('#fill-palette')).toHaveAttribute('data-current-color', '#123abc');
  await rect(page); expect((await elements(page))[0].fill).toBe('transparent');
  await page.locator('#fill-toggle').click(); await rect(page, 800); expect((await elements(page))[1].fill).toBe('#123abc');
});

test('choosing an unchanged existing palette color still sets the remembered fill while off', async ({ page }) => {
  await blank(page); await page.locator('#fill-palette').click();
  const picker = page.locator('#fill-picker'); await picker.locator('[data-preset-index="4"]').click();
  await picker.getByRole('button', { name: '应用颜色' }).click();
  await expect(page.locator('#fill-toggle')).not.toBeChecked();
  await expect(page.locator('#fill-palette')).toHaveAttribute('data-current-color', '#deedf5');
  await page.locator('#fill-toggle').click(); await rect(page); expect((await elements(page))[0].fill).toBe('#deedf5');
});

test('notes respect disabled fill without leaving a painted header and file import keeps the remembered color', async ({ page }) => {
  await blank(page); await page.locator('[data-property="fill"][data-color="#deedf5"]').click();
  await chooseTool(page, '便签'); await page.mouse.click(600, 400); await page.locator('#text-editor').fill('透明便签'); await page.keyboard.press('Control+Enter');
  const [note] = await elements(page); expect(note.fill).toBe('transparent'); expect(note.fillColor).toBe('#deedf5');
  const pixel = await page.locator('#canvas').evaluate((canvas: HTMLCanvasElement) => [...canvas.getContext('2d')!.getImageData(610, 405, 1, 1).data]);
  expect(pixel.slice(0, 3)).toEqual([248, 249, 246]);
  const downloading = page.waitForEvent('download'); await page.keyboard.press('Control+s'); const file = await downloading;
  await page.locator('#import-file').setInputFiles((await file.path())!); await expect(page.locator('#toast')).toContainText('画板已导入');
  await page.keyboard.press('Control+a'); await expect(page.locator('#fill-toggle')).not.toBeChecked();
  await expect(page.locator('#fill-colors [data-color="#deedf5"]')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('#fill-toggle').click(); expect((await elements(page))[0].fill).toBe('#deedf5');
});

test('multiple selected shapes restore their own fill colors and locked objects remain unchanged', async ({ page }) => {
  await blank(page); await page.locator('#fill-toggle').click(); await page.locator('[data-property="fill"][data-color="#deedf5"]').click(); await rect(page);
  await page.locator('[data-property="fill"][data-color="#f8e3dc"]').click(); await rect(page, 800);
  await chooseTool(page, '选择工具'); await page.keyboard.press('Control+a'); await page.locator('#fill-toggle').click();
  expect((await elements(page)).map((el: { fill: string }) => el.fill)).toEqual(['transparent', 'transparent']);
  await page.locator('#fill-toggle').click(); expect((await elements(page)).map((el: { fill: string }) => el.fill)).toEqual(['#deedf5', '#f8e3dc']);
  await contextAction(page, 'lock'); await expect(page.locator('#fill-toggle')).toBeDisabled();
});

test('old transparent preset preferences migrate in place and the switch fits both themes on mobile', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('liubai:fill-colors', JSON.stringify(['transparent', '#123abc', '#f8e3dc', '#faefc9', '#deedf5', '#eae3f5', '#f8e4ed', '#ddf0ea', '#eee4d9', '#ffffff'])));
  await page.setViewportSize({ width: 320, height: 844 }); await blank(page); await page.locator('#expand-properties').click();
  await expect(page.locator('#fill-colors [data-color="transparent"]')).toHaveCount(0);
  await expect(page.locator('#fill-colors [data-color]').nth(1)).toHaveAttribute('data-color', '#123abc');
  for (let theme = 0; theme < 2; theme++) {
    const toggle = page.locator('#fill-toggle'), panel = (await page.locator('#properties').boundingBox())!, box = (await toggle.boundingBox())!;
    expect(box.x).toBeGreaterThan(panel.x); expect(box.x + box.width).toBeLessThan(panel.x + panel.width); await expect(toggle).toHaveAttribute('data-tooltip', /填充/);
    await toggle.click(); await expect(toggle).not.toBeFocused(); await page.locator('#theme-button').click();
  }
});
