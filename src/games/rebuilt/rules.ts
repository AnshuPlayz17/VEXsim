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

/**
 * FUEL aerodynamics: quadratic drag a = -k |v| v with k = ½ ρ Cd A / m
 * (5.91" foam ball, 0.215 kg, Cd ≈ 0.47). The physics loop applies the same
 * drag, so solved shots fly where the solver says.
 */
export const FUEL_DRAG_K = (0.5 * 1.225 * 0.47 * Math.PI * ((5.91 * 0.0254) / 2) ** 2) / 0.215;
export const SIM_DT = 1 / 120;

/** Height and vertical speed when a shot reaches horizontal distance `dist`, or null if it never does. */
export function flightAt(speed: number, angle: number, dist: number, k = FUEL_DRAG_K, g = 9.81, dt = SIM_DT): { y: number; vy: number; t: number } | null {
  let vx = speed * Math.cos(angle);
  let vy = speed * Math.sin(angle);
  let x = 0;
  let y = 0;
  let t = 0;
  while (t < 4) {
    const v = Math.hypot(vx, vy);
    // Semi-implicit Euler, like the physics engine: update velocity, then position.
    vx -= k * v * vx * dt;
    vy -= (g + k * v * vy) * dt;
    const nx = x + vx * dt;
    const ny = y + vy * dt;
    if (nx >= dist) {
      const f = (dist - x) / (nx - x);
      return { y: y + (ny - y) * f, vy, t: t + dt * f };
    }
    if (ny < -3 || vx <= 0.05) return null;
    x = nx;
    y = ny;
    t += dt;
  }
  return null;
}

/**
 * Find a launch angle (within the hood range) and speed that passes through the
 * target point on the way down, steep enough to drop into the HUB.
 */
export function solveShot(
  dist: number,
  heightDelta: number,
  angleMin: number,
  angleMax: number,
  speedMax: number,
  minDescent = (32 * Math.PI) / 180,
  k = FUEL_DRAG_K,
): { speed: number; angle: number; time: number } | null {
  const step = (1.5 * Math.PI) / 180;
  for (let a = angleMin; a <= angleMax + 1e-9; a += step) {
    // Height at the target grows with speed (until the arc tops out past it): bisection.
    let lo = 1;
    let hi = speedMax;
    const hiRes = flightAt(hi, a, dist, k);
    if (!hiRes || hiRes.y < heightDelta) continue;
    let res = hiRes;
    for (let i = 0; i < 26; i++) {
      const mid = (lo + hi) / 2;
      const r = flightAt(mid, a, dist, k);
      if (!r || r.y < heightDelta) lo = mid;
      else {
        hi = mid;
        res = r;
      }
    }
    const vx = hi * Math.cos(a);
    // Descent angle at the target (approximate horizontal speed with the launch value; drag only steepens it).
    const descent = Math.atan2(-res.vy, vx);
    if (res.vy < 0 && descent >= minDescent) return { speed: hi, angle: a, time: res.t };
  }
  return null;
}
