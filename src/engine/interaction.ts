import { createElement, type BoardElement, type Bounds, type Camera, type Change, type Point, type Tool } from '../core/model';
import { containsBounds, expandBounds, hitTest, normalizeBounds, screenToWorld, simplifyPoints, unionBounds, zoomAt } from '../core/geometry';
import { Renderer } from './renderer';
import { editorTextOffset, textFont, textLayout } from './text-layout';
import { eraseAt, erasureBounds, scaleErasures } from '../core/erasure';
import { transformPath } from '../core/paths';
import { Cutter } from './cutter';
import { isLinearElement, lineEndpoints, lineHandleSide, lineRotationHandle, withLineEndpoints } from '../core/linear';
import { rotatePoint, rotationCenter, snapLineEndpoint, snapRotation } from '../core/transforms';
import { selectionFrame, selectionPadding, resizeFromCorner, type CornerHandle } from '../core/selection-frame';
import { recognizeShape } from '../core/recognition';
import { wheelZoom } from '../core/camera';
import { PressureSampler, pressureValue } from '../core/pressure';
import { simplifyInk } from '../core/ink';
import { inScope, selectionUnits, selectedUnits } from '../core/groups';

export interface InteractionHost {
  renderer: Renderer;
  styles: Partial<BoardElement>;
  onSelection(): void;
  onCamera(): void;
  setTool(tool: Tool): void;
  onContext(event: MouseEvent): void;
}

type Gesture =
  | { type: 'pan'; start: Point; camera: Camera }
  | { type: 'draw'; start: Point; element: BoardElement; recognize?: boolean; sampler?: PressureSampler; pointerId: number }
  | { type: 'move'; start: Point; originals: BoardElement[] }
  | { type: 'resize'; start: Point; originals: BoardElement[]; bounds: Bounds; handle: CornerHandle }
  | { type: 'endpoint'; endpoint: 'start' | 'end'; start: Point; original: BoardElement }
  | { type: 'rotate'; startAngle: number; startRotation: number; center: Point; original: BoardElement }
  | { type: 'marquee'; start: Point; previous: Set<string> }
  | { type: 'erase'; last: Point; radius: number }
  | { type: 'pinch'; distance: number; midpoint: Point; camera: Camera };

export class Interaction {
  private gesture: Gesture | null = null;
  private pointers = new Map<number, Point>();
  private space = false;
  private editing: { el: BoardElement; fresh: boolean } | null = null;
  private editor: HTMLTextAreaElement;
  private abort = new AbortController();
  private cutter = new Cutter();
  private pendingCuts = new Set<Promise<void>>();

  constructor(private host: InteractionHost) {
    const canvas = host.renderer.interactionCanvas;
    this.editor = document.querySelector<HTMLTextAreaElement>('#text-editor')!;
    const signal = this.abort.signal;
    canvas.addEventListener('pointerdown', event => this.down(event), { signal });
    canvas.addEventListener('pointermove', event => this.queueMove(event), { signal });
    canvas.addEventListener('pointerup', event => this.up(event), { signal });
    canvas.addEventListener('pointercancel', () => this.cancel(), { signal });
    canvas.addEventListener('lostpointercapture', () => { if (this.gesture) this.cancel(); }, { signal });
    canvas.addEventListener('pointerleave', () => { this.r.state.cursor = null; this.r.invalidate(false); }, { signal });
    canvas.addEventListener('wheel', event => this.wheel(event), { passive: false, signal });
    canvas.addEventListener('dblclick', event => this.doubleClick(event), { signal });
    canvas.addEventListener('contextmenu', event => { event.preventDefault(); host.onContext(event); }, { signal });
    window.addEventListener('keydown', event => {
      if (event.code === 'Space' && !event.ctrlKey && !event.metaKey && !event.altKey && !isTextInput(event.target) && !document.querySelector('dialog[open], .color-picker:not([hidden]), .canvas-eyedropper') && !(event.target instanceof Element && event.target.closest('[role="combobox"], [role="listbox"]'))) {
        event.preventDefault(); this.space = true; canvas.style.cursor = 'grab';
      }
      if (event.key === 'Escape') { this.finishEditing(); this.cancel(); }
    }, { signal });
    window.addEventListener('keyup', event => { if (event.code === 'Space') { this.space = false; this.updateCursor(); } }, { signal });
    window.addEventListener('blur', () => { this.space = false; this.cancel(); }, { signal });
    this.editor.addEventListener('blur', () => this.finishEditing(), { signal });
    this.editor.addEventListener('keydown', event => {
      if (event.key === 'Escape' || (event.key === 'Enter' && (event.ctrlKey || event.metaKey))) {
        event.preventDefault(); event.stopPropagation(); this.finishEditing();
      }
    }, { signal });
    this.editor.addEventListener('input', () => this.sizeEditor(), { signal });
  }

