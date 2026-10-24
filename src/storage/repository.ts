import { compareElements, type BoardDocument, type BoardMeta, type Camera, type Change } from '../core/model';
import { SnapshotCodec } from './snapshot';
import { PRODUCT } from '../core/product';

interface StoredBoard extends BoardMeta {
  camera: Camera;
  background: string;
  paperLayout?: BoardDocument['paperLayout'];
  revision: number;
}
interface LogEntry { key?: number; boardId: string; changes: Change[] }
export type MetadataPatch = Partial<Pick<BoardDocument, 'title' | 'camera' | 'background' | 'paperLayout'>> & { thumbnail?: string; elementCount?: number };

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('本地存储读取失败'));
  });
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = tx.onerror = () => reject(tx.error ?? new Error('本地存储事务失败'));
  });
}

export class Repository {
  private db: Promise<IDBDatabase> | null = null;
  private revisions = new Map<string, number>();
  constructor(private name: string = PRODUCT.database, private codec = new SnapshotCodec()) {}

  private open(): Promise<IDBDatabase> {
    return this.db ??= new Promise((resolve, reject) => {
      const req = indexedDB.open(this.name, 2);
      req.onupgradeneeded = event => {
        const snapshots = req.result.createObjectStore('snapshots', { keyPath: 'id' });
        if (event.oldVersion === 0) {
          req.result.createObjectStore('boards', { keyPath: 'id' });
          const logs = req.result.createObjectStore('logs', { keyPath: 'key', autoIncrement: true });
          logs.createIndex('boardId', 'boardId');
        } else {
          // Upgrade the development v1 layout without losing any local boards.
          const cursor = req.transaction!.objectStore('boards').openCursor();
          cursor.onsuccess = () => {
            if (!cursor.result) return;
            const { snapshot, ...metadata } = cursor.result.value;
            snapshots.put({ id: metadata.id, data: snapshot });
            cursor.result.update(metadata); cursor.result.continue();
          };
        }
      };
      req.onsuccess = () => {
        req.result.onversionchange = () => { req.result.close(); this.db = null; };
        resolve(req.result);
      };
      req.onerror = () => { this.db = null; reject(req.error ?? new Error('无法打开本地存储')); };
      req.onblocked = () => reject(new Error('本地存储被另一个窗口占用，请关闭旧窗口后重试'));
    });
  }

  async create(doc: BoardDocument, thumbnail?: string): Promise<void> {
    const snapshot = await this.codec.encode(doc);
    const db = await this.open();
    const tx = db.transaction(['boards', 'snapshots'], 'readwrite');
    const complete = done(tx);
    const { id, title, created, updated, camera, background, paperLayout } = doc;
    tx.objectStore('boards').add({ id, title, created, updated, camera, background, paperLayout, revision: 0, elementCount: doc.elements.length, thumbnail } satisfies StoredBoard);
    tx.objectStore('snapshots').add({ id, data: snapshot });
    await complete;
    this.revisions.set(id, 0);
  }

  async load(id: string): Promise<BoardDocument | null> {
    const db = await this.open();
    const tx = db.transaction(['boards', 'snapshots', 'logs'], 'readonly');
    const complete = done(tx);
    const [board, stored, logs] = await Promise.all([
      request(tx.objectStore('boards').get(id) as IDBRequest<StoredBoard | undefined>),
      request(tx.objectStore('snapshots').get(id) as IDBRequest<{ id: string; data: Uint8Array } | undefined>),
      request(tx.objectStore('logs').index('boardId').getAll(id) as IDBRequest<LogEntry[]>),
    ]);
    await complete;
    if (!board) return null;
    if (!stored) throw new Error('画板快照丢失，请从导出的源文件恢复');
    this.revisions.set(id, board.revision ?? 0);
    const doc = await this.codec.decode(new Uint8Array(stored.data));
    const elements = new Map(doc.elements.map(el => [el.id, el]));
    for (const log of logs) for (const c of log.changes) {
      if (c.after) elements.set(c.id, c.after); else elements.delete(c.id);
    }
    return { ...doc, title: board.title, updated: board.updated, camera: board.camera, background: board.background, paperLayout: board.paperLayout ?? doc.paperLayout, elements: [...elements.values()].sort(compareElements) };
  }

