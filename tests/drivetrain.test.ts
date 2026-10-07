import { describe, expect, it } from 'vitest';
import { shapeAxis, stepChassis, targetCommand, type DriveParams, type DriverTuning } from '../src/robot/drivetrain';

const P: DriveParams = { maxSpeed: 2, maxAccel: 4, maxDecel: 8, maxTurnRate: 6, maxTurnAccel: 30, trackWidth: 0.3 };
const T: DriverTuning = { deadzone: 0.1, expo: 0, turnExpo: 0, slowScale: 0.5 };
const input = (o: Partial<{ lx: number; ly: number; rx: number; ry: number; slow: boolean; fieldOriented: boolean }>) => ({
  lx: 0, ly: 0, rx: 0, ry: 0, slow: false, fieldOriented: false, ...o,
});

describe('shapeAxis', () => {
  it('applies the deadzone and stays continuous', () => {
    expect(shapeAxis(0.05, 0.1, 0)).toBe(0);
    expect(shapeAxis(0.1001, 0.1, 0)).toBeCloseTo(0, 3);
    expect(shapeAxis(1, 0.1, 0)).toBe(1);
    expect(shapeAxis(-1, 0.1, 0.5)).toBe(-1);
  });
  it('expo softens the middle of the stick', () => {
    expect(shapeAxis(0.5, 0, 1)).toBeCloseTo(0.125);
    expect(shapeAxis(0.5, 0, 0)).toBeCloseTo(0.5);
  });
});

describe('targetCommand', () => {
  it('tank: equal sticks drive straight along the heading', () => {
    const c = targetCommand('tank', input({ ly: 1, ry: 1 }), 0, 0, P, T);
    expect(c.vx).toBeCloseTo(2);
    expect(c.vz).toBeCloseTo(0);
    expect(c.omega).toBeCloseTo(0);
  });
  it('tank: opposite sticks spin in place, capped by max turn rate', () => {
    const c = targetCommand('tank', input({ ly: -1, ry: 1 }), 0, 0, P, T);
    expect(Math.hypot(c.vx, c.vz)).toBeCloseTo(0);
    expect(c.omega).toBeCloseTo(6); // right side forward => turn left (CCW, positive)
  });
  it('arcade: stick right turns clockwise', () => {
    const c = targetCommand('arcade', input({ lx: 1 }), 0, 0, P, T);
    expect(c.omega).toBeLessThan(0);
  });
  it('swerve field-oriented ignores robot heading', () => {
    const a = targetCommand('swerve', input({ ly: 1, fieldOriented: true }), 1.2, 0, P, T);
    expect(a.vx).toBeCloseTo(2);
    expect(a.vz).toBeCloseTo(0);
  });
  it('swerve robot-oriented follows robot heading', () => {
    const a = targetCommand('swerve', input({ ly: 1 }), Math.PI / 2, 0, P, T);
    expect(a.vx).toBeCloseTo(0);
    expect(a.vz).toBeCloseTo(-2);
  });
  it('holonomic translation + rotation share the wheel speed budget', () => {
    const a = targetCommand('swerve', input({ ly: 1, rx: 1 }), 0, 0, P, T);
    const radius = P.trackWidth * Math.SQRT1_2;
    expect(Math.hypot(a.vx, a.vz) + Math.abs(a.omega) * radius).toBeLessThanOrEqual(P.maxSpeed + 1e-9);
  });
  it('precision mode scales speed', () => {
    const c = targetCommand('tank', input({ ly: 1, ry: 1, slow: true }), 0, 0, P, T);
    expect(c.vx).toBeCloseTo(1);
  });
});

describe('stepChassis', () => {
  it('limits acceleration', () => {
    const c = stepChassis('swerve', { vx: 0, vz: 0, omega: 0 }, { vx: 2, vz: 0, omega: 0 }, 0, P, 0.1);
    expect(c.vx).toBeCloseTo(0.4);
  });
  it('brakes faster than it accelerates', () => {
    const c = stepChassis('swerve', { vx: 2, vz: 0, omega: 0 }, { vx: 0, vz: 0, omega: 0 }, 0, P, 0.1);
    expect(c.vx).toBeCloseTo(1.2);
  });
  it('differential drives cannot slide sideways', () => {
    const c = stepChassis('tank', { vx: 0, vz: 1, omega: 0 }, { vx: 0, vz: 1, omega: 0 }, 0, P, 0.01);
    expect(c.vz).toBeCloseTo(0);
  });
});
