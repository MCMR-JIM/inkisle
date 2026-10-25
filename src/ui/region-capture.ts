import type { BoardElement, Point } from '../core/model';
import { captureBounds, rectangleRegion, type CaptureMode } from '../core/capture';
import type { Renderer } from '../engine/renderer';
import { captureRegion, type CapturedRegion } from '../engine/capture';
import { positionContextToolbar } from './context-toolbar';

interface CaptureHost {
  renderer: Renderer;
  settle(): Promise<void>;
  copy(result: CapturedRegion, event?: ClipboardEvent): void;
  insert(element: BoardElement): void;
  notify(message: string): void;
}

/** Input geometry and asynchronous rasterization share a cancellable selection lifetime. */
export class RegionCapture {
  private mode: CaptureMode = 'rectangle';
  private start: Point | null = null;
  private job: AbortController | null = null;
  private result: CapturedRegion | null = null;
  private bar = document.querySelector<HTMLElement>('#capture-actions')!;
  private status = document.querySelector<HTMLElement>('#capture-status')!;

  constructor(private host: CaptureHost) {
    document.querySelectorAll<HTMLButtonElement>('[data-capture-mode]').forEach(button => button.addEventListener('click', () => {
      this.cancel(); this.mode = button.dataset.captureMode as CaptureMode;
      document.querySelectorAll<HTMLElement>('[data-capture-mode]').forEach(item => item.setAttribute('aria-pressed', String(item === button)));
      if (this.mode === 'polygon') this.host.notify('逐点点击，点击起点或按 Enter 闭合；Backspace 撤回一点');
      this.host.renderer.interactionCanvas.focus({ preventScroll: true });
    }));
    this.bar.addEventListener('click', event => {
      const action = (event.target as Element).closest<HTMLElement>('[data-capture-action]')?.dataset.captureAction;
      if (action === 'finish') this.finish();
      if (action === 'cancel') this.cancel();
      if (action === 'copy') this.copy();
      if (action === 'insert' && this.result) this.host.insert(this.result.element);
    });
  }

  pointer(type: 'down' | 'move' | 'up', point: Point, event: PointerEvent): void {
    const r = this.host.renderer;
    if (type === 'down') {
      if (r.state.capture?.closed) this.cancel();
      this.start = point;
      if (this.mode === 'rectangle') r.state.capture = { points: rectangleRegion(point, point), closed: false };
    } else if (type === 'move') {
      if (this.mode === 'rectangle' && this.start) r.state.capture = { points: rectangleRegion(this.start, point), closed: false };
      else if (this.mode === 'polygon' && r.state.capture && !r.state.capture.closed) r.state.capture.cursor = point;
    } else if (this.start) {
      if (this.mode === 'rectangle') {
        const start = this.start; this.start = null;
        if (Math.abs(point.x - start.x) * r.state.camera.zoom < 3 || Math.abs(point.y - start.y) * r.state.camera.zoom < 3) { this.cancel(); return; }
        r.state.capture = { points: rectangleRegion(start, point), closed: false }; this.finish();
      } else {
        this.start = null;
        const region = r.state.capture ??= { points: [], closed: false };
        const near = (p: Point) => Math.hypot(point.x - p.x, point.y - p.y) * r.state.camera.zoom < 9;
        if (region.points.length >= 3 && near(region.points[0])) this.finish();
        else if (!region.points.length || !near(region.points.at(-1)!)) {
          if (region.points.length >= 512) this.host.notify('顶点已达上限，请闭合区域');
          else region.points.push(point);
        }
        // A double-click's second release must not create a duplicate vertex.
        if (event.detail >= 2) this.finish();
      }
    }
    r.invalidate(false); this.update();
  }

  finish(): void {
    const region = this.host.renderer.state.capture;
    if (!region || region.closed) return;
    if (!captureBounds(region.points)) { this.host.notify('请至少选择三个不在同一直线上的点'); return; }
    region.closed = true; delete region.cursor; this.start = null;
    this.result = null; this.job?.abort();
    const job = this.job = new AbortController();
    this.status.textContent = '正在合成截取区域'; this.bar.setAttribute('aria-busy', 'true');
    this.host.renderer.invalidate(false); this.update();
    void this.prepare(region.points.slice(), job);
  }

  private async prepare(points: Point[], job: AbortController): Promise<void> {
    try {
      await this.host.settle(); job.signal.throwIfAborted();
      const r = this.host.renderer;
      const result = await captureRegion(r.scene.elements, points, r.state.dark, job.signal);
      job.signal.throwIfAborted();
      this.result = result; this.status.textContent = '区域已就绪，可以复制或生成对象';
    } catch (error) {
      if (job.signal.aborted) return;
      this.host.notify(error instanceof Error ? error.message : '截取失败，请重试'); this.cancel();
    } finally {
      if (this.job === job) { this.job = null; this.bar.removeAttribute('aria-busy'); this.update(); }
    }
  }

  copy(event?: ClipboardEvent): boolean {
    if (!this.result) return false;
    this.host.copy(this.result, event); return true;
  }

  keydown(event: KeyboardEvent): boolean {
    if (this.host.renderer.state.tool !== 'capture') return false;
    if ((event.ctrlKey || event.metaKey) && event.code === 'KeyC') {
      event.preventDefault(); if (!this.copy()) this.host.notify(this.job ? '正在合成，请稍候' : '先框选或围出一个区域'); return true;
    }
    if (event.key === 'Enter') { event.preventDefault(); this.finish(); return true; }
    if (event.key === 'Backspace' && !event.ctrlKey && !event.metaKey) {
      event.preventDefault();
      const region = this.host.renderer.state.capture;
      if (region && this.mode === 'polygon') {
        this.job?.abort(); this.job = null; this.result = null; region.closed = false; region.points.pop();
        this.bar.removeAttribute('aria-busy'); this.host.renderer.invalidate(false); this.update();
      }
      return true;
    }
    return false;
  }

  cancel(): void {
    this.job?.abort(); this.job = null; this.result = null; this.start = null;
    delete this.host.renderer.state.capture;
    this.bar.hidden = true; this.bar.removeAttribute('aria-busy'); this.status.textContent = '';
    this.host.renderer.invalidate(false);
  }

  update(): void {
    const r = this.host.renderer, region = r.state.capture;
    if (r.state.tool !== 'capture' || !region?.points.length || this.start) { this.bar.hidden = true; return; }
    const bounds = captureBounds(region.points) ?? { x: region.points[0].x, y: region.points[0].y, w: 1, h: 1 };
    for (const button of this.bar.querySelectorAll<HTMLButtonElement>('[data-capture-action]')) {
      const action = button.dataset.captureAction;
      button.hidden = action === 'finish' ? region.closed : (action === 'copy' || action === 'insert') && !region.closed;
      button.disabled = action === 'finish' ? region.points.length < 3 : (action === 'copy' || action === 'insert') && !this.result;
    }
    positionContextToolbar(r, this.bar, bounds);
  }
}
