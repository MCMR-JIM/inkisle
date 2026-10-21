import { afterEach, expect, it, vi } from 'vitest';
import { createDocument, createElement } from '../../src/core/model';
import { Writer } from '../../src/storage/writer';
import type { Repository } from '../../src/storage/repository';

afterEach(() => { vi.unstubAllGlobals(); });

it('retains a failed batch and retries it before edits that arrived during the write', async () => {
  vi.stubGlobal('window', globalThis);
  const doc = createDocument();
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
