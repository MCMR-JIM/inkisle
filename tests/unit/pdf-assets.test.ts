import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { AssetStore } from '../../src/storage/assets';
import { exportSource, importSource } from '../../src/storage/source-file';
import { createDocument } from '../../src/core/model';
import { createPaper } from '../../src/core/paper';
import { SnapshotCodec } from '../../src/storage/snapshot';

describe('shared PDF originals and portable board files', () => {
  it('stores one original for many page references and carries it to a fresh asset store', async () => {
    const store = new AssetStore(`assets-${crypto.randomUUID()}`);
    const blob = new Blob(['%PDF-1.7\nfixture'], { type: 'application/pdf' });
    const id = await store.put(blob); expect(await store.put(blob)).toBe(id);
    const doc = createDocument('PDF'); doc.elements = [createPaper(0, 0, id, 1), createPaper(1000, 0, id, 2)];
    const codec = new SnapshotCodec();
    const source = await exportSource(doc, codec, store);
    expect(source.size).toBeLessThan(3000);
    const destination = new AssetStore(`assets-${crypto.randomUUID()}`);
    expect(await importSource(source, codec, destination)).toEqual(doc);
    expect(await (await destination.get(id)).text()).toBe(await blob.text());
    store.close(); destination.close(); codec.close();
  });

  it('detects missing, corrupt and truncated assets while retaining legacy file compatibility', async () => {
    const store = new AssetStore(`assets-${crypto.randomUUID()}`), codec = new SnapshotCodec();
    const doc = createDocument('legacy');
    expect(await importSource(await exportSource(doc, codec, store), codec, store)).toEqual(doc);
    const id = await store.put(new Blob(['%PDF-1.7\nfixture'])); doc.elements = [createPaper(0, 0, id, 1)];
    const source = await exportSource(doc, codec, store);
    const bytes = new Uint8Array(await source.arrayBuffer()); bytes[bytes.length - 1] ^= 1;
    await expect(importSource(new Blob([bytes]), codec, store)).rejects.toThrow(/校验/);
    await expect(importSource(source.slice(0, source.size - 2), codec, store)).rejects.toThrow(/损坏|完整/);
    doc.elements[0].paper!.sourceId = 'b'.repeat(64);
    await expect(exportSource(doc, codec, store)).rejects.toThrow(/缺失/);
    store.close(); codec.close();
  });
});
