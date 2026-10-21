import type { BoardElement, Erasure, Point } from './model';
import { elementBounds, expandBounds, intersects } from './geometry';
import { localPoint } from './transforms';

export function erasureBounds(points: Point[], radius: number) {
  let x = Infinity, y = Infinity, right = -Infinity, bottom = -Infinity;
  for (const p of points) { x = Math.min(x, p.x); y = Math.min(y, p.y); right = Math.max(right, p.x); bottom = Math.max(bottom, p.y); }
  return expandBounds({ x, y, w: right - x, h: bottom - y }, radius);
}

/** Returns a new element; original geometry and previously committed masks stay immutable. */
export function eraseAt(el: BoardElement, points: Point[], radius: number, extend = false): BoardElement | null {
  if (el.locked || !points.length || radius <= 0 || !intersects(elementBounds(el), erasureBounds(points, radius))) return null;
  const local = points.map(p => localPoint(el, p));
  const previous = el.erasures ?? [], last = previous.at(-1), tail = last?.points.at(-1);
  if (extend && last && tail && last.radiusX === radius && last.radiusY === radius && tail.x === local[0].x && tail.y === local[0].y) {
    const additions = local.slice(1);
    if (!additions.length) return null;
    return { ...el, erasures: [...previous.slice(0, -1), { ...last, points: [...last.points, ...additions] }] };
  }
  return { ...el, erasures: [...previous, { points: local, radiusX: radius, radiusY: radius }] };
}

export function scaleErasures(erasures: Erasure[] | undefined, sx: number, sy: number): Erasure[] | undefined {
  return erasures?.map(stroke => ({
    radiusX: stroke.radiusX * Math.abs(sx), radiusY: stroke.radiusY * Math.abs(sy),
    points: stroke.points.map(p => ({ x: p.x * sx, y: p.y * sy })),
  }));
}
