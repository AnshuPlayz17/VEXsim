/**
 * VEX V5 Robotics Competition 2026-27 "Override": rules and scoring.
 *
 * Follows the game manual's scoring rules:
 *  - SC2: a Pin is Placed when nested in a Goal, or in a Cup nested on another
 *    Placed Pin; a Cup is Placed when nested on a Placed Pin. Each Goal / Cup
 *    half holds at most one Pin half, so stacks alternate Pin, Cup, Pin, ...
 *  - SC3: each Pin has two halves, each Scored separately while fully visible,
 *    i.e. not nested inside the opaque half of a Cup.
 *  - Alliance-color halves are worth 5 to that alliance; yellow halves are worth
 *    10 to the alliance that owns the Goal's quadrant Toggle. A Toggle only
 *    counts while no Robot is touching it.
 *  - Robot in the Midfield: 8. Autonomous Bonus: 12 (6 each on a tie).
 *
 * Values marked ASSUMPTION are not spelled out in the material we could access.
 */
export type Alliance = 'red' | 'blue';
export type PinColor = 'red' | 'blue' | 'yellow';
export type Quadrant = 'N' | 'E' | 'S' | 'W';

export const OVERRIDE = {
  autoSeconds: 15,
  driverSeconds: 105,
  skillsSeconds: 60,
  endgameSeconds: 10,
  points: {
    autoBonus: 12,
    autoBonusTie: 6,
    allianceHalf: 5,
    yellowHalf: 10,
    robotInMidfield: 8,
  },
  /** Midfield diamond |x| + |z| <= 0.6 m (the taped 48" diamond). */
  midfieldHalfDiagonal: 0.6,
  pinCounts: { redYellow: 20, blueYellow: 20, yellowYellow: 19, redBlue: 4 },
  cups: 56,
  /** Robots may expand to 50" tall during a match. */
  maxHeight: 50,
};

/**
 * A Pin's tapered (cone) end always nests downward into the Goal or Cup, so its
 * `cone` color is the lower half and `prism` color the upper half.
 */
export interface PinItem {
  type: 'pin';
  cone: PinColor;
  prism: PinColor;
}
export interface CupItem {
  type: 'cup';
  /** Normal orientation: clear half down, opaque half up. */
  opaqueUp: boolean;
}
export type StackItem = PinItem | CupItem;

export interface GoalState {
  id: string;
  kind: 'alliance' | 'short' | 'tall';
  alliance?: Alliance;
  /** null for the Tall (center) Goal in the Midfield. */
  quadrant: Quadrant | null;
  stack: StackItem[];
}

export interface OverrideState {
  goals: GoalState[];
  /** Toggle color at rest; null when neutral (yellow face) or touched by a robot. */
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

export function canPlace(goal: GoalState, item: StackItem, robotAlliance: Alliance): PlaceResult {
  if (goal.kind === 'alliance' && goal.alliance !== robotAlliance) {
    return { ok: false, reason: 'That is the opponent’s Alliance Goal' };
  }
  const top = goal.stack[goal.stack.length - 1];
  if (item.type === 'cup') {
    if (!top || top.type !== 'pin') return { ok: false, reason: 'A Cup must nest on a Placed Pin' };
    return { ok: true };
  }
  if (top && top.type === 'pin') return { ok: false, reason: 'Stack a Cup before the next Pin' };
  return { ok: true };
}

/** Pin halves that are visible (Scored) in a goal stack, bottom to top. */
export function visibleHalves(goal: GoalState): PinColor[] {
  const out: PinColor[] = [];
  goal.stack.forEach((item, i) => {
    if (item.type !== 'pin') return;
    const below = goal.stack[i - 1];
    const above = goal.stack[i + 1];
    // Lower (cone) half sits in the Goal or in the Cup below; hidden if that Cup's opaque half is up.
    const coneHidden = below?.type === 'cup' && below.opaqueUp;
    // Upper (prism) half is inside the Cup above; hidden if that Cup's opaque half is down.
    const prismHidden = above?.type === 'cup' && !above.opaqueUp;
    if (!coneHidden) out.push(item.cone);
    if (!prismHidden) out.push(item.prism);
  });
  return out;
}

/** Who owns the yellow halves in a goal. */
export function yellowOwner(
  goal: GoalState,
  toggles: Record<Quadrant, Alliance | null>,
  midfield: Record<Alliance, number>,
): Alliance | null {
  if (goal.quadrant) return toggles[goal.quadrant];
  // Tall Goal: the alliance with more Robots in the Midfield. ASSUMPTION (see README).
  if (midfield.red > midfield.blue) return 'red';
  if (midfield.blue > midfield.red) return 'blue';
  return null;
}

export function isInMidfield(x: number, z: number): boolean {
  return Math.abs(x) + Math.abs(z) <= OVERRIDE.midfieldHalfDiagonal;
}

/** Pin points only (used to decide the Autonomous Bonus). */
export function pinPoints(s: OverrideState): Record<Alliance, number> {
  const sc = scoreOverride({ ...s, autoBonus: null });
  return { red: sc.red.alliancePins + sc.red.yellowPins, blue: sc.blue.alliancePins + sc.blue.yellowPins };
}

export function autoWinner(s: OverrideState): Alliance | 'tie' {
  const p = pinPoints({ ...s, robotsInMidfield: { red: 0, blue: 0 } });
  if (p.red > p.blue) return 'red';
  if (p.blue > p.red) return 'blue';
  return 'tie';
}

export function scoreOverride(s: OverrideState): Record<Alliance, AllianceScore> {
  const out: Record<Alliance, AllianceScore> = {
    red: { alliancePins: 0, yellowPins: 0, midfield: 0, autoBonus: 0, total: 0 },
    blue: { alliancePins: 0, yellowPins: 0, midfield: 0, autoBonus: 0, total: 0 },
  };
  for (const g of s.goals) {
    const owner = yellowOwner(g, s.toggles, s.robotsInMidfield);
    for (const half of visibleHalves(g)) {
      if (half === 'yellow') {
        if (owner) out[owner].yellowPins += OVERRIDE.points.yellowHalf;
      } else {
        out[half].alliancePins += OVERRIDE.points.allianceHalf;
      }
    }
  }
  for (const a of ['red', 'blue'] as const) {
    out[a].midfield = s.robotsInMidfield[a] * OVERRIDE.points.robotInMidfield;
    if (s.autoBonus === a) out[a].autoBonus = OVERRIDE.points.autoBonus;
    if (s.autoBonus === 'tie') out[a].autoBonus = OVERRIDE.points.autoBonusTie;
    const r = out[a];
    r.total = r.alliancePins + r.yellowPins + r.midfield + r.autoBonus;
  }
  return out;
}
