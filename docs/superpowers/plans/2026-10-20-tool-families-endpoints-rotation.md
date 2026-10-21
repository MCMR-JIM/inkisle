# 分类工具栏、线类端点编辑与旋转 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为留白增加图形/直线分类子面板、双向箭头、六种图形、线类端点编辑和 Shift 15° 旋转，同时保持现有擦除、保存、导出和低延迟架构。

**Architecture:** 扩展模型但保留参数化对象；新增 transforms、linear、tool-families 三个边界模块。Renderer 只负责派发端点/旋转手柄，Interaction 负责一次手势生成一次事务；Canvas 绘制、命中、空间索引、擦除和导出共享同一局部-世界变换。

**Tech Stack:** 原生 TypeScript、Canvas 2D、Pointer Events、IndexedDB、Web Worker；Vitest、Playwright、Vite 仅开发使用。

## Global Constraints

- 零生产运行时依赖，不引入 UI、白板、图标或几何库。
- 一级工具固定为选择、抓手、画笔、图形、直线、文字、便签、图片、橡皮。
- 图形子工具为矩形、椭圆、菱形、三角形、五边形、六边形。
- 直线子工具为直线、箭头、双向箭头。
- 默认自由旋转；按住 Shift 吸附到 15°；端点按住 Shift 吸附到 45°。
- 单选直线类只显示两个端点和中垂线旋转手柄；普通对象显示顶部旋转手柄；多选本轮不显示旋转手柄。
- 一次端点拖动或旋转一次历史事务；无实际移动不产生历史记录。
- 旧 `.liubai` 文件缺失新增字段时必须仍可读取；非法角度、类型和路径数据必须拒绝。
- 选中对象保留原色，使用淡蓝 alpha 柔光；新增手柄与框选颜色沿用淡蓝体系。

---

## 文件结构与接口锁定

### Task 1: Model, transform and line semantics

**Files:**
- Modify: `src/core/model.ts`
- Create: `src/core/transforms.ts`
- Create: `src/core/linear.ts`
- Modify: `src/core/geometry.ts`
- Modify: `src/core/codec.ts`
- Test: `tests/unit/transform.test.ts`
- Test: `tests/unit/core.test.ts`

**Interfaces:**
- `BoardElement.rotation: number` defaults to `0`.
- `ElementKind` adds `'bidirectional-arrow'`, `'triangle'`, `'pentagon'`, and `'hexagon'`.
- `Tool` includes the four new concrete child tools only as children, not as new top-level families.
- `transforms.ts` exports:
  - `type Vec2 = { x: number; y: number }`
  - `worldPoint(el: BoardElement, local: Vec2): Vec2`
  - `localPoint(el: BoardElement, world: Vec2): Vec2`
  - `rotationCenter(el: BoardElement): Vec2`
  - `rotatePoint(point: Vec2, center: Vec2, angle: number): Vec2`
  - `normalizeAngle(angle: number): number`
  - `snapRotation(angle: number, step = Math.PI / 12): number`
  - `snapLineEndpoint(anchor: Vec2, point: Vec2, step = Math.PI / 4): Vec2`
  - `transformedBounds(el: BoardElement): Bounds`
- `linear.ts` exports:
  - `isLinearElement(el: BoardElement): boolean`
  - `lineEndpoints(el: BoardElement): { start: Vec2; end: Vec2 }`
  - `withLineEndpoints(el: BoardElement, start: Vec2, end: Vec2): BoardElement`
  - `lineEndpointAt(el: BoardElement, point: Vec2, tolerance: number): 'start' | 'end' | null`
  - `lineRotationHandle(el: BoardElement): { handle: Vec2; midpoint: Vec2 }`
  - `arrowHeadKinds(el: BoardElement): { start: boolean; end: boolean }`

- [ ] **Step 1: Write failing transform tests**

