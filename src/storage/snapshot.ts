import { decodeDocument, encodeDocument } from '../core/codec';
import type { BoardDocument } from '../core/model';

interface CodecReply { id: number; result?: BoardDocument | Uint8Array<ArrayBuffer>; error?: string }
interface Pending { resolve: (result: BoardDocument | Uint8Array<ArrayBuffer>) => void; reject: (error: Error) => void }

/** Tiny documents stay synchronous; expensive serialization runs off the UI thread. */
export class SnapshotCodec {
  private worker: Worker | null = null;
  private sequence = 0;
  private pending = new Map<number, Pending>();

  private background(type: 'encode' | 'decode', data: BoardDocument | Uint8Array): Promise<BoardDocument | Uint8Array<ArrayBuffer>> {
    if (!this.worker) {
      this.worker = new Worker(new URL('./snapshot.worker.ts', import.meta.url), { type: 'module' });
      this.worker.onmessage = ({ data }: MessageEvent<CodecReply>) => {
        const pending = this.pending.get(data.id); if (!pending) return;
        this.pending.delete(data.id);
        if (data.error) pending.reject(new Error(data.error)); else pending.resolve(data.result!);
      };
      this.worker.onerror = () => {
        for (const pending of this.pending.values()) pending.reject(new Error('后台文件处理失败，请重试'));
        this.pending.clear(); this.worker?.terminate(); this.worker = null;
      };
    }
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.worker!.postMessage({ id, type, data });
    });
  }

  async encode(doc: BoardDocument): Promise<Uint8Array<ArrayBuffer>> {
    const heavy = doc.elements.length > 256 || doc.elements.some(el => el.points.length > 2000 || (el.src?.length ?? 0) > 128000 || (el.erasures?.reduce((count, stroke) => count + stroke.points.length, 0) ?? 0) > 2000 || (el.path && el.path.fills.reduce((n, ring) => n + ring.length, 0) + el.path.strokes.reduce((n, stroke) => n + stroke.points.length, 0) > 2000));
    if (!heavy || typeof Worker === 'undefined') return encodeDocument(doc);
    return await this.background('encode', doc) as Uint8Array<ArrayBuffer>;
  }

  async decode(bytes: Uint8Array): Promise<BoardDocument> {
    if (bytes.length < 128000 || typeof Worker === 'undefined') return decodeDocument(bytes);
    return await this.background('decode', bytes) as BoardDocument;
  }

  close(): void {
    this.worker?.terminate(); this.worker = null;
    for (const pending of this.pending.values()) pending.reject(new Error('文件处理已停止'));
    this.pending.clear();
  }
}
