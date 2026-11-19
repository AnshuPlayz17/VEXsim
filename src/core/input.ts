import type { DriveType } from '../robot/drivetrain';
import { type Binding, activeGamepad, isVexController, profileFor, readAxis } from './gamepad';

/** One-shot actions (edge triggered). */
export type Action =
  | 'flip'
  | 'descore'
  | 'feed'
  | 'camera'
  | 'fieldToggle'
  | 'pause'
  | 'restart'
  | 'help'
  | 'ghost';

export interface ControlState {
  lx: number;
  ly: number;
  rx: number;
  ry: number;
  intake: boolean;
  outtake: boolean;
  /** Lift up / down (hold). */
  liftUp: boolean;
  liftDown: boolean;
  /** Placement assist only: auto-place on the Goal in front. */
  score: boolean;
  slow: boolean;
  actions: Set<Action>;
  usingGamepad: boolean;
  gamepadName: string | null;
  /** A VEX V5 Controller is the active gamepad. */
  vexController: boolean;
  /** It hasn't been mapped yet (using the default guess). */
  needsMapping: boolean;
}

const KEY_TURN_SCALE = 0.6;

const KEY_ACTIONS: Record<string, Action> = {
  KeyR: 'flip',
  KeyG: 'descore',
  KeyB: 'feed',
  KeyC: 'camera',
  KeyO: 'fieldToggle',
  Escape: 'pause',
  KeyP: 'pause',
  Backspace: 'restart',
  KeyH: 'help',
  KeyY: 'ghost',
};

const ACTIONS: Action[] = ['flip', 'descore', 'feed', 'camera', 'fieldToggle', 'pause', 'restart', 'ghost'];

export class Input {
  private keys = new Set<string>();
  private pressedKeys = new Set<string>();
  private prevPad: Partial<Record<Action, boolean>> = {};
  private lastPadActivity = -Infinity;
  private lastKeyActivity = 0;
  /** When false, game keys are ignored (e.g. while a menu text field is focused). */
  enabled = true;

