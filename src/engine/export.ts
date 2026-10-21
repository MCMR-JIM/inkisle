import type { BoardDocument, BoardElement } from '../core/model';
import { elementBounds, expandBounds, normalizeBounds, unionBounds } from '../core/geometry';
import { CANVAS_FONT, drawElement, preloadImages, wrapText } from './draw';
import { shapeVertices } from '../core/paths';
import { rotationCenter } from '../core/transforms';
import { inkSVG, smoothInk } from '../core/ink';

export function downloadBlob(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url; link.download = name; link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 10000);
}

export function fileName(title: string): string { return title.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').slice(0, 100) || '未命名画板'; }

export async function exportPNG(doc: BoardDocument, elements = doc.elements): Promise<Blob> {
  const b = unionBounds(elements);
  if (!b) throw new Error('画板还是空的，先写下第一个想法吧');
  await preloadImages(elements);
  const padding = 48;
  const w = b.w + padding * 2, h = b.h + padding * 2;
  const scale = Math.min(2, 8192 / w, 8192 / h, Math.sqrt(16000000 / (w * h)));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.ceil(w * scale)); canvas.height = Math.max(1, Math.ceil(h * scale));
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = doc.background; ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.scale(scale, scale); ctx.translate(padding - b.x, padding - b.y);
  for (const el of elements) drawElement(ctx, el);
  return new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('图片导出失败')), 'image/png'));
}

