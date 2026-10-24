import { compareElements, type BoardElement, type Bounds, type Camera, type Point, type Tool } from '../core/model';
import type { Scene } from '../core/scene';
import { contains, expandBounds, intersects, screenToWorld, unionBounds, worldToScreen, elementBounds } from '../core/geometry';
import { drawElement, onImagesLoaded } from './draw';
import { SelectionGlow } from './selection';
import { isLinearElement, lineEndpointAt, lineEndpoints, lineRotationHandle } from '../core/linear';
import { SELECTION_GAP, selectionFrame, objectRotationHandle, type CornerHandle } from '../core/selection-frame';
import { inScope, selectedUnits } from '../core/groups';
import { eraserRadius } from '../core/eraser';

export type Handle = CornerHandle | 'start' | 'end' | 'rotate';
export interface RenderState {
  camera: Camera;
  selected: Set<string>;
  preview: BoardElement[];
  hidden: Set<string>;
  marquee: Bounds | null;
  cursor: Point | null;
  tool: Tool;
  grid: boolean;
  dark: boolean;
  erasing: Map<string, BoardElement>;
  eraserSize: number;
  groupScope?: string[];
}

export class Renderer {
  private ctx: CanvasRenderingContext2D;
  private overlay: CanvasRenderingContext2D;
  private frame = 0;
  private mainDirty = true;
  private overlayDirty = true;
  private resizeObserver: ResizeObserver;
  private selectionGlow = new SelectionGlow();
  width = 0;
  height = 0;
  dpr = 1;
  lastFrameMs = 0;
  visibleCount = 0;
  frames = 0;
  onFrame?: () => void;

  constructor(public scene: Scene, readonly canvas: HTMLCanvasElement, readonly interactionCanvas: HTMLCanvasElement, public state: RenderState) {
    this.ctx = canvas.getContext('2d', { alpha: false, desynchronized: true })!;
    this.overlay = interactionCanvas.getContext('2d', { desynchronized: true })!;
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(canvas.parentElement!);
    onImagesLoaded(() => { this.selectionGlow.invalidate(); this.invalidate(); });
    this.resize();
  }

  resize(): void {
    const rect = this.canvas.parentElement!.getBoundingClientRect();
    this.width = rect.width; this.height = rect.height;
    this.dpr = Math.min(window.devicePixelRatio || 1, 3);
    for (const canvas of [this.canvas, this.interactionCanvas]) {
      canvas.width = Math.round(this.width * this.dpr);
      canvas.height = Math.round(this.height * this.dpr);
      canvas.style.width = `${this.width}px`; canvas.style.height = `${this.height}px`;
    }
    this.invalidate();
  }

  invalidate(main = true): void {
    this.mainDirty ||= main;
    this.overlayDirty = true;
    if (!this.frame) this.frame = requestAnimationFrame(() => this.render());
  }

  render(): void {
    const start = performance.now();
    this.frame = 0;
    if (this.mainDirty) { this.drawScene(); this.mainDirty = false; }
    if (this.overlayDirty) { this.drawOverlay(); this.overlayDirty = false; }
    this.lastFrameMs = performance.now() - start;
    this.frames++;
    this.onFrame?.();
  }

  private transform(ctx: CanvasRenderingContext2D): void {
    const { x, y, zoom } = this.state.camera;
    ctx.setTransform(this.dpr * zoom, 0, 0, this.dpr * zoom, x * this.dpr, y * this.dpr);
  }

  private drawScene(): void {
    const ctx = this.ctx;
    this.drawBackground(ctx);
    const visible = this.scene.query(this.viewport());
    this.visibleCount = visible.length;
    this.transform(ctx);
    for (const el of visible) {
      if (this.state.hidden.has(el.id)) continue;
      drawElement(ctx, this.state.erasing.get(el.id) ?? el, false, this.state.camera.zoom, this.state.dark);
    }
  }

