export function normalizeColor(value: string): string | null {
  const hex = value.trim().replace(/^#/, '').toLowerCase();
  if (/^[\da-f]{3}$/.test(hex)) return `#${[...hex].map(c => c + c).join('')}`;
  return /^[\da-f]{6}$/.test(hex) ? `#${hex}` : null;
}

export function colorInk(color: string): string {
  const hex = normalizeColor(color);
  if (!hex) return '#17251d';
  const values = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255).map(c => c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4);
  const luminance = values[0] * .2126 + values[1] * .7152 + values[2] * .0722;
  const darkContrast = (luminance + .05) / .066;
  const lightContrast = 1.05 / (luminance + .05);
  return darkContrast > lightContrast ? '#17251d' : '#ffffff';
}

export function cycleColor(colors: string[], current: string, direction: number): string {
  const index = colors.indexOf(current.toLowerCase());
  return colors[index < 0 ? direction > 0 ? 0 : colors.length - 1 : (index + direction + colors.length) % colors.length];
}

/** Validate and copy a persisted preset palette without mutating defaults. */
export function restorePalette(defaults: string[], saved: string | null, migrateTransparent = false): string[] {
  try {
    const colors: unknown = JSON.parse(saved ?? 'null');
    if (Array.isArray(colors) && colors.length === defaults.length && colors.every(color => typeof color === 'string' && (color === 'transparent' ? migrateTransparent || defaults.includes('transparent') : !!normalizeColor(color)))) {
      return colors.map((color, index) => color === 'transparent' ? migrateTransparent ? defaults[index] : color : normalizeColor(color)!);
    }
  } catch { /* Optional malformed preferences fall back to defaults. */ }
  return defaults.slice();
}

export interface HSV { h: number; s: number; v: number }
const unit = (value: number): number => Math.max(0, Math.min(1, value));

export function hsvToHex({ h, s, v }: HSV): string {
  const hue = ((h % 360) + 360) % 360 / 60, saturation = unit(s), value = unit(v);
  const c = value * saturation, x = c * (1 - Math.abs(hue % 2 - 1)), m = value - c;
  const channels = hue < 1 ? [c, x, 0] : hue < 2 ? [x, c, 0] : hue < 3 ? [0, c, x] : hue < 4 ? [0, x, c] : hue < 5 ? [x, 0, c] : [c, 0, x];
  return `#${channels.map(channel => Math.round((channel + m) * 255 + 1e-9).toString(16).padStart(2, '0')).join('')}`;
}

export function hexToHSV(color: string, fallbackHue = 0): HSV | null {
  const hex = normalizeColor(color);
  if (!hex) return null;
  const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255);
  const max = Math.max(r, g, b), min = Math.min(r, g, b), delta = max - min;
  const h = !delta ? fallbackHue : (max === r ? (g - b) / delta : max === g ? (b - r) / delta + 2 : (r - g) / delta + 4) * 60;
  return { h: (h + 360) % 360, s: max ? delta / max : 0, v: max };
}
