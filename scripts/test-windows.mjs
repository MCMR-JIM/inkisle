import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, readFile, cp, stat, writeFile } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, expect } from '@playwright/test';
import { createServer } from 'node:net';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = join(root, '.cache', 'windows', `smoke-${randomUUID()}`);
await mkdir(output, { recursive: true });
const results = [], tracked = new Set();
const delay = ms => new Promise(res => setTimeout(res, ms));
async function waitFor(predicate, name, timeout = 30000) {
  const start = Date.now(); let failure;
  while (Date.now() - start < timeout) {
    try { const result = await predicate(); if (result) return result; } catch (error) { failure = error; }
    await delay(100);
  }
  throw new Error(`Timed out: ${name}${failure ? ` (${failure.message})` : ''}`);
}
async function freePort() {
  const server = createServer(); await new Promise(res => server.listen(0, '127.0.0.1', res));
  const port = server.address().port; await new Promise(res => server.close(res)); return port;
}
async function processExit(child, timeout = 20000) {
  if (child.exitCode !== null) return child.exitCode;
  const exit = once(child, 'exit');
  const timer = setTimeout(() => child.kill(), timeout);
  try { const [code] = await exit; return code; } finally { clearTimeout(timer); }
}
async function launch(mode, profile, existingDir) {
  const port = await freePort(), directory = existingDir || join(root, 'release', `InkIsle-win-x64-${mode}`);
  // Deliberately use a different current directory and no dev-server URL.
  const child = spawn(join(directory, 'InkIsle.exe'), ['--test-port', String(port), '--data-dir', profile], { cwd: output, stdio: ['ignore', 'pipe', 'pipe'] });
  let diagnostics = ''; child.stdout.on('data', b => { diagnostics += b; }); child.stderr.on('data', b => { diagnostics += b; });
  tracked.add(child); child.once('exit', () => tracked.delete(child));
  await waitFor(async () => {
    if (child.exitCode !== null) {
      let log = ''; try { log = await readFile(join(profile, 'logs', 'desktop.log'), 'utf8'); } catch {}
      throw new Error(`Native process exited ${child.exitCode}: ${log}\n${diagnostics}`);
    }
    const response = await fetch(`http://127.0.0.1:${port}/json/version`); return response.ok;
  }, `native ${mode} debugging endpoint`);
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  const context = browser.contexts()[0];
  const page = await waitFor(() => context.pages().find(page => page.url().startsWith('https://liubai.localhost/')), 'mapped application page');
  const display = await context.newCDPSession(page);
  await display.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 960, deviceScaleFactor: 1, mobile: false });
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await expect(page.locator('#save-status')).toContainText('已保存在本机', { timeout: 20000 });
  return { child, browser, context, page, errors, profile, diagnostics: () => diagnostics };
}
async function close(app) {
  const exiting = processExit(app.child);
  await app.page.evaluate(() => window.chrome.webview.postMessage('liubai:test-close')).catch(() => {});
  await waitFor(() => app.page.isClosed(), 'WebView controller destroyed');
  await app.browser.close().catch(() => {});
  assert.equal(await exiting, 0, 'Native X close should flush and exit successfully');
}
async function choose(page, family, tool) {
  const button = page.locator(`[data-family="${family}"]`);
  if (tool) { const menu = page.locator(`#tool-menu-${family}`); if (!await menu.isVisible()) await button.click(); await page.locator(`[data-tool-child="${tool}"]`).click(); }
  else await button.click();
}
async function drag(page, x1, y1, x2, y2) {
  await page.mouse.move(x1, y1); await page.mouse.down(); await page.mouse.move(x2, y2, { steps: 5 }); await page.mouse.up();
}
async function checkExit(exe, expected, profile) {
  const child = spawn(exe, ['--check', '--data-dir', profile], { cwd: output, stdio: 'ignore' });
  assert.equal(await processExit(child), expected);
}
async function hash(path) { const h = createHash('sha256'); for await (const chunk of createReadStream(path)) h.update(chunk); return h.digest('hex'); }
async function checkIcon(app, mode) {
  const child = spawn(join(root, '.cache', 'windows', 'verify-icon.exe'), [join(root, 'release', `InkIsle-win-x64-${mode}`, 'InkIsle.exe'), String(app.child.pid)], { stdio: 'inherit' });
  assert.equal(await processExit(child), 0, `${mode} embedded and live window icons`);
}
async function saveDialog(app, path, trigger) {
  const helper = spawn(join(root, '.cache', 'windows', 'verify-save-dialog.exe'), [String(app.child.pid), path], { stdio: 'inherit' });
  const exited = processExit(helper, 25000);
  await trigger(); assert.equal(await exited, 0, 'Real Win32 Save As dialog');
  await waitFor(async () => (await stat(path)).size > 0, `saved ${path}`);
}

