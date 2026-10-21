import { decodeDocument, encodeDocument } from '../core/codec';
import type { BoardDocument } from '../core/model';

self.onmessage = ({ data }: MessageEvent<{ id: number; type: 'encode' | 'decode'; data: BoardDocument | Uint8Array }>) => {
  try {
    const result = data.type === 'encode' ? encodeDocument(data.data as BoardDocument) : decodeDocument(data.data as Uint8Array);
    if (result instanceof Uint8Array) self.postMessage({ id: data.id, result }, { transfer: [result.buffer] });
    else self.postMessage({ id: data.id, result });
  } catch (error) { self.postMessage({ id: data.id, error: error instanceof Error ? error.message : String(error) }); }
};
