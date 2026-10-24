import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { createDocument, createElement } from '../../src/core/model';
import { decodeDocument, encodeDocument } from '../../src/core/codec';
import { Repository } from '../../src/storage/repository';
import { SnapshotCodec } from '../../src/storage/snapshot';

describe('versioned document container', () => {
  it('round-trips Unicode and pressure samples', () => {
    const doc = createDocument('灵感 ✦');
    doc.elements = [createElement('pen', { text: '你好', points: [{ x: 0, y: 5, pressure: 0.7 }, { x: 7, y: 9, pressure: 0.3 }] })];
    expect(decodeDocument(encodeDocument(doc))).toEqual(doc);
  });

  it('rejects a corrupted payload instead of silently losing data', () => {
    const bytes = encodeDocument(createDocument('测试'));
    bytes[bytes.length - 2] ^= 0xff;
    expect(() => decodeDocument(bytes)).toThrow(/损坏|校验/);
  });

  it('rejects unsupported versions and non-finite coordinates', () => {
    const bytes = encodeDocument(createDocument('测试'));
    bytes[4] = 99;
    expect(() => decodeDocument(bytes)).toThrow(/版本/);
    const doc = createDocument('非法');
    doc.elements = [createElement('rect', { x: Number.POSITIVE_INFINITY })];
    expect(() => encodeDocument(doc)).toThrow(/数据|坐标|格式/);
  });
});

describe('incremental repository', () => {
  it('retains paper layout through metadata writes, compaction and source-file encoding', async () => {
    const repo = new Repository(`layout-${crypto.randomUUID()}`), doc = createDocument('Paper');
    doc.paperLayout = 'double'; await repo.create(doc);
    expect((await repo.load(doc.id))?.paperLayout).toBe('double');
    await repo.append(doc.id, [], { paperLayout: 'single' });
    const loaded = (await repo.load(doc.id))!; expect(loaded.paperLayout).toBe('single');
    expect(decodeDocument(encodeDocument(loaded)).paperLayout).toBe('single');
    await repo.compact(loaded); expect((await repo.load(doc.id))?.paperLayout).toBe('single'); repo.close();
  });
  it('recovers edits and deletions after reopening, then compacts without duplicating entities', async () => {
    const name = `test-${crypto.randomUUID()}`;
    const repo = new Repository(name);
    const doc = createDocument('持久化测试');
    const a = createElement('note', { id: 'a', text: '第一版' });
    doc.elements = [a];
    await repo.create(doc);
    await repo.append(doc.id, [{ id: 'a', after: { ...a, text: '第二版' } }], { title: '已改名' });
    const b = createElement('rect', { id: 'b' });
    await repo.append(doc.id, [{ id: 'b', after: b }, { id: 'a', after: null }]);
    repo.close();
    const reopened = new Repository(name);
    const loaded = await reopened.load(doc.id);
    expect(loaded?.title).toBe('已改名');
    expect(loaded?.elements.map(e => e.id)).toEqual(['b']);
    await reopened.compact(loaded!);
    const again = await reopened.load(doc.id);
    expect(again?.elements).toEqual([b]);
    expect((await reopened.list())).toHaveLength(1);
    await reopened.remove(doc.id);
    expect(await reopened.load(doc.id)).toBeNull();
    reopened.close();
  });

  it('updates lightweight metadata without rewriting or reading the document snapshot', async () => {
    const name = `test-${crypto.randomUUID()}`;
    const repo = new Repository(name);
    const doc = createDocument('增量');
    await repo.create(doc);
    const original = IDBObjectStore.prototype.get;
    const readStores: string[] = [];
    IDBObjectStore.prototype.get = function (key) {
      readStores.push(this.name);
      return original.call(this, key);
    };
    try { await repo.append(doc.id, [], { title: '只有名字改变', elementCount: 0 }); }
    finally { IDBObjectStore.prototype.get = original; }
    expect(readStores).not.toContain('snapshots');
    const connection = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open(name);
      req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error);
    });
    const metadata = await new Promise<Record<string, unknown>>(resolve => {
      const req = connection.transaction('boards').objectStore('boards').get(doc.id);
      req.onsuccess = () => resolve(req.result);
    });
    expect(metadata).not.toHaveProperty('snapshot');
    expect(connection.objectStoreNames.contains('snapshots')).toBe(true);
    connection.close(); repo.close();
  });

  it('rejects a stale window snapshot instead of compacting away another window’s edits', async () => {
    const name = `test-${crypto.randomUUID()}`;
    const first = new Repository(name), second = new Repository(name);
    const doc = createDocument('多个窗口');
    const el = createElement('note', { id: 'a', text: '旧内容' }); doc.elements = [el];
    await first.create(doc);
    const stale = await second.load(doc.id);
    await first.append(doc.id, [{ id: el.id, after: { ...el, text: '第一个窗口的新内容' } }]);
    await expect(second.compact(stale!)).rejects.toThrow(/另一个窗口/);
    await expect(second.append(doc.id, [{ id: el.id, after: el }])).rejects.toThrow(/另一个窗口/);
    expect((await first.load(doc.id))?.elements[0].text).toBe('第一个窗口的新内容');
    first.close(); second.close();
  });

  it('does not delete newer commits that arrive while a snapshot is encoding', async () => {
    const codec = new SnapshotCodec();
    const repo = new Repository(`test-${crypto.randomUUID()}`, codec);
    const doc = createDocument('并发快照');
    const el = createElement('note', { id: 'a', text: '第一版' }); doc.elements = [el];
    await repo.create(doc);
    let finish: (bytes: Uint8Array<ArrayBuffer>) => void = () => {};
    codec.encode = () => new Promise(resolve => { finish = resolve; });
    const compacting = repo.compact(doc);
    const rejection = expect(compacting).rejects.toThrow(/更新|变化/);
    await repo.append(doc.id, [{ id: el.id, after: { ...el, text: '快照期间的新修改' } }]);
    finish(encodeDocument(doc));
    await rejection;
    expect((await repo.load(doc.id))?.elements[0].text).toBe('快照期间的新修改');
    repo.close();
  });
});
