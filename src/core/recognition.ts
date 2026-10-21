import type { Bounds, Point } from './model';
import { simplifyPoints } from './geometry';
import { distance, mix, pointsBounds, ringArea } from './paths';
import { rectangularGesture } from './rectangle-gesture';

export interface RecognizedShape extends Bounds {
  kind: 'triangle' | 'rect' | 'ellipse';
  rotation: number;
  vertices?: Point[];
  regular: boolean;
}

const SAMPLES = 160;
const REGULAR_RATIO = .88;

function segmentDistance(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x, dy = b.y - a.y;
  const t = dx || dy ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy))) : 0;
  return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
}

/** Arc-length samples remove speed/pressure bias and bound all fitting work. */
function resample(points: Point[], length: number): Point[] {
  const result: Point[] = [points[0]];
  const step = length / SAMPLES;
  let traversed = 0, target = step;
  for (let i = 1; i < points.length && result.length < SAMPLES; i++) {
    const a = points[i - 1], b = points[i], edge = distance(a, b);
    if (edge < 1e-10) continue;
    while (target <= traversed + edge && result.length < SAMPLES) {
      result.push(mix(a, b, (target - traversed) / edge)); target += step;
    }
    traversed += edge;
  }
  return result;
}

function polygonCorners(points: Point[]): Point[] {
  // Start close to a geometric corner rather than preserving the user's
  // arbitrary start point on an edge (which would become a spurious vertex).
  const center = { x: points.reduce((sum, p) => sum + p.x, 0) / points.length, y: points.reduce((sum, p) => sum + p.y, 0) / points.length };
  let start = 0;
  for (let i = 1; i < points.length; i++) if (distance(points[i], center) > distance(points[start], center)) start = i;
  points = [...points.slice(start), ...points.slice(0, start)];
  let farthest = 1, maximum = 0;
  for (let i = 1; i < points.length; i++) {
    const d = distance(points[0], points[i]); if (d > maximum) { maximum = d; farthest = i; }
  }
  const first = simplifyPoints(points.slice(0, farthest + 1), .025);
  const last = simplifyPoints([...points.slice(farthest), points[0]], .025);
  const vertices = [...first.slice(0, -1), ...last.slice(0, -1)];
  let removed = true;
  while (removed && vertices.length > 3) {
    removed = false;
    for (let i = 0; i < vertices.length; i++) {
      if (segmentDistance(vertices[i], vertices[(i + vertices.length - 1) % vertices.length], vertices[(i + 1) % vertices.length]) < .025) {
        vertices.splice(i, 1); removed = true; break;
      }
    }
  }
  return vertices;
}

function triangle(vertices: Point[]): RecognizedShape | null {
  const sides = vertices.map((p, i) => distance(p, vertices[(i + 1) % 3]));
  if (Math.min(...sides) < .005 || Math.abs(ringArea(vertices)) < 1e-5) return null;
  const regular = Math.min(...sides) / Math.max(...sides) >= REGULAR_RATIO;
  let points = vertices;
  if (regular) {
    const center = { x: vertices.reduce((sum, p) => sum + p.x, 0) / 3, y: vertices.reduce((sum, p) => sum + p.y, 0) / 3 };
    const direction = Math.sign(ringArea(vertices));
    let real = 0, imaginary = 0;
    vertices.forEach((p, i) => {
      const angle = direction * i * Math.PI * 2 / 3, x = p.x - center.x, y = p.y - center.y;
      real += x * Math.cos(angle) + y * Math.sin(angle);
      imaginary += y * Math.cos(angle) - x * Math.sin(angle);
    });
    const radius = Math.hypot(real, imaginary) / 3, rotation = Math.atan2(imaginary, real);
    points = vertices.map((_, i) => ({ x: center.x + radius * Math.cos(rotation + direction * i * Math.PI * 2 / 3), y: center.y + radius * Math.sin(rotation + direction * i * Math.PI * 2 / 3) }));
  }
  const b = pointsBounds(points);
  return { kind: 'triangle', ...b, rotation: 0, regular, vertices: points.map(p => ({ x: p.x - b.x, y: p.y - b.y })) };
}

function boxShape(points: Point[], rotation: number, kind: 'rect' | 'ellipse'): RecognizedShape {
  const cos = Math.cos(rotation), sin = Math.sin(rotation);
  const bounds = pointsBounds(points.map(p => ({ x: p.x * cos + p.y * sin, y: -p.x * sin + p.y * cos })));
  let w = Math.max(.008, bounds.w), h = Math.max(.008, bounds.h);
  const regular = Math.min(w, h) / Math.max(w, h) >= REGULAR_RATIO;
  if (regular) w = h = (w + h) / 2;
  const cx = bounds.x + bounds.w / 2, cy = bounds.y + bounds.h / 2;
  const x = cx * cos - cy * sin, y = cx * sin + cy * cos;
  return { kind, x: x - w / 2, y: y - h / 2, w, h, rotation: kind === 'ellipse' && regular ? 0 : rotation, regular };
}

