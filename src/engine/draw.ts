import type { BoardElement, Point } from '../core/model';
import { normalizeBounds } from '../core/geometry';
import { drawMaskedElement } from './mask';
import { arrowHeadKinds } from '../core/linear';
import { rotationCenter } from '../core/transforms';
import { shapeVertices } from '../core/paths';
import { inkPath, smoothInk } from '../core/ink';
import { textFont, textLeading, wrapText } from './text-layout';

export { CANVAS_FONT, wrapText } from './text-layout';
const paths = new Map<string, { source: BoardElement; path: Path2D; width: number; pressure: boolean; dash: boolean }>();
const geometryPaths = new WeakMap<NonNullable<BoardElement['path']>, { fill: Path2D; stroke: Path2D }>();
const inkPaths = new WeakMap<NonNullable<BoardElement['path']>, { width: number; dash: boolean; path: Path2D }>();
const images = new Map<string, HTMLImageElement>();
const darkColors = new Map<string, string>();
let invalidateImages = () => {};

export function onImagesLoaded(callback: () => void): void { invalidateImages = callback; }

export function imageFor(src: string): HTMLImageElement {
  let image = images.get(src);
  if (!image) {
    image = new Image();
    image.onload = () => invalidateImages();
    image.src = src;
    images.set(src, image);
  }
  return image;
}

export async function preloadImages(elements: BoardElement[]): Promise<void> {
  await Promise.all(elements.filter(el => el.kind === 'image' && el.src).map(async el => {
    const image = imageFor(el.src!);
    if (!image.complete) await image.decode().catch(() => {});
  }));
}

function penPath(points: Point[]): Path2D {
  const path = new Path2D();
  if (!points.length) return path;
  path.moveTo(points[0].x, points[0].y);
  if (points.length === 1) { path.lineTo(points[0].x + 0.01, points[0].y); return path; }
  for (let i = 1; i < points.length - 1; i++) {
    const next = points[i + 1];
    path.quadraticCurveTo(points[i].x, points[i].y, (points[i].x + next.x) / 2, (points[i].y + next.y) / 2);
  }
  const end = points[points.length - 1];
  path.lineTo(end.x, end.y);
  return path;
}

export function drawElement(ctx: CanvasRenderingContext2D, el: BoardElement, preview = false, zoom = 1, dark = false): void {
  if (el.erasures?.length) {
    drawMaskedElement(ctx, el, layer => drawUnmaskedElement(layer, el, preview, zoom, dark));
    return;
  }
  drawUnmaskedElement(ctx, el, preview, zoom, dark);
}

