import type { BoardElement } from './model';

type FillState = Partial<Pick<BoardElement, 'fill' | 'fillColor'>>;
type FillPatch = Pick<BoardElement, 'fill' | 'fillColor'>;

/** Actual fill remains transparent when off; the selected color is independent. */
export function selectedFill(state: FillState, fallback = '#e6eee5'): string {
  if (state.fill && state.fill !== 'transparent') return state.fill;
  return state.fillColor && state.fillColor !== 'transparent' ? state.fillColor : fallback;
}

export function setFillColor(state: FillState, color: string): FillPatch {
  return { fill: state.fill && state.fill !== 'transparent' ? color : 'transparent', fillColor: color };
}

export function setFillEnabled(state: FillState, enabled: boolean, fallback?: string): FillPatch {
  const fillColor = selectedFill(state, fallback);
  return { fill: enabled ? fillColor : 'transparent', fillColor };
}
