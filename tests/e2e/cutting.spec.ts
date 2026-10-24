import { expect, test, type Page } from '@playwright/test';
import { createBoard, chooseTool } from './helpers';

async function blank(page: Page): Promise<void> {
  await page.goto('/');
  await createBoard(page);
}

async function eraseVertical(page: Page, x = 650): Promise<void> {
  await page.getByRole('button', { name: '橡皮擦', exact: true }).click();
  await page.mouse.move(x, 270); await page.mouse.down(); await page.mouse.move(x, 530, { steps: 8 }); await page.mouse.up();
}

async function pixel(page: Page, x: number, y: number): Promise<number[]> {
  await page.evaluate(() => new Promise(requestAnimationFrame));
  return page.locator('#canvas').evaluate((canvas: HTMLCanvasElement, [x, y]) => [...canvas.getContext('2d')!.getImageData(x, y, 1, 1).data], [x, y]);
}

test('cut line halves move independently, undo as one gesture and survive source-file round trips', async ({ page }) => {
  await blank(page);
  await chooseTool(page, '线条');
  await page.mouse.move(500, 370); await page.mouse.down(); await page.mouse.move(800, 370); await page.mouse.up();
  await eraseVertical(page);
  await expect(page.locator('#element-count')).toHaveText('2 个元素');
  await page.keyboard.press('Control+z'); await expect(page.locator('#element-count')).toHaveText('1 个元素');
  await page.keyboard.press('Control+Shift+z'); await expect(page.locator('#element-count')).toHaveText('2 个元素');
  await page.getByRole('button', { name: '选择工具', exact: true }).click();
  await page.mouse.move(560, 370); await page.mouse.down(); await page.mouse.move(560, 450); await page.mouse.up();
  expect((await pixel(page, 560, 450))[0]).toBeLessThan(100);
  expect((await pixel(page, 740, 370))[0]).toBeLessThan(100);
  expect((await pixel(page, 740, 450)).slice(0, 3)).toEqual([248, 249, 246]);
  await expect(page.locator('#save-status')).toContainText('已保存在本机');
  await page.reload(); await expect(page.locator('#element-count')).toHaveText('2 个元素');
  await expect(page.locator('#save-status')).toContainText('已保存在本机');
  const downloading = page.waitForEvent('download'); await page.keyboard.press('Control+s');
  const file = await downloading;
  await page.locator('#import-file').setInputFiles((await file.path())!);
  await expect(page.locator('#toast')).toContainText('画板已导入');
  expect((await pixel(page, 560, 450))[0]).toBeLessThan(100);
  expect((await pixel(page, 740, 370))[0]).toBeLessThan(100);
});

test('a cut outline is independently selectable open paths with no edge across the cut', async ({ page }) => {
  await blank(page);
  await chooseTool(page, '矩形');
  await page.mouse.move(500, 300); await page.mouse.down(); await page.mouse.move(800, 500); await page.mouse.up();
  await eraseVertical(page);
  await expect(page.locator('#element-count')).toHaveText('2 个元素');
  await page.getByRole('button', { name: '选择工具', exact: true }).click();
  await page.mouse.move(500, 390); await page.mouse.down(); await page.mouse.move(480, 430); await page.mouse.up();
  expect((await pixel(page, 480, 430))[0]).toBeLessThan(100);
  expect((await pixel(page, 800, 390))[0]).toBeLessThan(100);
  expect((await pixel(page, 630, 430)).slice(0, 3)).toEqual([248, 249, 246]);
});

test('a filled shape splits only on a through-cut and its fragments remain editable after reopening', async ({ page }) => {
  await blank(page);
  await chooseTool(page, '矩形');
  await page.mouse.move(500, 300); await page.mouse.down(); await page.mouse.move(800, 500); await page.mouse.up();
  await chooseTool(page, '选择工具'); await page.mouse.click(650, 300);
  await page.locator('[data-property="fill"][data-color="#e6eee5"]').click();
  await page.locator('#fill-toggle').click();
  await page.getByRole('button', { name: '橡皮擦', exact: true }).click();
  await page.mouse.click(580, 400);
  await expect(page.locator('#element-count')).toHaveText('1 个元素');
  expect((await pixel(page, 580, 400)).slice(0, 3)).toEqual([248, 249, 246]);
  await eraseVertical(page);
  await expect(page.locator('#element-count')).toHaveText('2 个元素');
  await page.getByRole('button', { name: '选择工具', exact: true }).click();
  await page.mouse.move(550, 370); await page.mouse.down(); await page.mouse.move(550, 450); await page.mouse.up();
  expect((await pixel(page, 580, 480)).slice(0, 3)).toEqual([248, 249, 246]);
  expect((await pixel(page, 740, 370)).slice(0, 3)).toEqual([230, 238, 229]);
  await page.locator('[data-property="fill"][data-color="#f8e3dc"]').click();
  expect((await pixel(page, 550, 450)).slice(0, 3)).toEqual([248, 227, 220]);
  expect((await pixel(page, 740, 370)).slice(0, 3)).toEqual([230, 238, 229]);
  await expect(page.locator('#save-status')).toContainText('已保存在本机');
  await page.reload(); await expect(page.locator('#element-count')).toHaveText('2 个元素');
  expect((await pixel(page, 550, 450)).slice(0, 3)).toEqual([248, 227, 220]);
});

