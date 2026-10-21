import type { BoardElement } from '../core/model';
import { elementBounds } from '../core/geometry';
import { drawElement } from './draw';

const PADDING = 18;

/** Cached alpha silhouette: glow surrounds visible pixels without repainting ink. */
export class SelectionGlow {
  private silhouette = document.createElement('canvas');
  private glow = document.createElement('canvas');
  private objects: BoardElement[] = [];
  private zoom = 0;
  private dpr = 0;
  private dark = false;
  private left = 0;
  private top = 0;
  private offsetX = 0;
  private offsetY = 0;
  private valid = false;

  invalidate(): void { this.valid = false; }

  draw(target: CanvasRenderingContext2D, elements: BoardElement[], zoom: number, dpr: number, dark: boolean): void {
    const t = target.getTransform();
    let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
    const visible: BoardElement[] = [];
    for (const element of elements) {
      const b = elementBounds(element);
      const x = b.x * t.a + t.e, y = b.y * t.d + t.f;
      const r = x + b.w * t.a, bottomY = y + b.h * t.d;
      if (r < -PADDING * dpr || x > target.canvas.width + PADDING * dpr || bottomY < -PADDING * dpr || y > target.canvas.height + PADDING * dpr) continue;
      visible.push(element);
      left = Math.min(left, x); top = Math.min(top, y); right = Math.max(right, r); bottom = Math.max(bottom, bottomY);
    }
    left = Math.max(0, Math.floor(left - PADDING * dpr)); top = Math.max(0, Math.floor(top - PADDING * dpr));
    right = Math.min(target.canvas.width, Math.ceil(right + PADDING * dpr)); bottom = Math.min(target.canvas.height, Math.ceil(bottom + PADDING * dpr));
    const width = right - left, height = bottom - top;
    if (width <= 0 || height <= 0) return;
    const same = this.valid && this.left === left && this.top === top && this.offsetX === t.e && this.offsetY === t.f && this.glow.width === width && this.glow.height === height && this.zoom === zoom && this.dpr === dpr && this.dark === dark && this.objects.length === visible.length && visible.every((element, i) => element === this.objects[i]);
    if (!same) {
      this.left = left; this.top = top; this.offsetX = t.e; this.offsetY = t.f; this.zoom = zoom; this.dpr = dpr; this.dark = dark;
      this.objects = visible.slice(); this.valid = true;
      for (const canvas of [this.silhouette, this.glow]) {
        if (canvas.width !== width) canvas.width = width;
        if (canvas.height !== height) canvas.height = height;
      }
      const mask = this.silhouette.getContext('2d')!;
      mask.setTransform(1, 0, 0, 1, 0, 0); mask.clearRect(0, 0, width, height);
      mask.setTransform(t.a, t.b, t.c, t.d, t.e - left, t.f - top);
      for (const element of visible) drawElement(mask, element, false, zoom, dark);
      const glow = this.glow.getContext('2d')!;
      glow.setTransform(1, 0, 0, 1, 0, 0); glow.clearRect(0, 0, width, height);
      glow.save();
      glow.shadowColor = dark ? 'rgba(117, 183, 255, 0.66)' : 'rgba(83, 158, 246, 0.52)';
      glow.shadowBlur = 5 * dpr; glow.shadowOffsetX = 0; glow.shadowOffsetY = 0;
      glow.drawImage(this.silhouette, 0, 0); glow.restore();
      // Remove the source silhouette from both source + shadow. This leaves
      // only the halo outside the object's alpha and preserves its real color.
      glow.globalCompositeOperation = 'destination-out';
      // Canvas antialiasing can leave a half-alpha center pixel on a thin
      // stroke; a few idempotent passes make the interior fully clear while
      // retaining the surrounding blurred edge.
      for (let i = 0; i < 12; i++) glow.drawImage(this.silhouette, 0, 0);
      glow.globalCompositeOperation = 'source-over';
    }
    target.save(); target.setTransform(1, 0, 0, 1, 0, 0);
      target.drawImage(this.glow, left, top); target.restore();
    // Do not repaint selected content on the interaction layer. The main
    // scene remains the authority for occlusion order; this layer contributes
    // only the halo and controls, so selecting a lower object cannot lift it
    // above objects painted later in the scene.
  }

  destroy(): void {
    this.silhouette.width = this.silhouette.height = this.glow.width = this.glow.height = 0;
    this.objects = []; this.valid = false;
  }
}
