import { clamp } from '../core/units';

/**
 * Pure drivetrain kinematics. No physics-engine types live here so that the
 * driving model can be unit tested and tuned independently of rendering.
 *
 * Conventions (top-down, Three.js world): the field is the X/Z plane, Y is up.
 * A heading of theta means the robot's front points along (cos theta, -sin theta)
 * in (x, z). Positive omega turns the robot counter-clockwise seen from above
 * (i.e. to the left).
 */

export type DriveType = 'tank' | 'arcade' | 'splitArcade' | 'swerve' | 'xdrive';

export const DRIVE_TYPE_LABELS: Record<DriveType, string> = {
  tank: 'Tank (left stick = left side, right stick = right side)',
  arcade: 'Arcade (one stick)',
  splitArcade: 'Split arcade (left = throttle, right = turn)',
  swerve: 'Swerve (holonomic)',
  xdrive: 'X-drive / mecanum (holonomic)',
};

export const isHolonomic = (t: DriveType): boolean => t === 'swerve' || t === 'xdrive';

export interface DriveParams {
  /** Free top speed of the chassis, m/s. */
  maxSpeed: number;
  /** Linear acceleration limit, m/s^2 (traction / motor torque). */
  maxAccel: number;
  /** Deceleration limit, m/s^2. Usually higher than accel (braking). */
  maxDecel: number;
  /** Maximum yaw rate, rad/s. */
  maxTurnRate: number;
  /** Yaw acceleration limit, rad/s^2. */
  maxTurnAccel: number;
  /** Distance between left and right wheels, m. */
  trackWidth: number;
}

export interface DriverTuning {
  /** Stick deadzone, 0..0.5 */
  deadzone: number;
  /** 0 = linear response, 1 = fully cubic. */
  expo: number;
  /** Separate expo for rotation. */
  turnExpo: number;
  /** Speed multiplier while precision mode is held. */
  slowScale: number;
}

export interface DriveInput {
  /** Sticks in -1..1. Y is positive when pushed away from the driver. */
  lx: number;
  ly: number;
  rx: number;
  ry: number;
  slow: boolean;
  /** Holonomic only: translate relative to the driver station instead of the robot. */
  fieldOriented: boolean;
}

export interface ChassisCommand {
  /** World-frame velocity, m/s. */
  vx: number;
  vz: number;
  /** Yaw rate, rad/s. */
  omega: number;
}

/** Apply deadzone (rescaled so output is continuous) and an expo curve. */
export function shapeAxis(v: number, deadzone: number, expo: number): number {
  const a = Math.abs(v);
  if (a <= deadzone) return 0;
  const n = Math.min(1, (a - deadzone) / (1 - deadzone));
  const shaped = (1 - expo) * n + expo * n * n * n;
  return Math.sign(v) * shaped;
}

/** Robot forward unit vector (x, z) for a heading. */
export function forwardOf(theta: number): [number, number] {
  return [Math.cos(theta), -Math.sin(theta)];
}

/** Robot right-hand unit vector (x, z) for a heading. */
export function rightOf(theta: number): [number, number] {
  return [Math.sin(theta), Math.cos(theta)];
}

/**
 * Turn driver input into a target chassis command.
 * @param heading robot heading (rad)
 * @param driverYaw heading the driver is facing when looking at the field (rad)
 */
export function targetCommand(
  type: DriveType,
  raw: DriveInput,
  heading: number,
  driverYaw: number,
  p: DriveParams,
  t: DriverTuning,
): ChassisCommand {
  const lx = shapeAxis(raw.lx, t.deadzone, t.expo);
  const ly = shapeAxis(raw.ly, t.deadzone, t.expo);
  const rx = shapeAxis(raw.rx, t.deadzone, t.turnExpo);
  const ry = shapeAxis(raw.ry, t.deadzone, t.expo);
  const scale = raw.slow ? t.slowScale : 1;

  if (type === 'swerve' || type === 'xdrive') {
    let tx = lx;
    let ty = ly;
    const mag = Math.hypot(tx, ty);
    if (mag > 1) {
      tx /= mag;
      ty /= mag;
    }
    let rot = -rx;
    // Wheel saturation: translation + rotation share the same module speed budget.
    const radius = p.trackWidth * Math.SQRT1_2;
    const transSpeed = Math.hypot(tx, ty) * p.maxSpeed;
    const rotSpeed = Math.abs(rot) * p.maxTurnRate * radius;
    const budget = transSpeed + rotSpeed;
    let k = 1;
    if (budget > p.maxSpeed) k = p.maxSpeed / budget;
    // X-drives lose some top speed and turning authority to roller scrub.
    const efficiency = type === 'xdrive' ? 0.92 : 1;
    tx *= k * efficiency;
    ty *= k * efficiency;
    rot *= k;

    const frameYaw = raw.fieldOriented ? driverYaw : heading;
    const [fx, fz] = forwardOf(frameYaw);
    const [rxv, rzv] = rightOf(frameYaw);
    const speed = p.maxSpeed * scale;
    return {
      vx: (ty * fx + tx * rxv) * speed,
      vz: (ty * fz + tx * rzv) * speed,
      omega: rot * p.maxTurnRate * scale,
    };
  }

  // Differential drives: compute normalized left/right wheel speeds.
  let left: number;
  let right: number;
  if (type === 'tank') {
    left = ly;
    right = ry;
  } else {
    const throttle = ly;
    const turn = type === 'arcade' ? lx : rx;
    left = throttle + turn;
    right = throttle - turn;
    const m = Math.max(1, Math.abs(left), Math.abs(right));
    left /= m;
    right /= m;
  }
  const v = ((left + right) / 2) * p.maxSpeed * scale;
  // Physical yaw rate from wheel speed difference, capped by the scrub-limited max.
  const wPhysical = ((right - left) * p.maxSpeed) / p.trackWidth;
  const omega = clamp(wPhysical, -p.maxTurnRate, p.maxTurnRate) * scale;
  const [fx, fz] = forwardOf(heading);
  return { vx: fx * v, vz: fz * v, omega };
}

/**
 * Move the current command toward the target while respecting acceleration limits.
 * Differential drives cannot slide sideways, so lateral velocity is bled off fast
 * (simulating wheel traction) instead of being treated as controllable.
 */
export function stepChassis(
  type: DriveType,
  current: ChassisCommand,
  target: ChassisCommand,
  heading: number,
  p: DriveParams,
  dt: number,
): ChassisCommand {
  const dvx = target.vx - current.vx;
  const dvz = target.vz - current.vz;
  const dmag = Math.hypot(dvx, dvz);
  // Decelerating if the target speed is lower than the current speed.
  const slowing = Math.hypot(target.vx, target.vz) < Math.hypot(current.vx, current.vz);
  const limit = (slowing ? p.maxDecel : p.maxAccel) * dt;
  let vx = target.vx;
  let vz = target.vz;
  if (dmag > limit && dmag > 0) {
    vx = current.vx + (dvx / dmag) * limit;
    vz = current.vz + (dvz / dmag) * limit;
  }

  if (!isHolonomic(type)) {
    // Project onto the robot's forward axis; kill sideways slip.
    const [fx, fz] = forwardOf(heading);
    const along = vx * fx + vz * fz;
    vx = fx * along;
    vz = fz * along;
  }

  const dw = target.omega - current.omega;
  const wl = p.maxTurnAccel * dt;
  const omega = Math.abs(dw) > wl ? current.omega + Math.sign(dw) * wl : target.omega;
  return { vx, vz, omega };
}
