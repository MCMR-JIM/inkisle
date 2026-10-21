# InkIsle rename and centered sidebar implementation

**Goal:** Apply the chosen InkIsle identity and `.inkisle` extension, center the style panel, and preserve every existing Windows release artifact.

## Tasks

- [x] Record release ZIP checksums; trace fixed side-panel offsets and name/extension references.
- [x] Add semantic product constants and compatibility tests before changing import/export, clipboard, persisted data or diagnostics.
- [x] Add viewport/selection/pressure/collapse regression tests; replace fixed sidebar offsets with centered, height-constrained layout and keep floating color controls synchronized.
- [x] Update visible frontend branding, project metadata, future native packaging/source labels and active documentation. Keep legacy persistence keys/origin and unchanged container format documented.
- [x] Run units, type checking, web build and browser/production regressions; address meaningful failures.
- [x] Verify all files in the existing release manifests and ZIP checksums remain unchanged. Do not generate another native package.

## Results

- `npm test`: 176 passed.
- `npm run build`: strict TypeScript and Vite Web build passed.
- `npm run test:e2e`: 129 passed, including new name/extension/legacy-data and centered-sidebar regressions.
- `npm run test:production`: 13 passed; new export suffix and `window.inkisle` work in bundled assets.
- Native C syntax checks passed for both `INKISLE_OFFLINE=0` and `=1` without compiling an executable; both packaging scripts pass `node --check`.
- Mechanical UI detector returned `[]` for the edited UI targets.
- Existing lite/offline ZIP hashes match the recorded values. All 11 lite and 267 offline original manifest files match their original SHA-256 values. No `InkIsle-*` native package exists.
