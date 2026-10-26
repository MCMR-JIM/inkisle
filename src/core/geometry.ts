import type { BoardElement, Bounds, Camera, Point } from './model';
import { inFills, shapeVertices } from './paths';
import { localPoint, transformedBounds } from './transforms';
import { clampZoom } from './camera';
import { hitInk, smoothInk } from './ink';

export function normalizeBounds(b: Bounds): Bounds {
  return { x: Math.min(b.x, b.x + b.w), y: Math.min(b.y, b.y + b.h), w: Math.abs(b.w), h: Math.abs(b.h) };
}

export function elementBounds(el: BoardElement): Bounds {
  if (el.kind === 'paper' && el.paper) return expandBounds(normalizeBounds(el), el.paper.margin);
  let b = normalizeBounds(el);
  if (el.kind === 'pen' && el.points.length) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const p of el.points) {
      minX = Math.min(minX, p.x); minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y);
    }
    b = { x: el.x + minX, y: el.y + minY, w: maxX - minX, h: maxY - minY };
  }
  const bounds = el.rotation ? transformedBounds(el) : b;
  return expandBounds(bounds, el.strokeWidth / 2);
}

export function expandBounds(b: Bounds, amount: number): Bounds {
  return { x: b.x - amount, y: b.y - amount, w: b.w + amount * 2, h: b.h + amount * 2 };
}

export function unionBounds(elements: BoardElement[]): Bounds | null {
  if (!elements.length) return null;
  let x = Infinity, y = Infinity, right = -Infinity, bottom = -Infinity;
  for (const el of elements) {
    const b = elementBounds(el);
    x = Math.min(x, b.x); y = Math.min(y, b.y);
    right = Math.max(right, b.x + b.w); bottom = Math.max(bottom, b.y + b.h);
  }
  return { x, y, w: right - x, h: bottom - y };
}

export function intersects(a: Bounds, b: Bounds): boolean {
  return a.x <= b.x + b.w && a.x + a.w >= b.x && a.y <= b.y + b.h && a.y + a.h >= b.y;
}

export function contains(b: Bounds, p: Point): boolean {
  return p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h;
}

/** Window selection requires the complete world bounds, including the stroke. */
export function containsBounds(outer: Bounds, inner: Bounds): boolean {
  const a = normalizeBounds(outer), b = normalizeBounds(inner);
  return b.x >= a.x && b.y >= a.y && b.x + b.w <= a.x + a.w && b.y + b.h <= a.y + a.h;
}

export function screenToWorld(p: Point, camera: Camera): Point {
  return { x: (p.x - camera.x) / camera.zoom, y: (p.y - camera.y) / camera.zoom };
}

export function worldToScreen(p: Point, camera: Camera): Point {
  return { x: p.x * camera.zoom + camera.x, y: p.y * camera.zoom + camera.y };
}

export function zoomAt(camera: Camera, point: Point, zoom: number): Camera {
  const next = clampZoom(zoom);
  const world = screenToWorld(point, camera);
  return { x: point.x - world.x * next, y: point.y - world.y * next, zoom: next };
}

function segmentDistanceSq(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x, dy = b.y - a.y;
  const t = dx || dy ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy))) : 0;
  return (p.x - a.x - t * dx) ** 2 + (p.y - a.y - t * dy) ** 2;
}

