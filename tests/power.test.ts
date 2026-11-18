import { describe, expect, it } from 'vitest';
import { freshPower, stepPower, supplyScale, thermalLimit } from '../src/robot/power';
import { stepDrive, type Powertrain } from '../src/robot/drivetrain';

const P: Powertrain = { motors: 6, cartridge: 'blue', wheelRpm: 450, wheelDia: 3.25 * 0.0254, mass: 6.4, mu: 0.9, trackWidth: 0.32, wheelbase: 0.28, scrub: 0.22, brake: 'brake' };

describe('V5 battery and motor heat', () => {
  it('sags under load and recovers at rest', () => {
    const loaded = stepPower(freshPower(), 0.01, 2.5, 6, 0);
    expect(loaded.volts).toBeLessThan(11.2);
    expect(supplyScale(loaded)).toBeLessThan(0.95);
    expect(stepPower(loaded, 0.01, 0, 6, 0).volts).toBeGreaterThan(12.7);
  });

  it('a pushing match at stall overheats in under two minutes; normal driving does not', () => {
    let pushing = freshPower();
    let driving = freshPower();
    for (let t = 0; t < 105; t += 0.1) {
      pushing = stepPower(pushing, 0.1, 2.5, 6, 0);
      driving = stepPower(driving, 0.1, 0.9, 6, 1);
    }
    expect(pushing.temp).toBeGreaterThan(55);
    expect(thermalLimit(pushing.temp)).toBeLessThan(1);
    expect(driving.temp).toBeLessThan(40);
    expect(driving.charge).toBeGreaterThan(0.5);
  });

  it('a sagging battery lowers top speed and the current limit lowers pushing force', () => {
    const run = (voltage: number, limit: number) => {
      let s = { vx: 0, vz: 0, omega: 0 };
      for (let i = 0; i < 600; i++) s = stepDrive('tank', P, 0.38, 0.38, s, [1, 1], 0, 1 / 120, { voltage, limit });
      return s.vx;
    };
    expect(run(0.85, 1)).toBeLessThan(run(1, 1) * 0.9);
    const sup = { voltage: 1, limit: 0.5, amps: 0 };
    stepDrive('tank', P, 0.38, 0.38, { vx: 0, vz: 0, omega: 0 }, [1, 1], 0, 1 / 120, sup);
    expect(sup.amps).toBeCloseTo(1.25, 2);
  });
});
