import { expect, it } from 'vitest';
import { polygonPoints } from '../../src/core/paths';
import { arrowHeadKinds } from '../../src/core/linear';
import { createElement } from '../../src/core/model';

it.each([[3, 'triangle'], [5, 'pentagon'], [6, 'hexagon']] as const)('creates %i vertices for %s', (sides, _name) => {
  expect(polygonPoints(0, 0, 50, 40, sides, 0)).toHaveLength(sides);
});

it('marks both endpoints for a bidirectional arrow', () => {
  expect(arrowHeadKinds(createElement('bidirectional-arrow'))).toEqual({ start: true, end: true });
});
