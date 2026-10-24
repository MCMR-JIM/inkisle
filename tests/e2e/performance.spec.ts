import { expect, test } from '@playwright/test';

test('measures startup, viewport rendering, long pen previews and incremental persistence', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#save-status')).toContainText('已保存在本机');
  const results = await page.evaluate(async () => {
    const load = (path: string) => import(/* @vite-ignore */ path);
    const { createElement, createDocument } = await load('/src/core/model.ts');
    const { Scene } = await load('/src/core/scene.ts');
    const { Renderer } = await load('/src/engine/renderer.ts');
    const { Repository } = await load('/src/storage/repository.ts');
    const { encodeDocument } = await load('/src/core/codec.ts');
    const { eraseAt } = await load('/src/core/erasure.ts');
    const container = document.createElement('div');
    Object.assign(container.style, { position: 'absolute', width: '1440px', height: '960px', pointerEvents: 'none' });
    const canvas = document.createElement('canvas'), overlay = document.createElement('canvas');
    container.append(canvas, overlay); document.body.append(container);
    const elements = Array.from({ length: 5000 }, (_, i) => createElement(i % 4 === 0 ? 'note' : 'rect', {
      x: (i % 100) * 180, y: Math.floor(i / 100) * 140, w: 145, h: 105,
      text: i % 4 === 0 ? `灵感 ${i}\n保持好奇心` : '', fill: i % 4 === 0 ? '#faefc9' : '#e6eee5', order: i,
    }));
    const startScene = performance.now();
    const scene = new Scene(elements);
    const indexBuildMs = performance.now() - startScene;
    const state = { camera: { x: 0, y: 0, zoom: 1 }, selected: new Set(), preview: [], hidden: new Set(), marquee: null, cursor: null, tool: 'select', grid: true, dark: false, erasing: new Map() };
    const renderer = new Renderer(scene, canvas, overlay, state);
    await new Promise(requestAnimationFrame);
    const paint = async (main = true): Promise<number> => {
      await new Promise<void>(resolve => { renderer.onFrame = () => resolve(); renderer.invalidate(main); });
      return renderer.lastFrameMs;
    };
    const frames: number[] = [];
    for (let i = 0; i < 60; i++) {
      renderer.state.camera.x = -i * 25;
      frames.push(await paint());
    }
    const visible = renderer.visibleCount;
    renderer.state.tool = 'select';
    const selectedElement = elements[0]; renderer.state.selected = new Set([selectedElement.id]); renderer.state.hidden = new Set([selectedElement.id]);
    const selectedFrames: number[] = [];
    for (let i = 0; i < 30; i++) {
      renderer.state.preview = [{ ...selectedElement, x: 1000 + i * 4, y: 400 }];
      selectedFrames.push(await paint(false));
    }
    renderer.state.selected.clear(); renderer.state.hidden.clear(); renderer.state.preview = []; renderer.state.tool = 'select';
    renderer.state.camera = { x: 0, y: 0, zoom: 0.06 };
    const overviewFrames: number[] = [];
    for (let i = 0; i < 30; i++) {
      renderer.state.camera.x = i;
      overviewFrames.push(await paint());
    }
    const overviewVisible = renderer.visibleCount;
    renderer.state.camera = { x: 0, y: 0, zoom: 1 };
    const maskedElements = elements.map((el: { x: number; y: number }) => eraseAt(el, [{ x: el.x + 70, y: el.y + 10 }, { x: el.x + 70, y: el.y + 90 }], 10));
    renderer.scene = new Scene(maskedElements);
    renderer.state.tool = 'eraser';
    const eraserFrames: number[] = [];
    for (let i = 0; i < 30; i++) {
      renderer.state.camera.x = -i * 5;
      eraserFrames.push(await paint());
    }
    renderer.scene = scene;
    renderer.state.camera = { x: 0, y: 0, zoom: 1 };
    renderer.state.tool = 'pen';
    renderer.state.preview = [createElement('pen', { x: 0, y: 400, points: Array.from({ length: 5000 }, (_, i) => ({ x: i * .2, y: Math.sin(i / 40) * 60, pressure: .5 })) })];
    const penFrames: number[] = [];
    for (let i = 0; i < 30; i++) {
      penFrames.push(await paint(false));
    }
    const penPreview = renderer.state.preview[0];
    renderer.state.preview = [{ ...penPreview, opacity: .35, strokeWidth: 20 }];
    const highlighterFrames: number[] = [];
    for (let i = 0; i < 30; i++) highlighterFrames.push(await paint(false));
    renderer.state.preview = [penPreview];
    renderer.state.preview = [{ ...renderer.state.preview[0], pressureEnabled: true, points: renderer.state.preview[0].points.map((p: { x: number; y: number }, i: number) => ({ ...p, pressure: .5 + .45 * Math.sin(i / 80) })) }];
    const pressureFrames: number[] = [];
    for (let i = 0; i < 30; i++) pressureFrames.push(await paint(false));
    const repo = new Repository(`benchmark-${crypto.randomUUID()}`);
    const doc = createDocument('5000 元素基准'); doc.elements = elements;
    let start = performance.now(); const bytes = encodeDocument(doc); const encodeMs = performance.now() - start;
    start = performance.now(); await repo.create(doc); const createMs = performance.now() - start;
    const writes: number[] = [];
    for (let i = 0; i < 25; i++) {
      start = performance.now(); await repo.append(doc.id, [{ id: elements[0].id, after: { ...elements[0], x: i } }], { elementCount: elements.length }); writes.push(performance.now() - start);
    }
    start = performance.now(); await repo.load(doc.id); const reopenMs = performance.now() - start;
    await repo.remove(doc.id); repo.close(); renderer.destroy(); container.remove();
    const percentile = (values: number[], p: number) => values.slice().sort((a, b) => a - b)[Math.min(values.length - 1, Math.floor(values.length * p))];
    return {
      environment: { userAgent: navigator.userAgent, dpr: devicePixelRatio, viewport: '1440x960', server: 'Vite development' },
      startup: (window as unknown as { liubai: { diagnostics: () => object } }).liubai.diagnostics(),
      scene: { elements: 5000, visible, overviewVisible, indexBuildMs, frameP50Ms: percentile(frames, .5), frameP95Ms: percentile(frames, .95), selectedLayeredPreviewP95Ms: percentile(selectedFrames, .95), overviewColdMs: overviewFrames[0], overviewP95Ms: percentile(overviewFrames, .95), erasedSceneP95Ms: percentile(eraserFrames, .95), longPenP95Ms: percentile(penFrames, .95), highlighterP95Ms: percentile(highlighterFrames, .95), pressurePenP95Ms: percentile(pressureFrames, .95) },
      storage: { bytes: bytes.length, encodeMs, createMs, appendP50Ms: percentile(writes, .5), appendP95Ms: percentile(writes, .95), reopenMs },
    };
  });
  console.log('LIUBAI_BENCHMARK', JSON.stringify(results, null, 2));
  expect(results.scene.visible).toBeLessThan(200);
  expect(results.scene.frameP95Ms).toBeLessThan(100);
  expect(results.scene.overviewP95Ms).toBeLessThan(100);
  expect(results.scene.erasedSceneP95Ms).toBeLessThan(100);
  expect(results.scene.selectedLayeredPreviewP95Ms).toBeLessThan(50);
  expect(results.scene.pressurePenP95Ms).toBeLessThan(50);
  expect(results.scene.highlighterP95Ms).toBeLessThan(50);
  expect(results.storage.appendP95Ms).toBeLessThan(100);
});
