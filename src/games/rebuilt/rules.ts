/**
 * FIRST Robotics Competition 2026 "REBUILT" — rules and scoring.
 * Values from the 2026 game manual summaries (see README).
 */
export type Alliance = 'red' | 'blue';

export const REBUILT = {
  autoSeconds: 20,
  teleopSeconds: 140,
  transitionSeconds: 10,
  shiftSeconds: 25,
  endgameSeconds: 30,
  points: {
    fuel: 1,
    towerAutoL1: 15,
    towerL1: 10,
    towerL2: 20,
    towerL3: 30,
  },
  rp: { energizedFuel: 100, superchargedFuel: 360, traversalTowerPoints: 50 },
  maxPreload: 8,
  fuelTotal: 504,
  depotFuel: 24,
  outpostFuel: 24,
  neutralFuel: 360,
};

export type TowerLevel = 0 | 1 | 2 | 3;

export type RebuiltPhaseId = 'auto' | 'transition' | 'shift1' | 'shift2' | 'shift3' | 'shift4' | 'endgame' | 'free';

/**
 * Hub activity. The alliance that scored more FUEL in AUTO has its HUB
 * inactive in SHIFTS 1 and 3, active in 2 and 4. Both hubs are active in
 * AUTO, the TRANSITION SHIFT and END GAME.
 */
export function hubActive(alliance: Alliance, phase: RebuiltPhaseId, autoWinner: Alliance | null): boolean {
  if (phase === 'shift1' || phase === 'shift3') return autoWinner !== alliance;
  if (phase === 'shift2' || phase === 'shift4') return autoWinner === alliance || autoWinner === null;
  return true;
}

export function towerPoints(level: TowerLevel, auto: boolean): number {
  if (auto) return level >= 1 ? REBUILT.points.towerAutoL1 : 0;
  return [0, REBUILT.points.towerL1, REBUILT.points.towerL2, REBUILT.points.towerL3][level];
}

export interface RebuiltTally {
  autoFuel: number;
  teleopFuel: number;
  /** Fuel that went through the hub while it was inactive (0 points). */
  inactiveFuel: number;
  autoTower: TowerLevel;
  endTower: TowerLevel;
}

export interface RebuiltScore {
  fuelPoints: number;
  towerPoints: number;
  total: number;
  energizedRP: boolean;
  superchargedRP: boolean;
  traversalRP: boolean;
}

export function scoreRebuilt(t: RebuiltTally): RebuiltScore {
  const fuelPoints = (t.autoFuel + t.teleopFuel) * REBUILT.points.fuel;
  const tp = towerPoints(t.autoTower, true) + towerPoints(t.endTower, false);
  const activeFuel = t.autoFuel + t.teleopFuel;
  return {
    fuelPoints,
    towerPoints: tp,
    total: fuelPoints + tp,
    energizedRP: activeFuel >= REBUILT.rp.energizedFuel,
    superchargedRP: activeFuel >= REBUILT.rp.superchargedFuel,
    traversalRP: tp >= REBUILT.rp.traversalTowerPoints,
  };
}

/**
 * Required launch speed to hit a target with a fixed launch angle.
 * Returns null if the target can't be reached at that angle.
 */
export function launchSpeedFor(distance: number, heightDelta: number, angle: number, g = 9.81): number | null {
  const c = Math.cos(angle);
  const denom = 2 * c * c * (distance * Math.tan(angle) - heightDelta);
  if (denom <= 0) return null;
  return Math.sqrt((g * distance * distance) / denom);
}
