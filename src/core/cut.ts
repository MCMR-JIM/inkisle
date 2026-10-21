import type { BoardElement, PathGeometry, Point, StrokePath } from './model';
import { connectedFills, difference } from './boolean';
import { clipStroke } from './clip';
import { distance, elementPaths, inFills, pointsBounds, ringArea } from './paths';
import { worldPoint } from './transforms';

function fragment(el: BoardElement, path: PathGeometry, index: number): BoardElement {
  const points = [...path.fills.flat(), ...path.strokes.flatMap(s => s.points)];
  const b = pointsBounds(points);
  const local = (p: Point): Point => ({ ...p, x: p.x - b.x, y: p.y - b.y });
  const { erasures, path: _oldPath, vertices: _vertices, ...base } = el;
  const retainedErasures = erasures?.filter(stroke => {
    const bounds = pointsBounds(stroke.points);
    const padding = el.strokeWidth / 2 + .5;
    return bounds.x - stroke.radiusX <= b.x + b.w + padding && bounds.x + bounds.w + stroke.radiusX >= b.x - padding && bounds.y - stroke.radiusY <= b.y + b.h + padding && bounds.y + bounds.h + stroke.radiusY >= b.y - padding;
  });
  // A normalized fragment gets its own rotation center. Place that center at
  // the original geometry's world point so no surviving edge jumps on split.
  const center = worldPoint(el, { x: b.x + b.w / 2, y: b.y + b.h / 2 });
  return {
    ...base, id: index ? crypto.randomUUID() : el.id, orderPath: [...(el.orderPath ?? []), index], kind: 'path', x: center.x - b.w / 2, y: center.y - b.h / 2, w: b.w, h: b.h,
    points: [], text: '', fill: path.fills.length ? el.fill : 'transparent',
    path: {
      fills: path.fills.map(ring => ring.map(local)), strokes: path.strokes.map(s => ({ ...s, points: s.points.map(local) })),
      ...(path.label ? { label: { ...path.label, x: path.label.x - b.x, y: path.label.y - b.y } } : {}),
    },
    // Exact residual masks keep round stroke caps from growing back into a cut.
    erasures: retainedErasures?.length ? retainedErasures.map(stroke => ({ ...stroke, points: stroke.points.map(local) })) : undefined,
  };
}

function connectedStrokes(paths: StrokePath[]): StrokePath[][] {
  const groups: StrokePath[][] = [];
  for (const path of paths) {
    const connected = groups.filter(group => group.some(other =>
      [path.points[0], path.points.at(-1)!].some(p => other.points.some(q => distance(p, q) < 1e-6)) ||
      [other.points[0], other.points.at(-1)!].some(p => path.points.some(q => distance(p, q) < 1e-6))));
    if (!connected.length) groups.push([path]);
    else {
      connected[0].push(path);
      for (const group of connected.slice(1)) { connected[0].push(...group); groups.splice(groups.indexOf(group), 1); }
    }
  }
  return groups;
}

export function cutElement(el: BoardElement, tolerance = .15): BoardElement[] {
  if (!el.erasures?.length || el.locked || ['text', 'note', 'image'].includes(el.kind)) return [el];
  // An unfilled shape's caption is an independent material region. Keep that
  // editable caption masked until it can be represented without changing layout.
  if (el.text && el.fill === 'transparent') return [el];
  const geometry = elementPaths(el, tolerance);
  const clipped = geometry.strokes.map(stroke => clipStroke(stroke, el.erasures!));
  const strokes = clipped.flatMap(result => result.paths);
  const fills = geometry.fills.length ? difference(geometry.fills, el.erasures, tolerance) : [];
  const oldArea = Math.abs(geometry.fills.reduce((sum, ring) => sum + ringArea(ring), 0));
  const newArea = Math.abs(fills.reduce((sum, ring) => sum + ringArea(ring), 0));
  if (!clipped.some(result => result.changed) && Math.abs(oldArea - newArea) < tolerance * tolerance * .01) {
    return [el];
  }
  if (geometry.fills.length) {
    const groups = connectedFills(fills);
    const label = geometry.label ?? (el.text ? { text: el.text, x: Math.min(0, el.w) + 16, y: Math.min(0, el.h) + 16, w: Math.max(10, Math.abs(el.w) - 32), h: Math.max(1, Math.abs(el.h) - 32) } : undefined);
    const paths: PathGeometry[] = groups.map(fills => ({ fills, strokes: [], ...(label ? { label } : {}) }));
    for (const stroke of strokes) {
      const point = stroke.points[Math.floor(stroke.points.length / 2)];
      let index = groups.findIndex(group => inFills(point, group));
      if (index < 0 && groups.length) {
        const probe = (group: Point[][]): number => Math.min(...group.flat().map(p => distance(point, p)));
        let best = Infinity;
        groups.forEach((group, i) => { const d = probe(group); if (d < best) { best = d; index = i; } });
      }
      if (index >= 0) paths[index].strokes.push(stroke);
      else paths.push({ fills: [], strokes: [stroke] });
    }
    if (paths.length > 1) paths.sort((a, b) => pointsBounds([...a.fills.flat(), ...a.strokes.flatMap(s => s.points)]).x - pointsBounds([...b.fills.flat(), ...b.strokes.flatMap(s => s.points)]).x);
    return paths.filter(path => path.fills.length || path.strokes.length).map((path, i) => fragment(el, path, i));
  }
  return connectedStrokes(strokes).map((strokes, i) => fragment(el, { fills: [], strokes }, i));
}
