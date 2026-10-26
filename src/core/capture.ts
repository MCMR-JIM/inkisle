import type { Bounds, Point } from './model';

export type CaptureMode = 'rectangle' | 'polygon';
export interface CaptureRegion { points: Point[]; closed: boolean; cursor?: Point }

export function rectangleRegion(a: Point, b: Point): Point[] {
  return [a, { x: b.x, y: a.y }, b, { x: a.x, y: b.y }].map(p => ({ x: p.x, y: p.y }));
}

/** Bounds stay in world coordinates, independently of camera and output resolution. */
export function captureBounds(points: Point[]): Bounds | null {
  if (points.length < 3 || points.length > 512 || points.some(p => !Number.isFinite(p.x) || !Number.isFinite(p.y))) return null;
  const xs = points.map(p => p.x), ys = points.map(p => p.y);
  const x = Math.min(...xs), y = Math.min(...ys), w = Math.max(...xs) - x, h = Math.max(...ys) - y;
  const area = points.reduce((sum, p, i) => { const next = points[(i + 1) % points.length]; return sum + (p.x - x) * (next.y - y) - (next.x - x) * (p.y - y); }, 0);
  return w > 0 && h > 0 && Math.abs(area) > .01 ? { x, y, w, h } : null;
}
