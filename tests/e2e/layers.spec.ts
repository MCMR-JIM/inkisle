import { expect, test, type Page } from '@playwright/test';
import { chooseTool } from './helpers';
import type { BoardElement } from '../../src/core/model';
import type { RenderState } from '../../src/engine/renderer';

async function read(page: Page): Promise<BoardElement[]> {
  await expect(page.locator('#save-status')).toContainText('已保存在本机');
  return page.evaluate(async () => {
    const path = '/src/storage/repository.ts'; const { Repository } = await import(/* @vite-ignore */ path);
    const repo = new Repository(); const doc = await repo.load(localStorage.getItem('liubai:last-board')); repo.close(); return doc.elements;
  });
}

async function stack(page: Page): Promise<BoardElement[]> {
  await page.goto('/'); await page.locator('#quick-new').click(); await page.locator('#fill-toggle').click();
  await page.locator('[data-property="fill"][data-color="#f8e3dc"]').click(); await chooseTool(page, '矩形');
  await page.mouse.move(480, 300); await page.mouse.down(); await page.mouse.move(780, 520); await page.mouse.up();
  await page.locator('[data-property="fill"][data-color="#deedf5"]').click();
  await page.mouse.move(600, 350); await page.mouse.down(); await page.mouse.move(900, 570); await page.mouse.up();
  await chooseTool(page, '选择工具'); return read(page);
}

async function pixel(page: Page, x = 670, y = 410): Promise<number[]> {
  await page.evaluate(() => new Promise(requestAnimationFrame));
  return page.evaluate(({ x, y }) => {
    const main = document.querySelector<HTMLCanvasElement>('#canvas')!, overlay = document.querySelector<HTMLCanvasElement>('#interaction-canvas')!;
    const canvas = document.createElement('canvas'); canvas.width = main.width; canvas.height = main.height;
    const ctx = canvas.getContext('2d')!; ctx.drawImage(main, 0, 0); ctx.drawImage(overlay, 0, 0);
    const dpr = main.width / main.clientWidth; return [...ctx.getImageData(Math.round(x * dpr), Math.round(y * dpr), 1, 1).data];
  }, { x, y });
}

test('selected content, halo and moving preview stay below upper objects instead of being raised to the overlay', async ({ page }) => {
  const before = await stack(page); const original = await pixel(page);
  await page.mouse.click(520, 410); await expect(page.locator('#selection-label')).toHaveText('已选择 1 个元素');
  expect(await pixel(page)).toEqual(original);
  // The lower object's right edge is entirely covered by the upper object.
  expect((await pixel(page, 784, 430)).slice(0, 3)).toEqual([222, 237, 245]);
  await page.mouse.move(520, 410); await page.mouse.down(); await page.mouse.move(560, 430, { steps: 4 });
  expect(await pixel(page)).toEqual(original);
  await page.mouse.up(); expect(await pixel(page)).toEqual(original);
  const after = await read(page); expect(after.map(el => el.id)).toEqual(before.map(el => el.id));
  expect(after[0].x).toBe(before[0].x + 40);
});

test('transparent upper objects are composited only once while selecting and dragging lower content', async ({ page }) => {
  await stack(page); await page.mouse.click(850, 450);
  await page.locator('#opacity').fill('50'); await page.locator('#opacity').dispatchEvent('change');
  await read(page); await page.mouse.click(1100, 700); const before = await pixel(page);
  await page.mouse.click(520, 410); expect(await pixel(page)).toEqual(before);
  await page.mouse.move(520, 410); await page.mouse.down(); await page.mouse.move(550, 420, { steps: 3 });
  expect(await pixel(page)).toEqual(before); await page.mouse.up(); expect(await pixel(page)).toEqual(before);
});

