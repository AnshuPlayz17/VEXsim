import { describe, expect, it } from 'vitest';
import { canPlace, isInMidfield, scoreOverride, type GoalState, type OverrideState } from '../src/games/override/rules';
import { hubActive, launchSpeedFor, scoreRebuilt, towerPoints } from '../src/games/rebuilt/rules';

const goal = (o: Partial<GoalState>): GoalState => ({ id: 'g', kind: 'short', quadrant: 'W', stack: [], ...o });
const state = (goals: GoalState[], o: Partial<OverrideState> = {}): OverrideState => ({
  goals,
  toggles: { N: null, E: null, S: null, W: null },
  robotsInMidfield: { red: 0, blue: 0 },
  autoBonus: null,
  ...o,
});

describe('Override scoring', () => {
  it('alliance-color Pins score 5 for their color', () => {
    const s = scoreOverride(state([goal({ stack: [{ type: 'pin', up: 'red', down: 'yellow' }] })]));
    expect(s.red.total).toBe(5);
    expect(s.blue.total).toBe(0);
  });

  it('yellow Pins score 10 for whoever owns the quadrant Toggle', () => {
    const g = goal({ quadrant: 'S', stack: [{ type: 'pin', up: 'yellow', down: 'yellow' }] });
    expect(scoreOverride(state([g])).red.total).toBe(0);
    const s = scoreOverride(state([g], { toggles: { N: null, E: null, S: 'blue', W: null } }));
    expect(s.blue.yellowPins).toBe(10);
  });

  it('flipping a Toggle moves yellow points live', () => {
    const g = goal({ quadrant: 'E', stack: [{ type: 'pin', up: 'yellow', down: 'red' }, { type: 'cup' }, { type: 'pin', up: 'yellow', down: 'blue' }] });
    const red = scoreOverride(state([g], { toggles: { N: null, E: 'red', S: null, W: null } }));
    const blue = scoreOverride(state([g], { toggles: { N: null, E: 'blue', S: null, W: null } }));
    expect(red.red.yellowPins).toBe(20);
    expect(blue.blue.yellowPins).toBe(20);
  });

  it('midfield and auto bonus', () => {
    const s = scoreOverride(state([], { robotsInMidfield: { red: 2, blue: 1 }, autoBonus: 'red' }));
    expect(s.red.total).toBe(16 + 12);
    expect(s.blue.total).toBe(8);
    const tie = scoreOverride(state([], { autoBonus: 'tie' }));
    expect(tie.red.autoBonus).toBe(6);
  });

  it('stacks alternate Pin, Cup, Pin', () => {
    const g = goal({});
    expect(canPlace(g, { type: 'cup' }, 'red').ok).toBe(false);
    expect(canPlace(g, { type: 'pin', up: 'red', down: 'yellow' }, 'red').ok).toBe(true);
    g.stack.push({ type: 'pin', up: 'red', down: 'yellow' });
    expect(canPlace(g, { type: 'pin', up: 'red', down: 'yellow' }, 'red').ok).toBe(false);
    expect(canPlace(g, { type: 'cup' }, 'red').ok).toBe(true);
  });

  it('only the owning alliance can score its Alliance Goal', () => {
    const g = goal({ kind: 'alliance', alliance: 'blue' });
    expect(canPlace(g, { type: 'pin', up: 'red', down: 'yellow' }, 'red').ok).toBe(false);
    expect(canPlace(g, { type: 'pin', up: 'blue', down: 'yellow' }, 'blue').ok).toBe(true);
  });

  it('midfield is the 24" diamond', () => {
    expect(isInMidfield(0, 0)).toBe(true);
    expect(isInMidfield(12, 12)).toBe(true);
    expect(isInMidfield(13, 12)).toBe(false);
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
});
