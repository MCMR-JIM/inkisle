import { compareElements, createElement, type BoardElement, type Point } from '../core/model';
import { captureBounds } from '../core/capture';
import { elementBounds, intersects } from '../core/geometry';
import { drawElement, imageFor } from './draw';
import { exportDimensions } from './export';
import { preparePaper } from './paper-render';

export interface CapturedRegion { element: BoardElement; blob: Blob }

/** Flatten the scene, not the viewport: UI, grid and paper margin guides are excluded. */
export async function captureRegion(elements: BoardElement[], points: Point[], dark = false, signal?: AbortSignal): Promise<CapturedRegion> {
  const bounds = captureBounds(points);
  if (!bounds) throw new Error('请围出一个有效区域');
  const layers = elements.filter(el => el.opacity > 0 && intersects(elementBounds(el), bounds)).sort(compareElements);
  if (!layers.length) throw new Error('这个区域里还没有内容');
  const { width, height } = exportDimensions(bounds, { padding: 0, scale: 2 });
  const scaleX = width / bounds.w, scaleY = height / bounds.h;
  const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('无法创建截取图片');
  try {
    ctx.scale(scaleX, scaleY); ctx.translate(-bounds.x, -bounds.y);
    ctx.beginPath(); points.forEach((p, i) => i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)); ctx.closePath(); ctx.clip('evenodd');
    for (const el of layers) {
      signal?.throwIfAborted();
      if (el.kind === 'image' && el.src) await imageFor(el.src).decode();
      await preparePaper(el, Math.max(scaleX, scaleY));
      signal?.throwIfAborted();
      drawElement(ctx, el, false, Math.max(scaleX, scaleY), dark);
    }
    const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('截取图片生成失败')), 'image/png'));
    signal?.throwIfAborted();
    if (blob.size > 20 * 1024 * 1024) throw new Error('截取内容太大，请缩小区域后重试');
    const src = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader(); reader.onload = () => resolve(reader.result as string); reader.onerror = () => reject(new Error('截取图片读取失败')); reader.readAsDataURL(blob);
    });
    return { element: createElement('image', { ...bounds, src, strokeWidth: 0, fill: 'transparent' }), blob };
  } finally { canvas.width = canvas.height = 0; }
}