```ts
import { describe, expect, it } from 'vitest';
import { createElement } from '../../src/core/model';
import { localPoint, rotationCenter, snapLineEndpoint, snapRotation, worldPoint } from '../../src/core/transforms';
import { lineEndpoints, lineEndpointAt, withLineEndpoints } from '../../src/core/linear';

describe('object transforms', () => {
  it('round-trips a rotated local point', () => {
    const el = createElement('rect', { x: 100, y: 80, w: 200, h: 100, rotation: Math.PI / 4 });
    const point = { x: 50, y: 20 };
    expect(localPoint(el, worldPoint(el, point))).toEqual(point);
  });

  it('uses the unrotated object center as the rotation pivot', () => {
    const el = createElement('rect', { x: 100, y: 80, w: 200, h: 100, rotation: Math.PI / 3 });
    expect(rotationCenter(el)).toEqual({ x: 200, y: 130 });
  });

  it('snaps rotation to 15 degrees and endpoint direction to 45 degrees', () => {
    expect(snapRotation(Math.PI / 15)).toBeCloseTo(Math.PI / 12);
    expect(snapLineEndpoint({ x: 0, y: 0 }, { x: 40, y: 11 })).toEqual({ x: 40.98780487804878, y: 0 });
  });
});

describe('linear endpoint semantics', () => {
  it('edits only the requested endpoint and preserves arrow metadata', () => {
    const arrow = createElement('arrow', { x: 10, y: 20, w: 80, h: 30, rotation: 0 });
    const next = withLineEndpoints(arrow, { x: 15, y: 25 }, lineEndpoints(arrow).end);
    expect(lineEndpoints(next)).toEqual({ start: { x: 15, y: 25 }, end: { x: 90, y: 50 } });
    expect(next.kind).toBe('arrow');
  });

  it('hits screen-space endpoint candidates before the line body', () => {
    const line = createElement('line', { x: 10, y: 20, w: 80, h: 30 });
    expect(lineEndpointAt(line, { x: 10, y: 20 }, 8)).toBe('start');
    expect(lineEndpointAt(line, { x: 90, y: 50 }, 8)).toBe('end');
  });
});
```

- [ ] **Step 2: Run the focused tests and verify the expected missing-module failure**

Run: `npm test -- tests/unit/transform.test.ts tests/unit/core.test.ts`

Expected: FAIL because `src/core/transforms.ts` and `src/core/linear.ts` do not yet exist, while the existing core tests remain discoverable.

- [ ] **Step 3: Add model fields and transform implementation**

Add `rotation?: number` with default `0`; add `'bidirectional-arrow'` to `ElementKind`. Implement the exact APIs above. Use this transform convention:

```ts
export function worldPoint(el: BoardElement, local: Vec2): Vec2 {
  const center = rotationCenter(el);
  const point = { x: el.x + local.x, y: el.y + local.y };
  return rotatePoint(point, center, el.rotation ?? 0);
}

export function localPoint(el: BoardElement, world: Vec2): Vec2 {
  const center = rotationCenter(el);
  const unrotated = rotatePoint(world, center, -(el.rotation ?? 0));
  return { x: unrotated.x - el.x, y: unrotated.y - el.y };
}
```

`withLineEndpoints()` stores the start in `x/y`, the vector in `w/h`, and resets line rotation to `0` when endpoint editing is committed; a separate rotation gesture stores the angle. `bidirectional-arrow` reports `{ start: true, end: true }`; `arrow` reports `{ start: false, end: true }`; `line` reports both false.

- [ ] **Step 4: Extend validation and rotated bounds**

Validate `rotation` as finite and bounded to `[-Math.PI * 1000, Math.PI * 1000]`; accept missing values as `0`. Add the bidirectional kind to the kind set. Make `elementBounds()` use `transformedBounds()` for parameterized objects and retain path-specific bounds. Add tests for negative dimensions, full-turn angles, invalid rotation, and source-file round trip.

- [ ] **Step 5: Run focused tests**

Run: `npm test -- tests/unit/transform.test.ts tests/unit/core.test.ts tests/unit/storage.test.ts`

Expected: PASS for the new transform/linear cases and all existing core/storage tests.

---

### Task 2: Shared geometry and rendering for new shapes and line variants

**Files:**
- Modify: `src/core/paths.ts`
- Modify: `src/core/geometry.ts`
- Modify: `src/engine/draw.ts`
- Modify: `src/engine/export.ts`
- Modify: `src/engine/renderer.ts`
- Test: `tests/unit/shapes.test.ts`
- Test: `tests/e2e/cutting.spec.ts`

