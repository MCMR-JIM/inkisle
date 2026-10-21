import type { BoardElement } from '../core/model';

/** Geometry is computed off-thread; pointer preview never waits for this module. */
export class Cutter {
  private worker: Worker | null = null;
  private sequence = 0;
  private pending = new Map<number, { resolve: (parts: BoardElement[][]) => void; reject: (error: Error) => void }>();

  cut(elements: BoardElement[], tolerance: number): Promise<BoardElement[][]> {
    if (!elements.length) return Promise.resolve([]);
    if (!this.worker) {
      this.worker = new Worker(new URL('./cutter.worker.ts', import.meta.url), { type: 'module' });
      this.worker.onmessage = ({ data }: MessageEvent<{ id: number; result?: BoardElement[][]; error?: string }>) => {
        const pending = this.pending.get(data.id); if (!pending) return;
        this.pending.delete(data.id);
        if (data.error) pending.reject(new Error(data.error)); else pending.resolve(data.result!);
      };
      this.worker.onerror = () => {
        for (const pending of this.pending.values()) pending.reject(new Error('几何处理未完成'));
        this.pending.clear(); this.worker?.terminate(); this.worker = null;
      };
    }
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject }); this.worker!.postMessage({ id, elements, tolerance });
    });
  }

  destroy(): void {
    this.worker?.terminate(); this.worker = null;
    for (const pending of this.pending.values()) pending.reject(new Error('几何处理已停止'));
    this.pending.clear();
  }
}