function rectangleFromSides(vertices: Point[]): RecognizedShape {
  const edges = vertices.map((a, i) => ({ x: vertices[(i + 1) % 4].x - a.x, y: vertices[(i + 1) % 4].y - a.y }));
  const sign = Math.sign(ringArea(vertices));
  const axis = {
    x: edges[0].x - edges[2].x + sign * (edges[1].y - edges[3].y),
    y: edges[0].y - edges[2].y - sign * (edges[1].x - edges[3].x),
  };
  let w = (distance(vertices[0], vertices[1]) + distance(vertices[2], vertices[3])) / 2;
  let h = (distance(vertices[1], vertices[2]) + distance(vertices[3], vertices[0])) / 2;
  const regular = Math.min(w, h) / Math.max(w, h) >= REGULAR_RATIO;
  if (regular) w = h = (w + h) / 2;
  const cx = vertices.reduce((sum, p) => sum + p.x, 0) / 4, cy = vertices.reduce((sum, p) => sum + p.y, 0) / 4;
  return { kind: 'rect', x: cx - w / 2, y: cy - h / 2, w, h, rotation: Math.atan2(axis.y, axis.x), regular };
}

function solve(matrix: number[][], vector: number[]): number[] | null {
  const size = vector.length, rows = matrix.map((row, i) => [...row, vector[i]]);
  for (let column = 0; column < size; column++) {
    let pivot = column;
    for (let row = column + 1; row < size; row++) if (Math.abs(rows[row][column]) > Math.abs(rows[pivot][column])) pivot = row;
    if (Math.abs(rows[pivot][column]) < 1e-10) return null;
    [rows[column], rows[pivot]] = [rows[pivot], rows[column]];
    const divisor = rows[column][column];
    for (let i = column; i <= size; i++) rows[column][i] /= divisor;
    for (let row = 0; row < size; row++) if (row !== column) {
      const factor = rows[row][column];
      for (let i = column; i <= size; i++) rows[row][i] -= factor * rows[column][i];
    }
  }
  return rows.map(row => row[size]);
}

function ellipse(points: Point[]): RecognizedShape | null {
  const matrix = Array.from({ length: 5 }, () => Array(5).fill(0) as number[]), vector = Array(5).fill(0) as number[];
  for (const { x, y } of points) {
    const row = [x * x, x * y, y * y, x, y];
    for (let i = 0; i < 5; i++) { vector[i] += row[i]; for (let j = 0; j < 5; j++) matrix[i][j] += row[i] * row[j]; }
  }
  const coefficients = solve(matrix, vector); if (!coefficients) return null;
  const [a, b, c, d, e] = coefficients, determinant = a * c - b * b / 4;
  if (a <= 0 || c <= 0 || determinant <= 1e-6) return null;
  const cx = -(c * d - b * e / 2) / (2 * determinant), cy = -(a * e - b * d / 2) / (2 * determinant);
  const scale = 1 + a * cx * cx + b * cx * cy + c * cy * cy;
  const root = Math.hypot(a - c, b), small = (a + c - root) / 2, large = (a + c + root) / 2;
  if (small <= 0 || scale <= 0) return null;
  let rx = Math.sqrt(scale / small), ry = Math.sqrt(scale / large), rotation = .5 * Math.atan2(b, a - c) + Math.PI / 2;
  // Reject only numerically unbounded fits. A poor but finite ellipse remains
  // a candidate and loses on visual distance instead of falling back to ink.
  if (rx > 1.5 || ry < .004 || Math.hypot(cx, cy) > 1) return null;
  const regular = ry / rx >= REGULAR_RATIO;
  if (regular) { rx = ry = (rx + ry) / 2; rotation = 0; }
  return { kind: 'ellipse', x: cx - rx, y: cy - ry, w: rx * 2, h: ry * 2, rotation, regular };
}

function convexHull(points: Point[]): Point[] {
  const sorted = points.slice().sort((a, b) => a.x - b.x || a.y - b.y);
  const cross = (a: Point, b: Point, c: Point) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  const lower: Point[] = [], upper: Point[] = [];
  for (const p of sorted) {
    while (lower.length > 1 && cross(lower.at(-2)!, lower.at(-1)!, p) <= 0) lower.pop();
    lower.push(p);
  }
  for (const p of sorted.reverse()) {
    while (upper.length > 1 && cross(upper.at(-2)!, upper.at(-1)!, p) <= 0) upper.pop();
    upper.push(p);
  }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}

