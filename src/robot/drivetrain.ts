import { clamp } from '../core/units';

/**
 * VEX V5 drivetrain physics. Pure functions (no engine types) so the driving
 * model can be unit tested.
 *
 * Each drive motor is a V5 Smart Motor (11 W) modeled as a DC motor with a
 * linear torque-speed curve: torque = stall * (voltage - speed / free speed).
 * Forces at each wheel are limited by traction, and the chassis integrates
 * them with its mass and rotational inertia, so acceleration, top speed,
 * turning and pushing all fall out of the real gearing, wheel size and weight.
 *
 * Conventions (top-down, Three.js world): the field is the X/Z plane, Y is up.
 * A heading of theta means the robot's front points along (cos theta, -sin theta)
 * in (x, z). Positive omega turns the robot counter-clockwise seen from above.
 */

export type DriveType = 'tank' | 'arcade' | 'splitArcade' | 'xdrive';

export const DRIVE_TYPE_LABELS: Record<DriveType, string> = {
  tank: 'Tank (left stick = left side, right stick = right side)',
  arcade: 'Arcade (one stick)',
  splitArcade: 'Split arcade (left = throttle, right = turn)',
  xdrive: 'X-drive (holonomic)',
};

export const isHolonomic = (t: DriveType): boolean => t === 'xdrive';

export type Cartridge = 'red' | 'green' | 'blue';
export const CARTRIDGE_RPM: Record<Cartridge, number> = { red: 100, green: 200, blue: 600 };
/** V5 Smart Motor stall torque with the red (100 rpm) cartridge, N·m. Other cartridges scale with speed. */
export const V5_STALL_TORQUE_RED = 2.1;

export interface Powertrain {
  /** Drive motors on the whole robot (split evenly per side / per wheel). */
  motors: number;
  cartridge: Cartridge;
  /** Wheel rpm at the cartridge's free speed (e.g. 450 for 600 rpm geared 36:48). */
  wheelRpm: number;
  /** Wheel diameter, m. */
  wheelDia: number;
  /** Robot mass with battery, kg. */
  mass: number;
  /** Wheel-to-tile friction coefficient. */
  mu: number;
  /** Distance between left and right wheels, m. */
  trackWidth: number;
  /** Wheelbase (front to back wheel), m. */
  wheelbase: number;
  /** 0..1: how much the wheels scrub sideways when turning (traction wheels > omnis). */
  scrub: number;
  /** Motor behaviour at zero input. */
  brake: 'coast' | 'brake';
}

export interface DriverTuning {
  deadzone: number;
  expo: number;
  turnExpo: number;
  slowScale: number;
}

export interface DriveInput {
  lx: number;
  ly: number;
  rx: number;
  ry: number;
  slow: boolean;
  /** X-drive only: translate relative to the driver station. */
  fieldOriented: boolean;
}

/** World-frame chassis velocity. */
export interface ChassisState {
  vx: number;
  vz: number;
  omega: number;
}

/** Per-wheel motor voltage command, -1..1. Tank: [left, right]. X-drive: [FL, FR, BL, BR]. */
export type Voltages = number[];

const G = 9.81;
/** Rolling resistance of wheels on foam tiles. */
const ROLL_RESIST = 0.06;

export function freeSpeed(p: Powertrain): number {
  return (p.wheelRpm * Math.PI * p.wheelDia) / 60;
}

/** Stall force one motor can put on the tiles at its wheel, N. */
export function stallForcePerMotor(p: Powertrain): number {
  const motorStall = (V5_STALL_TORQUE_RED * 100) / CARTRIDGE_RPM[p.cartridge];
  const torqueAtWheel = (motorStall * CARTRIDGE_RPM[p.cartridge]) / p.wheelRpm;
  return torqueAtWheel / (p.wheelDia / 2);
}

export function inertia(p: Powertrain, length: number, width: number): number {
  return (p.mass * (length * length + width * width)) / 12;
}

export function shapeAxis(v: number, deadzone: number, expo: number): number {
  const a = Math.abs(v);
  if (a <= deadzone) return 0;
  const n = Math.min(1, (a - deadzone) / (1 - deadzone));
  return Math.sign(v) * ((1 - expo) * n + expo * n * n * n);
}

