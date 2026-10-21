import type { Erasure, Point, StrokePath } from './model';
import { distance, mix } from './paths';

type Interval = [number, number];

function linearRange(a: number, b: number, low: number, high: number): Interval | null {
  if (Math.abs(b - a) < 1e-14) return a >= low && a <= high ? [0, 1] : null;
  const t0 = (low - a) / (b - a), t1 = (high - a) / (b - a);
  const start = Math.max(0, Math.min(t0, t1)), end = Math.min(1, Math.max(t0, t1));
  return end > start ? [start, end] : null;
}

function diskRange(a: Point, b: Point, center: Point): Interval | null {
  const dx = b.x - a.x, dy = b.y - a.y, px = a.x - center.x, py = a.y - center.y;
  const aa = dx * dx + dy * dy;
  if (!aa) return px * px + py * py <= 1 ? [0, 1] : null;
  const bb = 2 * (px * dx + py * dy), cc = px * px + py * py - 1;
  const discriminant = bb * bb - 4 * aa * cc;
  if (discriminant <= 0) return null;
  const root = Math.sqrt(discriminant);
  const lo = Math.max(0, (-bb - root) / (2 * aa)), hi = Math.min(1, (-bb + root) / (2 * aa));
  return hi > lo ? [lo, hi] : null;
}

function capsuleRanges(a: Point, b: Point, c: Point, d: Point): Interval[] {
  const result = [diskRange(a, b, c), diskRange(a, b, d)].filter((i): i is Interval => !!i);
  const length = distance(c, d);
  if (length > 1e-12) {
    const ux = (d.x - c.x) / length, uy = (d.y - c.y) / length;
    const axis = (p: Point): Point => ({ x: (p.x - c.x) * ux + (p.y - c.y) * uy, y: -(p.x - c.x) * uy + (p.y - c.y) * ux });
    const p = axis(a), q = axis(b);
    const x = linearRange(p.x, q.x, 0, length), y = linearRange(p.y, q.y, -1, 1);
    if (x && y) { const lo = Math.max(x[0], y[0]), hi = Math.min(x[1], y[1]); if (hi > lo) result.push([lo, hi]); }
  }
  return result;
}

export function erasedIntervals(a: Point, b: Point, erasures: Erasure[]): Interval[] {
  const intervals: Interval[] = [];
  for (const stroke of erasures) {
    const scale = (p: Point): Point => ({ x: p.x / stroke.radiusX, y: p.y / stroke.radiusY });
    const p = scale(a), q = scale(b);
    if (stroke.points.length === 1) { const range = diskRange(p, q, scale(stroke.points[0])); if (range) intervals.push(range); }
    else for (let i = 1; i < stroke.points.length; i++) intervals.push(...capsuleRanges(p, q, scale(stroke.points[i - 1]), scale(stroke.points[i])));
  }
  intervals.sort((a, b) => a[0] - b[0]);
  const merged: Interval[] = [];
  for (const interval of intervals) {
    const last = merged.at(-1);
    if (last && interval[0] <= last[1] + 1e-10) last[1] = Math.max(last[1], interval[1]);
    else merged.push([...interval]);
  }
  return merged;
}

export function clipStroke(stroke: StrokePath, erasures: Erasure[]): { paths: StrokePath[]; changed: boolean } {
  if (!stroke.points.length) return { paths: [], changed: false };
  const source = stroke.closed ? [...stroke.points, stroke.points[0]] : stroke.points;
  if (source.length === 1) {
    const erased = erasedIntervals(source[0], source[0], erasures).length > 0;
    return { paths: erased ? [] : [stroke], changed: erased };
  }
  const parts: StrokePath[] = [];
  let current: Point[] | null = null, changed = false;
  for (let i = 1; i < source.length; i++) {
    const a = source[i - 1], b = source[i];
    if (distance(a, b) < 1e-12) continue;
    const erased = erasedIntervals(a, b, erasures);
    changed ||= erased.length > 0;
    let start = 0;
    for (const [lo, hi] of [...erased, [1, 1] as Interval]) {
      if (lo - start > 1e-10) {
        const first = mix(a, b, start), end = mix(a, b, lo);
        if (!current || distance(current.at(-1)!, first) > 1e-7) { current = [first]; parts.push({ ...stroke, points: current, closed: false }); }
        current.push(end);
      }
      if (hi > lo) current = null;
      start = hi;
    }
  }
  if (!changed) return { paths: [stroke], changed: false };
  if (stroke.closed && parts.length > 1) {
    const first = parts[0], last = parts.at(-1)!;
    if (distance(last.points.at(-1)!, first.points[0]) < 1e-7) {
      first.points = [...last.points, ...first.points.slice(1)]; parts.pop();
    }
  }
  return { paths: parts.filter(p => p.points.length > 1), changed };
}
