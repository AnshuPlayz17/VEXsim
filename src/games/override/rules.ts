/**
 * VEX V5 Robotics Competition 2026-27 "Override" — rules and scoring.
 *
 * Sourced from the public game manual summaries (see README). Values marked
 * ASSUMPTION are not stated in the material we could access; they are kept in
 * one place so they are easy to correct when you check the official manual.
 */
export type Alliance = 'red' | 'blue';
export type PinColor = 'red' | 'blue' | 'yellow';
export type Quadrant = 'N' | 'E' | 'S' | 'W';

export const OVERRIDE = {
  autoSeconds: 15,
  driverSeconds: 105,
  skillsSeconds: 60,
  /** Final seconds of the driver period that make up the endgame. */
  endgameSeconds: 10,
  points: {
    autoBonus: 12,
    alliancePin: 5,
    ownedYellowPin: 10,
    robotInMidfield: 8,
  },
  /** Midfield: diamond |x| + |z| <= 24", judged by robot center. */
  midfieldHalfDiagonalIn: 24,
  /** ASSUMPTION: maximum Placed Pins per goal stack (pin, cup, pin, cup, ...). */
  maxPinsPerGoal: { alliance: 3, short: 4, tall: 5 },
  /**
   * ASSUMPTION: the Tall Goal is in no quadrant, so its yellow Pins go to the
   * alliance that owns the majority (3+) of Toggles. Ties score nothing.
   */
  tallGoalYellowRule: 'toggle-majority' as const,
  pinCounts: { redYellow: 20, blueYellow: 20, yellowYellow: 19, redBlue: 4 },
  cups: 56,
  matchLoadCupsPerAlliance: 10,
};

export interface PinItem {
  type: 'pin';
  /** Color of the half facing up once Placed (the half that scores). ASSUMPTION. */
  up: PinColor;
  down: PinColor;
}
export interface CupItem {
  type: 'cup';
}
export type StackItem = PinItem | CupItem;

export interface GoalState {
  id: string;
  kind: 'alliance' | 'short' | 'tall';
  alliance?: Alliance;
  quadrant: Quadrant | null;
  stack: StackItem[];
}

export interface OverrideState {
  goals: GoalState[];
  toggles: Record<Quadrant, Alliance | null>;
  robotsInMidfield: Record<Alliance, number>;
  autoBonus: Alliance | 'tie' | null;
}

export interface AllianceScore {
  alliancePins: number;
  yellowPins: number;
  midfield: number;
  autoBonus: number;
  total: number;
}

export type PlaceResult = { ok: true } | { ok: false; reason: string };

export function pinsIn(goal: GoalState): PinItem[] {
  return goal.stack.filter((s): s is PinItem => s.type === 'pin');
}

/**
 * Stacks alternate Pin, Cup, Pin, Cup... A Pin is Placed when nested in the goal
 * or in a Cup that sits on a Placed Pin; a Cup is Placed when on a Placed Pin.
 */
export function canPlace(goal: GoalState, item: StackItem, robotAlliance: Alliance): PlaceResult {
  if (goal.kind === 'alliance' && goal.alliance !== robotAlliance) {
    return { ok: false, reason: 'Opponent Alliance Goal' };
  }
  const top = goal.stack[goal.stack.length - 1];
  if (item.type === 'cup') {
    if (!top || top.type !== 'pin') return { ok: false, reason: 'A Cup must sit on a Pin' };
    return { ok: true };
  }
  if (top && top.type === 'pin') return { ok: false, reason: 'Add a Cup before the next Pin' };
  if (pinsIn(goal).length >= OVERRIDE.maxPinsPerGoal[goal.kind]) {
    return { ok: false, reason: 'Goal is full' };
  }
  return { ok: true };
}

export function yellowOwner(goal: GoalState, toggles: Record<Quadrant, Alliance | null>): Alliance | null {
  if (goal.quadrant) return toggles[goal.quadrant];
  let red = 0;
  let blue = 0;
  for (const q of Object.values(toggles)) {
    if (q === 'red') red++;
    if (q === 'blue') blue++;
  }
  if (red >= 3) return 'red';
  if (blue >= 3) return 'blue';
  return null;
}

export function isInMidfield(xIn: number, zIn: number): boolean {
  return Math.abs(xIn) + Math.abs(zIn) <= OVERRIDE.midfieldHalfDiagonalIn;
}

export function scoreOverride(s: OverrideState): Record<Alliance, AllianceScore> {
  const out: Record<Alliance, AllianceScore> = {
    red: { alliancePins: 0, yellowPins: 0, midfield: 0, autoBonus: 0, total: 0 },
    blue: { alliancePins: 0, yellowPins: 0, midfield: 0, autoBonus: 0, total: 0 },
  };
  for (const g of s.goals) {
    const owner = yellowOwner(g, s.toggles);
    for (const pin of pinsIn(g)) {
      if (pin.up === 'yellow') {
        if (owner) out[owner].yellowPins += OVERRIDE.points.ownedYellowPin;
      } else {
        out[pin.up].alliancePins += OVERRIDE.points.alliancePin;
      }
    }
  }
  for (const a of ['red', 'blue'] as const) {
    out[a].midfield = s.robotsInMidfield[a] * OVERRIDE.points.robotInMidfield;
    if (s.autoBonus === a) out[a].autoBonus = OVERRIDE.points.autoBonus;
    // A tied autonomous splits the bonus (standard V5RC convention).
    if (s.autoBonus === 'tie') out[a].autoBonus = OVERRIDE.points.autoBonus / 2;
    const r = out[a];
    r.total = r.alliancePins + r.yellowPins + r.midfield + r.autoBonus;
  }
  return out;
}
