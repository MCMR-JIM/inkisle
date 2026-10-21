import { createHash } from 'node:crypto';
import { cp, mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { spawn } from 'node:child_process';
import { dirname, join, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateWindowsIcon } from './windows-icon.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const cache = join(root, '.cache', 'windows'), release = join(root, 'release');
const native = join(root, 'desktop', 'windows');
const dependencies = JSON.parse(await readFile(join(native, 'dependencies.json'), 'utf8'));
const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
const modes = process.argv.slice(2);
if (process.platform !== 'win32') throw new Error('Windows packaging requires Windows + MinGW-w64 (gcc, windres, objdump).');
if (!modes.length || modes.some(mode => !['lite', 'offline'].includes(mode))) throw new Error('Usage: node scripts/package-windows.mjs lite [offline]');

async function run(command, args, options = {}) {
  return new Promise((res, reject) => {
    const child = spawn(command, args, { cwd: root, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, ...options });
    let output = ''; child.stdout.on('data', data => { output += data; if (options.live) process.stdout.write(data); });
    child.stderr.on('data', data => { output += data; if (options.live) process.stderr.write(data); });
    child.on('error', reject); child.on('exit', code => code === 0 ? res(output) : reject(new Error(`${command} failed (${code}):\n${output}`)));
  });
}
async function exists(path) { try { await stat(path); return true; } catch { return false; } }
async function hash(path) { const h = createHash('sha256'); for await (const chunk of createReadStream(path)) h.update(chunk); return h.digest('hex'); }
async function download(spec, filename) {
  const file = join(root, '.cache', filename);
  if (await exists(file) && await hash(file) === spec.sha256) return file;
  console.log(`Downloading official Microsoft dependency: ${spec.version}`);
  const temp = `${file}.partial`;
  await run('curl.exe', ['--fail', '--location', '--retry', '3', '--output', temp, spec.url]);
  if (await hash(temp) !== spec.sha256) throw new Error(`SHA-256 mismatch: ${filename}. Refusing this dependency.`);
  await rename(temp, file); return file;
}
async function files(directory) {
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) result.push(...await files(path));
    else if (entry.isFile()) result.push(path);
    else throw new Error(`Unexpected symbolic link in package: ${path}`);
  }
  return result.sort();
}
async function dependenciesOf(path) {
  const text = await run(process.env.OBJDUMP || 'objdump', ['-p', path]);
  return [...text.matchAll(/DLL Name:\s*(\S+)/g)].map(match => match[1]);
}
async function auditHost(path) {
  const dlls = await dependenciesOf(path);
  for (const dll of dlls) {
    if (!/^(kernel32|user32|gdi32|msvcrt|ucrtbase|ole32|oleaut32|shell32|shlwapi|advapi32|comctl32|comdlg32|version|rpcrt4|ntdll)\.dll$/i.test(dll) && !/^api-ms-win-/i.test(dll)) throw new Error(`Non-system native dependency: ${dll} in ${path}`);
  }
  return dlls;
}
function x64PE(buffer, file) {
  if (buffer.readUInt16LE(0) !== 0x5a4d) throw new Error(`Not a PE binary: ${file}`);
  const offset = buffer.readUInt32LE(0x3c);
  if (buffer.readUInt32LE(offset) !== 0x4550 || buffer.readUInt16LE(offset + 4) !== 0x8664) throw new Error(`Not x64: ${file}`);
}
async function prepareSDK() {
  const archive = await download(dependencies.sdk, `webview2-sdk-${dependencies.sdk.version}.zip`);
  const dir = join(cache, `sdk-${dependencies.sdk.version}`), marker = join(dir, 'build', 'native', 'include', 'WebView2.h');
  if (!await exists(marker)) { await mkdir(dir, { recursive: true }); await run('tar.exe', ['-xf', archive, '-C', dir]); }
  return dir;
}
async function prepareRuntime() {
  const provided = process.env.INKISLE_WEBVIEW2_RUNTIME || process.env.LIUBAI_WEBVIEW2_RUNTIME;
  let dir = provided ? resolve(provided) : null;
  if (!dir) {
    const archive = await download(dependencies.runtime, `webview2-fixed-${dependencies.runtime.version}-x64.cab`);
    const extracted = join(cache, `fixed-${dependencies.runtime.version}`);
    await mkdir(extracted, { recursive: true });
    dir = join(extracted, `Microsoft.WebView2.FixedVersionRuntime.${dependencies.runtime.version}.x64`);
    if (!await exists(join(dir, 'msedgewebview2.exe'))) { console.log('Extracting fixed WebView2 runtime…'); await run('expand.exe', [archive, '-F:*', extracted]); }
  }
  for (const name of ['msedgewebview2.exe', 'msedge.dll', 'icudtl.dat', 'resources.pak', 'locales']) if (!await exists(join(dir, name))) throw new Error(`Incomplete fixed runtime: missing ${name} in ${dir}`);
  x64PE(await readFile(join(dir, 'msedgewebview2.exe')), dir);
  const signature = await run(process.env.PWSH || 'pwsh.exe', ['-NoProfile', '-Command', `$ErrorActionPreference = 'Stop'; $signature = Get-AuthenticodeSignature -LiteralPath '${join(dir, 'msedgewebview2.exe').replaceAll("'", "''")}'; if ($signature.Status -ne 'Valid' -or $signature.SignerCertificate.Subject -notmatch 'O=Microsoft Corporation') { throw "Invalid Microsoft runtime signature: $($signature.Status)" }; $signature.Status`]);
  // CAB integrity is pinned above. Local overrides are recorded by their actual
  // hashes and version and must be supplied by the builder, not silently fetched.
  return { dir, signature: signature.trim(), custom: !!provided };
}

