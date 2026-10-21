import type { Point } from './model';
import { pressureValue } from './pressure';

const distance = (a: Point, b: Point): number => Math.hypot(b.x - a.x, b.y - a.y);
const lerp = (a: Point, b: Point, t: number): Point => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, pressure: pressureValue(a.pressure) + (pressureValue(b.pressure) - pressureValue(a.pressure)) * t });
const radius = (point: Point, width: number): number => width * (.25 + .75 * pressureValue(point.pressure)) / 2;

function quadratic(a: Point, c: Point, b: Point, tolerance: number, output: Point[], depth = 0): void {
  const length = distance(a, b);
  const t = length ? Math.max(0, Math.min(1, ((c.x - a.x) * (b.x - a.x) + (c.y - a.y) * (b.y - a.y)) / (length * length))) : 0;
  const error = Math.hypot(c.x - a.x - (b.x - a.x) * t, c.y - a.y - (b.y - a.y) * t);
  const pressureError = Math.abs(pressureValue(c.pressure) - (pressureValue(a.pressure) + pressureValue(b.pressure)) / 2);
  if ((error <= tolerance && pressureError <= .02) || depth >= 12) { output.push(b); return; }
  const ac = lerp(a, c, .5), cb = lerp(c, b, .5), mid = lerp(ac, cb, .5);
  quadratic(a, ac, mid, tolerance, output, depth + 1);
  quadratic(mid, cb, b, tolerance, output, depth + 1);
}

/** Same quadratic centerline for preview, export, hit testing and eraser cuts. */
export function smoothInk(points: Point[], tolerance = .12): Point[] {
  if (!points.length) return [];
  const output: Point[] = [{ ...points[0] }];
  for (let i = 1; i < points.length - 1; i++) quadratic(output.at(-1)!, points[i], lerp(points[i], points[i + 1], .5), tolerance, output);
  if (points.length > 1) output.push({ ...points.at(-1)! });
  return output;
}

/** RDP in position AND pressure, so a straight line can still carry expression. */
export function simplifyInk(points: Point[], tolerance: number, pressureTolerance = .025): Point[] {
  if (points.length <= 2) return points;
  const kept = new Uint8Array(points.length); kept[0] = kept[points.length - 1] = 1;
  const stack = [0, points.length - 1];
  while (stack.length) {
    const end = stack.pop()!, start = stack.pop()!;
    const a = points[start], b = points[end], dx = b.x - a.x, dy = b.y - a.y, length2 = dx * dx + dy * dy;
    let largest = 1, index = -1;
    for (let i = start + 1; i < end; i++) {
      const p = points[i];
      const t = length2 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / length2)) : (i - start) / (end - start);
      const q = lerp(a, b, t);
      const error = Math.max(distance(p, q) / Math.max(1e-6, tolerance), Math.abs(pressureValue(p.pressure) - q.pressure!) / pressureTolerance);
      if (error > largest) { largest = error; index = i; }
    }
    if (index >= 0) { kept[index] = 1; stack.push(start, index, index, end); }
  }
  return points.filter((_, i) => kept[i]);
}

/** Split a centerline using the existing 8/6 world-unit dash pattern. */
function runs(points: Point[], dash: boolean): Point[][] {
  if (!dash || points.length < 2) return points.length ? [points] : [];
  const result: Point[][] = [[points[0]]];
  let phase = 0, remaining = 8, current = result[0];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i], length = distance(a, b);
    if (length < 1e-10) { if (!phase) current.push(b); continue; }
    let offset = 0;
    while (offset < length - 1e-10) {
      const step = Math.min(remaining, length - offset), point = lerp(a, b, (offset + step) / length);
      if (!phase) current.push(point);
      offset += step; remaining -= step;
      if (remaining < 1e-9) {
        phase = 1 - phase; remaining = phase ? 6 : 8;
        if (!phase) { current = [point]; result.push(current); }
      }
    }
  }
  return result;
}

interface InkSink {
  circle(x: number, y: number, r: number): void;
  polygon(points: Point[]): void;
}

/** Same-direction subpaths filled ONCE: overlaps never darken transparent ink. */
function traceInk(points: Point[], width: number, dash: boolean, sink: InkSink): void {
  if (!(width > 0)) return;
  // Dense coalesced input needs no disk at every nearly-identical sample.
  // Bound centerline and radius errors before constructing the shared material.
  const reduced = simplifyInk(points, .04, Math.min(.015, .08 / width));
  for (const run of runs(reduced, dash)) {
    for (let i = 0; i < run.length; i++) {
      const b = run[i], rb = radius(b, width);
      sink.circle(b.x, b.y, rb);
      if (!i) continue;
      const a = run[i - 1], ra = radius(a, width), length = distance(a, b);
      if (length < 1e-10 || Math.abs(rb - ra) >= length) continue;
      const ux = (b.x - a.x) / length, uy = (b.y - a.y) / length;
      const slope = (ra - rb) / length, normal = Math.sqrt(1 - slope * slope);
      const nx = ux * slope - uy * normal, ny = uy * slope + ux * normal;
      const mx = ux * slope + uy * normal, my = uy * slope - ux * normal;
      sink.polygon([
        { x: a.x + nx * ra, y: a.y + ny * ra }, { x: a.x + mx * ra, y: a.y + my * ra },
        { x: b.x + mx * rb, y: b.y + my * rb }, { x: b.x + nx * rb, y: b.y + ny * rb },
      ]);
    }
  }
}

/** Input is a flattened centerline; callers smooth only original pen elements. */
export function inkPath(points: Point[], width: number, dash = false): Path2D {
  // Batch parsing avoids the browser's repeated Path2D arc copy-on-write cost.
  return new Path2D(inkSVG(points, width, dash));
}

export function inkSVG(points: Point[], width: number, dash = false): string {
  const parts: string[] = [], n = (value: number): string => String(Number(value.toFixed(4)));
  traceInk(points, width, dash, {
    circle(x, y, r) { parts.push(`M${n(x + r)} ${n(y)}A${n(r)} ${n(r)} 0 1 1 ${n(x - r)} ${n(y)}A${n(r)} ${n(r)} 0 1 1 ${n(x + r)} ${n(y)}Z`); },
    polygon(vertices) { parts.push(`M${vertices.map(p => `${n(p.x)} ${n(p.y)}`).join('L')}Z`); },
  });
  return parts.join('');
}

export function hitInk(points: Point[], point: Point, width: number, tolerance: number, dash = false): boolean {
  if (!(width > 0)) return false;
  for (const run of runs(points, dash)) {
    if (run.length === 1 && distance(point, run[0]) <= radius(run[0], width) + tolerance) return true;
    for (let i = 1; i < run.length; i++) {
      const a = run[i - 1], b = run[i], dx = b.x - a.x, dy = b.y - a.y;
      const r = radius(a, width) + tolerance, dr = radius(b, width) - radius(a, width);
      const denominator = dx * dx + dy * dy - dr * dr;
      const t = denominator > 1e-12 ? Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy + r * dr) / denominator)) : radius(a, width) > radius(b, width) ? 0 : 1;
      if (Math.hypot(point.x - a.x - dx * t, point.y - a.y - dy * t) <= r + dr * t) return true;
    }
  }
  return false;
}