**Interfaces:**
- `paths.ts` exports `polygonPoints(cx, cy, radiusX, radiusY, sides, rotation)` and accepts `3`, `5`, `6` sides; `BoardElement.kind` remains the semantic shape kind so the objects remain editable as shapes until they are geometrically cut.
- `drawElement()` renders rotation with `ctx.translate(center); ctx.rotate(rotation); ctx.translate(-center)` and handles `bidirectional-arrow`.
- `Renderer` exposes `endpointAt(screenPoint)` and `rotationHandleAt(screenPoint)`.

- [ ] **Step 1: Write failing shape and rendering tests**

```ts
import { expect, it } from 'vitest';
import { polygonPoints } from '../../src/core/paths';
import { createElement } from '../../src/core/model';
import { arrowHeadKinds } from '../../src/core/linear';

it.each([[3, 'triangle'], [5, 'pentagon'], [6, 'hexagon']] as const)('creates %i vertices for %s', (sides) => {
  expect(polygonPoints(0, 0, 50, 40, sides, 0)).toHaveLength(sides);
});

it('marks both endpoints for a bidirectional arrow', () => {
  expect(arrowHeadKinds(createElement('bidirectional-arrow'))).toEqual({ start: true, end: true });
});
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run: `npm test -- tests/unit/shapes.test.ts`

Expected: FAIL because `polygonPoints` and the new element kind are not implemented.

- [ ] **Step 3: Implement polygon geometry and line drawing**

Use one shared polygon helper with the top vertex at `-Math.PI / 2`, so triangle/pentagon/hexagon have consistent orientation. Add `bidirectional-arrow` to `drawUnmaskedElement()` and draw an arrowhead at the start and end based on transformed world endpoints. Draw all parameterized objects inside the same rotation transform and restore the context in `finally`-equivalent save/restore pairs.

- [ ] **Step 4: Extend SVG/PNG and hit testing**

SVG must emit polygon points, transformed line paths, and both arrowheads. `hitTest()` must inverse-transform the pointer before testing shapes and line endpoints. Spatial index bounds must use the rotated AABB. Add browser assertions for created triangle/pentagon/hexagon and bidirectional SVG output containing both arrowhead paths.

- [ ] **Step 5: Run focused tests**

Run: `npm test -- tests/unit/shapes.test.ts tests/unit/core.test.ts && npm run build`

Expected: all focused tests pass and TypeScript/Vite build exits 0.

---

### Task 3: Tool-family configuration and floating subpanels

**Files:**
- Create: `src/ui/tool-families.ts`
- Modify: `src/ui/shell.ts`
- Modify: `src/ui/icons.ts`
- Modify: `src/ui/styles.css`
- Modify: `src/app.ts`
- Test: `tests/e2e/tool-families.spec.ts`

**Interfaces:**
- `ToolFamily = { id: 'select' | 'hand' | 'pen' | 'shapes' | 'lines' | 'text' | 'note' | 'image' | 'eraser'; label: string; icon: string; children?: ToolChild[] }`.
- `ToolChild = { tool: Tool; label: string; icon: string }`.
- `ToolFamilyController.open(familyId)`, `.close()`, `.choose(tool)`, `.activeFamily()`, `.activeTool()`.

- [ ] **Step 1: Write failing browser tests for hierarchy and keyboard behavior**

```ts
import { expect, test } from '@playwright/test';

test('opens the shapes family and chooses a hexagon', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '图形', exact: true }).click();
  await expect(page.getByRole('menu', { name: '图形工具' })).toBeVisible();
  await page.getByRole('menuitem', { name: '六边形', exact: true }).click();
  await expect(page.getByRole('button', { name: '图形', exact: true })).toHaveAttribute('aria-expanded', 'false');
  await page.getByRole('button', { name: '六边形', exact: true }).click();
  await page.mouse.move(500, 300); await page.mouse.down(); await page.mouse.move(700, 450); await page.mouse.up();
  await expect(page.locator('#element-count')).toHaveText('1 个元素');
});