function triangleHull(hull: Point[]): Point[] {
  const vertices = hull.slice();
  while (vertices.length > 3) {
    let index = 0, minimum = Infinity;
    for (let i = 0; i < vertices.length; i++) {
      const area = Math.abs(ringArea([vertices[(i + vertices.length - 1) % vertices.length], vertices[i], vertices[(i + 1) % vertices.length]]));
      if (area < minimum) { minimum = area; index = i; }
    }
    vertices.splice(index, 1);
  }
  return vertices;
}

function boundary(shape: RecognizedShape, cornerRatio = 0): Point[] {
  if (shape.vertices) return shape.vertices.map(p => ({ x: shape.x + p.x, y: shape.y + p.y }));
  const cx = shape.x + shape.w / 2, cy = shape.y + shape.h / 2, cos = Math.cos(shape.rotation), sin = Math.sin(shape.rotation);
  let vertices = shape.kind === 'rect'
    ? [{ x: -shape.w / 2, y: -shape.h / 2 }, { x: shape.w / 2, y: -shape.h / 2 }, { x: shape.w / 2, y: shape.h / 2 }, { x: -shape.w / 2, y: shape.h / 2 }]
    : Array.from({ length: 64 }, (_, i) => ({ x: shape.w / 2 * Math.cos(i * Math.PI / 32), y: shape.h / 2 * Math.sin(i * Math.PI / 32) }));
  if (shape.kind === 'rect' && cornerRatio > 0) {
    const radius = Math.min(shape.w, shape.h) * cornerRatio;
    vertices = [];
    for (let corner = 0; corner < 4; corner++) {
      const angle = -Math.PI / 2 + corner * Math.PI / 2;
      const x = (corner < 2 ? 1 : -1) * (shape.w / 2 - radius);
      const y = (corner === 0 || corner === 3 ? -1 : 1) * (shape.h / 2 - radius);
      for (let i = 0; i <= 8; i++) vertices.push({ x: x + radius * Math.cos(angle + i * Math.PI / 16), y: y + radius * Math.sin(angle + i * Math.PI / 16) });
    }
  }
  return vertices.map(p => ({ x: cx + p.x * cos - p.y * sin, y: cy + p.x * sin + p.y * cos }));
}

function outlineDistanceSquared(point: Point, points: Point[], closed: boolean): number {
  let minimum = Infinity;
  for (let i = closed ? 0 : 1; i < points.length; i++) {
    const a = points[(i + points.length - 1) % points.length], b = points[i];
    const dx = b.x - a.x, dy = b.y - a.y, lengthSquared = dx * dx + dy * dy;
    const t = lengthSquared ? Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSquared)) : 0;
    const x = point.x - a.x - t * dx, y = point.y - a.y - t * dy;
    minimum = Math.min(minimum, x * x + y * y);
  }
  return minimum;
}

/** Symmetric contour error penalizes both extra and missing shape boundaries. */
function visualError(shape: RecognizedShape, samples: Point[], cornerRatio = 0): number {
  const ring = boundary(shape, cornerRatio), closed = [...ring, ring[0]];
  const perimeter = closed.reduce((sum, p, i) => i ? sum + distance(p, closed[i - 1]) : sum, 0);
  const outline = resample(closed, perimeter).filter((_, i) => i % 4 === 0);
  let inkError = 0, shapeError = 0;
  for (const point of samples) inkError += outlineDistanceSquared(point, ring, true);
  for (const point of outline) shapeError += outlineDistanceSquared(point, samples, false);
  return .75 * inkError / samples.length + .25 * shapeError / Math.max(1, outline.length);
}

function shapeError(shape: RecognizedShape, samples: Point[]): number {
  let error = visualError(shape, samples);
  if (shape.kind === 'rect') {
    // Rounded hand-drawn turns are a matching tolerance, not a different output
    // type. Genuine ellipses still have a lower unpenalized smooth-contour fit.
    for (const radius of [.12, .24, .34, .44, .48]) {
      error = Math.min(error, visualError(shape, samples, radius) + .000015);
    }
  }
  return error;
}

function axisNearZero(angle: number): number {
  return ((angle + Math.PI / 2) % Math.PI + Math.PI) % Math.PI - Math.PI / 2;
}

