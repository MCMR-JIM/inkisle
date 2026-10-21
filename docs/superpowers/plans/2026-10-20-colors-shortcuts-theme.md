# Colors, shortcuts and dark theme plan

**Goal:** Add a five-column palette with custom colors, bidirectional stroke cycling and legible dark UI; remove command search.

**Architecture:** Keep style/history changes in App. A focused ColorPicker component owns draft HEX/native color, popover focus and cancel/commit; shared pure color helpers normalize values, choose a readable mark and cycle presets. Theme foreground is driven by CSS variables.

**Constraints:** No runtime dependencies; preserve input/dialog keyboard navigation and existing Chinese visual identity. No Git commits requested.

- [x] Write failing browser acceptance tests for shortcut cycles, selection history, picker commit/cancel, ten square swatches in five columns, dark contrast and removed search.
- [x] Add `src/core/colors.ts` and `src/ui/color-picker.ts`; update palette markup/constants and App style synchronization.
- [x] Intercept unmodified Tab in the main workspace; retain editor/dialog/picker exceptions.
- [x] Add `src/core/shortcuts.ts` and `src/ui/shortcut-settings.ts`: shared configurable action map, key recording, conflicts, clearing, cancellation, defaults, local preference and live toolbar hints. Validate swapped bindings on reload.
- [x] Correct root theme foreground and hardcoded UI label/icon colors; make swatches responsive squares and preserve small-screen layout.
- [x] Remove command search markup, event handlers, command definitions, CSS and documentation references; adapt the existing search smoke test.
- [x] Run focused tests, full unit/browser checks, production build and production browser checks; document exact results.

## Verification (2026-10-20)

- `npm test`: 155 passed.
- `npm run test:e2e`: 79 passed.
- `npm run build`: strict types and production bundle passed.
- `npm run test:production`: 7 passed, including custom fill and rebound color shortcut across reload.
- UI detector: no findings; desktop/mobile light/dark palette and settings dimensions checked; active control/menu text contrast checked against 4.5:1.
- Draft HEX/native color changes apply once; invalid HEX is rejected, cancellation preserves the previous color. Main-workspace Tab cycles only stroke colors while input and dialog navigation remain normal.

## Self-rendered palette revision

The native picker was replaced at the user's request with custom HSV field/hue controls and a color preview. `hexToHSV` and `hsvToHex` in `src/core/colors.ts` provide deterministic conversions and retain the hue of gray colors. Pointer capture supports drags outside the control, while arrow keys and Shift steps offer keyboard adjustment. Draft, validation, Apply and Cancel still use the existing single-edit semantics.

The popover's left edge is `#properties.getBoundingClientRect().right` and its top is the same panel's top. Width shrinks to available right-side space; short screens use internal scrolling. Resize updates the position without discarding the color draft. Browser coverage includes both palettes at 1440, 1024, 390 and 320 px, hue/field/HEX sync, out-of-bounds drag clamping, theme changes, undo and persistence. The production smoke test exercises the custom hue control and docked positioning.

Revision verification: 156 unit tests and 83 browser tests passed; after stabilizing half-byte HSV rounding, all 156 unit tests, 11 focused color/shortcut browser tests and all 7 production tests passed again. Strict type checking and production build passed. UI detector reported no findings.

## Screen sampler and editable presets

- Added a screen eyedropper to both self-rendered pickers. A user click opens EyeDropper immediately; success updates only the draft. Abort/cancel, unsupported browsers and failures preserve the previous color. Pending operations can be canceled, and closing the picker aborts/invalidates an in-flight result.
- Preset controls inside the picker select a replacement slot; double-clicking a main-panel swatch opens that slot directly. Apply updates the slot and style, Cancel leaves the preset untouched. Stroke/fill preferences are independent, validated and restored at startup. Tab cycling uses the current user palette. Restore defaults and a separate no-fill action remain available.
- Verification: `npm test` 157 passed, `npm run test:e2e` 88 passed, `npm run build` passed, `npm run test:production` 8 passed. UI detector returned no findings. Screen sampling tests simulate EyeDropper results; a real desktop-wide pick was not exercised by automation.

## Square sampler and workspace focus

- Added `src/ui/canvas-eyedropper.ts`: an application-owned 11 × 11 pixel patch rendered into a square magnifier, with the live HEX string below. It composites the scene/interaction canvases, accounts for DPR, excludes floating controls, keeps the preview in the viewport, and supports click/Enter selection and Escape/right-click cancellation. Cross-application screen sampling remains a separate native EyeDropper action.
- Added `src/ui/workspace-input.ts`: ordinary pointer-clicked buttons release focus; native Space/Enter activation is suppressed for ordinary buttons. Expanded comboboxes and shortcut recorders retain their own keyboard handling. Canvas pointerdown explicitly focuses the canvas after finishing an editor, and the Space pan handler accepts stale ordinary-button focus. Mouse choices in CustomSelect release focus; keyboard choices retain it.
- Added real-browser regressions for focus after toolbar/style/theme/select actions, Space drag camera deltas, text input spaces, square loupe/HEX coordinates, cancellation, viewport bounds and DPR 2 sampling. Production coverage exercises both the square sampler and focus behavior.
- Verification: `npm test` 157 passed; `npm run test:e2e` 95 passed; `npm run build` passed; `npm run test:production` 9 passed. The focused tests reproduced a zero camera delta and repeated native activation before the focus fix. UI detector returned no findings.

## Primary eyedropper entry correction

The user reported never seeing the square sampler. Live-page inspection confirmed the prominent HEX-adjacent eyedropper still dispatched the native screen mode, while the square sampler was a separate lower-priority button. The primary eyedropper now always starts the custom square canvas sampler; the secondary text button explicitly says screen / cross-application / system eyedropper. Unsupported native APIs never disable the primary sampler.

A new real-browser regression clicks the actual HEX-adjacent primary button for both stroke and fill, verifies the square/HEX display, and asserts that native EyeDropper was never called. It failed before the route correction and passed afterward. Final checks: 16 focused color/sampling/shortcut tests passed, all 9 production tests passed, strict TypeScript and production bundle passed, UI detector reported no findings. The running site on port 5173 was inspected and serves the corrected primary route and square sampler styles.

## System screen sampling removed

At the user's request, removed the secondary screen/system eyedropper button, native EyeDropper types and calls, feature-detection messages, mode branches and dedicated CSS. The HEX-adjacent square canvas sampler, live HEX preview, draft/apply/cancel and editable presets remain. Replaced native sampling tests with actual canvas sampling and preset-persistence coverage, and updated current documentation. Verification: 22 relevant browser regressions and all 9 production browser tests passed; strict TypeScript and production build passed; UI detector returned no findings.