  constructor() {
    window.addEventListener('keydown', (e) => {
      if (isTyping(e)) return;
      if (!this.keys.has(e.code)) this.pressedKeys.add(e.code);
      this.keys.add(e.code);
      this.lastKeyActivity = performance.now();
      if (this.enabled && (e.code.startsWith('Arrow') || e.code === 'Space' || e.code === 'Backspace' || e.code === 'Tab')) {
        e.preventDefault();
      }
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
  }

  private key(...codes: string[]): boolean {
    return codes.some((c) => this.keys.has(c));
  }

  private axisKeys(neg: string[], pos: string[]): number {
    return (this.key(...pos) ? 1 : 0) - (this.key(...neg) ? 1 : 0);
  }

  /** Read every control. Call once per rendered frame. */
  poll(drive: DriveType): ControlState {
    const actions = new Set<Action>();
    for (const code of this.pressedKeys) {
      const a = KEY_ACTIONS[code];
      if (a) actions.add(a);
    }
    this.pressedKeys.clear();

    // Keyboard sticks.
    const kW = this.axisKeys(['KeyS'], ['KeyW']);
    const kA = this.axisKeys(['KeyA'], ['KeyD']);
    // Keys are all-or-nothing, so turning is softened to stay controllable.
    const kTurn = KEY_TURN_SCALE * this.axisKeys(['ArrowLeft', 'KeyQ', 'KeyJ'], ['ArrowRight', 'KeyE', 'KeyL']);
    let lx = kA;
    let ly = kW;
    let rx = kTurn;
    let ry = 0;
    // Keyboards can't do two-stick tank, so differential drives use arcade-style keys:
    // W/S throttle, A/D (or arrows) turn. The drive model still converts that into
    // left/right wheel speeds, so the robot behaves like the real drivetrain.
    if (drive === 'tank') {
      const turn = kA !== 0 ? kA * KEY_TURN_SCALE : kTurn;
      const l = clampUnit(kW + turn);
      const r = clampUnit(kW - turn);
      ly = l;
      ry = r;
    } else if (drive === 'splitArcade') {
      if (rx === 0) rx = kA * KEY_TURN_SCALE;
    } else if (drive === 'arcade') {
      if (lx !== 0) lx *= KEY_TURN_SCALE;
      if (lx === 0) lx = kTurn;
    }

    let intake = this.key('Space');
    let outtake = this.key('KeyV');
    let score = this.key('KeyF', 'Enter');
    let liftUp = this.key('ArrowUp', 'KeyI');
    let liftDown = this.key('ArrowDown', 'KeyK');
    let slow = this.key('ShiftLeft', 'ShiftRight');

    let usingGamepad = false;
    let gamepadName: string | null = null;
    let vexController = false;
    let needsMapping = false;
    const pad = activeGamepad();
    if (pad) {
      gamepadName = pad.id;
      vexController = isVexController(pad);
      const prof = profileFor(pad);
      needsMapping = vexController && !prof.custom;
      const btn = (k: Binding) => {
        const i = prof.buttons[k];
        return i !== undefined && !!pad.buttons[i]?.pressed;
      };
      const g = { lx: readAxis(pad, prof.sticks.lx), ly: readAxis(pad, prof.sticks.ly), rx: readAxis(pad, prof.sticks.rx), ry: readAxis(pad, prof.sticks.ry) };
      const moving = Math.max(Math.abs(g.lx), Math.abs(g.ly), Math.abs(g.rx), Math.abs(g.ry)) > 0.15;
      const anyButton = pad.buttons.some((x) => x.pressed);
      if (moving || anyButton) this.lastPadActivity = performance.now();
      usingGamepad = this.lastPadActivity > this.lastKeyActivity;
      if (usingGamepad) {
        lx = g.lx;
        ly = g.ly;
        rx = g.rx;
        ry = g.ry;
      }
      intake ||= btn('intake');
      outtake ||= btn('outtake');
      score ||= btn('score');
      liftUp ||= btn('liftUp');
      liftDown ||= btn('liftDown');
      slow ||= btn('slow');
      for (const a of ACTIONS) {
        const now = btn(a);
        if (now && !this.prevPad[a]) actions.add(a);
        this.prevPad[a] = now;
      }
    }

    if (!this.enabled) {
      return {
        lx: 0, ly: 0, rx: 0, ry: 0, intake: false, outtake: false, liftUp: false, liftDown: false, score: false, slow: false,
        actions: new Set([...actions].filter((a) => a === 'pause')), usingGamepad, gamepadName, vexController, needsMapping,
      };
    }
    return { lx, ly, rx, ry, intake, outtake, liftUp, liftDown, score, slow, actions, usingGamepad, gamepadName, vexController, needsMapping };
  }
}

function clampUnit(v: number): number {
  return Math.max(-1, Math.min(1, v));
}

function isTyping(e: KeyboardEvent): boolean {
  const t = e.target as HTMLElement | null;
  if (!t) return false;
  return t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA';
}

export const CONTROL_HELP: { action: string; keyboard: string; gamepad: string; v5: string }[] = [
  { action: 'Drive (tank/arcade: W/S throttle, A/D turn; X-drive: A/D strafe)', keyboard: 'W A S D', gamepad: 'Left stick', v5: 'Left joystick (Axis 3/4)' },
  { action: 'Turn / rotate', keyboard: '← → (or Q E)', gamepad: 'Right stick', v5: 'Right joystick (Axis 1/2)' },
  { action: 'Tank drive', keyboard: 'arcade-style on keys', gamepad: 'Left Y / Right Y', v5: 'Axis 3 / Axis 2' },
  { action: 'Lift up (hold)', keyboard: '↑ or I', gamepad: 'RB', v5: 'L1' },
  { action: 'Lift down (hold)', keyboard: '↓ or K', gamepad: 'LB', v5: 'L2' },
  { action: 'Intake / close claw (hold). Lift down to grab off the floor, at the top of a stack to descore', keyboard: 'Space', gamepad: 'RT', v5: 'R1' },
  { action: 'Release / open claw. Over a Goal at the right height it scores; anywhere else it drops', keyboard: 'V', gamepad: 'LT', v5: 'R2' },
  { action: 'Flip the wrist (which Pin half or Cup side goes down)', keyboard: 'R', gamepad: 'A', v5: 'A' },
  { action: 'Precision drive (hold)', keyboard: 'Shift', gamepad: 'X', v5: 'X' },
  { action: 'Match Load at your Loader', keyboard: 'B', gamepad: 'B', v5: 'B' },
  { action: 'Cycle camera', keyboard: 'C', gamepad: 'Y', v5: 'Y' },
  { action: 'Placement assist only: auto-place / descore', keyboard: 'F / G', gamepad: 'LT near a Goal / D-pad ↓', v5: 'R2 near a Goal' },
  { action: 'Field-oriented on/off', keyboard: 'O', gamepad: 'R3', v5: 'Up' },
  { action: 'Ghost of best run on/off', keyboard: 'Y', gamepad: 'D-pad ←', v5: 'Down' },
  { action: 'Restart', keyboard: 'Backspace', gamepad: 'Back', v5: 'Left' },
  { action: 'Pause', keyboard: 'Esc / P', gamepad: 'Start', v5: 'Right' },
  { action: 'Show / hide controls', keyboard: 'H', gamepad: '—', v5: '—' },
];
