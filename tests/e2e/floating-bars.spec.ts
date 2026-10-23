import { expect, test } from '@playwright/test';

test('tool option bars share sizing, center around their content and keep the trailing switch separated', async ({ page }) => {
  await page.goto('/'); await expect(page.locator('#save-status')).toContainText('已保存在本机');
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    for (const position of ['top', 'bottom']) {
      await page.locator('#workspace-settings-button').click(); await page.locator('#toolbar-position').selectOption(position);
      await page.getByRole('button', { name: '关闭工作区设置', exact: true }).click();
      let reference: unknown;
      for (const [key, id] of [['p', 'pressure-setting'], ['r', 'tool-menu-shapes'], ['l', 'tool-menu-lines']]) {
        await page.keyboard.press(key);
        const bar = page.locator(`#${id}`); await expect(bar).toBeVisible();
        const geometry = await bar.evaluate(el => {
          const frame = el.getBoundingClientRect(), anchor = el.parentElement!.getBoundingClientRect();
          const options = [...el.querySelectorAll<HTMLElement>(':scope > .floating-bar-option')];
          return { center: frame.x + frame.width / 2, anchor: anchor.x + anchor.width / 2, width: frame.width,
            boxes: options.map(option => option.getBoundingClientRect().toJSON()),
            style: options.map(option => { const s = getComputedStyle(option); return { height: s.height, font: s.fontSize, direction: s.flexDirection, padding: s.padding, radius: s.borderRadius }; }) };
        });
        expect(Math.abs(geometry.center - geometry.anchor)).toBeLessThan(1);
        expect(geometry.boxes.every(box => box.x >= 0 && box.right <= width && box.width >= 44 && box.height >= 44)).toBe(true);
        if (key === 'p') {
          reference = geometry.style[0];
          const separator = (await bar.locator('.bar-separator').boundingBox())!, control = (await bar.locator('.floating-bar-control').boundingBox())!;
          expect(separator.x).toBeGreaterThan(geometry.boxes.at(-1)!.right);
          expect(separator.x + separator.width).toBeLessThan(control.x);
          expect(separator.height).toBe(22); expect(control.x + control.width).toBeLessThanOrEqual(geometry.center + geometry.width / 2);
        }
        for (const style of geometry.style) expect(style).toEqual(reference);
        if (key === 'l') expect(geometry.width).toBeLessThan(width - 24);
      }
    }
  }
});

test('shared bars adapt to arbitrary option counts and keep trailing controls together when wrapping', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 }); await page.goto('/');
  for (const count of [1, 2, 4, 9, 13]) {
    await page.evaluate(async count => {
      document.querySelector('#bar-fixture')?.remove();
      const path = '/src/ui/floating-bar.ts'; const { floatingBarMarkup } = await import(/* @vite-ignore */ path);
      const fixture = document.createElement('div'); fixture.id = 'bar-fixture';
      Object.assign(fixture.style, { position: 'fixed', left: '50%', top: '150px', transform: 'translateX(-50%)', zIndex: '100' });
      fixture.innerHTML = floatingBarMarkup({ id: 'example-bar', label: 'Example controls', items: [
        ...Array.from({ length: count }, (_, i) => ({ type: 'option', icon: 'pen', label: `工具 ${i + 1}` })),
        { type: 'group', items: [{ type: 'separator' }, { type: 'switch', id: 'example-switch', label: '压感', checked: true }] },
      ] });
      document.querySelector('#app')!.append(fixture); fixture.querySelector<HTMLElement>('#example-bar')!.hidden = false;
    }, count);
    const bar = page.locator('#example-bar'), frame = (await bar.boundingBox())!;
    expect(Math.abs(frame.x + frame.width / 2 - 160)).toBeLessThan(1);
    expect(frame.x).toBeGreaterThanOrEqual(12); expect(frame.x + frame.width).toBeLessThanOrEqual(308);
    await expect(bar.locator('.floating-bar-option')).toHaveCount(count);
    const separator = (await bar.locator('.bar-separator').boundingBox())!, control = (await bar.locator('.floating-bar-control').boundingBox())!;
    expect(separator.x + separator.width).toBeLessThan(control.x);
    expect(separator.y + separator.height / 2).toBeCloseTo(control.y + control.height / 2, 1);
    expect(control.x + control.width).toBeLessThanOrEqual(frame.x + frame.width);
  }
});
