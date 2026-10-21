/** User-visible identity. Persistence namespaces below intentionally remain
 * stable so the rename cannot orphan existing boards, preferences or files. */
export const PRODUCT = Object.freeze({
  id: 'inkisle', name: '墨屿', englishName: 'InkIsle', extension: '.inkisle',
  legacyExtension: '.liubai', database: 'liubai-local-v1', preferencePrefix: 'liubai:',
  clipboardType: 'inkisle-elements', legacyClipboardType: 'liubai-elements',
});

export function isBoardFile(name: string): boolean {
  const lower = name.toLowerCase();
  return lower.endsWith(PRODUCT.extension) || lower.endsWith(PRODUCT.legacyExtension);
}

export function isElementClipboard(type: unknown): boolean {
  return type === PRODUCT.clipboardType || type === PRODUCT.legacyClipboardType;
}

export function readPreference(key: string, storage?: Pick<Storage, 'getItem'>): string | null {
  try { return (storage ?? localStorage).getItem(`${PRODUCT.preferencePrefix}${key}`); } catch { return null; }
}

export function writePreference(key: string, value: string, storage?: Pick<Storage, 'setItem'>): void {
  try { (storage ?? localStorage).setItem(`${PRODUCT.preferencePrefix}${key}`, value); } catch { /* preferences are optional */ }
}