try {
  for (const mode of ['lite', 'offline']) {
    const dir = join(root, 'release', `InkIsle-win-x64-${mode}`);
    const manifest = JSON.parse(await readFile(join(dir, 'build-manifest.json'), 'utf8'));
    for (const entry of manifest.files) {
      const file = join(dir, ...entry.path.split('/'));
      assert.equal((await stat(file)).size, entry.bytes); assert.equal(await hash(file), entry.sha256, `${mode}/${entry.path}`);
    }
    await checkExit(join(dir, 'InkIsle.exe'), 0, join(output, `check-${mode}`));
    results.push({ check: `${mode} manifest hashes + native runtime preflight`, files: manifest.files.length });
  }

  const sharedProfile = join(output, 'shared-profile');
  let app = await launch('lite', sharedProfile);
  await checkIcon(app, 'lite');
  await expect(app.page.locator('#element-count')).toHaveText('21 个元素');
  assert.equal(await app.page.evaluate(() => isSecureContext), true);
  await app.page.locator('#quick-new').click(); await choose(app.page, 'shapes', 'rect');
  await drag(app.page, 480, 300, 760, 510); await expect(app.page.locator('#element-count')).toHaveText('1 个元素');
  // Change an input and close immediately, before its debounced 180ms write.
  await app.page.locator('#board-title').fill('Windows 原生立即关闭保存'); await app.page.locator('#board-title').dispatchEvent('change');
  assert.deepEqual(app.errors, []); await close(app);
  results.push({ check: 'lite actual native window, secure virtual origin, drawing, immediate X-close save', passed: true });

  app = await launch('offline', sharedProfile);
  await checkIcon(app, 'offline');
  await expect(app.page.locator('#element-count')).toHaveText('1 个元素');
  await expect(app.page.locator('#board-title')).toHaveValue('Windows 原生立即关闭保存');
  const session = await app.context.newCDPSession(app.page);
  const { arguments: commandLine } = await session.send('Browser.getBrowserCommandLine');
  assert.ok(commandLine[0].toLowerCase().includes('inkisle-win-x64-offline\\runtime\\msedgewebview2.exe'), commandLine[0]);
  const external = [];
  await app.context.route('**/*', async route => {
    const url = route.request().url();
    if (/^https?:/.test(url) && !url.startsWith('https://liubai.localhost/')) { external.push(url); await route.abort(); }
    else await route.continue();
  });
  await session.send('Network.enable'); await session.send('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
  await app.page.reload(); await expect(app.page.locator('#save-status')).toContainText('已保存在本机');
  await choose(app.page, 'eraser'); await drag(app.page, 620, 270, 620, 550);
  await expect(app.page.locator('#element-count')).toHaveText('2 个元素');
  assert.ok(app.context.pages().length === 1);
  const workerUrls = app.page.workers().map(worker => worker.url());
  assert.ok(workerUrls.some(url => url.includes('cutter.worker')), JSON.stringify(workerUrls));
  await app.page.keyboard.press('Escape'); await app.page.mouse.click(1100, 650);

  const downloads = join(output, 'downloads'); await mkdir(downloads);
  // Playwright CDP attachment changes the actual WebView browser context's
  // download policy, bypassing DownloadStarting. Restore it to exercise the
  // same native Save As flow used in ordinary, non-debug desktop launches.
  const { targetInfos } = await session.send('Target.getTargets');
  const browserContextId = targetInfos.find(target => target.url.startsWith('https://liubai.localhost/')).browserContextId;
  await session.send('Browser.setDownloadBehavior', { behavior: 'default', browserContextId });
  const source = join(downloads, '原生保存往返.inkisle');
  await saveDialog(app, source, () => app.page.keyboard.press('Control+s'));
  await app.page.locator('#import-file').setInputFiles(source);
  await expect(app.page.locator('#toast')).toContainText('画板已导入');
  await expect(app.page.locator('#element-count')).toHaveText('2 个元素');
  for (const extension of ['png', 'svg']) {
    await app.page.locator('#export-button').click();
    await saveDialog(app, join(downloads, `原生导出.${extension}`), () => app.page.locator(`[data-action="export-${extension}"]`).click());
  }
  assert.deepEqual(app.errors, []); assert.deepEqual(external, []);
  await close(app);
  results.push({ check: 'fixed runtime path, offline reload, shared edition data, cutter Worker, .inkisle roundtrip, PNG/SVG downloads', passed: true, workerUrls });

  app = await launch('offline', sharedProfile);
  await expect(app.page.locator('#element-count')).toHaveText('2 个元素');
  await close(app); results.push({ check: 'offline restart persistence', passed: true });

  const missing = join(output, 'missing-parts'); await mkdir(missing);
  await cp(join(root, 'release', 'InkIsle-win-x64-offline', 'InkIsle.exe'), join(missing, 'InkIsle.exe'));
  await cp(join(root, 'release', 'InkIsle-win-x64-offline', 'WebView2Loader.dll'), join(missing, 'WebView2Loader.dll'));
  await checkExit(join(missing, 'InkIsle.exe'), 11, join(output, 'missing-resources-profile'));
  await cp(join(root, 'dist'), join(missing, 'resources'), { recursive: true });
  await checkExit(join(missing, 'InkIsle.exe'), 12, join(output, 'missing-runtime-profile'));
  results.push({ check: 'missing resources and missing fixed runtime deterministic failure (no system fallback)', passed: true });

  await writeFile(join(root, 'release', 'inkisle-windows-verification.json'), JSON.stringify({ testedAt: new Date().toISOString(), platform: process.platform, osVersion: (await import('node:os')).release(), profileDirectory: output, results }, null, 2));
  console.log(JSON.stringify({ results, output }, null, 2));
} finally {
  for (const child of tracked) child.kill();
}