/** Re-express the same world geometry in the axes a user expects when aligning. */
function canonicalPose(shape: RecognizedShape): RecognizedShape {
  if (shape.kind === 'triangle' && shape.vertices) {
    const points = shape.vertices.map(p => ({ x: shape.x + p.x, y: shape.y + p.y }));
    let rotation = 0, closest = Infinity;
    for (let i = 0; i < 3; i++) {
      const a = points[i], b = points[(i + 1) % 3];
      const angle = axisNearZero(Math.atan2(b.y - a.y, b.x - a.x));
      if (Math.abs(angle) < closest) { closest = Math.abs(angle); rotation = angle; }
    }
    const cos = Math.cos(rotation), sin = Math.sin(rotation);
    const local = points.map(p => ({ x: p.x * cos + p.y * sin, y: -p.x * sin + p.y * cos }));
    const b = pointsBounds(local), cx = b.x + b.w / 2, cy = b.y + b.h / 2;
    const center = { x: cx * cos - cy * sin, y: cx * sin + cy * cos };
    return { ...shape, x: center.x - b.w / 2, y: center.y - b.h / 2, w: b.w, h: b.h, rotation, vertices: local.map(p => ({ x: p.x - b.x, y: p.y - b.y })) };
  }
  const cx = shape.x + shape.w / 2, cy = shape.y + shape.h / 2;
  let w = shape.w, h = shape.h, rotation = axisNearZero(shape.rotation);
  if (shape.kind === 'rect') {
    if (rotation > Math.PI / 4) { rotation -= Math.PI / 2; [w, h] = [h, w]; }
    else if (rotation < -Math.PI / 4) { rotation += Math.PI / 2; [w, h] = [h, w]; }
  } else if (shape.regular) rotation = 0;
  else if (h > w) { [w, h] = [h, w]; rotation = axisNearZero(rotation + Math.PI / 2); }
  return { ...shape, x: cx - w / 2, y: cy - h / 2, w, h, rotation };
}

function worldGeometry(shape: RecognizedShape, origin: Point, scale: number): RecognizedShape {
  const result = canonicalPose(shape);
  return {
    ...result, x: origin.x + result.x * scale, y: origin.y + result.y * scale, w: result.w * scale, h: result.h * scale,
    ...(result.vertices ? { vertices: result.vertices.map(p => ({ x: p.x * scale, y: p.y * scale })) } : {}),
  };
}

/** Every nonempty finite trajectory becomes the closest triangle, rectangle or ellipse. */
export function recognizeShape(input: Point[], minSize = 8): RecognizedShape | null {
  if (!input.length || input.some(p => !Number.isFinite(p.x) || !Number.isFinite(p.y))) return null;
  const b = pointsBounds(input), diagonal = Math.hypot(b.w, b.h);
  if (diagonal < Math.max(1e-8, minSize * .25)) {
    const size = Math.max(minSize, diagonal, 1e-6);
    return { kind: 'ellipse', x: b.x + b.w / 2 - size / 2, y: b.y + b.h / 2 - size / 2, w: size, h: size, rotation: 0, regular: true };
  }
  const origin = { x: b.x + b.w / 2, y: b.y + b.h / 2 };
  const points = input.map(p => ({ x: (p.x - origin.x) / diagonal, y: (p.y - origin.y) / diagonal }));
  let length = 0;
  for (let i = 1; i < points.length; i++) length += distance(points[i - 1], points[i]);
  const samples = [...resample(points, length), points.at(-1)!];
  const hull = convexHull(samples), corners = polygonCorners(samples);
  const fourSides = rectangularGesture(samples, hull);
  if (fourSides) return worldGeometry(rectangleFromSides(fourSides), origin, diagonal);
  const candidates: RecognizedShape[] = [];
  if (corners.length === 3) { const shape = triangle(corners); if (shape) candidates.push(shape); }
  if (hull.length >= 3) { const shape = triangle(triangleHull(hull)); if (shape) candidates.push(shape); }
  const angles = new Set<number>([0]);
  const orientation = (angle: number) => Math.round((((angle % (Math.PI / 2)) + Math.PI / 2) % (Math.PI / 2)) * 10000) / 10000;
  const edges = hull.length > 24 ? polygonCorners([...hull, hull[0]]) : hull;
  for (let i = 0; i < edges.length; i++) {
    const a = edges[i], next = edges[(i + 1) % edges.length];
    if (distance(a, next) > .05) angles.add(orientation(Math.atan2(next.y - a.y, next.x - a.x)));
  }
  let xx = 0, yy = 0, xy = 0;
  for (const p of samples) { xx += p.x * p.x; yy += p.y * p.y; xy += p.x * p.y; }
  angles.add(orientation(.5 * Math.atan2(2 * xy, xx - yy)));
  for (const angle of angles) {
    candidates.push(boxShape(samples, angle, 'rect'));
    candidates.push(boxShape(samples, angle, 'ellipse'));
  }
  const fitted = ellipse(samples); if (fitted) candidates.push(fitted);
  let shape = candidates[0], bestError = Infinity;
  for (const candidate of candidates) {
    const error = shapeError(candidate, samples);
    if (error < bestError) { bestError = error; shape = candidate; }
  }
  return worldGeometry(shape, origin, diagonal);
}