  private viewport(): Bounds {
    const topLeft = screenToWorld({ x: 0, y: 0 }, this.state.camera);
    return expandBounds({ ...topLeft, w: this.width / this.state.camera.zoom, h: this.height / this.state.camera.zoom }, 40);
  }

  private drawBackground(ctx: CanvasRenderingContext2D): void {
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.fillStyle = this.state.dark ? '#1b211e' : '#f8f9f6';
    ctx.fillRect(0, 0, this.width, this.height);
    if (this.state.grid) this.drawGrid(ctx);
  }

  /** Compose a complete visible scene once, inserting each halo at its own rank.
   * An opaque background prevents duplicated translucent ink on the static base.
   * Editing previews replace their sources instead of floating above all objects.
   */
  private drawLayeredContent(ctx: CanvasRenderingContext2D): void {
    this.drawBackground(ctx); this.transform(ctx);
    const viewport = this.viewport(), previews = new Map(this.state.preview.map(el => [el.id, el]));
    const objects = new Map<string, BoardElement>();
    for (const source of this.scene.query(viewport)) {
      const element = this.state.hidden.has(source.id) ? previews.get(source.id) : this.state.erasing.get(source.id) ?? source;
      if (element) objects.set(element.id, element);
    }
    // A drag may bring an originally off-screen object into the viewport.
    for (const element of this.state.preview) if (this.state.hidden.has(element.id) && intersects(elementBounds(element), viewport)) objects.set(element.id, element);
    const ordered = [...objects.values()].sort(compareElements);
    for (let i = 0; i < ordered.length;) {
      const element = ordered[i];
      if (this.state.tool === 'select' && this.state.selected.has(element.id)) {
        const selected: BoardElement[] = [];
        while (i < ordered.length && this.state.selected.has(ordered[i].id)) selected.push(ordered[i++]);
        this.selectionGlow.draw(ctx, selected, this.state.camera.zoom, this.dpr, this.state.dark);
        for (const selectedElement of selected) drawElement(ctx, selectedElement, false, this.state.camera.zoom, this.state.dark);
      } else {
        drawElement(ctx, element, this.state.hidden.has(element.id), this.state.camera.zoom, this.state.dark); i++;
      }
    }
    for (const element of this.state.preview) if (!this.state.hidden.has(element.id)) drawElement(ctx, element, true, this.state.camera.zoom, this.state.dark);
  }

  private drawGrid(ctx: CanvasRenderingContext2D): void {
    const { camera, dark } = this.state;
    let step = 24 * camera.zoom;
    while (step < 16) step *= 4;
    while (step > 90) step /= 2;
    ctx.fillStyle = dark ? '#3b453e' : '#d9dfd5';
    const ox = ((camera.x % step) + step) % step, oy = ((camera.y % step) + step) % step;
    ctx.beginPath();
    for (let x = ox; x < this.width; x += step) for (let y = oy; y < this.height; y += step) {
      ctx.moveTo(x + 0.8, y); ctx.arc(x, y, 0.8, 0, Math.PI * 2);
    }
    ctx.fill();
  }

  selectionBounds(): Bounds | null {
    const selected = this.state.preview.length && this.state.hidden.size
      ? this.state.preview
      : [...this.state.selected].map(id => this.scene.get(id)).filter((el): el is BoardElement => !!el);
    return unionBounds(selected);
  }

  handleAt(point: Point): CornerHandle | null {
    if (this.state.tool !== 'select' || this.state.selected.size !== 1) return null;
    const selected = [...this.state.selected].map(id => this.scene.get(id));
    if (selected[0]?.groupPath?.[this.state.groupScope?.length ?? 0]) return null;
    if (selected.some(el => el?.locked)) return null;
    const element = selected.length === 1 ? selected[0] : undefined;
    if (element && isLinearElement(element)) return null;
    const b = this.selectionBounds();
    if (!b) return null;
    const handles = element && !isLinearElement(element) ? this.objectHandles(element) : this.handles(expandBounds(b, SELECTION_GAP / this.state.camera.zoom));
    for (const [name, corner] of handles) {
      const p = worldToScreen(corner, this.state.camera);
      if (contains({ x: p.x - 8, y: p.y - 8, w: 16, h: 16 }, point)) return name;
    }
    return null;
  }

