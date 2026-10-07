import type { DriveType } from '../robot/drivetrain';

/** One-shot actions (edge triggered). */
export type Action =
  | 'flip'
  | 'descore'
  | 'feed'
  | 'camera'
  | 'fieldToggle'
  | 'pause'
  | 'restart'
  | 'shooterUp'
  | 'shooterDown'
  | 'help'
  | 'ghost';

export interface ControlState {
  lx: number;
  ly: number;
  rx: number;
  ry: number;
  intake: boolean;
  outtake: boolean;
  score: boolean;
  slow: boolean;
  climb: boolean;
  actions: Set<Action>;
  usingGamepad: boolean;
  gamepadName: string | null;
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
  BracketRight: 'shooterUp',
  BracketLeft: 'shooterDown',
  KeyH: 'help',
  KeyY: 'ghost',
};

// Standard Gamepad mapping (Xbox / PlayStation / most USB controllers).
const PAD = {
  A: 0, B: 1, X: 2, Y: 3, LB: 4, RB: 5, LT: 6, RT: 7, BACK: 8, START: 9, LS: 10, RS: 11,
  UP: 12, DOWN: 13, LEFT: 14, RIGHT: 15,
};

const PAD_ACTIONS: [number, Action][] = [
  [PAD.A, 'flip'],
  [PAD.X, 'descore'],
  [PAD.B, 'feed'],
  [PAD.Y, 'camera'],
  [PAD.RS, 'fieldToggle'],
  [PAD.START, 'pause'],
  [PAD.BACK, 'restart'],
  [PAD.UP, 'shooterUp'],
  [PAD.DOWN, 'shooterDown'],
  [PAD.LEFT, 'ghost'],
];

export class Input {
  private keys = new Set<string>();
  private pressedKeys = new Set<string>();
  private prevPad: boolean[] = [];
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
    const kUpDown = this.axisKeys(['ArrowDown', 'KeyK'], ['ArrowUp', 'KeyI']);
    let lx = kA;
    let ly = kW;
    let rx = kTurn;
    let ry = kUpDown;
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
    let slow = this.key('ShiftLeft', 'ShiftRight');
    let climb = this.key('KeyT');

    let usingGamepad = false;
    let gamepadName: string | null = null;
    const pad = firstGamepad();
    if (pad) {
      gamepadName = pad.id;
      const b = (i: number) => !!pad.buttons[i]?.pressed;
      const ax = (i: number) => pad.axes[i] ?? 0;
      const g = { lx: ax(0), ly: -ax(1), rx: ax(2), ry: -ax(3) };
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
      intake ||= b(PAD.RT);
      outtake ||= b(PAD.LT);
      score ||= b(PAD.RB);
      slow ||= b(PAD.LB);
      climb ||= b(PAD.A);
      for (const [idx, action] of PAD_ACTIONS) {
        const now = b(idx);
        if (now && !this.prevPad[idx]) actions.add(action);
      }
      this.prevPad = pad.buttons.map((x) => x.pressed);
    }

    if (!this.enabled) {
      return {
        lx: 0, ly: 0, rx: 0, ry: 0, intake: false, outtake: false, score: false, slow: false, climb: false,
        actions: new Set([...actions].filter((a) => a === 'pause')), usingGamepad, gamepadName,
      };
    }
    return { lx, ly, rx, ry, intake, outtake, score, slow, climb, actions, usingGamepad, gamepadName };
  }
}

function clampUnit(v: number): number {
  return Math.max(-1, Math.min(1, v));
}

function firstGamepad(): Gamepad | null {
  const pads = navigator.getGamepads ? navigator.getGamepads() : [];
  for (const p of pads) if (p && p.connected) return p;
  return null;
}

function isTyping(e: KeyboardEvent): boolean {
  const t = e.target as HTMLElement | null;
  if (!t) return false;
  return t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA';
}

export const CONTROL_HELP: { action: string; keyboard: string; gamepad: string }[] = [
  { action: 'Drive (tank/arcade: W/S throttle, A/D turn)', keyboard: 'W A S D', gamepad: 'Left stick' },
  { action: 'Rotate (holonomic) / turn', keyboard: '← → (or Q E)', gamepad: 'Right stick' },
  { action: 'Tank drive', keyboard: 'arcade-style on keys', gamepad: 'Left Y = left, Right Y = right' },
  { action: 'Intake (hold)', keyboard: 'Space', gamepad: 'RT' },
  { action: 'Outtake / eject (hold)', keyboard: 'V', gamepad: 'LT' },
  { action: 'Score / shoot (hold)', keyboard: 'F', gamepad: 'RB' },
  { action: 'Precision mode (hold)', keyboard: 'Shift', gamepad: 'LB' },
  { action: 'VEX: flip pin color · FRC: climb (hold)', keyboard: 'R · T', gamepad: 'A' },
  { action: 'VEX: descore top of goal · FRC: climb down', keyboard: 'G', gamepad: 'X' },
  { action: 'VEX: match-load cup · FRC: human player feed', keyboard: 'B', gamepad: 'B' },
  { action: 'FRC manual shooter speed', keyboard: '[ ]', gamepad: 'D-pad ↑ ↓' },
  { action: 'Cycle camera', keyboard: 'C', gamepad: 'Y' },
  { action: 'Field-oriented on/off', keyboard: 'O', gamepad: 'R3' },
  { action: 'Ghost of best run on/off', keyboard: 'Y', gamepad: 'D-pad ←' },
  { action: 'Pause', keyboard: 'Esc / P', gamepad: 'Start' },
  { action: 'Restart', keyboard: 'Backspace', gamepad: 'Back' },
  { action: 'Show / hide controls', keyboard: 'H', gamepad: '—' },
];
