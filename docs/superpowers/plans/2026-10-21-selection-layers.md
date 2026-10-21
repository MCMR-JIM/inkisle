# Selection layers implementation

**Goal:** Keep selection and edit previews at their existing layer and support stable single-step ordering.

- [x] Trace overlay repaint lifting selected content above unrelated objects.
- [x] Add kernel tests for adjacent steps, stable multi-selection runs, top/bottom, boundaries, locks and split ranks; add real-browser occlusion/opacity regressions.
- [x] Extract `core/layers.ts`, permute exact ranks and wire four actions to buttons, context menu and configurable shortcuts.
- [x] Make SelectionGlow halo-only and composite selected/preview content in sorted viewport order over an opaque interaction base.
- [x] Expand browser coverage for multiple selection intervals, erasure holes, resizing and persistence; measure selected-preview frames.
- [x] Run unit/type/build/browser/production verification and update documentation with exact results.

## Verification

- `npm test`: 168 tests passed (16 files).
- `npm run build`: strict TypeScript checking and Vite production build passed.
- `npm run test:e2e`: 123 browser functional/performance tests passed, including eight layer-specific regressions.
- `npm run test:production`: 13 tests passed against `dist`, including selected/dragged lower-layer occlusion, step shortcuts and reload persistence.
- 5,000-object benchmark (72 viewport objects), selected layered preview P95: approximately 1.3 ms in local headless Edge, DPR 1, 1440 × 960. This measures JavaScript/Canvas calls rather than GPU completion.
- Layer controls fit 1440/390/320 px viewports in light and dark themes; mechanical UI detector returned no findings for the changed targets.
