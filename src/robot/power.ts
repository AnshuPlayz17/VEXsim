/**
 * V5 battery and Smart Motor thermals. Pure, so it can be unit tested.
 *
 * Battery: 12.8 V nominal LiFePO4, 1100 mAh. Its terminal voltage drops with the
 * current drawn (pack + wiring resistance) and slowly as it discharges, and the motors
 * see that as less top speed and torque.
 *
 * Motors: each V5 motor's current is limited to 2.5 A. Heat follows a first-order model
 * (the steady temperature rises with current squared). Like the real motor firmware, the
 * current limit halves at 55 °C, quarters at 60 °C and the motor stops at 65 °C.
 */
export const BATTERY = { nominal: 12.8, motorRated: 12.0, capacityAh: 1.1, resistance: 0.12, emptyDrop: 1.0 };
export const MOTOR = { maxCurrent: 2.5, ambient: 25, riseAtMax: 50, tau: 110 };

export interface PowerState {
  /** Charge left, 0..1. */
  charge: number;
  /** Average drive-motor temperature, °C. */
  temp: number;
  /** Battery terminal voltage, V. */
  volts: number;
}

export function freshPower(): PowerState {
  return { charge: 1, temp: MOTOR.ambient, volts: BATTERY.nominal };
}

/** Fraction of the motor's current limit allowed at a temperature (V5 firmware steps). */
export function thermalLimit(temp: number): number {
  if (temp >= 65) return 0;
  if (temp >= 60) return 0.25;
  if (temp >= 55) return 0.5;
  return 1;
}

/** Voltage scale the motors see, relative to their rated 12 V (capped at 1). */
export function supplyScale(s: PowerState): number {
  return Math.min(1, s.volts / BATTERY.motorRated);
}

/**
 * Advance the battery and motor temperature.
 * @param driveAmps average current per drive motor, A
 * @param motors number of drive motors
 * @param otherAmps current drawn by the other motors (lift, intake), A
 */
export function stepPower(s: PowerState, dt: number, driveAmps: number, motors: number, otherAmps: number): PowerState {
  const total = driveAmps * motors + otherAmps;
  const charge = Math.max(0, s.charge - (total * dt) / 3600 / BATTERY.capacityAh);
  const volts = BATTERY.nominal - total * BATTERY.resistance - (1 - charge) * BATTERY.emptyDrop;
  const ratio = driveAmps / MOTOR.maxCurrent;
  const steady = MOTOR.ambient + MOTOR.riseAtMax * ratio * ratio;
  const temp = s.temp + (steady - s.temp) * (1 - Math.exp(-dt / MOTOR.tau));
  return { charge, temp, volts };
}