test('single-step buttons and top/bottom operations preserve selection, undo, persisted order and visual occlusion', async ({ page }) => {
  const initial = await stack(page); await page.mouse.click(520, 410);
  await page.locator('#bring-forward').click(); expect((await read(page)).map(el => el.id)).toEqual([initial[1].id, initial[0].id]);
  expect((await pixel(page)).slice(0, 3)).toEqual([248, 227, 220]);
  await page.locator('#send-backward').click(); expect((await read(page)).map(el => el.id)).toEqual(initial.map(el => el.id));
  expect((await pixel(page)).slice(0, 3)).toEqual([222, 237, 245]);
  await page.locator('#bring-front').click(); await read(page); await page.keyboard.press('Control+z'); expect((await read(page)).map(el => el.id)).toEqual(initial.map(el => el.id));
  await page.keyboard.press('Control+Shift+z'); expect((await read(page)).at(-1)!.id).toBe(initial[0].id);
  await page.locator('#send-back').click(); expect((await read(page))[0].id).toBe(initial[0].id);
  await page.reload(); expect((await read(page)).map(el => el.id)).toEqual(initial.map(el => el.id));
  const downloading = page.waitForEvent('download'); await page.keyboard.press('Control+s'); const file = await downloading;
  await page.locator('#import-file').setInputFiles((await file.path())!); await expect(page.locator('#toast')).toContainText('画板已导入');
  expect((await read(page)).map(el => el.id)).toEqual(initial.map(el => el.id));
});

test('layer step shortcuts and context menu entries are available and configurable', async ({ page }) => {
  const initial = await stack(page); await page.mouse.click(520, 410);
  await page.keyboard.press('Control+]'); expect((await read(page)).at(-1)!.id).toBe(initial[0].id);
  await page.keyboard.press('Control+['); expect((await read(page))[0].id).toBe(initial[0].id);
  await page.mouse.click(520, 410, { button: 'right' });
  await expect(page.locator('#context-menu [data-action="forward"]')).toBeVisible();
  await expect(page.locator('#context-menu [data-action="backward"]')).toBeVisible();
  await page.locator('#context-menu [data-action="forward"]').click(); expect((await read(page)).at(-1)!.id).toBe(initial[0].id);
  await page.locator('#help-button').click();
  await expect(page.locator('[data-shortcut="bring-forward"]')).toHaveText('Ctrl + ]');
  await expect(page.locator('[data-shortcut="send-backward"]')).toHaveText('Ctrl + [');
  await page.locator('[data-shortcut="bring-forward"]').click(); await page.keyboard.press('q');
  await page.getByRole('button', { name: '关闭帮助', exact: true }).click();
  await expect(page.locator('#bring-forward')).toHaveAttribute('data-tooltip', /Q/);
  await page.locator('#send-backward').click(); await read(page); await page.keyboard.press('q');
  expect((await read(page)).at(-1)!.id).toBe(initial[0].id);
});

test('resizing and rotating a selected lower shape leave the upper shape visible at its own rank', async ({ page }) => {
  const [lower] = await stack(page); await page.mouse.click(520, 410);
  const { selectionFrame, objectRotationHandle } = await import('../../src/core/selection-frame');
  const corner = selectionFrame(lower, 1).corners.nw;
  await page.mouse.move(corner.x, corner.y); await page.mouse.down(); await page.mouse.move(corner.x - 30, corner.y - 20, { steps: 4 });
  expect((await pixel(page)).slice(0, 3)).toEqual([222, 237, 245]); await page.mouse.up();
  const resized = (await read(page))[0], handle = objectRotationHandle(resized, 1).handle;
  await page.mouse.move(handle.x, handle.y); await page.mouse.down(); await page.mouse.move(handle.x + 35, handle.y + 10, { steps: 4 });
  expect((await pixel(page)).slice(0, 3)).toEqual([222, 237, 245]); await page.mouse.up();
  expect((await read(page))[0].rotation).not.toBe(0);
});