export function hitTest(el: BoardElement, p: Point, tolerance = 5): boolean {
  if (el.kind === 'paper') return false;
  if (!contains(expandBounds(elementBounds(el), tolerance), p)) return false;
  if (el.rotation) {
    const local = localPoint(el, p);
    const unrotated = { ...el, rotation: 0, x: el.x, y: el.y };
    return hitTest(unrotated, { x: local.x + el.x, y: local.y + el.y }, tolerance);
  }
  if (pointIsErased(el, p)) return false;
  const t = tolerance + el.strokeWidth / 2;
  if (el.kind === 'path' && el.path) {
    const local = { x: p.x - el.x, y: p.y - el.y };
    if (el.fill !== 'transparent' && inFills(local, el.path.fills)) return true;
    if (el.stroke !== 'transparent' && el.strokeWidth > 0) for (const stroke of el.path.strokes) {
      if (stroke.pressureEnabled) {
        if (hitInk(stroke.points, local, el.strokeWidth, tolerance, el.dash)) return true;
        continue;
      }
      const points = stroke.points;
      if (points.length === 1 && Math.hypot(local.x - points[0].x, local.y - points[0].y) <= t) return true;
      for (let i = 1; i < points.length; i++) if (segmentDistanceSq(local, points[i - 1], points[i]) <= t * t) return true;
      if (stroke.closed && points.length > 1 && segmentDistanceSq(local, points.at(-1)!, points[0]) <= t * t) return true;
    }
    return false;
  }
  if (el.kind === 'line' || el.kind === 'arrow') {
    return segmentDistanceSq(p, el, { x: el.x + el.w, y: el.y + el.h }) <= t * t;
  }
  if (el.kind === 'pen') {
    const local = { x: p.x - el.x, y: p.y - el.y };
    if (el.pressureEnabled) return el.stroke !== 'transparent' && hitInk(smoothInk(el.points), local, el.strokeWidth, tolerance, el.dash);
    if (el.points.length === 1) return Math.hypot(local.x - el.points[0].x, local.y - el.points[0].y) <= t;
    for (let i = 1; i < el.points.length; i++) {
      if (segmentDistanceSq(local, el.points[i - 1], el.points[i]) <= t * t) return true;
    }
    return false;
  }
  const b = normalizeBounds(el);
  if (['diamond', 'triangle', 'pentagon', 'hexagon'].includes(el.kind)) {
    const point = { x: p.x - el.x, y: p.y - el.y }, vertices = shapeVertices(el);
    if (inFills(point, [vertices])) return true;
    return vertices.some((a, i) => segmentDistanceSq(point, a, vertices[(i + 1) % vertices.length]) <= t * t);
  }
  if (el.kind === 'roundrect') {
    const radius = Math.min(el.radius, b.w / 2, b.h / 2);
    const cx = Math.max(b.x + radius, Math.min(b.x + b.w - radius, p.x));
    const cy = Math.max(b.y + radius, Math.min(b.y + b.h - radius, p.y));
    return Math.hypot(p.x - cx, p.y - cy) <= radius + t;
  }
  if (el.kind === 'ellipse') {
    const rx = Math.max(0.01, b.w / 2), ry = Math.max(0.01, b.h / 2);
    return ((p.x - b.x - rx) / (rx + t)) ** 2 + ((p.y - b.y - ry) / (ry + t)) ** 2 <= 1;
  }
  return true;
}

export function pointIsErased(el: BoardElement, point: Point): boolean {
  if (!el.erasures?.length) return false;
  const local = localPoint(el, point);
  for (const stroke of el.erasures) {
    const p = { x: local.x / stroke.radiusX, y: local.y / stroke.radiusY };
    const normalized = (p: Point): Point => ({ x: p.x / stroke.radiusX, y: p.y / stroke.radiusY });
    if (stroke.points.length === 1) {
      const a = normalized(stroke.points[0]);
      if ((p.x - a.x) ** 2 + (p.y - a.y) ** 2 <= 1) return true;
    } else for (let i = 1; i < stroke.points.length; i++) {
      if (segmentDistanceSq(p, normalized(stroke.points[i - 1]), normalized(stroke.points[i])) <= 1) return true;
    }
  }
  return false;
}

export function simplifyPoints(points: Point[], tolerance = 0.5): Point[] {
  if (points.length <= 2) return points.slice();
  const keep = new Uint8Array(points.length);
  keep[0] = keep[points.length - 1] = 1;
  const stack = [0, points.length - 1];
  while (stack.length) {
    const end = stack.pop()!, start = stack.pop()!;
    let max = tolerance * tolerance, index = -1;
    for (let i = start + 1; i < end; i++) {
      const d = segmentDistanceSq(points[i], points[start], points[end]);
      if (d > max) { max = d; index = i; }
    }
    if (index !== -1) { keep[index] = 1; stack.push(start, index, index, end); }
  }
  return points.filter((_, i) => keep[i]);
}