  private get r(): Renderer { return this.host.renderer; }
  get isEditing(): boolean { return !!this.editing; }
  get isGesturing(): boolean { return !!this.gesture; }
  get hasPendingGeometry(): boolean { return this.pendingCuts.size > 0; }
  async settle(): Promise<void> { await Promise.all(this.pendingCuts); }

  selectElement(element: BoardElement, additive = false, deep = false): void {
    if (deep) this.r.state.groupScope = element.groupPath?.slice() ?? [];
    if (!inScope(element, this.r.state.groupScope ?? [])) { this.r.state.groupScope = []; this.r.state.selected.clear(); }
    const unit = selectionUnits(this.r.scene.elements, this.r.state.groupScope ?? []).find(unit => unit.elements.some(el => el.id === element.id));
    if (!unit) return;
    if (additive) {
      const remove = unit.elements.every(el => this.r.state.selected.has(el.id));
      for (const el of unit.elements) if (remove) this.r.state.selected.delete(el.id); else this.r.state.selected.add(el.id);
    } else if (deep || !unit.elements.every(el => this.r.state.selected.has(el.id))) this.r.state.selected = new Set(unit.elements.map(el => el.id));
    this.host.onSelection(); this.r.invalidate(false);
  }

  exitGroup(): boolean {
    const scope = this.r.state.groupScope ?? [];
    if (!scope.length) return false;
    this.finishEditing(); this.cancel(); this.r.state.groupScope = scope.slice(0, -1);
    this.r.state.selected = new Set(this.r.scene.elements.filter(el => inScope(el, scope)).map(el => el.id));
    this.host.onSelection(); return true;
  }

  private enterGroup(element: BoardElement): boolean {
    const scope = this.r.state.groupScope ?? [];
    if (!inScope(element, scope) || !element.groupPath?.[scope.length]) return false;
    this.finishEditing(); this.cancel();
    this.r.state.groupScope = element.groupPath.slice(0, scope.length + 1);
    this.r.state.selected.clear(); this.selectElement(element);
    return true;
  }

