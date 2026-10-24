import 'fake-indexeddb/auto';
import { afterEach, expect, it, vi } from 'vitest';
import { createDocument, createElement } from '../../src/core/model';
import { Writer } from '../../src/storage/writer';
import { Repository } from '../../src/storage/repository';

afterEach(() => { vi.unstubAllGlobals(); });

it('retains a failed batch and retries it before edits that arrived during the write', async () => {
  vi.stubGlobal('window', globalThis);
  const doc = createDocument('Retry test');
  const a = createElement('note', { id: 'a' }), b = createElement('rect', { id: 'b' });
  const batches: string[][] = [];
  let rejectWrite: (error: Error) => void = () => {};
  let first = true;
  const repo = {
    append: async (_id: string, changes: { id: string }[]) => {
      batches.push(changes.map(c => c.id));
      if (first) {
        first = false;
        await new Promise<void>((_resolve, reject) => { rejectWrite = reject; });
      }
    },
  } as unknown as Repository;
  const states: string[] = [];
  const writer = new Writer(repo, () => doc, state => states.push(state));
  writer.enqueue([{ id: 'a', after: a }]);
  const writing = writer.flush();
  writer.enqueue([{ id: 'b', after: b }]);
  rejectWrite(new Error('quota'));
  expect(await writing).toBe(false);
  expect(writer.pending).toBe(true);
  expect(states.at(-1)).toBe('error');
  expect(await writer.flush()).toBe(true);
  expect(batches).toEqual([['a'], ['a', 'b']]);
  expect(states.at(-1)).toBe('saved');
  expect(writer.pending).toBe(false);
  writer.stop();
});

it('keeps blank drafts out of storage, saves first content, and recreates after undo and redo', async () => {
  vi.stubGlobal('window', globalThis);
  const repo = new Repository(`writer-${crypto.randomUUID()}`);
  let doc = createDocument();
  const states: string[] = [];
  const writer = new Writer(repo, () => doc, state => states.push(state), false);
  try {
    writer.enqueue([], { camera: { x: 10, y: 20, zoom: 2 } });
    expect(await writer.flush()).toBe(true);
    expect(await repo.list()).toEqual([]); expect(states.at(-1)).toBe('draft');
    const element = createElement('note', { text: 'Keep this' });
    doc = { ...doc, elements: [element] };
    writer.enqueue([{ id: element.id, after: element }]); await writer.flush();
    expect((await repo.load(doc.id))?.elements).toEqual([element]); expect(writer.stored).toBe(true);
    doc = { ...doc, elements: [] };
    writer.enqueue([{ id: element.id, after: null }]); await writer.flush();
    expect(await repo.list()).toEqual([]); expect(writer.stored).toBe(false);
    doc = { ...doc, elements: [element] };
    writer.enqueue([{ id: element.id, after: element }]); await writer.flush();
    expect((await repo.load(doc.id))?.elements).toEqual([element]); expect(states.at(-1)).toBe('saved');
  } finally { writer.stop(); repo.close(); }
});

it('saves named empty boards and discards them only after restoring an unnamed title', async () => {
  vi.stubGlobal('window', globalThis);
  const repo = new Repository(`writer-${crypto.randomUUID()}`);
  let doc = createDocument('Plan');
  const writer = new Writer(repo, () => doc, () => {}, false);
  try {
    writer.enqueue([], { title: doc.title }); await writer.flush();
    expect((await repo.load(doc.id))?.title).toBe('Plan');
    writer.enqueue([], { camera: doc.camera }); await writer.flush();
    expect(await repo.list()).toHaveLength(1);
    doc = { ...doc, title: '未命名画板' };
    writer.enqueue([], { title: doc.title }); await writer.flush();
    expect(await repo.list()).toEqual([]);
  } finally { writer.stop(); repo.close(); }
});

it('serializes edits arriving during draft creation and retries failed initial saves', async () => {
  vi.stubGlobal('window', globalThis);
  const a = createElement('rect'), b = createElement('note');
  let doc = { ...createDocument(), elements: [a] };
  let release: () => void = () => {};
  const create = vi.fn().mockRejectedValueOnce(new Error('quota')).mockImplementationOnce(() => new Promise<void>(resolve => { release = resolve; }));
  const append = vi.fn().mockResolvedValue(undefined);
  const states: string[] = [];
  const writer = new Writer({ create, append } as unknown as Repository, () => doc, state => states.push(state), false);
  try {
    writer.enqueue([{ id: a.id, after: a }]); expect(await writer.flush()).toBe(false);
    expect(writer.stored).toBe(false); expect(writer.pending).toBe(true); expect(states.at(-1)).toBe('error');
    const writing = writer.flush();
    doc = { ...doc, elements: [a, b] }; writer.enqueue([{ id: b.id, after: b }]);
    release(); expect(await writing).toBe(true);
    expect(create.mock.calls[1][0].elements).toEqual([a]);
    expect(append.mock.calls[0][1]).toEqual([{ id: b.id, after: b }]);
    expect(states.at(-1)).toBe('saved'); expect(writer.pending).toBe(false);
  } finally { writer.stop(); }
});

it('refuses to discard an empty board when another window has saved new content', async () => {
  vi.stubGlobal('window', globalThis);
  const name = `writer-${crypto.randomUUID()}`, repo = new Repository(name), other = new Repository(name);
  const doc = createDocument();
  await repo.create(doc); await other.load(doc.id);
  const states: string[] = [];
  const writer = new Writer(repo, () => doc, state => states.push(state));
  try {
    const element = createElement('note', { text: 'New in another window' });
    await other.append(doc.id, [{ id: element.id, after: element }], { elementCount: 1 });
    writer.enqueue([]); expect(await writer.flush()).toBe(false);
    expect(states.at(-1)).toBe('error'); expect(writer.pending).toBe(true);
    expect((await other.load(doc.id))?.elements).toEqual([element]);
  } finally { writer.stop(); repo.close(); other.close(); }
});
