import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { chromium } from '@playwright/test';

/** Rasterize the existing application logo, preserving its transparent corners.
 * PNG-backed ICO frames are supported by the Windows 10/11 shell at all sizes. */
export async function generateWindowsIcon(source, destination) {
  const svg = await readFile(source, 'utf8');
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const sizes = [16, 20, 24, 32, 40, 48, 64, 128, 256], images = [];
  try {
    const page = await browser.newPage({ deviceScaleFactor: 1 });
    await page.setContent(`<style>html,body{margin:0;width:100%;height:100%;overflow:hidden;background:transparent}svg{display:block;width:100%;height:100%}</style>${svg}`);
    for (const size of sizes) {
      await page.setViewportSize({ width: size, height: size });
      images.push(await page.screenshot({ type: 'png', omitBackground: true }));
    }
  } finally { await browser.close(); }
  const directory = Buffer.alloc(6 + sizes.length * 16);
  directory.writeUInt16LE(1, 2); directory.writeUInt16LE(sizes.length, 4);
  let offset = directory.length;
  for (let i = 0; i < sizes.length; i++) {
    const start = 6 + i * 16, size = sizes[i];
    directory[start] = directory[start + 1] = size === 256 ? 0 : size;
    directory.writeUInt16LE(1, start + 4); directory.writeUInt16LE(32, start + 6);
    directory.writeUInt32LE(images[i].length, start + 8); directory.writeUInt32LE(offset, start + 12);
    offset += images[i].length;
  }
  await mkdir(dirname(destination), { recursive: true });
  await writeFile(destination, Buffer.concat([directory, ...images]));
  return sizes;
}
