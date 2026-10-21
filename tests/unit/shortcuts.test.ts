import { describe, expect, it } from 'vitest';
import { ShortcutMap, shortcutFromEvent } from '../../src/core/shortcuts';
import { cycleColor, normalizeColor, colorInk, hexToHSV, hsvToHex, restorePalette } from '../../src/core/colors';

describe('editable application shortcuts', () => {
  it('normalizes keyboard chords across platforms and shifted digit keys', () => {
    expect(shortcutFromEvent({ key: 'Tab', code: 'Tab', shiftKey: true })).toBe('Shift+Tab');
    expect(shortcutFromEvent({ key: ')', code: 'Digit0', shiftKey: true })).toBe('Shift+0');
    expect(shortcutFromEvent({ key: 'S', code: 'KeyS', metaKey: true })).toBe('Mod+S');
    expect(shortcutFromEvent({ key: 'Control', code: 'ControlLeft', ctrlKey: true })).toBeNull();
  });

  it('supports rebinding, conflicts, disabling and restoring defaults without losing another action', () => {
    const map = new ShortcutMap();
    expect(map.action({ key: 'Tab', code: 'Tab' })).toBe('color-next');
    expect(map.set('color-next', 'V')).toMatch(/选择/);
    expect(map.get('color-next')).toBe('Tab');
    expect(map.set('color-next', 'Q')).toBeNull();
    expect(map.action({ key: 'Tab', code: 'Tab' })).toBeNull();
    expect(map.action({ key: 'q', code: 'KeyQ' })).toBe('color-next');
    expect(map.set('color-next', '')).toBeNull();
    const restored = new ShortcutMap(map.serialize());
    expect(restored.get('color-next')).toBe('');
    restored.reset(); expect(restored.get('color-next')).toBe('Tab');
    expect(new ShortcutMap('invalid-json').get('color-next')).toBe('Tab');
  });

  it('loads saved chords without duplicates or unknown actions', () => {
    const map = new ShortcutMap(JSON.stringify({ 'color-next': 'Q', 'color-previous': 'Q', unknown: 'F9' }));
    expect(map.get('color-next')).toBe('Q');
    expect(map.get('color-previous')).toBe('Shift+Tab');
    expect(map.set('color-next', 'Mod+Tab')).toMatch(/浏览器/);
  });

  it('restores swapped tool keys and protects fixed editing and pan gestures', () => {
    const map = new ShortcutMap();
    expect(map.set('tool:hand', 'Q')).toBeNull();
    expect(map.set('tool:select', 'H')).toBeNull();
    expect(map.set('tool:hand', 'V')).toBeNull();
    const loaded = new ShortcutMap(map.serialize());
    expect(loaded.get('tool:select')).toBe('H');
    expect(loaded.get('tool:hand')).toBe('V');
    expect(map.set('color-next', 'Space')).toMatch(/固定/);
    expect(map.set('color-next', 'Mod+C')).toMatch(/固定/);
  });
});

describe('palette helpers', () => {
  it('restores edited presets without mutating defaults and rejects corrupt preferences', () => {
    const defaults = ['#283e36', '#ffffff'];
    expect(restorePalette(defaults, '["#123ABC","#FED"]')).toEqual(['#123abc', '#ffeedd']);
    expect(defaults).toEqual(['#283e36', '#ffffff']);
    for (const saved of ['invalid', 'null', '["#123456"]', '["#123456","not-a-color"]', '["transparent","#ffffff"]']) expect(restorePalette(defaults, saved)).toEqual(defaults);
    expect(restorePalette(['transparent', '#ffffff'], '["transparent","#123456"]')).toEqual(['transparent', '#123456']);
  });

  it('normalizes HEX, rejects invalid colors and chooses legible ink', () => {
    expect(normalizeColor('ABC')).toBe('#aabbcc');
    expect(normalizeColor('#123456')).toBe('#123456');
    expect(normalizeColor('red')).toBeNull();
    expect(colorInk('#ffffff')).toBe('#17251d');
    expect(colorInk('#e28165')).toBe('#17251d');
    expect(colorInk('#283e36')).toBe('#ffffff');
  });

  it('cycles preset colors in both directions and handles custom colors', () => {
    const colors = ['#111111', '#222222', '#333333'];
    expect(cycleColor(colors, '#333333', 1)).toBe('#111111');
    expect(cycleColor(colors, '#111111', -1)).toBe('#333333');
    expect(cycleColor(colors, '#abcdef', 1)).toBe('#111111');
    expect(cycleColor(colors, '#abcdef', -1)).toBe('#333333');
  });

  it('converts the custom color field to HEX across hue boundaries, white and black', () => {
    expect(hsvToHex({ h: 0, s: 1, v: 1 })).toBe('#ff0000');
    expect(hsvToHex({ h: 10, s: 1, v: 1 })).toBe('#ff2b00');
    expect(hsvToHex({ h: 120, s: 1, v: 1 })).toBe('#00ff00');
    expect(hsvToHex({ h: 240, s: 1, v: 1 })).toBe('#0000ff');
    expect(hsvToHex({ h: 360, s: 1, v: 1 })).toBe('#ff0000');
    expect(hsvToHex({ h: -120, s: 1, v: 1 })).toBe('#0000ff');
    expect(hsvToHex({ h: 30, s: 0, v: 1 })).toBe('#ffffff');
    expect(hsvToHex({ h: 30, s: 1, v: 0 })).toBe('#000000');
    expect(hsvToHex({ h: 0, s: 2, v: 2 })).toBe('#ff0000');
    expect(hexToHSV('#808080', 210)?.h).toBe(210);
    expect(hexToHSV('invalid')).toBeNull();
    for (const color of ['#283e36', '#123abc', '#fedcba', '#64a69a', '#ffffff', '#000000', '#808080']) expect(hsvToHex(hexToHSV(color)!)).toBe(color);
  });
});