await mkdir(cache, { recursive: true }); await mkdir(release, { recursive: true });
const sdk = await prepareSDK();
await run(process.execPath, ['node_modules/typescript/bin/tsc', '--noEmit'], { live: true });
await run(process.execPath, ['node_modules/vite/bin/vite.js', 'build'], { live: true });
const resourceObject = join(cache, 'app.o');
const iconSizes = await generateWindowsIcon(join(root, 'public', 'favicon.svg'), join(cache, 'inkisle.ico'));
await run(process.env.WINDRES || 'windres', ['--codepage=65001', '-I', native, '-I', cache, '-i', join(native, 'app.rc'), '-o', resourceObject]);
const iconVerifier = join(cache, 'verify-icon.exe');
await run(process.env.CC || 'gcc', ['-std=c17', '-O2', '-s', '-static', '-municode', join(native, 'verify-icon.c'), '-o', iconVerifier, '-lshell32', '-lgdi32']);
await run(process.env.CC || 'gcc', ['-std=c17', '-O2', '-s', '-static', '-municode', join(native, 'verify-save-dialog.c'), '-o', join(cache, 'verify-save-dialog.exe')]);
const runtimeInfo = modes.includes('offline') ? await prepareRuntime() : null;
const summaries = [];
for (const mode of modes) {
  const name = `InkIsle-win-x64-${mode}`, output = join(release, name);
  // Output directories are fixed project-owned names; never clean a user path.
  await rm(output, { recursive: true, force: true }); await mkdir(output, { recursive: true });
  const exe = join(output, 'InkIsle.exe');
  await run(process.env.CC || 'gcc', ['-std=c17', '-O2', '-s', '-static', '-static-libgcc', '-municode', '-mwindows', '-Wall', '-Wextra', '-Wno-unknown-pragmas', '-Wno-misleading-indentation', `-DINKISLE_OFFLINE=${mode === 'offline' ? 1 : 0}`, '-isystem', join(sdk, 'build', 'native', 'include'), join(native, 'main.c'), resourceObject, '-o', exe, '-lole32', '-luuid', '-lshell32', '-lshlwapi', '-lcomdlg32', '-ladvapi32', '-lcomctl32'], { live: true });
  const loader = join(output, 'WebView2Loader.dll');
  await run(iconVerifier, [exe]);
  await cp(join(sdk, 'build', 'native', 'x64', 'WebView2Loader.dll'), loader);
  await cp(join(root, 'dist'), join(output, 'resources'), { recursive: true });
  await mkdir(join(output, 'licenses'), { recursive: true });
  await cp(join(sdk, 'LICENSE.txt'), join(output, 'licenses', 'WebView2-SDK-LICENSE.txt'));
  await cp(join(sdk, 'NOTICE.txt'), join(output, 'licenses', 'WebView2-SDK-NOTICE.txt'));
  if (mode === 'offline') {
    console.log('Copying complete fixed runtime…');
    await cp(runtimeInfo.dir, join(output, 'runtime'), { recursive: true });
    await run('icacls.exe', [join(output, 'runtime'), '/grant', '*S-1-15-2-1:(OI)(CI)(RX)', '*S-1-15-2-2:(OI)(CI)(RX)']);
  }
  const imports = { exe: await auditHost(exe), loader: await auditHost(loader) };
  x64PE(await readFile(exe), exe); x64PE(await readFile(loader), loader);
  await writeFile(join(output, 'README.txt'), '\ufeff' + `墨屿 InkIsle ${pkg.version} · Windows 10/11 x64 · ${mode === 'offline' ? '离线绿色版' : '轻量版'}\r\n\r\n完整解压后双击 InkIsle.exe。不要单独移动 EXE，不需要管理员权限。\r\n${mode === 'offline' ? '随包携带固定 WebView2 Runtime；无需预装 WebView2，无需联网安装任何组件。保留完整 runtime 目录。' : '需要系统 Microsoft Edge WebView2 Runtime；缺少时有中文提示。可使用自带内核的离线版。'}\r\n无需 Node.js、.NET、VC++ Redistributable 或开发环境。\r\n\r\n画板与设置：%LOCALAPPDATA%\\Liubai\\WebView2（沿用旧目录以保留画板）\r\n日志：%LOCALAPPDATA%\\Liubai\\logs\\desktop.log\r\n两种版本共用数据，同一时间只打开一份。浏览器版数据可通过 .inkisle 文件转移，也支持导入旧 .liubai。\r\n绿色指免安装；复制程序到 U 盘不自动携带数据。\r\n导出 .inkisle、PNG、SVG 时选择保存位置。更新前关闭程序并保留用户数据目录。\r\n\r\nWebView2 官方说明：https://learn.microsoft.com/microsoft-edge/webview2/concepts/distribution\r\nWebView2 Runtime 下载：https://developer.microsoft.com/microsoft-edge/webview2/consumer/\r\n第三方许可见 licenses/ 及 runtime/ 中随附许可文件。\r\n`);
  const entries = [];
  for (const path of await files(output)) entries.push({ path: relative(output, path).replaceAll('\\', '/'), bytes: (await stat(path)).size, sha256: await hash(path) });
  const manifest = { application: pkg.name, version: pkg.version, architecture: 'x64', icon: { source: 'public/favicon.svg', sizes: iconSizes, sha256: await hash(join(cache, 'inkisle.ico')) }, runtimeMode: mode === 'offline' ? 'fixed' : 'evergreen', origin: 'https://liubai.localhost/', entry: 'https://liubai.localhost/index.html', sdk: dependencies.sdk, runtime: mode === 'offline' ? { ...dependencies.runtime, customSource: runtimeInfo.custom, signature: runtimeInfo.signature } : null, nativeImports: imports, files: entries };
  await writeFile(join(output, 'build-manifest.json'), JSON.stringify(manifest, null, 2));
  const zip = join(release, `${name}.zip`); await rm(zip, { force: true });
  console.log(`Compressing ${name}…`);
  await run('tar.exe', ['-a', '-cf', zip, '-C', release, name]);
  const bytes = (await stat(zip)).size, unpackedBytes = entries.reduce((total, entry) => total + entry.bytes, 0) + (await stat(join(output, 'build-manifest.json'))).size;
  const summary = { mode, directory: relative(root, output), zip: relative(root, zip), bytes, unpackedBytes, sha256: await hash(zip), nativeImports: imports };
  summaries.push(summary); console.log(JSON.stringify(summary, null, 2));
}
await writeFile(join(release, 'inkisle-windows-build-summary.json'), JSON.stringify(summaries, null, 2));