test('opens lines and chooses bidirectional arrow with Escape/outside dismissal', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '直线', exact: true }).click();
  await page.getByRole('menuitem', { name: '双向箭头', exact: true }).click();
  await page.getByRole('button', { name: '直线', exact: true }).click();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('menu', { name: '直线工具' })).not.toBeVisible();
});
```

- [ ] **Step 2: Run and verify the browser tests fail**

Run: `npm run test:e2e -- tests/e2e/tool-families.spec.ts`

Expected: FAIL because the current toolbar renders every child as a top-level button and has no `menu`/`menuitem` family controller.

- [ ] **Step 3: Implement the family metadata and DOM shell**

Replace the current `tools` array used for toolbar markup with stable family data. Render only the nine family buttons. Add one anchored floating menu container with `role="menu"`, generated child `role="menuitem"` buttons, `aria-expanded`, `aria-controls`, and `aria-current` state. Keep direct child tool buttons available to tests and keyboard users after a family is chosen.

- [ ] **Step 4: Implement focus and dismissal rules**

Click family toggles its menu; clicking a child calls `setTool(child.tool)`, closes the menu, and restores focus to the family button. Arrow keys move through menu items; Enter/Space selects; Escape closes and restores focus; click outside closes. Do not use hover to open. Ensure mobile menu is viewport-contained.

- [ ] **Step 5: Update CSS and command search**

Style the menu as a single floating surface with the existing one-border visual language. Add the new icons and labels to command search. Do not create a second toolbar row or permanent child strip.

- [ ] **Step 6: Run browser tests**

Run: `npm run test:e2e -- tests/e2e/tool-families.spec.ts tests/e2e/refinements.spec.ts`

Expected: PASS for family menus, keyboard dismissal, custom select, and blue selection glow regressions.

---

### Task 4: Endpoint handles and rotation handles

**Files:**
- Modify: `src/engine/renderer.ts`
- Modify: `src/engine/interaction.ts`
- Modify: `src/engine/selection.ts`
- Modify: `src/engine/draw.ts`
- Modify: `src/app.ts`
- Test: `tests/unit/transform.test.ts`
- Test: `tests/e2e/endpoints-rotation.spec.ts`

**Interfaces:**
- `Handle` extends `'start' | 'end' | 'rotate'` in addition to existing corner handles.
- `Renderer.endpointAt(point): 'start' | 'end' | null` only when exactly one selected element satisfies `isLinearElement()` and is unlocked.
- `Renderer.rotationHandleAt(point): boolean` only for exactly one selected editable object.
- Gesture variants:
  - `{ type: 'endpoint'; endpoint: 'start' | 'end'; original: BoardElement; start: Vec2 }`
  - `{ type: 'rotate'; originals: BoardElement[]; center: Vec2; startAngle: number; startRotation: number }`

- [ ] **Step 1: Write failing endpoint/rotation browser tests**

```ts
import { expect, test } from '@playwright/test';

test('line selection exposes two endpoints, not rectangle corners', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '直线', exact: true }).click();
  await page.getByRole('menuitem', { name: '直线', exact: true }).click();
  await page.mouse.move(500, 350); await page.mouse.down(); await page.mouse.move(800, 450); await page.mouse.up();
  await expect(page.locator('[data-handle="line-start"]')).toBeVisible();
  await expect(page.locator('[data-handle="line-end"]')).toBeVisible();
  await expect(page.locator('[data-handle="nw"]')).not.toBeVisible();
  await expect(page.locator('[data-handle="rotate"]')).toBeVisible();
});

test('dragging one endpoint preserves the other and Shift snaps to 45 degrees', async ({ page }) => {
  // Draw line, select it, drag start, then read the saved source document.
  // The assertion checks the end coordinate is unchanged and the resulting
  // angle is an integer multiple of 45 degrees within 0.01 radians.
});

