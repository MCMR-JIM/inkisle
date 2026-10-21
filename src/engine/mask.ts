import type { BoardElement } from '../core/model';
import { elementBounds, expandBounds } from '../core/geometry';
import { rotationCenter } from '../core/transforms';

let surface: HTMLCanvasElement | null = null;
let context: CanvasRenderingContext2D | null = null;

/** Isolate only the element's visible pixels, so holes reveal real lower layers. */
export function drawMaskedElement(target: CanvasRenderingContext2D, el: BoardElement, paint: (ctx: CanvasRenderingContext2D) => void): void {
  const t = target.getTransform();
  const b = expandBounds(elementBounds(el), 32);
  const corners = [new DOMPoint(b.x, b.y), new DOMPoint(b.x + b.w, b.y), new DOMPoint(b.x, b.y + b.h), new DOMPoint(b.x + b.w, b.y + b.h)].map(p => p.matrixTransform(t));
  const left = Math.max(0, Math.floor(Math.min(...corners.map(p => p.x))));
  const top = Math.max(0, Math.floor(Math.min(...corners.map(p => p.y))));
  const right = Math.min(target.canvas.width, Math.ceil(Math.max(...corners.map(p => p.x))));
  const bottom = Math.min(target.canvas.height, Math.ceil(Math.max(...corners.map(p => p.y))));
  const width = right - left, height = bottom - top;
  if (width <= 0 || height <= 0) return;
  if (!surface) { surface = document.createElement('canvas'); context = surface.getContext('2d')!; }
  if (surface.width !== width) surface.width = width;
  if (surface.height !== height) surface.height = height;
  const ctx = context!;
  ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, width, height);
  ctx.setTransform(t.a, t.b, t.c, t.d, t.e - left, t.f - top);
  paint(ctx);
  ctx.save();
  ctx.globalCompositeOperation = 'destination-out';
  ctx.globalAlpha = 1; ctx.strokeStyle = '#000000'; ctx.fillStyle = '#000000';
  ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.lineWidth = 2; ctx.setLineDash([]);
  if (el.rotation) {
    const center = rotationCenter(el);
    ctx.translate(center.x, center.y); ctx.rotate(el.rotation); ctx.translate(-center.x, -center.y);
  }
  ctx.translate(el.x, el.y);
  for (const stroke of el.erasures!) {
    ctx.save(); ctx.scale(stroke.radiusX, stroke.radiusY);
    ctx.beginPath();
    const first = stroke.points[0];
    if (stroke.points.length === 1) {
      ctx.arc(first.x / stroke.radiusX, first.y / stroke.radiusY, 1, 0, Math.PI * 2); ctx.fill();
    } else {
      ctx.moveTo(first.x / stroke.radiusX, first.y / stroke.radiusY);
      for (let i = 1; i < stroke.points.length; i++) ctx.lineTo(stroke.points[i].x / stroke.radiusX, stroke.points[i].y / stroke.radiusY);
      ctx.stroke();
    }
    ctx.restore();
  }
  ctx.restore();
  target.save(); target.setTransform(1, 0, 0, 1, 0, 0);
  target.drawImage(surface, left, top); target.restore();
}