  endpointAt(point: Point): 'start' | 'end' | null {
    if (this.state.tool !== 'select' || this.state.selected.size !== 1) return null;
    const element = this.scene.get([...this.state.selected][0]);
    if (element?.groupPath?.[this.state.groupScope?.length ?? 0]) return null;
    if (!element || element.locked || !isLinearElement(element)) return null;
    const world = screenToWorld(point, this.state.camera);
    return lineEndpointAt(element, world, 10 / this.state.camera.zoom);
  }

  rotationHandleAt(point: Point): boolean {
    if (this.state.tool !== 'select' || this.state.selected.size !== 1) return false;
    const element = this.scene.get([...this.state.selected][0]);
    if (element?.groupPath?.[this.state.groupScope?.length ?? 0]) return false;
    if (!element || element.locked) return false;
    const world = screenToWorld(point, this.state.camera);
    const handle = isLinearElement(element) ? lineRotationHandle(element, this.state.camera.zoom).handle : objectRotationHandle(element, this.state.camera.zoom).handle;
    return Math.hypot(world.x - handle.x, world.y - handle.y) <= 11 / this.state.camera.zoom;
  }

  private handles(b: Bounds): [CornerHandle, Point][] {
    return [['nw', { x: b.x, y: b.y }], ['ne', { x: b.x + b.w, y: b.y }], ['sw', { x: b.x, y: b.y + b.h }], ['se', { x: b.x + b.w, y: b.y + b.h }]];
  }

  objectHandles(el: BoardElement): [CornerHandle, Point][] {
    return Object.entries(selectionFrame(el, this.state.camera.zoom).corners) as [CornerHandle, Point][];
  }