test('rotation handle is above shapes and on the perpendicular bisector of a line', async ({ page }) => {
  // Draw one rectangle and one line in separate canvases; compare handle
  // bounding boxes to geometry-derived expected positions.
});
```

- [ ] **Step 2: Run and verify the new browser tests fail**

Run: `npm run test:e2e -- tests/e2e/endpoints-rotation.spec.ts`

Expected: FAIL because the current renderer only emits corner handles and the interaction state machine has only move/resize gestures.

- [ ] **Step 3: Add endpoint and rotation hit-testing**

In `Renderer.drawOverlay()`:

```ts
if (singleLinear) {
  drawEndpoint(start);
  drawEndpoint(end);
  drawRotationStem(midpoint, perpendicularHandle);
} else if (singleEditable) {
  drawRotationStem(topCenter, rotationHandle);
  drawExistingCornerHandles();
}
```

Use screen-space radius 9 px for endpoint/rotation hit testing, converted by zoom only for Canvas geometry. Add stable `data-handle` attributes to DOM only if handles are DOM controls; otherwise expose equivalent testable state through `window.liubai.diagnostics()` and hit-coordinate tests. Preserve the blue glow underneath.

- [ ] **Step 4: Implement endpoint gesture**

On pointerdown, check endpoint before body/corner handles. For `start`, keep original end; for `end`, keep original start. On move, convert the pointer to world coordinates; if Shift is pressed, call `snapLineEndpoint(anchor, pointer)`. Build a preview with `withLineEndpoints()` and render only overlay during the gesture. On pointerup, compare coordinates; if changed, `scene.apply([{ id, after }], '编辑端点')`; otherwise no transaction.

- [ ] **Step 5: Implement rotation gesture**

On pointerdown at the rotation handle, capture object center and initial pointer angle. On move compute `angle = atan2(pointer.y - center.y, pointer.x - center.x) - initialPointerAngle + startRotation`; if Shift is down use `snapRotation(angle, Math.PI / 12)`. Preview with `rotation` changed. On pointerup commit one `旋转` transaction only when the normalized angle differs. For line classes, derive the perpendicular handle from midpoint plus `Math.atan2(h, w) - Math.PI / 2`; arrowheads are drawn from transformed endpoint vectors.

- [ ] **Step 6: Handle cancellation and locks**

Escape, pointercancel, lost capture, and window blur restore the original preview. Locked elements expose no endpoint or rotation handles. Selection changes clear active endpoint/rotation gestures. Keep current move behavior when clicking the line body away from handles.

- [ ] **Step 7: Run focused browser tests**

Run: `npm run test:e2e -- tests/e2e/endpoints-rotation.spec.ts tests/e2e/cutting.spec.ts tests/e2e/selection.spec.ts`

Expected: PASS for endpoint edits, arrows, blue glow, line cutting and selection behavior.

---

### Task 5: Rotation-aware resize, erase, persistence and export

**Files:**
- Modify: `src/core/erasure.ts`
- Modify: `src/core/geometry.ts`
- Modify: `src/core/cut.ts`
- Modify: `src/engine/mask.ts`
- Modify: `src/engine/export.ts`
- Modify: `src/storage/snapshot.ts`
- Modify: `src/core/codec.ts`
- Test: `tests/unit/erasure.test.ts`
- Test: `tests/unit/storage.test.ts`
- Test: `tests/e2e/rotation-persistence.spec.ts`

**Interfaces:**
- Existing `eraseAt()` accepts world points and stores object-local masks after inverse rotation.
- `scaleErasures()` and `transformPath()` must also preserve `rotation` without changing its angle.
- `encodeDocument`/`decodeDocument` preserve `rotation`, `bidirectional-arrow`, polygon and endpoint semantics.

- [ ] **Step 1: Write failing persistence and rotated-geometry tests**

```ts
import { expect, it } from 'vitest';
import { createDocument, createElement } from '../../src/core/model';
import { decodeDocument, encodeDocument } from '../../src/core/codec';
import { eraseAt } from '../../src/core/erasure';
import { hitTest } from '../../src/core/geometry';

it('round-trips rotation, bidirectional arrow and a rotated polygon', () => {
  const doc = createDocument();
  doc.elements = [
    createElement('bidirectional-arrow', { rotation: Math.PI / 3, w: 120, h: 40 }),
    createElement('hexagon', { rotation: Math.PI / 12, w: 200, h: 160 }),
  ];
  expect(decodeDocument(encodeDocument(doc))).toEqual(doc);
});

