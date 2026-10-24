import { expect, test, type Page } from '@playwright/test';

type ImageDecodeWindow = Window & { imageDecodeGate: { started: boolean; release: () => void } };

async function blank(page: Page): Promise<void> {
  await page.goto('/');
  await expect(page.locator('#save-status')).toContainText('已保存在本机');
  await page.locator('#quick-new').click();
  await expect(page.locator('#element-count')).toHaveText('0 个元素');
}

async function beginImageImport(page: Page): Promise<void> {
  await page.evaluate(() => {
    const original = HTMLImageElement.prototype.decode;
    const gate = { started: false, release: () => {} };
    const wait = new Promise<void>(resolve => { gate.release = resolve; });
    (window as unknown as ImageDecodeWindow).imageDecodeGate = gate;
    HTMLImageElement.prototype.decode = async function () {
      HTMLImageElement.prototype.decode = original;
      await original.call(this);
      gate.started = true;
      await wait;
    };
  });
  const image = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
  await page.locator('#image-file').setInputFiles({ name: 'pixel.png', mimeType: 'image/png', buffer: image });
  await expect.poll(() => page.evaluate(() => (window as unknown as ImageDecodeWindow).imageDecodeGate.started)).toBe(true);
}

async function releaseImage(page: Page): Promise<void> {
  await page.evaluate(() => (window as unknown as ImageDecodeWindow).imageDecodeGate.release());
}

for (const reopen of [false, true]) {
  test(`an image finishing after a board switch cannot modify ${reopen ? 'the reopened source board' : 'the new board'}`, async ({ page }) => {
    await blank(page);
    await page.locator('#board-title').fill('Image source');
    await page.locator('#board-title').blur();
    await beginImageImport(page);
    await page.locator('#quick-new').click();
    await expect(page.locator('#board-title')).toHaveValue('未命名画板');
    if (reopen) {
      await page.locator('#library-button').click();
      await page.getByRole('button', { name: '打开画板 Image source', exact: true }).click();
      await expect(page.locator('#board-title')).toHaveValue('Image source');
    }
    await releaseImage(page);
    await expect(page.locator('#toast')).toContainText('画板已切换，请重新插入图片');
    await expect(page.locator('#element-count')).toHaveText('0 个元素');
    await expect(page.locator('#save-status')).toHaveAttribute('data-state', reopen ? 'saved' : 'draft');
    await page.reload();
    await expect(page.locator('#element-count')).toHaveText('0 个元素');
    await expect(page.locator('#board-title')).toHaveValue('Image source');
  });
}

test('an image keeps its requested world position when the camera changes during decoding', async ({ page }) => {
  await blank(page);
  await beginImageImport(page);
  await page.locator('#zoom-in').click();
  await expect(page.locator('#zoom-value')).toHaveText('125%');
  await page.keyboard.down('Space');
  await page.mouse.move(1000, 650); await page.mouse.down();
  await page.mouse.move(1100, 710); await page.mouse.up();
  await page.keyboard.up('Space');
  await releaseImage(page);
  await expect(page.locator('#element-count')).toHaveText('1 个元素');
  await expect(page.locator('#save-status')).toContainText('已保存在本机');
  const image = await page.evaluate(async () => {
    const path = '/src/storage/repository.ts';
    const { Repository } = await import(/* @vite-ignore */ path);
    const repo = new Repository();
    const doc = await repo.load(localStorage.getItem('liubai:last-board'));
    repo.close();
    return doc.elements[0];
  });
  expect(image.kind).toBe('image');
  expect(image.x + image.w / 2).toBeCloseTo(720, 3);
  expect(image.y + image.h / 2).toBeCloseTo(480, 3);
  await page.keyboard.press('Control+z');
  await expect(page.locator('#element-count')).toHaveText('0 个元素');
  await page.keyboard.press('Control+Shift+z');
  await expect(page.locator('#element-count')).toHaveText('1 个元素');
  await expect(page.locator('#save-status')).toContainText('已保存在本机');
  await page.reload();
  await expect(page.locator('#element-count')).toHaveText('1 个元素');
});
