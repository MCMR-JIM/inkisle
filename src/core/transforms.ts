import type { BoardElement, Bounds, Point } from './model';
function normalizeBounds(b: Bounds): Bounds {
  return { x: Math.min(b.x, b.x + b.w), y: Math.min(b.y, b.y + b.h), w: Math.abs(b.w), h: Math.abs(b.h) };
}

export type Vec2 = { x: number; y: number };

export function objectLocalBounds(el: BoardElement): Bounds {
  if (el.kind === 'pen' && el.points.length) {
    let x = Infinity, y = Infinity, right = -Infinity, bottom = -Infinity;
    for (const p of el.points) { x = Math.min(x, p.x); y = Math.min(y, p.y); right = Math.max(right, p.x); bottom = Math.max(bottom, p.y); }
    return { x, y, w: right - x, h: bottom - y };
  }
  return normalizeBounds({ x: 0, y: 0, w: el.w, h: el.h });
}

export function rotationCenter(el: BoardElement): Vec2 {
  const b = normalizeBounds(el);
  return { x: b.x + b.w / 2, y: b.y + b.h / 2 };
}

export function rotatePoint(point: Vec2, center: Vec2, angle: number): Vec2 {
  const cos = Math.cos(angle), sin = Math.sin(angle), x = point.x - center.x, y = point.y - center.y;
  return { x: center.x + x * cos - y * sin, y: center.y + x * sin + y * cos };
}

export function worldPoint(el: BoardElement, local: Vec2): Vec2 {
  return rotatePoint({ x: el.x + local.x, y: el.y + local.y }, rotationCenter(el), el.rotation ?? 0);
}

export function localPoint(el: BoardElement, world: Vec2): Vec2 {
  const unrotated = rotatePoint(world, rotationCenter(el), -(el.rotation ?? 0));
  return { x: unrotated.x - el.x, y: unrotated.y - el.y };
}

export function normalizeAngle(angle: number): number {
  const twoPi = Math.PI * 2;
  return ((angle + Math.PI) % twoPi + twoPi) % twoPi - Math.PI;
}

export function snapRotation(angle: number, step = Math.PI / 12): number {
  return normalizeAngle(Math.round(angle / step) * step);
}

export function snapLineEndpoint(anchor: Vec2, point: Vec2, step = Math.PI / 4): Vec2 {
  const dx = point.x - anchor.x, dy = point.y - anchor.y, length = Math.hypot(dx, dy);
  if (length < 1e-9) return point;
  const angle = Math.round(Math.atan2(dy, dx) / step) * step;
  return { x: anchor.x + Math.cos(angle) * length, y: anchor.y + Math.sin(angle) * length };
}

export function transformedBounds(el: BoardElement): Bounds {
  const b = objectLocalBounds(el), corners = [
    worldPoint(el, { x: b.x, y: b.y }),
    worldPoint(el, { x: b.x + b.w, y: b.y }),
    worldPoint(el, { x: b.x + b.w, y: b.y + b.h }),
    worldPoint(el, { x: b.x, y: b.y + b.h }),
  ];
  const xs = corners.map(p => p.x), ys = corners.map(p => p.y);
  return { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
}

export function lineWorldEndpoints(el: BoardElement): { start: Point; end: Point } {
  return { start: worldPoint(el, { x: 0, y: 0 }), end: worldPoint(el, { x: el.w, y: el.h }) };
}