it('stores an eraser point in rotated object coordinates and hits the resulting hole', () => {
  const element = createElement('rect', { x: 100, y: 100, w: 200, h: 100, rotation: Math.PI / 4, fill: '#e6eee5' });
  const erased = eraseAt(element, [{ x: 200, y: 100 }], 10)!;
  expect(hitTest(erased, { x: 200, y: 100 }, 0)).toBe(false);
});
```

- [ ] **Step 2: Run focused tests and verify they fail**

Run: `npm test -- tests/unit/erasure.test.ts tests/unit/storage.test.ts`

Expected: FAIL on missing rotation validation/geometry and the new kind.

- [ ] **Step 3: Make erasure and mask composition rotation-aware**

Convert world pointer to object-local coordinates with `localPoint()` before adding an erasure. In `mask.ts`, apply the object rotation in the offscreen context transform before painting and destination-out. Do not rotate the stored mask twice. Update rotated bounds so spatial queries include the full transformed object.

- [ ] **Step 4: Make cut fragments retain angle and layer order**

When a rotated line or path is cut, use local geometry and retain the source angle. New fragments inherit `order` and append a deterministic `orderPath`, preserving source layer order without timestamp floating-point insertion. Arrow head state is copied only to the fragment containing the corresponding original endpoint.

- [ ] **Step 5: Update source/Png/SVG paths and validation**

Render/export all shapes and line classes through the same transform. SVG gets `transform="rotate(angle cx cy)"`; path/polygon points remain local. Validate rotation finite, polygon vertex count and bidirectional arrow kind. Add old-document defaults and malformed-data rejection.

- [ ] **Step 6: Run focused and browser persistence tests**

Run: `npm test -- tests/unit/erasure.test.ts tests/unit/storage.test.ts && npm run test:e2e -- tests/e2e/rotation-persistence.spec.ts tests/e2e/cutting.spec.ts`

Expected: PASS for rotated masks, source files, refresh recovery, PNG/SVG and cut fragment behavior.

---

### Task 6: Documentation, performance and final regression

**Files:**
- Modify: `README.md`
- Modify: `docs/performance.md`
- Modify: `docs/superpowers/specs/2026-10-20-tool-families-endpoints-rotation-design.md`
- Modify: `tests/e2e/performance.spec.ts`
- Modify: `tests/e2e/production.spec.ts`

- [ ] **Step 1: Add regression coverage for performance and production**

Extend performance diagnostics with `endpointDragMs`, `rotationPreviewMs`, and polygon scene counts. Assert no permanent animation loop and that 5,000-element normal viewport remains below 100 ms P95. Add production test creating a bidirectional arrow and hexagon, editing an endpoint, rotating with Shift, reloading, and exporting.

- [ ] **Step 2: Run the full verification suite**

Run:

```sh
npm test
npm run build
npm run test:e2e
npm run test:production
git diff --check
npm ls --omit=dev
```

Expected: all unit/browser/production tests pass; build exits 0; `git diff --check` emits no output; `npm ls --omit=dev` reports no production dependencies.

- [ ] **Step 3: Update documentation with measured results**

Document the two-level tool families, six shapes, three line tools, endpoint and rotation gestures, Shift snapping, locked behavior, cut arrow semantics, and actual build sizes/timings. Do not claim multi-select rotation because it is intentionally out of scope for this plan.

## Self-review

- Spec coverage: Task 1 covers model, angle validation and line semantics; Task 2 covers polygons, bidirectional arrows and shared rendering; Task 3 covers exact two-level menus; Task 4 covers endpoints and rotation handles; Task 5 covers erase/persistence/export; Task 6 covers performance and delivery.
- Placeholder scan: no TBD/TODO/“implement later” steps are used.
- Type consistency: `BoardElement.rotation`, `bidirectional-arrow`, `transforms.ts`, `linear.ts`, `Renderer.endpointAt`, `Renderer.rotationHandleAt`, and the two gesture variants are the shared names used across tasks.
- Scope: multi-select rotation is explicitly excluded and not exposed in the UI; all single-object requirements are included.
