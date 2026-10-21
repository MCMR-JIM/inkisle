import type { BoardElement, Point } from './model';
import { lineWorldEndpoints, localPoint, rotationCenter } from './transforms';

export function isLinearElement(el: BoardElement): boolean {
  return el.kind === 'line' || el.kind === 'arrow' || el.kind === 'bidirectional-arrow';
}

export function lineEndpoints(el: BoardElement): { start: Point; end: Point } {
  return lineWorldEndpoints(el);
}

export function withLineEndpoints(el: BoardElement, start: Point, end: Point): BoardElement {
  const localEnd = localPoint({ ...el, x: start.x, y: start.y, rotation: 0 }, end);
  return { ...el, x: start.x, y: start.y, w: localEnd.x, h: localEnd.y, rotation: 0 };
}

export function lineEndpointAt(el: BoardElement, point: Point, tolerance: number): 'start' | 'end' | null {
  if (!isLinearElement(el)) return null;
  const { start, end } = lineEndpoints(el);
  const startDistance = Math.hypot(point.x - start.x, point.y - start.y);
  const endDistance = Math.hypot(point.x - end.x, point.y - end.y);
  if (startDistance <= tolerance && startDistance <= endDistance) return 'start';
  if (endDistance <= tolerance) return 'end';
  return null;
}

export function lineRotationHandle(el: BoardElement, zoom = 1): { handle: Point; midpoint: Point } {
  const { start, end } = lineEndpoints(el);
  const midpoint = { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 };
  const dx = end.x - start.x, dy = end.y - start.y;
  // A line is an unoriented axis for selection purposes, even when its arrow
  // endpoints are directed. Pick the axis nearest horizontal, then its upper
  // normal. Reversing start/end must not flip the control to the other side.
  const angle = Math.hypot(dx, dy) < 1e-9 ? 0 : ((Math.atan2(dy, dx) + Math.PI / 2) % Math.PI + Math.PI) % Math.PI - Math.PI / 2;
  const distance = 28 / zoom;
  return { midpoint, handle: { x: midpoint.x + Math.sin(angle) * distance, y: midpoint.y - Math.cos(angle) * distance } };
}

export function arrowHeadKinds(el: BoardElement): { start: boolean; end: boolean } {
  return { start: el.kind === 'bidirectional-arrow', end: el.kind === 'arrow' || el.kind === 'bidirectional-arrow' };
}

export function lineCenter(el: BoardElement): Point {
  return rotationCenter(el);
}
