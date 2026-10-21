import type { Bounds } from './model';
import { intersects } from './geometry';

/** A bounded-memory spatial hash. Oversized items live in a separate small set. */
export class SpatialIndex {
  private cells = new Map<string, Set<string>>();
  private entries = new Map<string, { bounds: Bounds; cells: string[] }>();
  private oversized = new Set<string>();

  constructor(private cellSize = 256) {}

  private keys(b: Bounds): string[] | null {
    const l = Math.floor(b.x / this.cellSize), r = Math.floor((b.x + b.w) / this.cellSize);
    const t = Math.floor(b.y / this.cellSize), bottom = Math.floor((b.y + b.h) / this.cellSize);
    if ((r - l + 1) * (bottom - t + 1) > 512) return null;
    const keys: string[] = [];
    for (let x = l; x <= r; x++) for (let y = t; y <= bottom; y++) keys.push(`${x},${y}`);
    return keys;
  }

  set(id: string, bounds: Bounds): void {
    this.delete(id);
    const keys = this.keys(bounds);
    if (!keys) this.oversized.add(id);
    else for (const key of keys) {
      let cell = this.cells.get(key);
      if (!cell) this.cells.set(key, cell = new Set());
      cell.add(id);
    }
    this.entries.set(id, { bounds, cells: keys ?? [] });
  }

  delete(id: string): void {
    const entry = this.entries.get(id);
    if (!entry) return;
    for (const key of entry.cells) {
      const cell = this.cells.get(key)!;
      cell.delete(id);
      if (!cell.size) this.cells.delete(key);
    }
    this.oversized.delete(id);
    this.entries.delete(id);
  }

  query(bounds: Bounds): Set<string> {
    const keys = this.keys(bounds);
    const candidates = new Set(this.oversized);
    if (!keys) {
      for (const id of this.entries.keys()) candidates.add(id);
    } else for (const key of keys) {
      const cell = this.cells.get(key);
      if (cell) for (const id of cell) candidates.add(id);
    }
    for (const id of candidates) if (!intersects(this.entries.get(id)!.bounds, bounds)) candidates.delete(id);
    return candidates;
  }
}
