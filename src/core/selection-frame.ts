import type { BoardElement, Point } from './model';
import { scaleErasures } from './erasure';
import { transformPath } from './paths';
import { localPoint, objectLocalBounds, worldPoint } from './transforms';

export type CornerHandle = 'nw' | 'ne' | 'sw' | 'se';
export const SELECTION_GAP = 5;

/** Keep the air gap in CSS pixels, outside the element's visible stroke. */
export function selectionPadding(el: BoardElement, zoom: number): number {
  const stroke = el.stroke !== 'transparent' && !['text', 'image', 'note'].includes(el.kind) ? el.strokeWidth / 2 : 0;
  return stroke + SELECTION_GAP / zoom;
}

/** Dashed edges, visible controls and hit targets all consume these corners. */
export function objectFrame(el: BoardElement, padding = 0) {
  const bounds = objectLocalBounds(el);
  const b = { x: bounds.x - padding, y: bounds.y - padding, w: bounds.w + padding * 2, h: bounds.h + padding * 2 };
  const corners: Record<CornerHandle, Point> = {
    nw: worldPoint(el, { x: b.x, y: b.y }),
    ne: worldPoint(el, { x: b.x + b.w, y: b.y }),
    sw: worldPoint(el, { x: b.x, y: b.y + b.h }),
    se: worldPoint(el, { x: b.x + b.w, y: b.y + b.h }),
  };
  return { bounds: b, corners };
}

export function selectionFrame(el: BoardElement, zoom: number) {
  return objectFrame(el, selectionPadding(el, zoom));
}

export function objectRotationHandle(el: BoardElement, zoom: number) {
  const b = selectionFrame(el, zoom).bounds;
  return {
    start: worldPoint(el, { x: b.x + b.w / 2, y: b.y }),
    handle: worldPoint(el, { x: b.x + b.w / 2, y: b.y - 28 / zoom }),
  };
}

/** Resize in the frame's own axes, keeping the opposite world corner fixed. */
export function resizeFromCorner(el: BoardElement, handle: CornerHandle, pointer: Point, preserveRatio: boolean, padding = 0): BoardElement {
  const b = objectLocalBounds(el), local = localPoint(el, pointer);
  const west = handle.includes('w'), north = handle.includes('n');
  // The pointer grabs the padded control, not the original geometry corner.
  // Remove that fixed local offset before solving the geometric dimensions.
  local.x += west ? padding : -padding;
  local.y += north ? padding : -padding;
  const anchor = { x: west ? b.x + b.w : b.x, y: north ? b.y + b.h : b.y };
  let width = Math.max(10, west ? anchor.x - local.x : local.x - anchor.x);
  let height = Math.max(10, north ? anchor.y - local.y : local.y - anchor.y);
  if (preserveRatio && b.w > 0 && b.h > 0) {
    const scale = Math.max(width / b.w, height / b.h);
    width = b.w * scale; height = b.h * scale;
  }
  const left = west ? anchor.x - width : anchor.x, top = north ? anchor.y - height : anchor.y;
  const sx = width / Math.max(b.w, .01), sy = height / Math.max(b.h, .01);
  const next = {
    ...el,
    x: el.x + left - b.x * sx, y: el.y + top - b.y * sy,
    w: el.w * sx, h: el.h * sy,
    points: el.kind === 'pen' ? el.points.map(p => ({ ...p, x: p.x * sx, y: p.y * sy })) : el.points,
    ...(el.vertices ? { vertices: el.vertices.map(p => ({ x: p.x * sx, y: p.y * sy })) } : {}),
    fontSize: Math.max(8, Math.min(1000, el.fontSize * Math.min(sx, sy))),
    erasures: scaleErasures(el.erasures, sx, sy),
    ...(el.path ? { path: transformPath(el.path, sx, sy) } : {}),
  };
  const fixed = worldPoint(el, anchor);
  const moved = worldPoint(next, { x: anchor.x * sx, y: anchor.y * sy });
  next.x += fixed.x - moved.x; next.y += fixed.y - moved.y;
  return next;
}
