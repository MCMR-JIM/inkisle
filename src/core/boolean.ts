import type { Erasure, Point } from './model';
import { capsule, distance, inFills, inRing, mix, pointsBounds, ringArea } from './paths';

interface Edge { a: Point; b: Point; cuts: number[]; x: number; y: number; right: number; bottom: number }
interface Boundary { a: Point; b: Point; from: string; to: string; used: boolean }
const cross = (a: Point, b: Point): number => a.x * b.y - a.y * b.x;
const subtract = (a: Point, b: Point): Point => ({ x: a.x - b.x, y: a.y - b.y });

function intersect(a: Edge, b: Edge): void {
  const r = subtract(a.b, a.a), s = subtract(b.b, b.a), q = subtract(b.a, a.a), denominator = cross(r, s);
  if (Math.abs(denominator) > 1e-10) {
    const t = cross(q, s) / denominator, u = cross(q, r) / denominator;
    if (t >= -1e-9 && t <= 1 + 1e-9 && u >= -1e-9 && u <= 1 + 1e-9) {
      a.cuts.push(Math.max(0, Math.min(1, t))); b.cuts.push(Math.max(0, Math.min(1, u)));
    }
    return;
  }
  if (Math.abs(cross(q, r)) > 1e-8) return;
  const rr = r.x * r.x + r.y * r.y, ss = s.x * s.x + s.y * s.y;
  if (!rr || !ss) return;
  for (const point of [b.a, b.b]) {
    const t = ((point.x - a.a.x) * r.x + (point.y - a.a.y) * r.y) / rr;
    if (t > 0 && t < 1) a.cuts.push(t);
  }
  for (const point of [a.a, a.b]) {
    const t = ((point.x - b.a.x) * s.x + (point.y - b.a.y) * s.y) / ss;
    if (t > 0 && t < 1) b.cuts.push(t);
  }
}

/** Polygonal arrangement of the subject and eraser union, with even-odd holes. */
export function difference(rings: Point[][], erasures: Erasure[], tolerance = .15): Point[][] {
  if (!rings.length || !erasures.length) return rings;
  const subject = pointsBounds(rings.flat());
  const cutters: { ring: Point[]; bounds: ReturnType<typeof pointsBounds> }[] = [];
  for (const stroke of erasures) {
    const points = stroke.points;
    for (let i = 0; i < Math.max(1, points.length - 1); i++) {
      const a = points[i], b = points[Math.min(i + 1, points.length - 1)];
      const ring = capsule(a, b, stroke.radiusX, stroke.radiusY, tolerance * .4);
      const bounds = pointsBounds(ring);
      if (bounds.x <= subject.x + subject.w && bounds.x + bounds.w >= subject.x && bounds.y <= subject.y + subject.h && bounds.y + bounds.h >= subject.y) cutters.push({ ring, bounds });
    }
  }
  if (!cutters.length) return rings;
  const inside = (p: Point): boolean => inFills(p, rings) && !cutters.some(c => p.x >= c.bounds.x && p.x <= c.bounds.x + c.bounds.w && p.y >= c.bounds.y && p.y <= c.bounds.y + c.bounds.h && inRing(p, c.ring));
  const edges: Edge[] = [];
  for (const ring of [...rings, ...cutters.map(c => c.ring)]) {
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i], b = ring[(i + 1) % ring.length];
      if (distance(a, b) < 1e-10) continue;
      edges.push({ a, b, cuts: [0, 1], x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), right: Math.max(a.x, b.x), bottom: Math.max(a.y, b.y) });
    }
  }
  // Sweep bounds before exact intersections. Most distant capsules never meet.
  const sorted = edges.slice().sort((a, b) => a.x - b.x);
  for (let i = 0; i < sorted.length; i++) for (let j = i + 1; j < sorted.length && sorted[j].x <= sorted[i].right + 1e-8; j++) {
    const a = sorted[i], b = sorted[j];
    if (b.bottom < a.y - 1e-8 || b.y > a.bottom + 1e-8) continue;
    intersect(a, b);
  }
  const snap = Math.max(1e-8, Math.min(tolerance * 1e-4, 1e-5));
  const key = (p: Point): string => `${Math.round(p.x / snap)},${Math.round(p.y / snap)}`;
  const boundary = new Map<string, Boundary>();
  for (const edge of edges) {
    const cuts = [...new Set(edge.cuts)].sort((a, b) => a - b);
    for (let i = 1; i < cuts.length; i++) {
      let a = mix(edge.a, edge.b, cuts[i - 1]), b = mix(edge.a, edge.b, cuts[i]);
      const length = distance(a, b); if (length < snap) continue;
      const p = mix(a, b, .5), epsilon = Math.min(tolerance * .01, length * 1e-3);
      const nx = -(b.y - a.y) / length * epsilon, ny = (b.x - a.x) / length * epsilon;
      const left = inside({ x: p.x + nx, y: p.y + ny }), right = inside({ x: p.x - nx, y: p.y - ny });
      if (left === right) continue;
      if (!left) [a, b] = [b, a];
      const from = key(a), to = key(b); if (from === to) continue;
      boundary.set(`${from}>${to}`, { a, b, from, to, used: false });
    }
  }
  const outgoing = new Map<string, Boundary[]>();
  for (const edge of boundary.values()) {
    let list = outgoing.get(edge.from); if (!list) outgoing.set(edge.from, list = []);
    list.push(edge);
  }
  const result: Point[][] = [];
  for (const first of boundary.values()) {
    if (first.used) continue;
    const ring: Point[] = []; let edge = first, closed = false;
    for (let limit = 0; limit <= boundary.size; limit++) {
      if (edge.used) break;
      edge.used = true; ring.push(edge.a);
      if (edge.to === first.from) { closed = true; break; }
      const candidates = outgoing.get(edge.to)?.filter(next => !next.used) ?? [];
      if (!candidates.length) break;
      const angle = Math.atan2(edge.b.y - edge.a.y, edge.b.x - edge.a.x);
      // At touching vertices, keep the material on the same (left) side.
      candidates.sort((a, b) => turn(a) - turn(b));
      function turn(candidate: typeof edge): number {
        const next = Math.atan2(candidate.b.y - candidate.a.y, candidate.b.x - candidate.a.x);
        return (angle + Math.PI - next + Math.PI * 4) % (Math.PI * 2);
      }
      edge = candidates[0];
    }
    if (!closed) throw new Error('几何边界未闭合');
    if (ring.length >= 3 && Math.abs(ringArea(ring)) > tolerance * tolerance * .01) result.push(ring);
  }
  return result;
}

/** A connected material region consists of one positive outer ring plus holes. */
export function connectedFills(rings: Point[][]): Point[][][] {
  const groups = rings.filter(ring => ringArea(ring) > 0).map(ring => [ring]);
  for (const hole of rings.filter(ring => ringArea(ring) < 0)) {
    const parents = groups.filter(group => inRing(hole[0], group[0])).sort((a, b) => Math.abs(ringArea(a[0])) - Math.abs(ringArea(b[0])));
    parents[0]?.push(hole);
  }
  return groups;
}