const esc = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function exportSVG(doc: BoardDocument, elements = doc.elements): Blob {
  const b = unionBounds(elements);
  if (!b) throw new Error('画板还是空的，先写下第一个想法吧');
  const padding = 40;
  const measure = document.createElement('canvas').getContext('2d')!;
  const parts = [`<svg xmlns="http://www.w3.org/2000/svg" width="${b.w + padding * 2}" height="${b.h + padding * 2}" viewBox="${b.x - padding} ${b.y - padding} ${b.w + padding * 2} ${b.h + padding * 2}">`, `<rect x="${b.x - padding}" y="${b.y - padding}" width="${b.w + padding * 2}" height="${b.h + padding * 2}" fill="${doc.background}"/>`];
  for (const [index, el] of elements.entries()) {
    const box = normalizeBounds(el);
    const attrs = `stroke="${el.stroke}" fill="${el.fill === 'transparent' ? 'none' : el.fill}" stroke-width="${el.strokeWidth}" stroke-linecap="round" stroke-linejoin="${el.kind === 'rect' ? 'miter' : 'round'}"${el.dash ? ' stroke-dasharray="8 6"' : ''}`;
    if (el.rotation) {
      const center = rotationCenter(el);
      parts.push(`<g transform="rotate(${el.rotation * 180 / Math.PI} ${center.x} ${center.y})">`);
    }
    const maskId = `erase-${index}`;
    if (el.erasures?.length) {
      const b = expandBounds(elementBounds({ ...el, rotation: 0 }), 32);
      parts.push(`<defs><mask id="${maskId}" maskUnits="userSpaceOnUse" maskContentUnits="userSpaceOnUse" x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" style="mask-type:luminance"><rect x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" fill="white"/>`);
      for (const stroke of el.erasures) {
        const transform = `translate(${el.x} ${el.y}) scale(${stroke.radiusX} ${stroke.radiusY})`;
        const first = stroke.points[0];
        if (stroke.points.length === 1) parts.push(`<circle cx="${first.x / stroke.radiusX}" cy="${first.y / stroke.radiusY}" r="1" fill="black" transform="${transform}"/>`);
        else parts.push(`<polyline points="${stroke.points.map(p => `${p.x / stroke.radiusX},${p.y / stroke.radiusY}`).join(' ')}" stroke="black" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none" transform="${transform}"/>`);
      }
      parts.push('</mask></defs>');
    }
    parts.push(`<g opacity="${el.opacity}"${el.erasures?.length ? ` mask="url(#${maskId})"` : ''}>`);
    if (el.kind === 'path' && el.path) {
      const pathData = (points: { x: number; y: number }[], closed: boolean): string => points.length ? `M${points.map(p => `${p.x} ${p.y}`).join('L')}${closed ? 'Z' : ''}` : '';
      parts.push(`<g transform="translate(${el.x} ${el.y})">`);
      if (el.path.fills.length) parts.push(`<path d="${el.path.fills.map(ring => pathData(ring, true)).join('')}" fill="${el.fill === 'transparent' ? 'none' : el.fill}" fill-rule="evenodd" stroke="none"/>`);
      const ordinary = el.path.strokes.filter(stroke => !stroke.pressureEnabled);
      if (ordinary.length) parts.push(`<path d="${ordinary.map(stroke => pathData(stroke.points, stroke.closed)).join('')}" ${attrs.replace(/fill="[^"]*"/, 'fill="none"')}/>`);
      const pressure = el.path.strokes.filter(stroke => stroke.pressureEnabled);
      if (pressure.length) parts.push(`<path d="${pressure.map(stroke => inkSVG(stroke.points, el.strokeWidth, el.dash)).join('')}" fill="${el.stroke === 'transparent' ? 'none' : el.stroke}" stroke="none"/>`);
      if (el.path.label) {
        const label = el.path.label, clipId = `label-${index}`;
        measure.font = `${el.fontSize}px ${CANVAS_FONT}`;
        const lines = wrapText(measure, label.text, label.w), leading = el.fontSize * 1.55;
        const y = label.y + Math.max(0, (label.h - lines.length * leading) / 2);
        parts.push(`<defs><clipPath id="${clipId}"><path d="${el.path.fills.map(ring => pathData(ring, true)).join('')}" clip-rule="evenodd"/></clipPath></defs>`);
        parts.push(`<text clip-path="url(#${clipId})" fill="${el.stroke}" font-family="Segoe UI,Microsoft YaHei,sans-serif" font-size="${el.fontSize}" text-anchor="middle">`);
        lines.forEach((line, i) => parts.push(`<tspan x="${label.x + label.w / 2}" y="${y + el.fontSize + leading * i}">${esc(line)}</tspan>`));
        parts.push('</text>');
      }
      parts.push('</g>');
    } else if (el.kind === 'pen') {
      if (el.pressureEnabled) parts.push(`<path d="${inkSVG(smoothInk(el.points), el.strokeWidth, el.dash)}" transform="translate(${el.x} ${el.y})" fill="${el.stroke === 'transparent' ? 'none' : el.stroke}" stroke="none"/>`);
      else parts.push(`<polyline points="${el.points.map(p => `${p.x + el.x},${p.y + el.y}`).join(' ')}" ${attrs.replace(/fill="[^"]*"/, 'fill="none"')}/>`);
    }
    else if (el.kind === 'ellipse') parts.push(`<ellipse cx="${box.x + box.w / 2}" cy="${box.y + box.h / 2}" rx="${box.w / 2}" ry="${box.h / 2}" ${attrs}/>`);
    else if (['diamond', 'triangle', 'pentagon', 'hexagon'].includes(el.kind)) parts.push(`<polygon points="${shapeVertices(el).map(p => `${el.x + p.x},${el.y + p.y}`).join(' ')}" ${attrs}/>`);
    else if (el.kind === 'line' || el.kind === 'arrow') {
      parts.push(`<path d="M${el.x} ${el.y}L${el.x + el.w} ${el.y + el.h}" ${attrs}/>`);
      if (el.kind === 'arrow') {
        const angle = Math.atan2(el.h, el.w), length = Math.min(Math.hypot(el.w, el.h) / 2, Math.max(12, el.strokeWidth * 4));
        parts.push(`<path d="M${el.x + el.w - length * Math.cos(angle - Math.PI / 6)} ${el.y + el.h - length * Math.sin(angle - Math.PI / 6)}L${el.x + el.w} ${el.y + el.h}L${el.x + el.w - length * Math.cos(angle + Math.PI / 6)} ${el.y + el.h - length * Math.sin(angle + Math.PI / 6)}" stroke="${el.stroke}" stroke-width="${el.strokeWidth}" fill="none" stroke-linecap="round"/>`);
      }
    } else if (el.kind === 'image') parts.push(`<image x="${box.x}" y="${box.y}" width="${box.w}" height="${box.h}" href="${esc(el.src!)}" preserveAspectRatio="none"/>`);
    else if (el.kind !== 'text') parts.push(`<rect x="${box.x}" y="${box.y}" width="${box.w}" height="${box.h}" rx="${el.kind === 'rect' ? 0 : el.kind === 'note' ? 3 : Math.min(el.radius, box.w / 2, box.h / 2)}" ${el.kind === 'note' ? `fill="${el.fill}"` : attrs}/>`);
    if (el.text) {
      measure.font = `${el.fontSize}px ${CANVAS_FONT}`;
      const pad = el.kind === 'text' ? 0 : el.kind === 'note' ? 22 : 16;
      const lines = wrapText(measure, el.text, Math.max(10, box.w - pad * 2));
      const centered = ['rect', 'roundrect', 'ellipse', 'diamond', 'triangle', 'pentagon', 'hexagon'].includes(el.kind);
      const x = box.x + (centered ? box.w / 2 : pad);
      const y = box.y + pad + (centered ? Math.max(0, (box.h - pad * 2 - lines.length * el.fontSize * 1.55) / 2) : 0);
      parts.push(`<text fill="${el.stroke}" font-family="Segoe UI,Microsoft YaHei,sans-serif" font-size="${el.fontSize}" font-weight="${el.kind === 'text' && el.fontSize >= 32 ? 600 : 400}"${centered ? ' text-anchor="middle"' : ''}>`);
      lines.forEach((line, i) => parts.push(`<tspan x="${x}" y="${y + el.fontSize + i * el.fontSize * 1.55}">${esc(line)}</tspan>`));
      parts.push('</text>');
    }
    parts.push('</g>');
    if (el.rotation) parts.push('</g>');
  }
  parts.push('</svg>');
  return new Blob([parts.join('')], { type: 'image/svg+xml' });
}

export function thumbnail(elements: BoardElement[]): string | undefined {
  const b = unionBounds(elements);
  if (!b) return undefined;
  const canvas = document.createElement('canvas'); canvas.width = 420; canvas.height = 240;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#f8f9f6'; ctx.fillRect(0, 0, 420, 240);
  const scale = Math.min(380 / Math.max(b.w, 1), 200 / Math.max(b.h, 1), 1);
  ctx.translate((420 - b.w * scale) / 2, (240 - b.h * scale) / 2); ctx.scale(scale, scale); ctx.translate(-b.x, -b.y);
  for (const el of elements) drawElement(ctx, el);
  return canvas.toDataURL('image/webp', 0.6);
}
