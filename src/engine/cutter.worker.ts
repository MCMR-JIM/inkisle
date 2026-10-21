import { cutElement } from '../core/cut';
import type { BoardElement } from '../core/model';

self.onmessage = ({ data }: MessageEvent<{ id: number; elements: BoardElement[]; tolerance: number }>) => {
  try {
    const result = data.elements.map(element => {
      try { return cutElement(element, data.tolerance); }
      catch { return [element]; } // Exact live masks are a lossless fallback for degenerate topology.
    });
    self.postMessage({ id: data.id, result });
  } catch (error) { self.postMessage({ id: data.id, error: error instanceof Error ? error.message : String(error) }); }
};
