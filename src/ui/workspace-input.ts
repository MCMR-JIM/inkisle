/** Pointer clicks must not leave a native Space/Enter activation armed on buttons. */
export function bindWorkspaceInput(): void {
  const canSelectText = (target: EventTarget | null): boolean => {
    const element = target instanceof Element ? target : target instanceof Node ? target.parentElement : null;
    return !!element && (!!element.closest('input, textarea, select') || element instanceof HTMLElement && element.isContentEditable);
  };
  const clearTextSelection = (): void => { window.getSelection()?.removeAllRanges(); };
  // Canvas object selection must never expose UI/tooltip text as native selection.
  document.addEventListener('pointerdown', event => { if (!canSelectText(event.target)) clearTextSelection(); }, true);
  document.addEventListener('selectstart', event => {
    if (!canSelectText(event.target)) { event.preventDefault(); clearTextSelection(); }
  }, true);
  document.addEventListener('dragstart', event => { if (!canSelectText(event.target)) event.preventDefault(); }, true);
  document.addEventListener('click', event => {
    if (!event.detail) return;
    queueMicrotask(() => {
      const active = document.activeElement;
      if (active instanceof HTMLButtonElement && !active.matches('[role="combobox"][aria-expanded="true"], [data-shortcut]')) active.blur();
    });
  }, true);
  const preventButtonActivation = (event: KeyboardEvent): void => {
    if (event.key !== ' ' && event.key !== 'Enter') return;
    const button = event.target instanceof Element ? event.target.closest('button') : null;
    if (button && !button.matches('[role="combobox"], [data-shortcut]')) event.preventDefault();
  };
  document.addEventListener('keydown', preventButtonActivation, true);
  document.addEventListener('keyup', preventButtonActivation, true);
}
