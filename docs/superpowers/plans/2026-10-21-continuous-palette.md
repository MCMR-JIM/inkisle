# Continuous palette implementation

**Goal:** Allow editing several linked presets in one open popover, with clean before/after controls and valid HEX recovery.

**Architecture:** ColorPicker manages one pending preset; App previews only in-memory palette/DOM, commits each item to preference/style once. A shared fixed tooltip layer replaces clipped pseudo-element and inline explanatory hints.

- [x] Add browser acceptance for live slot synchronization, committing on switching, scoped cancellation, HEX blur recovery, aligned controls and tooltips; observe failures before implementation.
- [x] Add App preview/commit palette callbacks and preserve unchanged style history. Rework picker draft selection/settlement and update controls without replacing focus targets.
- [x] Use a vertically split before/after swatch; remove redundant buttons/annotations; align row heights and normalize/recover HEX on blur.
- [x] Add shared viewport-aware tooltips, migrate palette/pressure descriptions and native title hints, preserve keyboard/pan behavior.
- [x] Adapt earlier acceptance tests to continuous-edit behavior, run type/build/unit/functional/production checks, update current documentation with exact evidence.

## Verification

The live-grid regression failed before implementation because edits were still draft-only and the selected preset did not carry a synchronized color. Final commands: Vitest 157 passed; Playwright development 101 passed; production 10 passed. Strict TypeScript and production bundle passed. UI detector returned no findings. Browser tests verify 34px row alignment, stacked comparison, 320px light/dark layouts, fixed tooltip visibility, multi-preset persistence, scoped rollback and a single selected-object history step per commit.
