/** One fixed tooltip layer also works outside scrollable palette boundaries. */
export function bindTooltips(): void {
  const bubble = document.createElement('div'); bubble.className = 'tooltip'; bubble.id = 'ui-tooltip'; bubble.hidden = true;
  bubble.setAttribute('role', 'tooltip'); document.body.append(bubble);
  let anchor: HTMLElement | null = null, timer = 0;
  const hide = (): void => {
    clearTimeout(timer); bubble.hidden = true;
    if (anchor) {
      const description = (anchor.getAttribute('aria-describedby') ?? '').split(' ').filter(id => id && id !== bubble.id);
      if (description.length) anchor.setAttribute('aria-describedby', description.join(' ')); else anchor.removeAttribute('aria-describedby');
    }
    anchor = null;
  };
  const show = (target: HTMLElement, delay: number): void => {
    if (anchor === target && !bubble.hidden && bubble.textContent === target.dataset.tooltip) return;
    hide(); anchor = target;
    timer = window.setTimeout(() => {
      if (anchor !== target || !target.isConnected || !target.getClientRects().length || !target.dataset.tooltip) return;
      // Native modal dialogs live above body content; mount within their layer.
      (target.closest('dialog[open]') ?? document.body).append(bubble);
      bubble.textContent = target.dataset.tooltip; bubble.hidden = false;
      bubble.style.maxWidth = `${Math.min(280, window.innerWidth - 16)}px`;
      const box = target.getBoundingClientRect(), width = bubble.offsetWidth, height = bubble.offsetHeight;
      bubble.style.left = `${Math.max(8, Math.min(window.innerWidth - width - 8, box.left + box.width / 2 - width / 2))}px`;
      bubble.style.top = `${Math.max(8, box.bottom + height + 8 <= window.innerHeight - 8 ? box.bottom + 8 : box.top - height - 8)}px`;
      const description = target.getAttribute('aria-describedby'); target.setAttribute('aria-describedby', `${description ? `${description} ` : ''}${bubble.id}`);
    }, delay);
  };
  const targetFor = (target: EventTarget | null): HTMLElement | null => target instanceof Element ? target.closest<HTMLElement>('[data-tooltip]') : null;
  document.addEventListener('pointerover', event => { const target = targetFor(event.target); if (target) show(target, 300); });
  document.addEventListener('pointerout', event => { if (anchor && !(event.relatedTarget instanceof Node && anchor.contains(event.relatedTarget))) hide(); });
  document.addEventListener('focusin', event => { const target = targetFor(event.target); if (target) show(target, 300); });
  document.addEventListener('focusout', hide);
  document.addEventListener('pointerdown', hide, true);
  document.addEventListener('keydown', hide, true);
  document.addEventListener('scroll', hide, true);
  window.addEventListener('resize', hide);
}
