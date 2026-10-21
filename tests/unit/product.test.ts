import { describe, expect, it } from 'vitest';
import { PRODUCT, isBoardFile, readPreference, writePreference, isElementClipboard } from '../../src/core/product';

describe('InkIsle identity and persistence compatibility', () => {
  it('uses the chosen name, extension and repository slug', () => {
    expect(PRODUCT.name).toBe('墨屿'); expect(PRODUCT.englishName).toBe('InkIsle');
    expect(PRODUCT.id).toBe('inkisle'); expect(PRODUCT.extension).toBe('.inkisle');
  });

  it('recognizes current and legacy files case-insensitively without accepting unrelated suffixes', () => {
    for (const name of ['画板.inkisle', 'BOARD.INKISLE', '以前.liubai', 'OLD.LIUBAI']) expect(isBoardFile(name)).toBe(true);
    for (const name of ['notes.txt', 'notinkisle', 'fake.inkisle.exe', 'board.liubai.png']) expect(isBoardFile(name)).toBe(false);
  });

  it('continues to use existing local preferences so renaming cannot silently reset palettes or boards', () => {
    const data = new Map([['liubai:theme', 'dark'], ['liubai:last-board', 'old-board']]);
    const storage = { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value); } };
    expect(readPreference('theme', storage)).toBe('dark'); expect(readPreference('last-board', storage)).toBe('old-board');
    writePreference('theme', 'light', storage); expect(data.get('liubai:theme')).toBe('light');
    expect(PRODUCT.database).toBe('liubai-local-v1');
  });

  it('accepts the new and the previous element clipboard type', () => {
    expect(isElementClipboard('inkisle-elements')).toBe(true); expect(isElementClipboard('liubai-elements')).toBe(true);
    expect(isElementClipboard('other')).toBe(false); expect(isElementClipboard(null)).toBe(false);
  });
});