function drawUnmaskedElement(ctx: CanvasRenderingContext2D, el: BoardElement, preview: boolean, zoom: number, dark: boolean): void {
  ctx.save();
  ctx.globalAlpha = el.opacity;
  const ink = dark && el.fill === 'transparent' ? darkInk(el.stroke) : el.stroke;
  ctx.strokeStyle = ink;
  ctx.fillStyle = el.fill;
  ctx.lineWidth = el.strokeWidth;
  ctx.lineCap = 'round';
  ctx.lineJoin = el.kind === 'rect' ? 'miter' : 'round';
  ctx.setLineDash(el.dash ? [8, 6] : []);
  if (el.rotation) {
    const center = rotationCenter(el);
    ctx.translate(center.x, center.y); ctx.rotate(el.rotation); ctx.translate(-center.x, -center.y);
  }
  const b = normalizeBounds(el);

  if (el.kind === 'path' && el.path) {
    ctx.translate(el.x, el.y);
    let cached = geometryPaths.get(el.path);
    if (!cached) {
      const fill = new Path2D(), stroke = new Path2D();
      const trace = (path: Path2D, points: Point[], closed: boolean) => {
        if (!points.length) return;
        path.moveTo(points[0].x, points[0].y);
        for (let i = 1; i < points.length; i++) path.lineTo(points[i].x, points[i].y);
        if (closed) path.closePath();
        else if (points.length === 1) path.lineTo(points[0].x + .001, points[0].y);
      };
      for (const ring of el.path.fills) trace(fill, ring, true);
      for (const outline of el.path.strokes) if (!outline.pressureEnabled) trace(stroke, outline.points, outline.closed);
      cached = { fill, stroke }; geometryPaths.set(el.path, cached);
    }
    if (el.fill !== 'transparent') ctx.fill(cached.fill, 'evenodd');
    if (el.stroke !== 'transparent' && el.strokeWidth > 0) {
      ctx.stroke(cached.stroke);
      if (el.path.strokes.some(stroke => stroke.pressureEnabled)) {
        let inkGeometry = inkPaths.get(el.path);
        if (!inkGeometry || inkGeometry.width !== el.strokeWidth || inkGeometry.dash !== el.dash) {
          const path = new Path2D();
          for (const stroke of el.path.strokes) if (stroke.pressureEnabled) path.addPath(inkPath(stroke.points, el.strokeWidth, el.dash));
          inkGeometry = { width: el.strokeWidth, dash: el.dash, path }; inkPaths.set(el.path, inkGeometry);
        }
        ctx.fillStyle = ink; ctx.fill(inkGeometry.path);
      }
    }
    if (el.path.label && el.fontSize * zoom >= 5) {
      const label = el.path.label;
      ctx.clip(cached.fill, 'evenodd');
      drawText(ctx, { ...el, text: label.text }, label.x, label.y, label.w, label.h, true, ink);
    }
  } else if (el.kind === 'pen') {
    ctx.translate(el.x, el.y);
    let cached = paths.get(el.id);
    if (!cached || cached.source.points !== el.points || cached.width !== el.strokeWidth || cached.pressure !== !!el.pressureEnabled || cached.dash !== el.dash) {
      cached = { source: el, path: el.pressureEnabled ? inkPath(smoothInk(el.points), el.strokeWidth, el.dash) : penPath(el.points), width: el.strokeWidth, pressure: !!el.pressureEnabled, dash: el.dash };
      if (!preview) {
        if (paths.size > 6000) paths.clear();
        paths.set(el.id, cached);
      }
    }
    if (el.pressureEnabled) { ctx.fillStyle = ink; ctx.fill(cached.path); }
    else ctx.stroke(cached.path);
  } else if (el.kind === 'image' && el.src) {
    const image = imageFor(el.src);
    if (image.complete && image.naturalWidth) {
      ctx.beginPath(); ctx.roundRect(b.x, b.y, b.w, b.h, Math.min(el.radius, b.w / 2, b.h / 2)); ctx.clip();
      ctx.drawImage(image, b.x, b.y, b.w, b.h);
    } else {
      ctx.fillStyle = '#e8ece6'; ctx.fillRect(b.x, b.y, b.w, b.h);
    }
  } else if (el.kind === 'text') {
    if (el.fontSize * zoom >= 5) drawText(ctx, el, b.x, b.y, b.w || 1000, undefined, false, ink);
  } else if (el.kind === 'line' || el.kind === 'arrow' || el.kind === 'bidirectional-arrow') {
    ctx.beginPath(); ctx.moveTo(el.x, el.y); ctx.lineTo(el.x + el.w, el.y + el.h); ctx.stroke();
    const heads = arrowHeadKinds(el);
    if (heads.end) drawArrowHead(ctx, { x: el.x + el.w, y: el.y + el.h }, { x: el.x, y: el.y }, el.strokeWidth);
    if (heads.start) drawArrowHead(ctx, { x: el.x, y: el.y }, { x: el.x + el.w, y: el.y + el.h }, el.strokeWidth);
  } else {
    ctx.beginPath();
    if (el.kind === 'ellipse') ctx.ellipse(b.x + b.w / 2, b.y + b.h / 2, b.w / 2, b.h / 2, 0, 0, Math.PI * 2);
    else if (['diamond', 'triangle', 'pentagon', 'hexagon'].includes(el.kind)) {
      const vertices = shapeVertices(el);
      for (let i = 0; i < vertices.length; i++) {
        const p = vertices[i];
        if (i === 0) ctx.moveTo(el.x + p.x, el.y + p.y); else ctx.lineTo(el.x + p.x, el.y + p.y);
      }
      ctx.closePath();
    } else ctx.roundRect(b.x, b.y, b.w, b.h, el.kind === 'rect' ? 0 : Math.min(el.kind === 'note' ? 3 : el.radius, b.w / 2, b.h / 2));
    if (el.kind === 'note') {
      if (el.fill !== 'transparent') {
        if (zoom > 0.35) { ctx.shadowColor = '#29372b12'; ctx.shadowBlur = 18; ctx.shadowOffsetY = 5; }
        ctx.fill(); ctx.shadowColor = 'transparent';
        ctx.fillStyle = '#ffffff25'; ctx.fillRect(b.x, b.y, b.w, 25);
      }
    } else {
      if (el.fill !== 'transparent') ctx.fill();
      if (el.strokeWidth && el.stroke !== 'transparent') ctx.stroke();
    }
    if (el.text && el.fontSize * zoom >= 5) {
      const padding = el.kind === 'note' ? 22 : 16;
      drawText(ctx, el, b.x + padding, b.y + padding, Math.max(10, b.w - padding * 2), b.h - padding * 2, el.kind !== 'note', ink);
    }
  }
  ctx.restore();
}

function drawArrowHead(ctx: CanvasRenderingContext2D, tip: Point, tail: Point, strokeWidth: number): void {
  const angle = Math.atan2(tip.y - tail.y, tip.x - tail.x);
  const length = Math.max(12, strokeWidth * 4);
  ctx.beginPath();
  ctx.moveTo(tip.x - length * Math.cos(angle - Math.PI / 6), tip.y - length * Math.sin(angle - Math.PI / 6));
  ctx.lineTo(tip.x, tip.y);
  ctx.lineTo(tip.x - length * Math.cos(angle + Math.PI / 6), tip.y - length * Math.sin(angle + Math.PI / 6));
  ctx.stroke();
}

function drawText(ctx: CanvasRenderingContext2D, el: BoardElement, x: number, y: number, width: number, height?: number, centered = false, ink = el.stroke): void {
  ctx.font = textFont(el);
  ctx.fillStyle = ink;
  ctx.textBaseline = 'top';
  const lines = wrapText(ctx, el.text, width);
  const leading = textLeading(el);
  if (height !== undefined) {
    ctx.beginPath(); ctx.rect(x - 2, y - 2, width + 4, height + 4); ctx.clip();
  }
  if (centered && height !== undefined) y += Math.max(0, (height - lines.length * leading) / 2);
  for (const line of lines) {
    ctx.fillText(line, centered ? x + (width - ctx.measureText(line).width) / 2 : x, y + el.fontSize * 0.12);
    y += leading;
  }
}

/** Theme adaptation is presentation-only; file colors and exports stay exact. */
function darkInk(color: string): string {
  if (darkColors.has(color)) return darkColors.get(color)!;
  const match = /^#([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i.exec(color);
  if (!match) return color;
  const rgb = match.slice(1).map(v => parseInt(v, 16));
  const luminance = rgb[0] * .2126 + rgb[1] * .7152 + rgb[2] * .0722;
  const next = luminance < 165 ? `#${rgb.map(v => Math.round(v + (255 - v) * .7).toString(16).padStart(2, '0')).join('')}` : color;
  darkColors.set(color, next); return next;
}