export function forwardOf(theta: number): [number, number] {
  return [Math.cos(theta), -Math.sin(theta)];
}

export function rightOf(theta: number): [number, number] {
  return [Math.sin(theta), Math.cos(theta)];
}

/** X-drive wheel layout in robot frame (forward, right): position and drive direction. */
function xWheels(p: Powertrain): { pf: number; pr: number; df: number; dr: number }[] {
  const a = p.wheelbase / 2;
  const b = p.trackWidth / 2;
  const s = Math.SQRT1_2;
  // FL, FR, BL, BR. Each wheel pushes along a 45° line; rollers let it slide across.
  return [
    { pf: a, pr: -b, df: s, dr: s },
    { pf: a, pr: b, df: s, dr: -s },
    { pf: -a, pr: -b, df: s, dr: -s },
    { pf: -a, pr: b, df: s, dr: s },
  ];
}

/** Turn sticks into motor voltages, like a typical VEXcode driver-control loop. */
export function driverVoltages(
  type: DriveType,
  raw: DriveInput,
  heading: number,
  driverYaw: number,
  t: DriverTuning,
): Voltages {
  const lx = shapeAxis(raw.lx, t.deadzone, t.expo);
  const ly = shapeAxis(raw.ly, t.deadzone, t.expo);
  const rx = shapeAxis(raw.rx, t.deadzone, t.turnExpo);
  const ry = shapeAxis(raw.ry, t.deadzone, t.expo);
  const k = raw.slow ? t.slowScale : 1;

  if (type === 'xdrive') {
    let fwd = ly;
    let str = lx;
    if (raw.fieldOriented) {
      // Rotate the driver's stick frame into the robot's frame.
      const a = heading - driverYaw;
      const c = Math.cos(a);
      const s = Math.sin(a);
      const f = ly * c - lx * s;
      const r = ly * s + lx * c;
      fwd = f;
      str = r;
    }
    const turn = rx;
    const s = Math.SQRT1_2;
    // Wheel voltage ∝ desired chassis motion projected on each wheel's drive line.
    const u = [
      (fwd + str) * s + turn,
      (fwd - str) * s - turn,
      (fwd - str) * s + turn,
      (fwd + str) * s - turn,
    ];
    const m = Math.max(1, ...u.map(Math.abs));
    return u.map((x) => (x / m) * k);
  }

  let left: number;
  let right: number;
  if (type === 'tank') {
    left = ly;
    right = ry;
  } else {
    const turn = type === 'arcade' ? lx : rx;
    left = ly + turn;
    right = ly - turn;
    const m = Math.max(1, Math.abs(left), Math.abs(right));
    left /= m;
    right /= m;
  }
  return [left * k, right * k];
}

/**
 * What the motors get from the battery: `voltage` scales the commanded voltage (battery
 * sag), `limit` caps each motor's current (and so torque) as a fraction of its 2.5 A max.
 * `amps` is written back: the average current per drive motor this step, A.
 */
export interface Supply {
  voltage: number;
  limit: number;
  amps?: number;
}

