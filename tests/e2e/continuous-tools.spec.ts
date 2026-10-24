import { expect, test, type Page } from '@playwright/test';
import { createBoard, chooseTool } from './helpers';

async function blank(page: Page) {
  await page.goto('/'); await createBoard(page);
}

test('shape, line and recognition tools stay active across consecutive gestures without selecting the result', async ({ page }) => {
  await blank(page);
  let count = 0;
  for (const [label, tool] of [['矩形', 'rect'], ['圆角矩形', 'roundrect'], ['椭圆', 'ellipse'], ['箭头', 'arrow'], ['双向箭头', 'bidirectional-arrow'], ['轨迹识别', 'recognize']]) {
    await chooseTool(page, label);
    for (let i = 0; i < 2; i++) {
      await page.mouse.move(500 + i * 250, 340); await page.mouse.down();
      await page.mouse.move(650 + i * 250, 460, { steps: 12 }); await page.mouse.up();
      count++;
      await expect(page.locator('#element-count')).toHaveText(`${count} 个元素`);
      await expect(page.locator(`[data-tool-child="${tool}"]`)).toHaveAttribute('aria-selected', 'true');
      await expect(page.locator('[data-family="select"]')).toHaveAttribute('aria-pressed', 'false');
      await expect(page.locator('#selection-status')).toBeHidden();
    }
  }
  await chooseTool(page, '选择工具'); await page.keyboard.press('Control+a');
  await expect(page.locator('#selection-label')).toHaveText(`已选择 ${count} 个元素`);
});

test('finishing text and notes preserves their tool and allows another item', async ({ page }) => {
  await blank(page);
  let count = 0;
  for (const [label, family] of [['文字', 'text'], ['便签', 'note']]) {
    await chooseTool(page, label);
    for (let i = 0; i < 2; i++) {
      await page.mouse.click(500 + i * 250, 350);
      await page.locator('#text-editor').fill(`${label} ${i + 1}`); await page.keyboard.press('Control+Enter');
      count++;
      await expect(page.locator('#element-count')).toHaveText(`${count} 个元素`);
      await expect(page.locator(`[data-family="${family}"]`)).toHaveAttribute('aria-pressed', 'true');
      await expect(page.locator('#selection-status')).toBeHidden();
    }
  }
  await page.keyboard.press('Escape'); await expect(page.locator('[data-family="select"]')).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('Control+a'); await expect(page.locator('#selection-label')).toHaveText('已选择 4 个元素');
});

test('Ctrl wheel zoom uses small steps, anchors the pointer and persists both new range limits', async ({ page }) => {
  await blank(page);
  await page.locator('#board-title').fill('Zoom memory'); await page.locator('#board-title').blur();
  await page.mouse.move(700, 430); await page.keyboard.down('Control'); await page.mouse.wheel(0, -100); await page.keyboard.up('Control');
  await expect.poll(async () => parseFloat((await page.locator('#zoom-value').textContent())!)).toBeGreaterThan(100);
  expect(parseFloat((await page.locator('#zoom-value').textContent())!)).toBeLessThan(111);
  await expect(page.locator('#save-status')).toContainText('已保存在本机');
  const camera = await page.evaluate(async () => {
    const path = '/src/storage/repository.ts'; const { Repository } = await import(/* @vite-ignore */ path);
    const repo = new Repository(); const doc = await repo.load(localStorage.getItem('liubai:last-board')); repo.close(); return doc.camera;
  });
  expect((700 - camera.x) / camera.zoom).toBeCloseTo(700, 7);
  expect((430 - camera.y) / camera.zoom).toBeCloseTo(430, 7);
  for (const [delta, expected] of [[-10000, '2000%'], [10000, '1%']] as const) {
    await page.locator('#interaction-canvas').evaluate((canvas, delta) => {
      for (let i = 0; i < 45; i++) canvas.dispatchEvent(new WheelEvent('wheel', { ctrlKey: true, deltaY: delta, clientX: 700, clientY: 430, bubbles: true, cancelable: true }));
    }, delta);
    await expect(page.locator('#zoom-value')).toHaveText(expected);
    await expect(page.locator('#save-status')).toContainText('已保存在本机');
    await page.reload(); await expect(page.locator('#zoom-value')).toHaveText(expected);
  }
});
