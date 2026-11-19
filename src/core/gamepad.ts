import type { Action } from './input';

/**
 * Gamepad profiles. Standard controllers (Xbox, PlayStation…) work out of the
 * box. A VEX V5 Controller plugged in over micro-USB (and powered off, as VEX
 * describes for Virtual Skills) shows up in Chrome as a gamepad with its own,
 * non-standard axis and button numbering, so it gets mapped once with the
 * Controller setup screen and the mapping is saved per device.
 */
export type HoldBinding = 'intake' | 'outtake' | 'liftUp' | 'liftDown' | 'score' | 'slow';
export type Binding = HoldBinding | Action;

export interface AxisRef {
  index: number;
  invert: boolean;
}

export interface PadProfile {
  sticks: { lx: AxisRef; ly: AxisRef; rx: AxisRef; ry: AxisRef };
  buttons: Partial<Record<Binding, number>>;
  /** True once the driver has mapped this controller themselves. */
  custom: boolean;
}

/** Standard Gamepad mapping indices. */
const STD = { A: 0, B: 1, X: 2, Y: 3, LB: 4, RB: 5, LT: 6, RT: 7, BACK: 8, START: 9, LS: 10, RS: 11, UP: 12, DOWN: 13, LEFT: 14, RIGHT: 15 };

export const STANDARD_PROFILE: PadProfile = {
  sticks: { lx: { index: 0, invert: false }, ly: { index: 1, invert: true }, rx: { index: 2, invert: false }, ry: { index: 3, invert: true } },
  buttons: {
    intake: STD.RT, outtake: STD.LT, liftUp: STD.RB, liftDown: STD.LB, slow: STD.X,
    flip: STD.A, descore: STD.DOWN, feed: STD.B, camera: STD.Y,
    fieldToggle: STD.RS, pause: STD.START, restart: STD.BACK, ghost: STD.LEFT,
  },
  custom: false,
};

/** VEX's USB vendor id is 0x2888; Chrome puts it (and usually the name) in Gamepad.id. */
export function isVexController(pad: Gamepad): boolean {
  return /vex|2888/i.test(pad.id);
}

/**
 * Starting guess for a V5 Controller before it is mapped: VEX numbers the sticks
 * Axis 1 (right X), Axis 2 (right Y), Axis 3 (left Y), Axis 4 (left X).
 */
export const V5_GUESS: PadProfile = {
  sticks: { rx: { index: 0, invert: false }, ry: { index: 1, invert: true }, ly: { index: 2, invert: true }, lx: { index: 3, invert: false } },
  buttons: {
    liftUp: 4, liftDown: 5, intake: 6, outtake: 7,
    flip: 0, feed: 1, slow: 2, camera: 3,
    fieldToggle: 8, ghost: 9, restart: 10, pause: 11,
  },
  custom: false,
};

const KEY = 'vexsim.pads.v1';

function loadAll(): Record<string, PadProfile> {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '{}') as Record<string, PadProfile>;
  } catch {
    return {};
  }
}

export function profileFor(pad: Gamepad): PadProfile {
  const saved = loadAll()[pad.id];
  if (saved) {
    // Profiles mapped before the manual lift existed: L1/L2 were place/precision.
    if (saved.buttons.liftUp === undefined && saved.buttons.score !== undefined) {
      saved.buttons.liftUp = saved.buttons.score;
      saved.buttons.liftDown = saved.buttons.slow;
      saved.buttons.slow = saved.buttons.descore;
      delete saved.buttons.score;
      delete saved.buttons.descore;
    }
    return saved;
  }
  if (isVexController(pad)) return V5_GUESS;
  return pad.mapping === 'standard' ? STANDARD_PROFILE : { ...STANDARD_PROFILE, custom: false };
}

export function saveProfile(pad: Gamepad, profile: PadProfile): void {
  const all = loadAll();
  all[pad.id] = profile;
  try {
    localStorage.setItem(KEY, JSON.stringify(all));
  } catch {
    // storage unavailable
  }
}

export function clearProfile(pad: Gamepad): void {
  const all = loadAll();
  delete all[pad.id];
  try {
    localStorage.setItem(KEY, JSON.stringify(all));
  } catch {
    // storage unavailable
  }
}

export function readAxis(pad: Gamepad, a: AxisRef): number {
  const v = pad.axes[a.index] ?? 0;
  return a.invert ? -v : v;
}

