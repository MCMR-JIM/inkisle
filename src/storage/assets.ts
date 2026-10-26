/** Immutable PDF originals, separate from element logs and snapshots. */
export const MAX_PDF_BYTES = 32 * 1024 * 1024;
export class AssetStore {
  private db: Promise<IDBDatabase> | null = null;
  constructor(private name = 'liubai-pdf-assets-v1') {}
  private open(): Promise<IDBDatabase> {
    return this.db ??= new Promise((resolve, reject) => {
      const req = indexedDB.open(this.name, 1);
      req.onupgradeneeded = () => req.result.createObjectStore('assets');
      req.onsuccess = () => { req.result.onversionchange = () => { req.result.close(); this.db = null; }; resolve(req.result); };
      req.onerror = () => { this.db = null; reject(new Error('无法打开 PDF 资源存储')); };
      req.onblocked = () => reject(new Error('请关闭旧窗口后重试 PDF 导入'));
    });
  }
  async put(blob: Blob): Promise<string> {
    if (!blob.size || blob.size > MAX_PDF_BYTES) throw new Error('PDF 文件须小于 32 MB，请先拆分大文档');
    const bytes = await blob.arrayBuffer();
    if (!new TextDecoder().decode(bytes.slice(0, 1024)).includes('%PDF-')) throw new Error('这不是有效的 PDF 文件');
    const id = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(n => n.toString(16).padStart(2, '0')).join('');
    const db = await this.open();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('assets', 'readwrite'); tx.objectStore('assets').put(blob, id);
      tx.oncomplete = () => resolve(); tx.onerror = tx.onabort = () => reject(new Error('PDF 保存失败，请检查本机存储空间'));
    });
    return id;
  }
  async get(id: string): Promise<Blob> {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const req = db.transaction('assets', 'readonly').objectStore('assets').get(id);
      req.onsuccess = () => req.result instanceof Blob ? resolve(req.result) : reject(new Error('PDF 原件缺失，请重新导入原 PDF 或完整画板源文件'));
      req.onerror = () => reject(new Error('PDF 原件读取失败'));
    });
  }
  close(): void { void this.db?.then(db => db.close()); this.db = null; }
}
export const pdfAssets = new AssetStore();
