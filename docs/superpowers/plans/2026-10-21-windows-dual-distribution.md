# Windows Dual Distribution Implementation Plan

**Goal:** Deliver working Windows 10/11 x64 lightweight and self-contained offline ZIP distributions.

**Architecture:** A statically linked C Win32 host uses the official native WebView2 Loader. It maps `https://liubai.localhost/` to the installed resources without a web server and uses `%LOCALAPPDATA%\Liubai\WebView2` for both editions. The offline executable requires its adjacent fixed runtime; the lite executable checks the installed runtime. A Node build-time script fetches and verifies pinned SDK assets, compiles with MinGW, copies Vite assets and packages both editions. No Node/.NET/compiler is needed by end users.

**Tech Stack:** C17, Win32/COM, WebView2 SDK, MinGW-w64 GCC, Vite, Node.js build scripts, PowerShell and Playwright verification.

## Global Constraints

- Windows 10/11 x64; use only OS DLLs plus the supplied WebView2 Loader in the native host.
- Build and ship both editions; offline must fail clearly when its fixed runtime is missing rather than silently falling back to an installed runtime.
- Retain whiteboard features and file format. Keep data outside release folders and use a stable HTTPS origin across editions/upgrades.
- Do not install a runtime, require elevation or download anything at application startup.
- Report actual measured package sizes and actual tested OS; do not claim clean-machine verification without a clean machine.
- Implementation proceeds in the existing workspace: the repository is unborn and contains all existing application files as untracked work. Do not commit, discard or isolate away that work.

## Task 1 — Reproducible native host

Files: `desktop/windows/main.c`, `desktop/windows/app.manifest`, `desktop/windows/app.rc`, `scripts/package-windows.mjs`, `desktop/windows/dependencies.json`.

- [x] Pin the official WebView2 SDK URL and checksum; obtain the x64 loader and C headers.
- [x] Create the C Win32 host, COM callbacks, local virtual host mapping, stable user profile and precise startup errors.
- [x] Compile using `gcc -std=c17 -O2 -s -static -static-libgcc -municode -mwindows`; inspect `objdump -p` imports and reject non-system dependencies except the packaged WebView2 Loader.
- [x] Add missing-runtime, resource-directory and isolated-data-directory diagnostics for automated verification.

## Task 2 — Desktop lifecycle and packaging

Files: `src/desktop.ts`, `src/main.ts`, `src/app.ts`, `tests/unit/desktop.test.ts`, `scripts/package-windows.mjs`, `package.json`, `.gitignore`.

- [x] Test the desktop shutdown message path and preservation of web startup.
- [x] On native close request settle geometry, finish editing and flush pending IndexedDB writes before acknowledging close; retain the window and show the existing save error if flushing fails.
- [x] Keep native navigation restricted to the local application. Preserve file chooser and browser download workflows.
- [x] Add `npm run package:win:lite`, `npm run package:win:offline` and `npm run package:win` commands. Produce EXE, resources, official loader, Logo, manifest, usage/license notices and ZIP archives in `release/`.
- [x] Offline mode copies a verified complete fixed runtime, retaining Microsoft license files and applying required Windows 10 AppContainer read permissions using user-level ACL changes.

## Task 3 — Actual artifacts and verification

Files: `scripts/test-windows.mjs`, `tests/e2e/desktop.spec.ts` (if browser fixture is appropriate), `docs/windows.md`, `README.md`.

- [x] Build both artifacts with the current production frontend and record hashes/sizes.
- [x] Launch the real native host with an isolated profile and local debugging endpoint for Playwright CDP checks; do not expose a debugging endpoint during normal launches.
- [x] Verify example startup, drawing, file workflows, Worker activity, immediate-close saving, reopening and shared-edition persistence. Verify missing fixed runtime and missing resources fail with deterministic diagnostics.
- [x] Test offline behavior by blocking external HTTP requests in the native WebView and confirm fixed runtime process paths.
- [x] Run unit tests, production build and impacted production/browser tests. Inspect packaged PE dependencies, Logo resources and package integrity.
- [x] Document startup, actual sizes, data paths, reproducible commands, dependencies of each edition and exact platform testing limitations.

## Final verification

- `npm run package:win`: generated and audited both distributions with embedded nine-size Logo.
- `npm run test:windows`: passed real Win32/WebView2 startup, icon extraction/live icon handles, shared profile and shutdown saving, fixed browser path, CDP offline reload, geometry Worker, actual Win32 Save As dialogs, `.liubai` import/export and PNG/SVG saves, and deterministic incomplete-package failure.
- `npm test`: 172 tests passed.
- `npm run test:e2e`: 123 tests passed.
- `npm run test:production`: 13 tests passed.
- Native testing ran on Windows 11 x64, build 26200; Windows 10 and a clean OS without installed runtimes remain untested.
- Final ZIP sizes: lite 223,461 bytes; offline 311,578,028 bytes. Detailed SHA-256 and file manifests are under `release/`.
