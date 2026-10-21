import type { Point } from './model';
import { distance, pointsBounds, ringArea } from './paths';

interface Side { origin: Point; direction: Point; span: number; residual: number; turn: number }
const cross = (a: Point, b: Point): number => a.x * b.y - a.y * b.x;
const dot = (a: Point, b: Point): number => a.x * b.x + a.y * b.y;

function direction(a: Point, b: Point): Point {
  const length = distance(a, b);
  return { x: (b.x - a.x) / Math.max(length, 1e-10), y: (b.y - a.y) / Math.max(length, 1e-10) };
}

/** Total-least-squares fit to the middle of a side, away from rounded turns. */
function fitSide(points: Point[]): Side | null {
  const trim = Math.floor(points.length * .22), run = points.slice(trim, points.length - trim);
  if (run.length < 5) return null;
  const center = { x: run.reduce((sum, p) => sum + p.x, 0) / run.length, y: run.reduce((sum, p) => sum + p.y, 0) / run.length };
  let xx = 0, yy = 0, xy = 0;
  for (const p of run) { const x = p.x - center.x, y = p.y - center.y; xx += x * x; yy += y * y; xy += x * y; }
  const angle = .5 * Math.atan2(2 * xy, xx - yy);
  let axis = { x: Math.cos(angle), y: Math.sin(angle) };
  if (dot(axis, direction(run[0], run.at(-1)!)) < 0) axis = { x: -axis.x, y: -axis.y };
  let low = Infinity, high = -Infinity, error = 0;
  for (const p of run) {
    const delta = { x: p.x - center.x, y: p.y - center.y }, projection = dot(delta, axis);
    low = Math.min(low, projection); high = Math.max(high, projection); error += cross(delta, axis) ** 2;
  }
  const span = high - low;
  if (span < .045) return null;
  const third = Math.max(2, Math.floor((run.length - 1) / 3));
  const first = direction(run[0], run[third]), last = direction(run[run.length - 1 - third], run.at(-1)!);
  const turn = Math.acos(Math.max(-1, Math.min(1, dot(first, last))));
  return { origin: center, direction: axis, span, residual: Math.sqrt(error / run.length) / span, turn };
}

function intersection(a: Side, b: Side): Point | null {
  const denominator = cross(a.direction, b.direction);
  if (Math.abs(denominator) < .5) return null;
  const delta = { x: b.origin.x - a.origin.x, y: b.origin.y - a.origin.y };
  const t = cross(delta, b.direction) / denominator;
  return { x: a.origin.x + t * a.direction.x, y: a.origin.y + t * a.direction.y };
}

/**
 * Recognize four sustained straight runs with paired opposite directions.
 * A rounded/slanted quad may fit an ellipse more closely in raw point distance,
 * but its four side runs express rectangular intent. Smooth oval caps must fail.
 */
export function rectangularGesture(samples: Point[], hull: Point[]): Point[] | null {
  if (hull.length < 4 || distance(samples[0], samples.at(-1)!) > .24) return null;
  const quadrilateral = hull.slice();
  while (quadrilateral.length > 4) {
    let smallest = Infinity, remove = 0;
    for (let i = 0; i < quadrilateral.length; i++) {
      const area = Math.abs(ringArea([quadrilateral[(i + quadrilateral.length - 1) % quadrilateral.length], quadrilateral[i], quadrilateral[(i + 1) % quadrilateral.length]]));
      if (area < smallest) { smallest = area; remove = i; }
    }
    quadrilateral.splice(remove, 1);
  }
  const indices = quadrilateral.map(p => samples.indexOf(p)).sort((a, b) => a - b);
  if (indices.some(i => i < 0)) return null;
  const sides: Side[] = [];
  for (let i = 0; i < 4; i++) {
    const start = indices[i], end = indices[(i + 1) % 4] + (i === 3 ? samples.length : 0);
    const points = Array.from({ length: end - start + 1 }, (_, j) => samples[(start + j) % samples.length]);
    const side = fitSide(points);
    // The middle of a short side can carry several pixels of pen jitter.
    // Direction stability still rejects the continuously turning caps of ovals.
    if (!side || side.residual > .03 || side.turn > .35) return null;
    sides.push(side);
  }
  for (let i = 0; i < 4; i++) {
    // Perspective/skew makes opposite edges converge. Test broad directional
    // pairing here; all four middle runs must still independently be straight.
    if (dot(sides[i].direction, sides[(i + 2) % 4].direction) > -.75) return null;
    if (Math.abs(cross(sides[i].direction, sides[(i + 1) % 4].direction)) < .65) return null;
  }
  const vertices: Point[] = [];
  for (let i = 0; i < 4; i++) {
    const point = intersection(sides[(i + 3) % 4], sides[i]);
    if (!point) return null;
    vertices.push(point);
  }
  const bounds = pointsBounds(vertices), source = pointsBounds(samples), area = ringArea(vertices);
  if (bounds.w > source.w * 1.4 || bounds.h > source.h * 1.4 || Math.abs(area) < .03) return null;
  for (let i = 0; i < 4; i++) {
    const a = vertices[i], b = vertices[(i + 1) % 4], c = vertices[(i + 2) % 4];
    if (cross({ x: b.x - a.x, y: b.y - a.y }, { x: c.x - b.x, y: c.y - b.y }) * area <= 0) return null;
    if (sides[i].span < distance(a, b) * .25) return null;
  }
  return vertices;
}