  private point(e: { clientX: number; clientY: number }): Point {
    const rect = this.r.interactionCanvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  private hit(point: Point): BoardElement | undefined {
    const t = 7 / this.r.state.camera.zoom;
    return this.r.scene.query(expandBounds({ ...point, w: 0, h: 0 }, t)).reverse().find(el => hitTest(el, point, t));
  }

  private down(e: PointerEvent): void {
    if (e.button === 2) return;
    // Prevent the canvas' native focus action from stealing focus from a text
    // editor opened during this pointerdown handler.
    e.preventDefault();
    this.finishEditing();
    this.r.interactionCanvas.focus({ preventScroll: true });
    const screen = this.point(e), world = screenToWorld(screen, this.r.state.camera);
    this.pointers.set(e.pointerId, screen);
    this.r.interactionCanvas.setPointerCapture(e.pointerId);
    if (this.pointers.size === 2) {
      this.clearPreview();
      const [a, b] = [...this.pointers.values()];
      this.gesture = { type: 'pinch', distance: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)), midpoint: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, camera: { ...this.r.state.camera } };
      return;
    }
    if (this.space || e.button === 1 || this.r.state.tool === 'hand') {
      this.gesture = { type: 'pan', start: screen, camera: { ...this.r.state.camera } };
      this.r.interactionCanvas.style.cursor = 'grabbing';
      return;
    }
    const tool = this.r.state.tool;
    if (tool === 'select') {
      const endpoint = this.r.endpointAt(screen);
      if (endpoint) {
        const original = this.r.scene.get([...this.r.state.selected][0])!;
        this.gesture = { type: 'endpoint', endpoint, start: world, original };
        this.r.state.hidden = new Set([original.id]); this.r.state.preview = [original]; this.r.invalidate(); return;
      }
      if (this.r.rotationHandleAt(screen)) {
        const original = this.r.scene.get([...this.r.state.selected][0])!;
        const center = isLinearElement(original) ? lineRotationHandle(original).midpoint : rotationCenter(original);
        this.gesture = { type: 'rotate', startAngle: Math.atan2(world.y - center.y, world.x - center.x), startRotation: original.rotation, center, original };
        this.r.state.hidden = new Set([original.id]); this.r.state.preview = [original]; this.r.invalidate(); return;
      }
      const handle = this.r.handleAt(screen);
      const selected = [...this.r.state.selected].map(id => this.r.scene.get(id)).filter((el): el is BoardElement => !!el);
      const bounds = unionBounds(selected);
      if (handle && bounds) {
        this.gesture = { type: 'resize', start: world, originals: selected, bounds, handle };
        this.r.state.hidden = new Set(selected.map(el => el.id)); this.r.state.preview = selected;
        this.r.invalidate(); return;
      }
      const hit = this.hit(world);
      if (hit) {
        this.selectElement(hit, e.shiftKey, e.ctrlKey || e.metaKey);
        const originals = selectedUnits(this.r.scene.elements, this.r.state.selected, this.r.state.groupScope ?? []).filter(unit => !unit.elements.some(el => el.locked)).flatMap(unit => unit.elements);
        if (originals.length) this.gesture = { type: 'move', start: world, originals };
      } else {
        const previous = e.shiftKey ? new Set(this.r.state.selected) : new Set<string>();
        this.r.state.selected = new Set(previous);
        this.gesture = { type: 'marquee', start: world, previous };
      }
      this.host.onSelection(); this.r.invalidate(false); return;
    }
    if (tool === 'eraser') {
      this.gesture = { type: 'erase', last: world, radius: 10 / this.r.state.camera.zoom }; this.erase(world); return;
    }
    if (tool === 'image') return;
    if (tool === 'text' || tool === 'note') {
      const el = createElement(tool, { ...this.host.styles, groupPath: this.r.state.groupScope?.slice(), x: world.x, y: world.y, w: tool === 'note' ? 230 : 320, h: tool === 'note' ? 200 : 45, ...(tool === 'note' ? { fontSize: 20 } : {}) });
      this.editText(el, true); return;
    }
    const ink = tool === 'pen' || tool === 'recognize';
    const pressure = tool === 'pen' && this.host.styles.pressureEnabled !== false && (e.pointerType === 'pen' || e.pointerType === 'mouse');
    const sampler = pressure ? new PressureSampler(e.pointerType, { x: screen.x, y: screen.y, time: e.timeStamp, pressure: e.pressure }) : undefined;
    const element = createElement(tool === 'recognize' ? 'pen' : tool, { ...this.host.styles, groupPath: this.r.state.groupScope?.slice(), x: world.x, y: world.y, ...(ink ? { pressureEnabled: pressure } : {}), points: ink ? [{ x: 0, y: 0, pressure: sampler?.value ?? pressureValue(e.pressure) }] : [] });
    this.r.state.selected.clear();
    this.gesture = { type: 'draw', start: world, element, recognize: tool === 'recognize', sampler, pointerId: e.pointerId };
    this.r.state.preview = [element]; this.r.invalidate(false);
  }

  private queueMove(e: PointerEvent): void {
    const screen = this.point(e);
    if (this.pointers.has(e.pointerId)) this.pointers.set(e.pointerId, screen);
    this.r.state.cursor = screen;
    if (this.gesture?.type === 'erase') {
      const events = e.getCoalescedEvents?.() ?? [e];
      for (const sample of events.length ? events : [e]) this.erase(screenToWorld(this.point(sample), this.r.state.camera));
      return;
    }
    if (this.gesture?.type === 'draw' && this.gesture.element.kind === 'pen') {
      // Capture every coalesced sample immediately. Paint at most once per display frame.
      const g = this.gesture;
      if (e.pointerId !== g.pointerId) return;
      const events = e.getCoalescedEvents?.() ?? [e];
      for (const sample of events.length ? events : [e]) {
        const p = screenToWorld(this.point(sample), this.r.state.camera);
        const last = g.element.points[g.element.points.length - 1];
        const screen = this.point(sample);
        const next = { x: p.x - g.start.x, y: p.y - g.start.y, pressure: g.sampler?.next({ x: screen.x, y: screen.y, time: sample.timeStamp, pressure: sample.pressure }) ?? pressureValue(sample.pressure) };
        if (Math.hypot(next.x - last.x, next.y - last.y) >= 0.4 / this.r.state.camera.zoom || g.element.pressureEnabled && Math.abs(next.pressure - (last.pressure ?? .5)) >= .015) g.element.points.push(next);
      }
      this.r.invalidate(false); return;
    }
    // Update the cheap gesture model immediately. Renderer owns the only RAF
    // boundary; a second RAF here would delay every non-pen gesture one frame.
    this.move(e);
  }

  private move(e: PointerEvent): void {
    const screen = this.point(e), world = screenToWorld(screen, this.r.state.camera), g = this.gesture;
    if (!g) { this.updateCursor(screen); if (this.r.state.tool === 'eraser') this.r.invalidate(false); return; }
    if (g.type === 'pan') {
      this.r.state.camera = { ...g.camera, x: g.camera.x + screen.x - g.start.x, y: g.camera.y + screen.y - g.start.y };
      this.r.invalidate(); this.host.onCamera(); return;
    }
    if (g.type === 'pinch') {
      if (this.pointers.size < 2) return;
      const [a, b] = [...this.pointers.values()];
      const midpoint = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const next = zoomAt(g.camera, g.midpoint, g.camera.zoom * Math.hypot(a.x - b.x, a.y - b.y) / g.distance);
      next.x += midpoint.x - g.midpoint.x; next.y += midpoint.y - g.midpoint.y;
      this.r.state.camera = next; this.r.invalidate(); this.host.onCamera(); return;
    }
    if (g.type === 'draw') {
      let w = world.x - g.start.x, h = world.y - g.start.y;
      if (e.shiftKey) {
        if (isLinearElement(g.element)) {
          const angle = Math.round(Math.atan2(h, w) / (Math.PI / 4)) * Math.PI / 4, length = Math.hypot(w, h);
          w = Math.cos(angle) * length; h = Math.sin(angle) * length;
        } else { const size = Math.max(Math.abs(w), Math.abs(h)); w = Math.sign(w || 1) * size; h = Math.sign(h || 1) * size; }
      }
      g.element.w = w; g.element.h = h;
    } else if (g.type === 'endpoint') {
      const anchor = lineEndpoints(g.original);
      const fixed = g.endpoint === 'start' ? anchor.end : anchor.start;
      const nextPoint = e.shiftKey ? snapLineEndpoint(fixed, world) : world;
      this.r.state.preview = [withLineEndpoints(g.original, g.endpoint === 'start' ? nextPoint : anchor.start, g.endpoint === 'end' ? nextPoint : anchor.end)];
      this.r.invalidate(false); return;
    } else if (g.type === 'rotate') {
      const raw = g.startRotation + Math.atan2(world.y - g.center.y, world.x - g.center.x) - g.startAngle;
      const rotation = e.shiftKey ? snapRotation(raw) : raw;
      this.r.state.preview = [{ ...g.original, rotation }];
      this.r.invalidate(false); return;
    } else if (g.type === 'move') {
      const dx = world.x - g.start.x, dy = world.y - g.start.y;
      if (Math.abs(dx) + Math.abs(dy) > 0.5) {
        const firstMove = !this.r.state.hidden.size;
        if (firstMove) this.r.state.hidden = new Set(g.originals.map(el => el.id));
        this.r.state.preview = g.originals.map(el => ({ ...el, x: el.x + dx, y: el.y + dy }));
        this.r.invalidate(firstMove); return;
      }
    } else if (g.type === 'resize') {
      if (g.originals.length === 1) {
        const original = g.originals[0], zoom = this.r.state.camera.zoom;
        const grabbed = selectionFrame(original, zoom).corners[g.handle];
        const pointer = { x: grabbed.x + world.x - g.start.x, y: grabbed.y + world.y - g.start.y };
        this.r.state.preview = [resizeFromCorner(original, g.handle, pointer, e.shiftKey, selectionPadding(original, zoom))];
        this.r.invalidate(false); return;
      }
      const { bounds: b, handle } = g;
      const pointer = {
        x: (handle.includes('w') ? b.x : b.x + b.w) + world.x - g.start.x,
        y: (handle.includes('n') ? b.y : b.y + b.h) + world.y - g.start.y,
      };
      let left = b.x, top = b.y, right = b.x + b.w, bottom = b.y + b.h;
      if (handle.includes('w')) left = Math.min(pointer.x, right - 10); else right = Math.max(pointer.x, left + 10);
      if (handle.includes('n')) top = Math.min(pointer.y, bottom - 10); else bottom = Math.max(pointer.y, top + 10);
      let sx = (right - left) / Math.max(b.w, 0.1), sy = (bottom - top) / Math.max(b.h, 0.1);
      if (e.shiftKey) {
        sx = sy = Math.max(sx, sy);
        if (handle.includes('w')) left = right - b.w * sx;
        if (handle.includes('n')) top = bottom - b.h * sy;
      }
      this.r.state.preview = g.originals.map(el => ({
        ...el, x: left + (el.x - b.x) * sx, y: top + (el.y - b.y) * sy, w: el.w * sx, h: el.h * sy,
        points: el.kind === 'pen' ? el.points.map(p => ({ ...p, x: p.x * sx, y: p.y * sy })) : el.points,
        fontSize: Math.max(8, Math.min(1000, el.fontSize * Math.min(sx, sy))),
        erasures: scaleErasures(el.erasures, sx, sy),
        ...(el.path ? { path: transformPath(el.path, sx, sy) } : {}),
        ...(el.vertices ? { vertices: el.vertices.map(p => ({ x: p.x * sx, y: p.y * sy })) } : {}),
      }));
    } else if (g.type === 'marquee') {
      const b = normalizeBounds({ ...g.start, w: world.x - g.start.x, h: world.y - g.start.y });
      this.r.state.marquee = b;
      this.r.state.selected = new Set([...g.previous, ...selectionUnits(this.r.scene.elements, this.r.state.groupScope ?? []).filter(unit => containsBounds(b, unit.bounds)).flatMap(unit => unit.elements.map(el => el.id))]);
    } else if (g.type === 'erase') { this.erase(world); return; }
    this.r.invalidate(false);
  }

  private up(e: PointerEvent): void {
    const g = this.gesture;
    if (g?.type === 'draw' && g.pointerId !== e.pointerId) { this.pointers.delete(e.pointerId); return; }
    this.pointers.delete(e.pointerId);
    this.gesture = null;
    if (!g) return;
    if (g.type === 'draw') {
      let el = g.element;
      if (el.kind === 'pen') {
        const world = screenToWorld(this.point(e), this.r.state.camera), tail = el.points.at(-1)!;
        const point = { x: world.x - el.x, y: world.y - el.y, pressure: tail.pressure };
        // pointerup normally reports zero after contact is gone, not a new thin sample.
        if (Math.hypot(point.x - tail.x, point.y - tail.y) > .1 / this.r.state.camera.zoom) el.points.push(point);
      }
      if (g.recognize) {
        const size = 8 / this.r.state.camera.zoom;
        const shape = recognizeShape(el.points, size) ?? { kind: 'ellipse' as const, x: -size / 2, y: -size / 2, w: size, h: size, rotation: 0, regular: true };
        const { regular: _regular, ...geometry } = shape;
        const origin = { x: el.x, y: el.y };
        el = { ...el, ...geometry, x: origin.x + geometry.x, y: origin.y + geometry.y, points: [], radius: 0 };
      }
      if (el.kind === 'pen') {
        el = { ...el, points: el.pressureEnabled ? simplifyInk(el.points, 0.35 / this.r.state.camera.zoom) : simplifyPoints(el.points, 0.35 / this.r.state.camera.zoom) };
      } else if (Math.hypot(el.w, el.h) < 4 / this.r.state.camera.zoom) {
        el = { ...el, w: 160, h: isLinearElement(el) ? 0 : 100 };
      }
      if (isLinearElement(el)) el = { ...el, rotationHandleSide: lineHandleSide(el) };
      this.r.scene.apply([{ id: el.id, after: el }], '绘制');
      // Creation tools are sticky. Selection is an explicit action (V/Esc).
      this.r.state.selected.clear();
    } else if ((g.type === 'move' || g.type === 'resize' || g.type === 'endpoint' || g.type === 'rotate') && this.r.state.preview.length) {
      const label = g.type === 'move' ? '移动' : g.type === 'resize' ? '缩放' : g.type === 'endpoint' ? '编辑端点' : '旋转';
      this.r.scene.apply(this.r.state.preview.map(el => ({ id: el.id, after: el })), label);
    } else if (g.type === 'erase') {
      const sources = [...this.r.state.erasing.values()].map(el => {
        const original = this.r.scene.get(el.id)!;
        const count = original.erasures?.length ?? 0;
        const erasures = el.erasures!.map((stroke, i) => i < count ? stroke : { ...stroke, points: simplifyPoints(stroke.points, g.radius * .02) });
        return { ...el, erasures };
      });
      const scene = this.r.scene;
      const transaction = scene.apply(sources.map<Change>(el => ({ id: el.id, after: el })), '局部擦除');
      if (transaction) {
        const job = this.cutter.cut(sources, Math.max(.01, Math.min(.2, .2 / this.r.state.camera.zoom))).then(result => {
          const replacements = result.map((parts, i) => ({ source: sources[i], parts }));
          scene.refine(transaction, replacements);
          if (scene === this.r.scene) this.host.onSelection();
        }).catch(() => { /* Committed local masks remain intact if the worker is unavailable. */ });
        this.pendingCuts.add(job); void job.finally(() => this.pendingCuts.delete(job));
      }
    } else if (g.type === 'pan' || g.type === 'pinch') this.host.onCamera();
    this.clearPreview(); this.updateCursor(); this.host.onSelection();
  }

  private erase(point: Point): void {
    const gesture = this.gesture;
    if (gesture?.type !== 'erase') return;
    const previous = gesture.last;
    const points = previous.x === point.x && previous.y === point.y ? [point] : [previous, point];
    for (const el of this.r.scene.query(erasureBounds(points, gesture.radius))) {
      const preview = this.r.state.erasing.get(el.id);
      const next = eraseAt(preview ?? el, points, gesture.radius, !!preview);
      if (next) this.r.state.erasing.set(el.id, next);
    }
    gesture.last = point;
    this.r.invalidate();
  }

  private wheel(e: WheelEvent): void {
    e.preventDefault();
    if (this.editing) this.finishEditing();
    if (e.ctrlKey || e.metaKey || !('ontouchstart' in window) && e.deltaMode === 1) {
      this.r.state.camera = zoomAt(this.r.state.camera, this.point(e), wheelZoom(this.r.state.camera.zoom, e.deltaY, e.deltaMode));
    } else {
      this.r.state.camera.x -= e.shiftKey ? e.deltaY : e.deltaX;
      this.r.state.camera.y -= e.shiftKey ? e.deltaX : e.deltaY;
    }
    this.r.invalidate(); this.host.onCamera();
  }

  private doubleClick(e: MouseEvent): void {
    if (this.r.state.tool !== 'select') return;
    const world = screenToWorld(this.point(e), this.r.state.camera);
    const el = this.hit(world);
    if (el && this.enterGroup(el)) return;
    if (el && !el.locked && ['text', 'note', 'rect', 'roundrect', 'ellipse', 'diamond', 'triangle', 'pentagon', 'hexagon'].includes(el.kind)) this.editText(el);
    else if (!el) this.editText(createElement('text', { ...this.host.styles, groupPath: this.r.state.groupScope?.slice(), x: world.x, y: world.y, w: 320, h: 45 }), true);
  }

  editSelected(): void {
    const units = selectedUnits(this.r.scene.elements, this.r.state.selected, this.r.state.groupScope ?? []);
    if (units.length !== 1) return;
    const el = this.r.scene.get([...this.r.state.selected][0]);
    if (el && this.enterGroup(el)) return;
    if (el && !el.locked && ['text', 'note', 'rect', 'roundrect', 'ellipse', 'diamond', 'triangle', 'pentagon', 'hexagon'].includes(el.kind)) this.editText(el);
  }

  editText(el: BoardElement, fresh = false): void {
    this.finishEditing();
    this.editing = { el, fresh };
    this.r.state.hidden.add(el.id);
    this.r.state.preview = el.kind === 'text' ? [] : [{ ...el, text: '' }];
    this.r.state.selected.clear();
    const editor = this.editor;
    editor.hidden = false; editor.value = el.text;
    editor.style.font = textFont(el);
    editor.style.color = el.stroke;
    editor.style.opacity = `${el.opacity}`;
    this.sizeEditor(); this.r.invalidate();
    editor.focus({ preventScroll: true }); editor.setSelectionRange(editor.value.length, editor.value.length);
  }

  private sizeEditor(): void {
    if (!this.editing) return;
    const { el } = this.editing, editor = this.editor, ctx = this.r.canvas.getContext('2d')!;
    const layout = textLayout(ctx, el, editor.value), camera = this.r.state.camera;
    const origin = rotatePoint({ x: layout.x, y: layout.y + editorTextOffset(ctx, el) }, rotationCenter(el), el.rotation ?? 0);
    editor.style.left = `${origin.x * camera.zoom + camera.x}px`;
    editor.style.top = `${origin.y * camera.zoom + camera.y}px`;
    editor.style.transform = `rotate(${el.rotation ?? 0}rad) scale(${camera.zoom})`;
    editor.style.width = `${layout.width}px`;
    editor.style.lineHeight = `${layout.leading}px`;
    editor.style.textAlign = layout.centered ? 'center' : 'left';
    editor.style.height = `${layout.lines.length * layout.leading + 4}px`;
  }

  finishEditing(): void {
    if (!this.editing) return;
    const { el, fresh } = this.editing;
    this.editing = null;
    const text = this.editor.value.trimEnd();
    this.editor.hidden = true;
    if (text.trim() || !fresh) {
      if (text !== el.text || fresh) {
        const measure = this.r.canvas.getContext('2d')!;
        const { lines, leading, padding } = textLayout(measure, el, text);
        const next = { ...el, text };
        if (el.kind === 'text') {
          next.h = Math.max(el.fontSize * 1.6, lines.length * leading + 4);
          if (fresh) next.w = Math.max(24, ...lines.map(line => measure.measureText(line).width + 8));
        }
        if (el.kind === 'note') next.h = Math.max(el.h, lines.length * leading + padding * 2);
        if (el.rotation && (next.w !== el.w || next.h !== el.h)) {
          const before = rotationCenter(el), after = rotationCenter(next);
          const delta = { x: before.x - after.x, y: before.y - after.y };
          const rotated = rotatePoint(delta, { x: 0, y: 0 }, el.rotation);
          next.x += delta.x - rotated.x; next.y += delta.y - rotated.y;
        }
        this.r.scene.apply([{ id: el.id, after: next }], '编辑文字');
      }
      this.r.state.selected = this.r.state.tool === 'select' ? new Set([el.id]) : new Set();
    }
    this.clearPreview();
    this.host.onSelection();
  }

  cancel(): void {
    this.gesture = null; this.pointers.clear();
    this.clearPreview(); this.updateCursor();
  }

  private clearPreview(): void {
    this.r.state.preview = []; this.r.state.hidden.clear(); this.r.state.marquee = null; this.r.state.erasing.clear();
    this.r.invalidate();
  }

  updateCursor(point?: Point): void {
    const tool = this.r.state.tool;
    const handle = point && this.r.handleAt(point);
    this.r.interactionCanvas.style.cursor = this.space || tool === 'hand' ? 'grab' : handle ? (handle === 'nw' || handle === 'se' ? 'nwse-resize' : 'nesw-resize') : tool === 'select' ? 'default' : tool === 'text' ? 'text' : tool === 'eraser' ? 'none' : 'crosshair';
  }

  destroy(): void { this.finishEditing(); this.cancel(); this.abort.abort(); this.cutter.destroy(); }
}

export function isTextInput(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));
}
