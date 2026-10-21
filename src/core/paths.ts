import type { BoardElement, Bounds, PathGeometry, Point } from './model';
import { smoothInk } from './ink';

export const distance = (a: Point, b: Point): number => Math.hypot(a.x - b.x, a.y - b.y);
export const mix = (a: Point, b: Point, t: number): Point => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, ...(a.pressure !== undefined || b.pressure !== undefined ? { pressure: (a.pressure ?? .5) + ((b.pressure ?? .5) - (a.pressure ?? .5)) * t } : {}) });

export function polygonPoints(cx: number, cy: number, radiusX: number, radiusY: number, sides: number, rotation = -Math.PI / 2): Point[] {
  return Array.from({ length: sides }, (_, i) => {
    const angle = rotation + i * Math.PI * 2 / sides;
    return { x: cx + radiusX * Math.cos(angle), y: cy + radiusY * Math.sin(angle) };
  });
}

export function shapeVertices(el: BoardElement): Point[] {
  if (el.kind === 'triangle' && el.vertices) return el.vertices;
  const x = Math.min(0, el.w), y = Math.min(0, el.h), w = Math.abs(el.w), h = Math.abs(el.h);
  if (el.kind === 'diamond') return [{ x: x + w / 2, y }, { x: x + w, y: y + h / 2 }, { x: x + w / 2, y: y + h }, { x, y: y + h / 2 }];
  return polygonPoints(x + w / 2, y + h / 2, w / 2, h / 2, el.kind === 'triangle' ? 3 : el.kind === 'pentagon' ? 5 : 6);
}

export function pointsBounds(points: Point[]): Bounds {
  let x = Infinity, y = Infinity, right = -Infinity, bottom = -Infinity;
  for (const p of points) { x = Math.min(x, p.x); y = Math.min(y, p.y); right = Math.max(right, p.x); bottom = Math.max(bottom, p.y); }
  return points.length ? { x, y, w: right - x, h: bottom - y } : { x: 0, y: 0, w: 0, h: 0 };
}

export function ringArea(points: Point[]): number {
  let sum = 0;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) sum += points[j].x * points[i].y - points[i].x * points[j].y;
  return sum / 2;
}