/** Advance the chassis by dt under the given motor voltages. */
export function stepDrive(
  type: DriveType,
  p: Powertrain,
  length: number,
  width: number,
  state: ChassisState,
  u: Voltages,
  heading: number,
  dt: number,
  supply: Supply = { voltage: 1, limit: 1 },
): ChassisState {
  const [fx, fz] = forwardOf(heading);
  const [rx, rz] = rightOf(heading);
  // Robot-frame velocity.
  let vf = state.vx * fx + state.vz * fz;
  let vr = state.vx * rx + state.vz * rz;
  let w = state.omega;
  const vFree = freeSpeed(p);
  const fs = stallForcePerMotor(p);
  const I = inertia(p, length, width);
  const wheelsOnGround = type === 'xdrive' ? 4 : 2;
  const tractionPer = (p.mu * p.mass * G) / wheelsOnGround;

  let ampSum = 0;
  let ampN = 0;
  const motorForce = (n: number, volts: number, wheelSpeed: number) => {
    // Brake mode shorts the motor at zero input (back-EMF braking); coast lets it spin free.
    if (Math.abs(volts) < 1e-3 && p.brake === 'coast') return 0;
    const v = Math.abs(volts) < 1e-3 ? 0 : volts * supply.voltage;
    // Torque (and current) follow the torque-speed line, capped by the current limit.
    const frac = clamp(v - wheelSpeed / vFree, -supply.limit, supply.limit);
    ampSum += Math.abs(frac) * 2.5 * n;
    ampN += n;
    return n * fs * frac;
  };

  let Ff = 0;
  let Fr = 0;
  let T = 0;
  if (type === 'xdrive') {
    const per = p.motors / 4;
    xWheels(p).forEach((wh, i) => {
      // Wheel ground speed along its drive line (includes rotation: ω × r, ω CCW = left).
      // Point velocity v + ω×p, with ω counter-clockwise (toward the robot's left).
      const sf = vf + w * wh.pr;
      const sr = vr - w * wh.pf;
      const s = sf * wh.df + sr * wh.dr;
      const F = clamp(motorForce(per, u[i] ?? 0, s), -tractionPer, tractionPer);
      Ff += F * wh.df;
      Fr += F * wh.dr;
      // Torque about +Y (CCW positive): τ = -(pf * Fr_i - pr * Ff_i)
      T += -(wh.pf * F * wh.dr - wh.pr * F * wh.df);
    });
  } else {
    const per = p.motors / 2;
    const half = p.trackWidth / 2;
    const vl = vf - w * half;
    const vrgt = vf + w * half;
    const FL = clamp(motorForce(per, u[0] ?? 0, vl), -tractionPer, tractionPer);
    const FR = clamp(motorForce(per, u[1] ?? 0, vrgt), -tractionPer, tractionPer);
    Ff = FL + FR;
    T = (FR - FL) * half;
    // Differential drives can't push sideways: tire grip kills lateral slip.
    const maxLat = p.mu * G * dt;
    vr -= clamp(vr, -maxLat * 3, maxLat * 3);
  }

  // Rolling resistance and turning scrub.
  const roll = ROLL_RESIST * p.mass * G;
  Ff -= roll * Math.tanh(vf / 0.05);
  if (type === 'xdrive') Fr -= roll * Math.tanh(vr / 0.05);
  const scrubTorque = p.scrub * p.mu * p.mass * G * (p.wheelbase / 4);
  T -= scrubTorque * Math.tanh(w / 0.4);

  // Never let a resistive force reverse the motion within one step.
  const dvf = (Ff / p.mass) * dt;
  const dvr = (Fr / p.mass) * dt;
  const dw = (T / I) * dt;
  vf += dvf;
  vr += dvr;
  w += dw;
  supply.amps = ampN ? ampSum / ampN : 0;
  if (Math.abs(vf) < 0.004 && Math.abs(u.reduce((a, b) => a + Math.abs(b), 0)) < 1e-3) vf = 0;
  if (Math.abs(w) < 0.01 && Math.abs(u.reduce((a, b) => a + Math.abs(b), 0)) < 1e-3) w = 0;

  return { vx: fx * vf + rx * vr, vz: fz * vf + rz * vr, omega: w };
}

/** Headline numbers for the setup screen. */
export function driveSummary(p: Powertrain, length: number, width: number): { topSpeed: number; accel: number; turnRate: number } {
  const vFree = freeSpeed(p);
  const fs = stallForcePerMotor(p);
  const accel = Math.min(p.mu * G, (p.motors * fs) / p.mass);
  // Steady spin rate where motor torque balances scrub.
  const half = p.trackWidth / 2;
  void length;
  void width;
  const scrub = p.scrub * p.mu * p.mass * G * (p.wheelbase / 4);
  // (motors/2)*fs*(1 - w*half/vFree) * half * 2 = scrub  →  w = (1 - scrub/(motors*fs*half)) * vFree/half
  const turnRate = Math.max(0, (1 - scrub / (p.motors * fs * half)) * (vFree / half));
  return { topSpeed: vFree, accel, turnRate };
}