test('nonconsecutive multi-selection, erased upper holes and offscreen editing obey precise scene order', async ({ page }) => {
  await page.goto('/'); await expect(page.locator('#save-status')).toContainText('已保存在本机');
  const result = await page.evaluate(async () => {
    const load = (path: string) => import(/* @vite-ignore */ path);
    const { Renderer } = await load('/src/engine/renderer.ts'), { Scene } = await load('/src/core/scene.ts'), { createElement } = await load('/src/core/model.ts');
    const container = document.createElement('div'); Object.assign(container.style, { position: 'absolute', width: '600px', height: '400px', pointerEvents: 'none' });
    const main = document.createElement('canvas'), overlay = document.createElement('canvas'); container.append(main, overlay); document.body.append(container);
    const elements = [
      createElement('rect', { id: 'lower', order: 0, x: 40, y: 100, w: 270, h: 180, fill: '#f8e3dc' }),
      createElement('rect', { id: 'upper', order: 1, x: 140, y: 140, w: 270, h: 180, fill: '#deedf5', erasures: [{ points: [{ x: 40, y: 50 }], radiusX: 15, radiusY: 15 }] }),
      createElement('rect', { id: 'top', order: 2, x: 250, y: 180, w: 210, h: 160, fill: '#faefc9' }),
    ];
    const state: RenderState = { camera: { x: 0, y: 0, zoom: 1 }, selected: new Set(['lower', 'top']), preview: [], hidden: new Set(), marquee: null, cursor: null, tool: 'select', grid: false, dark: false, erasing: new Map() };
    const renderer = new Renderer(new Scene(elements), main, overlay, state);
    const paint = () => new Promise<void>(resolve => { renderer.onFrame = () => resolve(); renderer.invalidate(); });
    const sample = (x: number, y: number) => [...overlay.getContext('2d')!.getImageData(x * renderer.dpr, y * renderer.dpr, 1, 1).data].slice(0, 3);
    await paint(); const ordered = [sample(180, 190), sample(220, 200), sample(290, 230)];
    // Replacing an originally off-screen source must still include its preview.
    const source = createElement('rect', { id: 'offscreen', order: 0, x: -1000, y: 100, w: 200, h: 150, fill: '#f8e3dc' });
    renderer.scene = new Scene([source, elements[1]]); state.selected = new Set([source.id]); state.hidden = new Set([source.id]); state.preview = [{ ...source, x: 40 }];
    await paint(); const moved = [sample(80, 170), sample(220, 200)];
    renderer.destroy(); container.remove(); return { ordered, moved };
  });
  expect(result.ordered).toEqual([[248, 227, 220], [222, 237, 245], [250, 239, 201]]);
  expect(result.moved).toEqual([[248, 227, 220], [222, 237, 245]]);
});

test('layer actions stay distinct and borderless inside small and large style panels', async ({ page }) => {
  await stack(page); await page.mouse.click(520, 410);
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    for (let theme = 0; theme < 2; theme++) {
      const panel = (await page.locator('#properties').boundingBox())!;
      const controls = await page.locator('.layer-controls > button').evaluateAll(nodes => nodes.map(el => ({ box: el.getBoundingClientRect().toJSON(), border: getComputedStyle(el).borderTopWidth })));
      expect(controls).toHaveLength(4);
      for (const control of controls) { expect(control.box.x).toBeGreaterThanOrEqual(panel.x); expect(control.box.right).toBeLessThanOrEqual(panel.x + panel.width); expect(control.border).toBe('0px'); }
      expect(new Set(controls.map(control => control.box.y)).size).toBe(1);
      await page.locator('#theme-button').click();
    }
  }
});

test('each step crosses only one object and multi-selection keeps its internal order', async ({ page }) => {
  await page.goto('/'); await page.locator('#quick-new').click();
  await chooseTool(page, '矩形');
  for (const x of [450, 680, 910]) {
    await page.mouse.move(x, 300); await page.mouse.down(); await page.mouse.move(x + 160, 440); await page.mouse.up();
  }
  const initial = await read(page); await chooseTool(page, '选择工具'); await page.mouse.click(530, 300);
  await page.locator('#bring-forward').click(); expect((await read(page)).map(el => el.id)).toEqual([initial[1].id, initial[0].id, initial[2].id]);
  await page.locator('#bring-forward').click(); expect((await read(page)).map(el => el.id)).toEqual([initial[1].id, initial[2].id, initial[0].id]);
  await page.keyboard.press('Control+z'); await read(page); await page.keyboard.press('Control+z'); await read(page);
  await page.keyboard.down('Shift'); await page.mouse.click(760, 300); await page.keyboard.up('Shift');
  await expect(page.locator('#selection-label')).toHaveText('已选择 2 个元素');
  await page.locator('#bring-forward').click(); expect((await read(page)).map(el => el.id)).toEqual([initial[2].id, initial[0].id, initial[1].id]);
  await page.locator('#lock-button').click();
  for (const control of ['bring-front', 'send-back', 'bring-forward', 'send-backward']) await expect(page.locator(`#${control}`)).toBeDisabled();
});