export function inRing(p: Point, ring: Point[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i], b = ring[j];
    if ((a.y > p.y) !== (b.y > p.y) && p.x < (b.x - a.x) * (p.y - a.y) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

export function inFills(p: Point, rings: Point[][]): boolean {
  let inside = false;
  for (const ring of rings) if (inRing(p, ring)) inside = !inside;
  return inside;
}

function arc(cx: number, cy: number, rx: number, ry: number, start: number, end: number, tolerance: number): Point[] {
  const radius = Math.max(rx, ry, .01);
  const angle = 2 * Math.acos(Math.max(-1, Math.min(1, 1 - tolerance / radius)));
  const count = Math.min(4096, Math.max(2, Math.ceil(Math.abs(end - start) / Math.max(.01, angle))));
  return Array.from({ length: count + 1 }, (_, i) => ({ x: cx + rx * Math.cos(start + (end - start) * i / count), y: cy + ry * Math.sin(start + (end - start) * i / count) }));
}

function quadratic(a: Point, c: Point, b: Point, tolerance: number, out: Point[], depth = 0): void {
  const chord = distance(a, b);
  const error = chord ? Math.abs((b.x - a.x) * (a.y - c.y) - (a.x - c.x) * (b.y - a.y)) / chord : distance(a, c);
  if (error <= tolerance || depth >= 16) { out.push(b); return; }
  const ac = mix(a, c, .5), cb = mix(c, b, .5), middle = mix(ac, cb, .5);
  quadratic(a, ac, middle, tolerance, out, depth + 1); quadratic(middle, cb, b, tolerance, out, depth + 1);
}

export function elementPaths(el: BoardElement, tolerance = .15): PathGeometry {
  if (el.kind === 'path') return el.path!;
  if (el.kind === 'pen') {
    if (el.pressureEnabled) return { fills: [], strokes: [{ points: smoothInk(el.points, tolerance), closed: false, pressureEnabled: true }] };
    const points: Point[] = el.points.length ? [el.points[0]] : [];
    for (let i = 1; i < el.points.length - 1; i++) quadratic(points.at(-1)!, el.points[i], mix(el.points[i], el.points[i + 1], .5), tolerance, points);
    if (el.points.length > 1) points.push(el.points.at(-1)!);
    return { fills: [], strokes: [{ points, closed: false, ...(el.pressureEnabled !== undefined ? { pressureEnabled: el.pressureEnabled } : {}) }] };
  }
  if (el.kind === 'line' || el.kind === 'arrow' || el.kind === 'bidirectional-arrow') {
    const end = { x: el.w, y: el.h };
    const strokes = [{ points: [{ x: 0, y: 0 }, end], closed: false }];
    if (el.kind === 'arrow' || el.kind === 'bidirectional-arrow') {
      const angle = Math.atan2(el.h, el.w), length = Math.min(Math.hypot(el.w, el.h) / 2, Math.max(12, el.strokeWidth * 4));
      strokes.push({ points: [{ x: el.w - length * Math.cos(angle - Math.PI / 6), y: el.h - length * Math.sin(angle - Math.PI / 6) }, end, { x: el.w - length * Math.cos(angle + Math.PI / 6), y: el.h - length * Math.sin(angle + Math.PI / 6) }], closed: false });
      if (el.kind === 'bidirectional-arrow') strokes.push({ points: [{ x: length * Math.cos(angle - Math.PI / 6), y: length * Math.sin(angle - Math.PI / 6) }, { x: 0, y: 0 }, { x: length * Math.cos(angle + Math.PI / 6), y: length * Math.sin(angle + Math.PI / 6) }], closed: false });
    }
    return { fills: [], strokes };
  }
  const x = Math.min(0, el.w), y = Math.min(0, el.h), w = Math.abs(el.w), h = Math.abs(el.h);
  let ring: Point[];
  if (el.kind === 'ellipse') ring = arc(x + w / 2, y + h / 2, w / 2, h / 2, 0, Math.PI * 2, tolerance).slice(0, -1);
  else if (['diamond', 'triangle', 'pentagon', 'hexagon'].includes(el.kind)) ring = shapeVertices(el);
  else {
    const r = el.kind === 'rect' ? 0 : Math.min(el.radius, w / 2, h / 2);
    if (!r) ring = [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }];
    else ring = [
      ...arc(x + w - r, y + r, r, r, -Math.PI / 2, 0, tolerance),
      ...arc(x + w - r, y + h - r, r, r, 0, Math.PI / 2, tolerance),
      ...arc(x + r, y + h - r, r, r, Math.PI / 2, Math.PI, tolerance),
      ...arc(x + r, y + r, r, r, Math.PI, Math.PI * 1.5, tolerance),
    ];
  }
  return { fills: el.fill !== 'transparent' ? [ring] : [], strokes: el.stroke !== 'transparent' && el.strokeWidth > 0 ? [{ points: ring, closed: true }] : [] };
}

export function transformPath(path: PathGeometry | undefined, sx: number, sy: number): PathGeometry | undefined {
  const map = (p: Point): Point => ({ ...p, x: p.x * sx, y: p.y * sy });
  return path && {
    fills: path.fills.map(ring => ring.map(map)), strokes: path.strokes.map(stroke => ({ ...stroke, points: stroke.points.map(map) })),
    ...(path.label ? { label: { ...path.label, x: path.label.x * sx, y: path.label.y * sy, w: path.label.w * sx, h: path.label.h * sy } } : {}),
  };
}

export function capsule(a: Point, b: Point, rx: number, ry: number, tolerance: number): Point[] {
  const angle = Math.atan2((b.y - a.y) / ry, (b.x - a.x) / rx);
  if (distance(a, b) < 1e-10) return arc(a.x, a.y, rx, ry, 0, Math.PI * 2, tolerance).slice(0, -1);
  return [
    ...arc(b.x, b.y, rx, ry, angle - Math.PI / 2, angle + Math.PI / 2, tolerance),
    ...arc(a.x, a.y, rx, ry, angle + Math.PI / 2, angle + Math.PI * 1.5, tolerance),
  ];
}