  async list(): Promise<BoardMeta[]> {
    const db = await this.open();
    const tx = db.transaction('boards', 'readonly');
    const complete = done(tx);
    const boards = await request(tx.objectStore('boards').getAll() as IDBRequest<StoredBoard[]>);
    await complete;
    return boards.map(({ id, title, created, updated, elementCount, thumbnail }) => ({ id, title, created, updated, elementCount, thumbnail })).sort((a, b) => b.updated - a.updated);
  }

  async append(id: string, changes: Change[], patch: MetadataPatch = {}): Promise<void> {
    const expectedRevision = this.revisions.get(id);
    const db = await this.open();
    const tx = db.transaction(['boards', 'logs'], 'readwrite');
    const complete = done(tx);
    const boards = tx.objectStore('boards');
    const req = boards.get(id) as IDBRequest<StoredBoard | undefined>;
    let failure: Error | null = null;
    let nextRevision = 0;
    req.onsuccess = () => {
      if (!req.result) { failure = new Error('这块画板已被删除'); tx.abort(); return; }
      const revision = req.result.revision ?? 0;
      if (expectedRevision !== revision) {
        failure = new Error('画板已在另一个窗口更新，请先导出当前内容，再刷新页面'); tx.abort(); return;
      }
      nextRevision = revision + 1;
      if (changes.length) tx.objectStore('logs').add({ boardId: id, changes } satisfies LogEntry);
      boards.put({ ...req.result, ...patch, revision: nextRevision, updated: Date.now() });
    };
    try { await complete; } catch (error) { throw failure ?? error; }
    this.revisions.set(id, nextRevision);
  }

  async compact(doc: BoardDocument, thumbnail?: string): Promise<void> {
    // Capture the version before yielding to the codec worker. Reading this
    // later could validate an old snapshot against a newer local commit.
    const expectedRevision = this.revisions.get(doc.id);
    const snapshot = await this.codec.encode(doc);
    const db = await this.open();
    const tx = db.transaction(['boards', 'snapshots', 'logs'], 'readwrite');
    const complete = done(tx);
    const { id, title, created, camera, background, paperLayout } = doc;
    const boards = tx.objectStore('boards');
    const req = boards.get(id) as IDBRequest<StoredBoard | undefined>;
    let failure: Error | null = null;
    let nextRevision = 0;
    req.onsuccess = () => {
      if (!req.result) { failure = new Error('这块画板已被删除'); tx.abort(); return; }
      const revision = req.result.revision ?? 0;
      if (expectedRevision !== revision) {
        failure = new Error('画板已在另一个窗口更新，请先导出当前内容，再刷新页面'); tx.abort(); return;
      }
      nextRevision = revision + 1;
      boards.put({ id, title, created, updated: Date.now(), camera, background, paperLayout, revision: nextRevision, elementCount: doc.elements.length, thumbnail } satisfies StoredBoard);
      tx.objectStore('snapshots').put({ id, data: snapshot });
      const logs = tx.objectStore('logs');
      const keys = logs.index('boardId').getAllKeys(id);
      keys.onsuccess = () => { for (const key of keys.result) logs.delete(key); };
    };
    try { await complete; } catch (error) { throw failure ?? error; }
    this.revisions.set(id, nextRevision);
  }

  async remove(id: string, requireCurrentRevision = false): Promise<void> {
    const expectedRevision = this.revisions.get(id);
    const db = await this.open();
    const tx = db.transaction(['boards', 'snapshots', 'logs'], 'readwrite');
    const complete = done(tx);
    const boards = tx.objectStore('boards');
    let failure: Error | null = null;
    if (requireCurrentRevision) {
      // Automatic empty-board cleanup must not delete edits from another window.
      const req = boards.get(id) as IDBRequest<StoredBoard | undefined>;
      req.onsuccess = () => {
        if (req.result && (req.result.revision ?? 0) !== expectedRevision) {
          failure = new Error('画板已在另一个窗口更新，请先导出当前内容，再刷新页面'); tx.abort(); return;
        }
        boards.delete(id);
      };
    } else boards.delete(id);
    tx.objectStore('snapshots').delete(id);
    const logs = tx.objectStore('logs');
    const keys = logs.index('boardId').getAllKeys(id);
    keys.onsuccess = () => { for (const key of keys.result) logs.delete(key); };
    try { await complete; } catch (error) { throw failure ?? error; }
    this.revisions.delete(id);
  }

  close(): void { void this.db?.then(db => db.close()); this.db = null; this.codec.close(); }
}
