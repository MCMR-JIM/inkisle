# Pressure Ink Implementation Plan

> Execute inline with executing-plans; the user approved pressure plus mouse speed simulation.

**Goal:** Deliver true pen pressure and smooth mouse speed-dependent widths with consistent editing and export.

**Architecture:** Preserve pressure-tagged centerlines; share pure pressure sampling and ink geometry across Canvas, hit testing, cutting and SVG. Missing flags retain old equal-width behavior.

**Tech Stack:** TypeScript, Canvas 2D, Pointer Events, Vitest, Playwright; zero runtime dependencies.

## Global constraints

- Zoom 1%–2000%; existing Chinese visual language.
- Preserve old documents; no Git commits requested.
- Mouse speed measured in screen CSS px/ms; pen uses actual pressure; touch remains equal width.

## Completion evidence

Implemented inline on 2026-10-20. Input and persistence tests failed before implementation; browser tests failed before the switch/render path existed. Final verification: 149 unit tests, 72 development browser tests and 6 production browser tests passed; `npm run build` passed. UI mechanical detector returned no findings. Desktop/mobile light/dark pressure controls, coalesced events, zoom-independent mouse sampling, pen preview, persistence, file round-trip, PNG/SVG, dash gaps and resized cut fragments verified. 5000-point variable-pressure preview P95 was 12.8 ms in the full suite (14.4 ms in the focused pass). Physical stylus hardware has not been exercised.

The persisted flag is named `pressureEnabled` to distinguish it from numeric `Point.pressure`. Long ink is geometrically reduced before batch SVG-to-Path2D construction; this avoids repeated native arc copy-on-write costs while preserving shared Canvas/SVG geometry. Legacy tests now explicitly select objects before editing, matching sticky creation tools.

## Task 1: Input and geometry kernel

- [x] Add `tests/unit/ink.test.ts` for real pressure, zero pressure, velocity, duplicate timestamps, curved interpolation, pressure-aware simplification and hit testing; run `npm test -- tests/unit/ink.test.ts` and observe missing feature failure.
- [x] Add `src/core/pressure.ts` exporting stateful `PressureSampler` and `src/core/ink.ts` exporting smooth centerline, ink path commands, pressure-aware simplification and variable-width hit testing. Use a bounded diameter multiplier `.25 + .75 * pressure`, frame-independent exponential smoothing and screen-speed mapping.
- [x] Run the focused tests until passing.

## Task 2: Model, editing and persistence integration

- [x] Add regression tests to `tests/unit/ink.test.ts`: pressure flag and values round-trip, reject invalid flags, cut a varying-width line and verify cut pressure plus widths, resize preserves sample pressure.
- [x] Add optional pressure flag to `BoardElement` and `StrokePath` in `src/core/model.ts`. Validate in `src/core/codec.ts`, including path pressures.
- [x] Integrate smooth variable centerlines in `src/core/paths.ts`, preserve pressure in `mix`, path transformation and `src/core/cut.ts` local mappings; inherit flag in `src/core/clip.ts` fragments. Connect precise pen/path hit testing in `src/core/geometry.ts`.
- [x] Run `npm test` to verify kernel, storage, cutting and transforms.

## Task 3: Interaction, Canvas and SVG

- [x] Add `tests/e2e/pressure.spec.ts` synthetic timed Pointer Events plus pixel width comparisons, pen pressure peaks, mouse slow/fast, preview/commit parity, default switch, file restore and exports. Run `npx playwright test tests/e2e/pressure.spec.ts` before implementation.
- [x] In `src/engine/interaction.ts`, create a sampler per draw gesture, use coalesced events and timestamps, retain stationary pressure changes, append final coordinate without forced release-zero pressure, simplify retaining pressure changes.
- [x] In `src/engine/draw.ts`, fill a shared ink path once per pressure pen/stroke; cache by source points plus width/dash. In `src/engine/export.ts` export identical variable-width geometry as SVG paths.
- [x] Keep old equal-width paths unchanged. Update existing SVG test to accept new pressure path.

## Task 4: Settings and verification

- [x] Add native keyboard-operable pressure switch to `src/ui/shell.ts`, style consistently in `src/ui/styles.css`; bind preference/default and selected-pen edits in `src/app.ts`.
- [x] Verify browser tests, update README with true pen pressure and mouse speed, run `npm test`, `npm run build`, `npm run test:e2e`, `npm run test:production`.
- [x] Run UI detector once on changed UI files; inspect any findings. Measure 5000-point pressure previews in existing performance benchmark. Report test output and physical stylus verification limitation accurately.
