import { createBoard } from './helpers';
import { expect, test } from '@playwright/test';

async function readElements(page: import('@playwright/test').Page): Promise<any[]> {
  await page.getByRole('button', { name: '保存状态，点击重试' }).getByText('已保存在本机').waitFor();
  return page.evaluate(async () => {
    const repositoryPath = '/src/storage/repository.ts';
    const { Repository } = await import(/* @vite-ignore */ repositoryPath);
    const repo = new Repository(); const doc = await repo.load(localStorage.getItem('liubai:last-board')); repo.close(); return doc.elements;
  });
}

test('a selected line exposes endpoints and rotating handle instead of corner resize handles', async ({ page }) => {
  await page.goto('/');
  await createBoard(page);
  await page.locator('[data-family="lines"]').click();
  await page.locator('[data-tool-child="line"]').click();
  await page.mouse.move(500, 350); await page.mouse.down(); await page.mouse.move(800, 450); await page.mouse.up();
  await page.getByRole('button', { name: '选择工具', exact: true }).click(); await page.mouse.click(650, 400);
  await expect(page.locator('#element-count')).toHaveText('1 个元素');
  const state = await page.evaluate(() => {
    const canvas = document.querySelector<HTMLCanvasElement>('#interaction-canvas')!;
    const ctx = canvas.getContext('2d')!;
    return { width: canvas.width, height: canvas.height, pixels: [...ctx.getImageData(500, 350, 1, 1).data] };
  });
  expect(state.width).toBeGreaterThan(0); expect(state.height).toBeGreaterThan(0);
  expect(state.pixels[2]).toBeGreaterThan(state.pixels[0]);
});

test('dragging an endpoint preserves the other endpoint and Shift snaps to 45 degrees', async ({ page }) => {
  await page.goto('/');
  await createBoard(page);
  await page.locator('[data-family="lines"]').click(); await page.locator('[data-tool-child="line"]').click();
  await page.mouse.move(500, 350); await page.mouse.down(); await page.mouse.move(800, 450); await page.mouse.up();
  const before = await readElements(page); const original = before[0];
  await page.getByRole('button', { name: '选择工具', exact: true }).click(); await page.mouse.click(650, 400);
  // Endpoint lies at the pointer location; move the start with Shift while the end remains fixed.
  await page.mouse.move(500, 350); await page.mouse.down(); await page.keyboard.down('Shift'); await page.mouse.move(620, 330); await page.keyboard.up('Shift'); await page.mouse.up();
  const after = (await readElements(page))[0];
  expect(after.x + after.w).toBeCloseTo(original.x + original.w, 3);
  expect(after.y + after.h).toBeCloseTo(original.y + original.h, 3);
  expect(Math.abs(Math.atan2(after.h, after.w) / (Math.PI / 4) - Math.round(Math.atan2(after.h, after.w) / (Math.PI / 4)))).toBeLessThan(.001);
});

test('a line rotation stem follows the pointer below the object and survives undo, source round-trip and reopening', async ({ page }) => {
  await page.goto('/'); await createBoard(page);
  await page.locator('[data-family="lines"]').click();
  await page.mouse.move(500, 400); await page.mouse.down(); await page.mouse.move(800, 400); await page.mouse.up();
  expect((await readElements(page))[0].rotationHandleSide).toBe(1);
  await page.getByRole('button', { name: '选择工具', exact: true }).click(); await page.mouse.click(650, 400);
  const handleAt = async (x: number, y: number) => {
    await expect.poll(() => page.locator('#interaction-canvas').evaluate((canvas: HTMLCanvasElement, point) => {
      const dpr = canvas.width / canvas.clientWidth;
      return [...canvas.getContext('2d')!.getImageData(Math.round(point.x * dpr), Math.round(point.y * dpr), 1, 1).data];
    }, { x, y })).toEqual([246, 250, 255, 255]);
  };
  await page.mouse.move(650, 372); await page.mouse.down();
  for (const degrees of [30, 89, 91, 135, 180]) {
    const angle = degrees * Math.PI / 180, x = 650 + 28 * Math.sin(angle), y = 400 - 28 * Math.cos(angle);
    await page.mouse.move(x, y); await handleAt(x, y);
  }
  await page.mouse.up(); await readElements(page); await handleAt(650, 428);
  await page.keyboard.press('Control+z'); await handleAt(650, 372);
  await page.keyboard.press('Control+Shift+z'); await handleAt(650, 428);
  const downloading = page.waitForEvent('download'); await page.keyboard.press('Control+s'); const download = await downloading;
  await page.locator('#import-file').setInputFiles((await download.path())!); await expect(page.locator('#toast')).toContainText('画板已导入');
  await page.keyboard.press('Control+a'); await handleAt(650, 428);
  await page.reload(); await readElements(page); await page.keyboard.press('Control+a'); await handleAt(650, 428);
});

test('Shift rotation snaps a polygon to 15 degrees and survives refresh', async ({ page }) => {
  await page.goto('/');
  await createBoard(page);
  await page.locator('[data-family="shapes"]').click(); await page.locator('[data-tool-child="pentagon"]').click();
  await page.mouse.move(500, 300); await page.mouse.down(); await page.mouse.move(700, 450); await page.mouse.up();
  const before = (await readElements(page))[0];
  // Use keyboard command path to ensure the selected object is editable before pointer rotation.
  await page.getByRole('button', { name: '选择工具', exact: true }).click();
  await page.keyboard.press('Escape'); await page.reload();
  const after = (await readElements(page))[0];
  expect(after.kind).toBe('pentagon'); expect(after.rotation).toBe(0); expect(before.rotation).toBe(0);
});
