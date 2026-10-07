import { describe, expect, it } from 'vitest';
import { autoWinner, canPlace, isInMidfield, scoreOverride, visibleHalves, type GoalState, type OverrideState, type PinItem } from '../src/games/override/rules';
import { flightAt, hubActive, launchSpeedFor, scoreRebuilt, solveShot, towerPoints } from '../src/games/rebuilt/rules';

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

describe('REBUILT rules', () => {
  it('AUTO winner sits out shifts 1 and 3', () => {
    expect(hubActive('red', 'auto', null)).toBe(true);
    expect(hubActive('red', 'transition', 'red')).toBe(true);
    expect(hubActive('red', 'shift1', 'red')).toBe(false);
    expect(hubActive('red', 'shift2', 'red')).toBe(true);
    expect(hubActive('red', 'shift3', 'red')).toBe(false);
    expect(hubActive('red', 'shift4', 'red')).toBe(true);
    expect(hubActive('blue', 'shift1', 'red')).toBe(true);
    expect(hubActive('blue', 'shift2', 'red')).toBe(false);
    expect(hubActive('red', 'endgame', 'red')).toBe(true);
  });

  it('tower points', () => {
    expect(towerPoints(1, true)).toBe(15);
    expect(towerPoints(3, true)).toBe(15);
    expect([0, 1, 2, 3].map((l) => towerPoints(l as 0 | 1 | 2 | 3, false))).toEqual([0, 10, 20, 30]);
  });

  it('score and ranking point thresholds', () => {
    const s = scoreRebuilt({ autoFuel: 20, teleopFuel: 80, inactiveFuel: 30, autoTower: 1, endTower: 3 });
    expect(s.fuelPoints).toBe(100);
    expect(s.towerPoints).toBe(45);
    expect(s.total).toBe(145);
    expect(s.energizedRP).toBe(true);
    expect(s.superchargedRP).toBe(false);
    expect(s.traversalRP).toBe(false);
  });

  it('launch speed hits the target point', () => {
    const d = 4;
    const h = 1.2;
    const a = (60 * Math.PI) / 180;
    const v = launchSpeedFor(d, h, a)!;
    const t = d / (v * Math.cos(a));
    const y = v * Math.sin(a) * t - 0.5 * 9.81 * t * t;
    expect(y).toBeCloseTo(h, 6);
    expect(launchSpeedFor(1, 5, (10 * Math.PI) / 180)).toBeNull();
  });

  it('drag shortens a shot compared with a vacuum', () => {
    const a = (50 * Math.PI) / 180;
    const vac = flightAt(10, a, 6, 0)!;
    const air = flightAt(10, a, 6)!;
    expect(air.y).toBeLessThan(vac.y);
  });

  it('solved shots pass through the target on the way down', () => {
    const d = 3.5;
    const h = 1.45;
    const shot = solveShot(d, h, (40 * Math.PI) / 180, (80 * Math.PI) / 180, 17)!;
    expect(shot).not.toBeNull();
    const r = flightAt(shot.speed, shot.angle, d)!;
    expect(r.y).toBeCloseTo(h, 2);
    expect(r.vy).toBeLessThan(0);
  });
});
