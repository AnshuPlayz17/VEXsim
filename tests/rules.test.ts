import { describe, expect, it } from 'vitest';
import { autoWinner, canPlace, isInMidfield, scoreOverride, visibleHalves, type GoalState, type OverrideState, type PinItem } from '../src/games/override/rules';

const goal = (o: Partial<GoalState>): GoalState => ({ id: 'g', kind: 'short', quadrant: 'W', stack: [], ...o });
const state = (goals: GoalState[], o: Partial<OverrideState> = {}): OverrideState => ({
  goals,
  toggles: { N: null, E: null, S: null, W: null },
  robotsInMidfield: { red: 0, blue: 0 },
  autoBonus: null,
  ...o,
});
const pin = (cone: PinItem['cone'], prism: PinItem['prism']): PinItem => ({ type: 'pin', cone, prism });

describe('Override scoring (per Pin half)', () => {
  it('both halves of a Pin on a Goal score', () => {
    const s = scoreOverride(state([goal({ stack: [pin('red', 'blue')] })]));
    expect(s.red.total).toBe(5);
    expect(s.blue.total).toBe(5);
  });

  it('yellow halves score 10 for the quadrant Toggle owner', () => {
    const g = goal({ quadrant: 'S', stack: [pin('red', 'yellow')] });
    expect(scoreOverride(state([g])).red.total).toBe(5);
    const s = scoreOverride(state([g], { toggles: { N: null, E: null, S: 'red', W: null } }));
    expect(s.red.total).toBe(15);
  });

  it('a Cup with its opaque half up hides the next Pin’s lower half', () => {
    const g = goal({ stack: [pin('red', 'yellow'), { type: 'cup', opaqueUp: true }, pin('red', 'yellow')] });
    expect(visibleHalves(g)).toEqual(['red', 'yellow', 'yellow']);
  });

  it('a Cup turned over hides the lower Pin’s upper half instead', () => {
    const g = goal({ stack: [pin('red', 'yellow'), { type: 'cup', opaqueUp: false }, pin('red', 'yellow')] });
    expect(visibleHalves(g)).toEqual(['red', 'red', 'yellow']);
  });

  it('the Tall Goal’s yellows go to the alliance with more robots in the Midfield', () => {
    const g = goal({ id: 'c', kind: 'tall', quadrant: null, stack: [pin('yellow', 'yellow')] });
    expect(scoreOverride(state([g], { robotsInMidfield: { red: 1, blue: 0 } })).red.yellowPins).toBe(20);
    expect(scoreOverride(state([g], { robotsInMidfield: { red: 1, blue: 1 } })).red.yellowPins).toBe(0);
  });

  it('midfield and auto bonus', () => {
    const s = scoreOverride(state([], { robotsInMidfield: { red: 2, blue: 1 }, autoBonus: 'red' }));
    expect(s.red.total).toBe(16 + 12);
    expect(s.blue.total).toBe(8);
    expect(scoreOverride(state([], { autoBonus: 'tie' })).red.autoBonus).toBe(6);
  });

  it('the auto bonus counts Pin points only', () => {
    const g = goal({ stack: [pin('blue', 'blue')] });
    expect(autoWinner(state([g], { robotsInMidfield: { red: 2, blue: 0 } }))).toBe('blue');
  });

  it('stacks alternate Pin, Cup, Pin', () => {
    const g = goal({});
    expect(canPlace(g, { type: 'cup', opaqueUp: true }, 'red').ok).toBe(false);
    expect(canPlace(g, pin('red', 'yellow'), 'red').ok).toBe(true);
    g.stack.push(pin('red', 'yellow'));
    expect(canPlace(g, pin('red', 'yellow'), 'red').ok).toBe(false);
    expect(canPlace(g, { type: 'cup', opaqueUp: true }, 'red').ok).toBe(true);
  });

  it('only the owning alliance can score its Alliance Goal', () => {
    const g = goal({ kind: 'alliance', alliance: 'blue' });
    expect(canPlace(g, pin('red', 'yellow'), 'red').ok).toBe(false);
    expect(canPlace(g, pin('blue', 'yellow'), 'blue').ok).toBe(true);
  });

  it('midfield is the 48" diamond', () => {
    expect(isInMidfield(0, 0)).toBe(true);
    expect(isInMidfield(0.3, 0.29)).toBe(true);
    expect(isInMidfield(0.31, 0.31)).toBe(false);
  });
});