export function activeGamepad(): Gamepad | null {
  const pads = navigator.getGamepads ? navigator.getGamepads() : [];
  let best: Gamepad | null = null;
  for (const p of pads) {
    if (!p || !p.connected) continue;
    // Prefer a VEX controller when several are plugged in.
    if (isVexController(p)) return p;
    best ??= p;
  }
  return best;
}

/** The mapping wizard's steps, labelled with V5 Controller names. */
export const MAP_STEPS: { id: 'lx' | 'ly' | 'rx' | 'ry' | Binding; prompt: string; kind: 'axis' | 'button' }[] = [
  { id: 'ly', prompt: 'Push the LEFT joystick UP (Axis 3)', kind: 'axis' },
  { id: 'lx', prompt: 'Push the LEFT joystick RIGHT (Axis 4)', kind: 'axis' },
  { id: 'ry', prompt: 'Push the RIGHT joystick UP (Axis 2)', kind: 'axis' },
  { id: 'rx', prompt: 'Push the RIGHT joystick RIGHT (Axis 1)', kind: 'axis' },
  { id: 'intake', prompt: 'Press the button for INTAKE / close claw (V5: R1)', kind: 'button' },
  { id: 'outtake', prompt: 'Press the button to RELEASE / open claw (V5: R2)', kind: 'button' },
  { id: 'liftUp', prompt: 'Press the button for LIFT UP (V5: L1)', kind: 'button' },
  { id: 'liftDown', prompt: 'Press the button for LIFT DOWN (V5: L2)', kind: 'button' },
  { id: 'flip', prompt: 'Press the button to FLIP the wrist (V5: A)', kind: 'button' },
  { id: 'slow', prompt: 'Press the button for PRECISION drive (V5: X)', kind: 'button' },
  { id: 'feed', prompt: 'Press the button for MATCH LOAD (V5: B)', kind: 'button' },
  { id: 'camera', prompt: 'Press the button to switch CAMERA (V5: Y)', kind: 'button' },
  { id: 'fieldToggle', prompt: 'Press the button for FIELD-ORIENTED on/off (V5: Up)', kind: 'button' },
  { id: 'ghost', prompt: 'Press the button to show/hide the GHOST (V5: Down)', kind: 'button' },
  { id: 'restart', prompt: 'Press the button to RESTART (V5: Left)', kind: 'button' },
  { id: 'pause', prompt: 'Press the button to PAUSE (V5: Right)', kind: 'button' },
];

/** Drives the mapping wizard: call `poll` every frame; it reports progress. */
export class PadMapper {
  step = 0;
  private baseAxes: number[] = [];
  private waitRelease = true;
  readonly profile: PadProfile;

  constructor(private pad: Gamepad) {
    this.profile = structuredClone(profileFor(pad));
    this.profile.custom = true;
  }

  get done(): boolean {
    return this.step >= MAP_STEPS.length;
  }

  get prompt(): string {
    return this.done ? 'All set!' : MAP_STEPS[this.step].prompt;
  }

  skip(): void {
    this.step++;
    this.waitRelease = true;
  }

  poll(): void {
    if (this.done) return;
    const pad = navigator.getGamepads?.()[this.pad.index];
    if (!pad) return;
    const axes = [...pad.axes];
    const anyButton = pad.buttons.some((b) => b.pressed);
    if (this.waitRelease) {
      // Wait for sticks to center and buttons to be released, then take a baseline.
      if (!anyButton && axes.every((v) => Math.abs(v) < 0.35)) {
        this.baseAxes = axes;
        this.waitRelease = false;
      }
      return;
    }
    const s = MAP_STEPS[this.step];
    if (s.kind === 'axis') {
      let best = -1;
      let bestD = 0.6;
      axes.forEach((v, i) => {
        const d = Math.abs(v - (this.baseAxes[i] ?? 0));
        if (d > bestD) {
          bestD = d;
          best = i;
        }
      });
      if (best >= 0) {
        const v = axes[best] - (this.baseAxes[best] ?? 0);
        this.profile.sticks[s.id as 'lx' | 'ly' | 'rx' | 'ry'] = { index: best, invert: v < 0 };
        this.skip();
      }
    } else {
      const i = pad.buttons.findIndex((b) => b.pressed);
      if (i >= 0) {
        this.profile.buttons[s.id as Binding] = i;
        this.skip();
      }
    }
  }

  save(): void {
    saveProfile(this.pad, this.profile);
  }
}
