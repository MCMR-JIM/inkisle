import { expect, test, type Page } from '@playwright/test';
import type { BoardMeta } from '../../src/core/model';
import { createBoard, chooseTool } from './helpers';

async function boards(page: Page): Promise<BoardMeta[]> {
  return page.evaluate(async () => {
    const path = '/src/storage/repository.ts'; const { Repository } = await import(/* @vite-ignore */ path);
    const repo = new Repository(); try { return await repo.list(); } finally { repo.close(); }
  });
}

test('unnamed blank boards stay transient through new, zoom, library and close', async ({ page }) => {
  await page.addInitScript(() => {
    let listener: (event: { data: unknown }) => void | Promise<void> = () => {};
    const messages: string[] = [];
    const bridge = { messages, postMessage: (message: string) => messages.push(message), addEventListener: (_name: string, handler: typeof listener) => { listener = handler; }, receive: async (data: string) => { await listener({ data }); } };
    Object.assign(window, { desktopTest: bridge });
    Object.assign((window as unknown as { chrome: object }).chrome, { webview: bridge });
  });
  await page.goto('/'); await expect(page.locator('#save-status')).toHaveAttribute('data-state', 'saved');
  const initial = await boards(page);
  for (let i = 0; i < 3; i++) {
    await createBoard(page); await expect(page.locator('#element-count')).toHaveText('0 个元素');
    await expect(page.locator('#save-status')).toHaveAttribute('data-state', 'draft');
    await expect(page.locator('#toast')).toBeHidden();
  }
  await page.getByRole('button', { name: '放大', exact: true }).click(); await page.locator('#save-status').click();
  await expect(page.locator('#save-status')).toHaveAttribute('data-state', 'draft');
  await page.locator('#library-button').click(); await expect(page.locator('.board-card')).toHaveCount(initial.length);
  expect(await page.evaluate(async () => {
    const bridge = (window as unknown as { desktopTest: { receive: (data: string) => Promise<void>; messages: string[] } }).desktopTest;
    await bridge.receive('liubai:prepare-close'); return bridge.messages.at(-1);
  })).toBe('liubai:close-ready');
  expect(await boards(page)).toEqual(initial);
  await page.reload(); await expect(page.locator('#save-status')).toHaveAttribute('data-state', 'saved');
  expect(await page.locator('#board-title').inputValue()).toBe(initial[0].title);
  expect(await boards(page)).toEqual(initial);
});

test('importing an unnamed blank source and deleting the final stored board do not create library entries', async ({ page }) => {
  await page.goto('/'); await expect(page.locator('#save-status')).toHaveAttribute('data-state', 'saved');
  const initial = await boards(page);
  await createBoard(page); await expect(page.locator('#save-status')).toHaveAttribute('data-state', 'draft');
  const downloading = page.waitForEvent('download'); await page.keyboard.press('Control+s'); const download = await downloading;
  await page.locator('#import-file').setInputFiles((await download.path())!); await expect(page.locator('#toast')).toContainText('画板已导入');
  await expect(page.locator('#save-status')).toHaveAttribute('data-state', 'draft'); expect(await boards(page)).toEqual(initial);
  await page.locator('#library-button').click(); await expect(page.locator('.board-card')).toHaveCount(1);
  await page.getByRole('button', { name: `打开画板 ${initial[0].title}`, exact: true }).click();
  await page.locator('#library-button').click();
  await page.getByRole('button', { name: `删除画板 ${initial[0].title}`, exact: true }).click(); await page.locator('#confirm-delete').click();
  await expect(page.locator('.board-card')).toHaveCount(0); await expect(page.locator('#save-status')).toHaveAttribute('data-state', 'draft');
  expect(await boards(page)).toEqual([]);
});

test('naming a blank board saves it and restoring its default title removes only that empty board', async ({ page }) => {
  await page.goto('/'); await expect(page.locator('#save-status')).toHaveAttribute('data-state', 'saved');
  const initial = await boards(page);
  await createBoard(page);
  await expect(page.locator('#save-status')).toHaveAttribute('data-state', 'draft');
  await page.locator('#board-title').fill('Next idea'); await page.locator('#board-title').press('Enter');
  await expect(page.locator('#save-status')).toHaveAttribute('data-state', 'saved');
  expect(await boards(page)).toHaveLength(initial.length + 1);
  await page.reload(); await expect(page.locator('#board-title')).toHaveValue('Next idea');
  await expect(page.locator('#element-count')).toHaveText('0 个元素');
  await page.locator('#board-title').fill(''); await page.locator('#board-title').press('Enter');
  await expect(page.locator('#save-status')).toHaveAttribute('data-state', 'draft');
  expect(await boards(page)).toEqual(initial);
});

test('first content saves a draft, undo to empty discards it and redo restores it durably', async ({ page }) => {
  await page.goto('/'); await expect(page.locator('#save-status')).toHaveAttribute('data-state', 'saved');
  const initial = await boards(page);
  await createBoard(page); await expect(page.locator('#save-status')).toHaveAttribute('data-state', 'draft'); await chooseTool(page, '矩形');
  await page.mouse.move(500, 300); await page.mouse.down(); await page.mouse.move(700, 400); await page.mouse.up();
  await expect(page.locator('#save-status')).toHaveAttribute('data-state', 'saved');
  const id = await page.evaluate(() => localStorage.getItem('liubai:last-board'));
  expect(await boards(page)).toHaveLength(initial.length + 1);
  await page.keyboard.press('Control+z'); await expect(page.locator('#save-status')).toHaveAttribute('data-state', 'draft');
  await page.locator('#library-button').click(); await expect(page.locator('.board-card')).toHaveCount(initial.length);
  await page.keyboard.press('Escape'); await page.keyboard.press('Control+Shift+z');
  await expect(page.locator('#save-status')).toHaveAttribute('data-state', 'saved');
  expect(await page.evaluate(() => localStorage.getItem('liubai:last-board'))).toBe(id);
  await page.reload(); await expect(page.locator('#element-count')).toHaveText('1 个元素');
});

test('clearing the name of another empty board in the library discards only that board', async ({ page }) => {
  await page.goto('/'); await expect(page.locator('#save-status')).toHaveAttribute('data-state', 'saved');
  const initial = await boards(page);
  for (const name of ['Later', 'Current']) {
    await createBoard(page); await expect(page.locator('#save-status')).toHaveAttribute('data-state', 'draft');
    await page.locator('#board-title').fill(name); await page.locator('#board-title').press('Enter');
    await expect(page.locator('#save-status')).toHaveAttribute('data-state', 'saved');
  }
  await page.locator('#library-button').click(); await expect(page.locator('.board-card')).toHaveCount(initial.length + 2);
  await page.getByRole('textbox', { name: '画板名称 Later', exact: true }).fill(''); await page.keyboard.press('Enter');
  await expect(page.locator('.board-card')).toHaveCount(initial.length + 1);
  expect((await boards(page)).some(board => board.title === 'Current')).toBe(true);
  await expect(page.locator('#board-title')).toHaveValue('Current');
});