test('cutting a freehand stroke retains independent left and right pieces', async ({ page }) => {
  await blank(page);
  await chooseTool(page, '画笔');
  await page.mouse.move(500, 370); await page.mouse.down();
  for (let i = 1; i <= 30; i++) await page.mouse.move(500 + i * 10, 370 + Math.sin(i / 4) * 20);
  await page.mouse.up(); await eraseVertical(page);
  await expect(page.locator('#element-count')).toHaveText('2 个元素');
  await page.getByRole('button', { name: '选择工具', exact: true }).click();
  await page.mouse.click(550, 389);
  await expect(page.locator('#selection-label')).toHaveText('已选择 1 个元素');
  await page.keyboard.press('Delete'); await expect(page.locator('#element-count')).toHaveText('1 个元素');
  await page.keyboard.press('Control+z'); await expect(page.locator('#element-count')).toHaveText('2 个元素');
});

test('split vector paths export consistently to PNG and SVG', async ({ page }) => {
  await blank(page);
  await chooseTool(page, '椭圆');
  await page.mouse.move(500, 300); await page.mouse.down(); await page.mouse.move(800, 500); await page.mouse.up();
  await chooseTool(page, '选择工具'); await page.mouse.click(650, 300);
  await page.locator('[data-property="fill"][data-color="#e6eee5"]').click();
  await page.locator('#fill-toggle').click();
  await eraseVertical(page); await expect(page.locator('#element-count')).toHaveText('2 个元素');
  await expect(page.locator('#save-status')).toContainText('已保存在本机');
  const result = await page.evaluate(async () => {
    const load = (path: string) => import(/* @vite-ignore */ path);
    const { Repository } = await load('/src/storage/repository.ts');
    const { unionBounds } = await load('/src/core/geometry.ts');
    const { exportPNG, exportSVG } = await load('/src/engine/export.ts');
    const repo = new Repository(); const doc = await repo.load(localStorage.getItem('liubai:last-board')); repo.close();
    const bounds = unionBounds(doc.elements);
    const svg = exportSVG(doc);
    const read = async (blob: Blob, padding: number) => {
      const url = URL.createObjectURL(blob), image = new Image(); image.src = url; await image.decode();
      const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
      const ctx = canvas.getContext('2d')!; ctx.drawImage(image, 0, 0);
      const scale = image.width / (bounds.w + padding * 2);
      const colors = [[550, 400], [650, 400], [750, 400]].map(([x, y]) => [...ctx.getImageData(Math.round((x - bounds.x + padding) * scale), Math.round((y - bounds.y + padding) * scale), 1, 1).data]);
      URL.revokeObjectURL(url); return colors;
    };
    return { png: await read(await exportPNG(doc), 48), svg: await read(svg, 40), xml: await svg.text() };
  });
  for (const colors of [result.png, result.svg]) {
    expect(colors[0].slice(0, 3)).toEqual([230, 238, 229]);
    expect(colors[1].slice(0, 3)).toEqual([248, 249, 246]);
    expect(colors[2].slice(0, 3)).toEqual([230, 238, 229]);
  }
  expect(result.xml).toContain('fill-rule="evenodd"');
});

test('undo while geometry is running never resurrects a cut and redo restores the finished fragments', async ({ page }) => {
  await blank(page);
  await chooseTool(page, '线条');
  await page.mouse.move(500, 370); await page.mouse.down(); await page.mouse.move(800, 370); await page.mouse.up();
  await page.getByRole('button', { name: '橡皮擦', exact: true }).click();
  await page.mouse.move(650, 270); await page.mouse.down(); await page.mouse.move(650, 530);
  await page.mouse.up(); await page.keyboard.press('Control+z');
  await expect(page.locator('#element-count')).toHaveText('1 个元素');
  expect((await pixel(page, 650, 370))[0]).toBeLessThan(100);
  await page.keyboard.press('Control+Shift+z');
  await expect(page.locator('#element-count')).toHaveText('2 个元素');
  expect((await pixel(page, 650, 370)).slice(0, 3)).toEqual([248, 249, 246]);
});