  private drawOverlay(): void {
    const ctx = this.overlay;
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, this.interactionCanvas.width, this.interactionCanvas.height);
    const layered = this.state.hidden.size || this.state.tool === 'select' && this.state.selected.size;
    // Present translucent previews over an opaque copy of the cached scene.
    // Independently presented canvases can otherwise briefly show both the old
    // preview and the committed stroke, compositing the same ink twice.
    if (!layered && this.state.preview.some(el => el.opacity < 1)) ctx.drawImage(this.canvas, 0, 0);
    this.transform(ctx);
    if (layered) this.drawLayeredContent(ctx);
    else for (const el of this.state.preview) drawElement(ctx, el, true, this.state.camera.zoom, this.state.dark);
    const b = this.selectionBounds();
    const zoom = this.state.camera.zoom;
    if (b && this.state.tool === 'select') {
      const elements = this.state.preview.length && this.state.hidden.size
        ? this.state.preview : [...this.state.selected].map(id => this.scene.get(id)).filter((el): el is BoardElement => !!el);
      ctx.strokeStyle = this.state.dark ? '#8ebef0' : '#82ade1';
      ctx.fillStyle = this.state.dark ? '#223347' : '#f6faff'; ctx.lineWidth = 1 / zoom;
      const locked = [...this.state.selected].some(id => this.scene.get(id)?.locked);
      const units = selectedUnits(elements, new Set(elements.map(el => el.id)), this.state.groupScope ?? []);
      const only = elements.length === 1 && !units[0]?.group ? elements[0] : null;
      if (!locked && only && isLinearElement(only)) this.drawLinearHandles(ctx, only, zoom);
      else if (!only || !isLinearElement(only)) {
        if (!locked && only) this.drawRotationHandle(ctx, only, zoom, false);
        ctx.save(); ctx.setLineDash([5 / zoom, 5 / zoom]);
        if (only) {
          const { nw, ne, se, sw } = selectionFrame(only, zoom).corners;
          ctx.beginPath(); ctx.moveTo(nw.x, nw.y);
          for (const p of [ne, se, sw]) ctx.lineTo(p.x, p.y);
          ctx.closePath(); ctx.stroke();
        } else {
          for (const unit of units) {
            if (!unit.group && unit.elements.length === 1) {
              const { nw, ne, se, sw } = selectionFrame(unit.elements[0], zoom).corners;
              ctx.beginPath(); ctx.moveTo(nw.x, nw.y);
              for (const p of [ne, se, sw]) ctx.lineTo(p.x, p.y);
              ctx.closePath(); ctx.stroke();
            } else {
              const frame = expandBounds(unit.bounds, SELECTION_GAP / zoom);
              ctx.strokeRect(frame.x, frame.y, frame.w, frame.h);
            }
          }
        }
        ctx.restore();
      }
      if (!locked && only && !isLinearElement(only)) for (const [, p] of this.objectHandles(only)) {
        const size = 7 / zoom;
        ctx.beginPath(); ctx.roundRect(p.x - size / 2, p.y - size / 2, size, size, 1 / zoom); ctx.fill(); ctx.stroke();
      }
    }
    if (this.state.groupScope?.length) {
      const bounds = unionBounds(this.scene.elements.filter(el => inScope(el, this.state.groupScope!)));
      if (bounds) {
        const frame = expandBounds(bounds, 14 / zoom);
        ctx.save(); ctx.strokeStyle = this.state.dark ? '#a4b2a5' : '#657460';
        ctx.lineWidth = 1 / zoom; ctx.setLineDash([3 / zoom, 5 / zoom]);
        ctx.strokeRect(frame.x, frame.y, frame.w, frame.h); ctx.restore();
      }
    }
    if (this.state.marquee) {
      const m = this.state.marquee;
      ctx.fillStyle = '#71aaf017'; ctx.strokeStyle = this.state.dark ? '#8ebef0' : '#82ade1'; ctx.lineWidth = 1 / zoom;
      ctx.fillRect(m.x, m.y, m.w, m.h); ctx.strokeRect(m.x, m.y, m.w, m.h);
    }
    if (this.state.tool === 'eraser' && this.state.cursor) {
      const p = screenToWorld(this.state.cursor, this.state.camera);
      ctx.strokeStyle = this.state.dark ? '#dbe6dc' : '#516b59'; ctx.fillStyle = '#9db4a223'; ctx.lineWidth = 1 / zoom;
      ctx.beginPath(); ctx.arc(p.x, p.y, eraserRadius(this.state.eraserSize, zoom), 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    }
  }

  private drawLinearHandles(ctx: CanvasRenderingContext2D, element: BoardElement, zoom: number): void {
    const { start, end } = lineEndpoints(element);
    const radius = 5 / zoom;
    ctx.beginPath(); ctx.arc(start.x, start.y, radius, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.arc(end.x, end.y, radius, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    this.drawRotationHandle(ctx, element, zoom, true);
  }

  private drawRotationHandle(ctx: CanvasRenderingContext2D, element: BoardElement, zoom: number, line: boolean): void {
    const linear = line ? lineRotationHandle(element, zoom) : null;
    const rotation = linear ? { start: linear.midpoint, handle: linear.handle } : objectRotationHandle(element, zoom);
    const { start, handle } = rotation;
    ctx.beginPath(); ctx.moveTo(start.x, start.y); ctx.lineTo(handle.x, handle.y); ctx.stroke();
    ctx.beginPath(); ctx.arc(handle.x, handle.y, 5 / zoom, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  }

  destroy(): void {
    cancelAnimationFrame(this.frame);
    this.resizeObserver.disconnect();
    this.selectionGlow.destroy();
  }
}
