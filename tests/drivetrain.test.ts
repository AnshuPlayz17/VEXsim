import { describe, expect, it } from 'vitest';
import {
  type ChassisState,
  type DriverTuning,
  type Powertrain,
  driveSummary,
  driverVoltages,
  freeSpeed,
  shapeAxis,
  stallForcePerMotor,
  stepDrive,
} from '../src/robot/drivetrain';

const IN = 0.0254;
const P: Powertrain = {
  motors: 6, cartridge: 'blue', wheelRpm: 450, wheelDia: 3.25 * IN, mass: 6.35, mu: 0.9,
  trackWidth: 12.5 * IN, wheelbase: 11 * IN, scrub: 0.22, brake: 'brake',
};
const T: DriverTuning = { deadzone: 0.05, expo: 0, turnExpo: 0, slowScale: 0.5 };
const L = 15 * IN;
const W = 15 * IN;
const input = (o: Partial<{ lx: number; ly: number; rx: number; ry: number; slow: boolean; fieldOriented: boolean }>) => ({
  lx: 0, ly: 0, rx: 0, ry: 0, slow: false, fieldOriented: false, ...o,
});
const run = (type: 'tank' | 'xdrive', p: Powertrain, u: number[], seconds: number, start: ChassisState = { vx: 0, vz: 0, omega: 0 }, heading0 = 0) => {
  let s = start;
  let heading = heading0;
  for (let t = 0; t < seconds; t += 1 / 120) {
    s = stepDrive(type, p, L, W, s, u, heading, 1 / 120);
    heading += s.omega / 120;
  }
  return { s, heading };
};

describe('V5 motor model', () => {
  it('450 rpm on 3.25" wheels is ~1.95 m/s free speed', () => {
    expect(freeSpeed(P)).toBeCloseTo(1.945, 2);
  });

  it('a 600 rpm cartridge geared to 450 rpm makes ~11 N per motor at the tiles', () => {
    expect(stallForcePerMotor(P)).toBeGreaterThan(10);
    expect(stallForcePerMotor(P)).toBeLessThan(12.5);
  });

  it('full throttle approaches (but never exceeds) free speed', () => {
    const { s } = run('tank', P, [1, 1], 3);
    expect(s.vx).toBeGreaterThan(freeSpeed(P) * 0.9);
    expect(s.vx).toBeLessThanOrEqual(freeSpeed(P));
  });

  it('accelerates quickly at first and tapers off (motor curve)', () => {
    const a = run('tank', P, [1, 1], 0.1).s.vx;
    const b = run('tank', P, [1, 1], 0.2).s.vx;
    expect(a).toBeGreaterThan(0.6);
    expect(b - a).toBeLessThan(a);
  });

  it('a heavier robot accelerates slower', () => {
    const light = run('tank', P, [1, 1], 0.15).s.vx;
    const heavy = run('tank', { ...P, mass: P.mass * 1.6 }, [1, 1], 0.15).s.vx;
    expect(heavy).toBeLessThan(light);
  });

  it('brake mode stops much faster than coast', () => {
    const moving = { vx: 1.8, vz: 0, omega: 0 };
    const brake = run('tank', P, [0, 0], 0.25, moving).s.vx;
    const coast = run('tank', { ...P, brake: 'coast' }, [0, 0], 0.25, moving).s.vx;
    expect(brake).toBeLessThan(coast);
    expect(coast).toBeGreaterThan(0.5);
  });

  it('opposite sides spin the robot in place', () => {
    const { s } = run('tank', P, [-1, 1], 1);
    expect(Math.hypot(s.vx, s.vz)).toBeLessThan(0.05);
    expect(s.omega).toBeGreaterThan(3); // counter-clockwise
  });

  it('tank drives cannot slide sideways', () => {
    const { s } = run('tank', P, [0, 0], 0.3, { vx: 0, vz: 1, omega: 0 });
    expect(Math.abs(s.vz)).toBeLessThan(0.05);
  });

  it('an X-drive strafes', () => {
    const u = driverVoltages('xdrive', input({ lx: 1 }), 0, 0, T);
    const { s } = run('xdrive', { ...P, motors: 4, scrub: 0 }, u, 1.5);
    // Right of a robot facing +X is +Z.
    expect(s.vz).toBeGreaterThan(1);
    expect(Math.abs(s.vx)).toBeLessThan(0.1);
  });

  it('field-oriented X-drive pushes away from the driver whatever the heading', () => {
    const u = driverVoltages('xdrive', input({ ly: 1, fieldOriented: true }), Math.PI / 2, 0, T);
    const { s } = run('xdrive', { ...P, motors: 4, scrub: 0 }, u, 0.4, undefined, Math.PI / 2);
    expect(s.vx).toBeGreaterThan(0.5);
    expect(Math.abs(s.vz)).toBeLessThan(0.15);
  });

  it('summary numbers are sane', () => {
    const sum = driveSummary(P, L, W);
    expect(sum.topSpeed).toBeCloseTo(freeSpeed(P));
    expect(sum.accel).toBeLessThanOrEqual(0.9 * 9.81 + 1e-9);
    expect(sum.turnRate).toBeGreaterThan(3);
  });
});

describe('driver input', () => {
  it('deadzone and expo', () => {
    expect(shapeAxis(0.04, 0.05, 0)).toBe(0);
    expect(shapeAxis(1, 0.05, 0.5)).toBe(1);
    expect(shapeAxis(0.5, 0, 1)).toBeCloseTo(0.125);
  });
  it('arcade: stick right turns clockwise (left side faster)', () => {
    const [l, r] = driverVoltages('arcade', input({ lx: 1 }), 0, 0, T);
    expect(l).toBeGreaterThan(r);
  });
  it('precision mode scales voltage', () => {
    const [l] = driverVoltages('tank', input({ ly: 1, ry: 1, slow: true }), 0, 0, T);
    expect(l).toBeCloseTo(0.5);
  });
});
