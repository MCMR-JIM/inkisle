/** Samples the rendered whiteboard with an application-owned square pixel loupe. */
export class CanvasEyeDropper {
  open({ signal }: { signal: AbortSignal }): Promise<{ sRGBHex: string }> {
    if (signal.aborted) return Promise.reject(new DOMException('Cancelled', 'AbortError'));
    const scene = document.querySelector<HTMLCanvasElement>('#canvas')!;
    const interaction = document.querySelector<HTMLCanvasElement>('#interaction-canvas')!;
    const overlay = document.createElement('div'); overlay.className = 'canvas-eyedropper'; overlay.tabIndex = -1;
    overlay.setAttribute('role', 'dialog'); overlay.setAttribute('aria-label', '画布取色，点击选取颜色，Esc 取消');
    overlay.innerHTML = '<div class="canvas-eyedropper-preview"><canvas class="canvas-eyedropper-loupe" aria-label="方形像素放大预览"></canvas><output class="canvas-eyedropper-hex">移到画布取色</output></div>';
    const preview = overlay.firstElementChild as HTMLDivElement;
    const loupe = overlay.querySelector<HTMLCanvasElement>('canvas')!, label = overlay.querySelector<HTMLOutputElement>('output')!;
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    loupe.width = loupe.height = Math.round(110 * dpr);
    const display = loupe.getContext('2d')!; display.scale(dpr, dpr); display.imageSmoothingEnabled = false;
    const patch = document.createElement('canvas'); patch.width = patch.height = 11;
    const context = patch.getContext('2d', { willReadFrequently: true })!;
    document.body.append(overlay); overlay.focus({ preventScroll: true });
    let color: string | null = null;

    return new Promise((resolve, reject) => {
      const cleanup = (): void => { signal.removeEventListener('abort', cancel); overlay.remove(); };
      const cancel = (): void => { cleanup(); reject(new DOMException('Cancelled', 'AbortError')); };
      const choose = (): void => { if (color) { const sRGBHex = color; cleanup(); resolve({ sRGBHex }); } };
      const update = (x: number, y: number): void => {
        const target = document.elementsFromPoint(x, y).find(el => !overlay.contains(el));
        const rect = scene.getBoundingClientRect();
        const valid = (target === scene || target === interaction) && x >= rect.left && y >= rect.top && x < rect.right && y < rect.bottom;
        color = null;
        display.clearRect(0, 0, 110, 110);
        if (valid) {
          const px = Math.floor((x - rect.left) * scene.width / rect.width), py = Math.floor((y - rect.top) * scene.height / rect.height);
          context.clearRect(0, 0, 11, 11);
          context.drawImage(scene, px - 5, py - 5, 11, 11, 0, 0, 11, 11);
          context.drawImage(interaction, px - 5, py - 5, 11, 11, 0, 0, 11, 11);
          const pixel = context.getImageData(5, 5, 1, 1).data;
          color = `#${[pixel[0], pixel[1], pixel[2]].map(value => value.toString(16).padStart(2, '0')).join('')}`;
          display.drawImage(patch, 0, 0, 110, 110);
          display.strokeStyle = '#ffffff50'; display.lineWidth = 1; display.beginPath();
          for (let i = 1; i < 11; i++) { display.moveTo(i * 10 + .5, 0); display.lineTo(i * 10 + .5, 110); display.moveTo(0, i * 10 + .5); display.lineTo(110, i * 10 + .5); }
          display.stroke(); display.strokeStyle = '#17251d'; display.lineWidth = 3; display.strokeRect(50, 50, 10, 10);
          display.strokeStyle = '#ffffff'; display.lineWidth = 1; display.strokeRect(50, 50, 10, 10);
        }
        label.textContent = color ?? '移到画布取色';
        const width = preview.offsetWidth, height = preview.offsetHeight;
        const left = x + width + 24 <= window.innerWidth - 8 ? x + 24 : x - width - 24;
        const top = y + height + 24 <= window.innerHeight - 8 ? y + 24 : y - height - 24;
        preview.style.left = `${Math.max(8, Math.min(window.innerWidth - width - 8, left))}px`;
        preview.style.top = `${Math.max(8, Math.min(window.innerHeight - height - 8, top))}px`;
      };
      overlay.addEventListener('pointermove', event => update(event.clientX, event.clientY));
      overlay.addEventListener('pointerdown', event => { event.preventDefault(); event.stopPropagation(); update(event.clientX, event.clientY); });
      overlay.addEventListener('click', event => { event.preventDefault(); event.stopPropagation(); if (event.button === 0) { update(event.clientX, event.clientY); choose(); } });
      overlay.addEventListener('contextmenu', event => { event.preventDefault(); event.stopPropagation(); cancel(); });
      overlay.addEventListener('keydown', event => {
        event.preventDefault(); event.stopPropagation();
        if (event.key === 'Escape') cancel();
        else if (event.key === 'Enter' && !event.repeat) choose();
      });
      overlay.addEventListener('keyup', event => { event.preventDefault(); event.stopPropagation(); });
      signal.addEventListener('abort', cancel, { once: true });
    });
  }
}
