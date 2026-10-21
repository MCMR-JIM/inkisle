# Fill switch implementation

**Goal:** Separate whether an object is filled from which color is selected.

**Architecture:** Keep `fill` as the rendered value and introduce optional `fillColor` for remembered color. Pure fill helpers create patches; App applies per-object patches as one transaction and persists drawing defaults. Fill palette contains only colors and migrates legacy transparent slots.

- [x] Write failing kernel/browser acceptance tests for colored presets, migration, independent switching, disabled selection, object recall, undo and persistence.
- [x] Add pure fill helpers, optional validated file field and palette migration.
- [x] Add title-row switch, bind per-object fill/remembered-color changes and drawing defaults; remove no-fill palette action.
- [x] Adapt existing drawing tests to explicit filling and verify kernel, browser, production and build outputs.

## Verification

- Unit tests: 160 passed, including off/on fill patches, old palette migration, remembered-color source-file round-trip and invalid remembered-color rejection.
- Development browser tests: 108 passed. New scenarios verify disabled selection/editing, normal preset selection from the picker, individual and multi-object memory, undo/redo, locked objects, transparent notes without header residue, source import and 320px light/dark controls.
- Production tests: 11 passed, including fill off/on and source-file recovery.
- Strict TypeScript and production bundle passed; UI detector returned no findings.
- Rendering/cutting/export keep using the effective `fill`; `fillColor` only retains the user's selected color. Palette color edits do not enable filling automatically.
