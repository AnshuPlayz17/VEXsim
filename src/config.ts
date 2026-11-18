import type { DriveType, DriverTuning } from './robot/drivetrain';
import type { GameId, ModeId } from './games/types';
import type { Alliance } from './robot/robot';

export type CameraMode = 'driver' | 'follow' | 'top' | 'pov';

/** Per-robot overrides the driver can tune in the setup screen. */
export interface RobotTweaks {
  drive?: DriveType;
  /** Wheel rpm (gearing). */
  wheelRpm?: number;
  /** Wheel diameter, inches. */
  wheelIn?: number;
  motors?: number;
  /** Robot weight, lb. */
  weightLb?: number;
  brake?: 'coast' | 'brake';
  capacity?: number;
}

export interface Settings {
  game: GameId;
  mode: Record<GameId, ModeId>;
  preset: Record<GameId, string>;
  tweaks: Record<string, RobotTweaks>;
  alliance: Alliance;
  station: Record<GameId, string>;
  startIndex: number;
  tuning: DriverTuning;
  fieldOriented: boolean;
  camera: CameraMode;
  showGhost: boolean;
  sound: boolean;
  quality: 'high' | 'low';
  countdown: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  game: 'override',
  mode: { override: 'match' },
  preset: { override: 'vex-dr4b' },
  tweaks: {},
  alliance: 'red',
  station: { override: 'red-left' },
  startIndex: 0,
  tuning: { deadzone: 0.08, expo: 0.35, turnExpo: 0.45, slowScale: 0.4 },
  fieldOriented: true,
  camera: 'driver',
  showGhost: true,
  sound: true,
  quality: 'high',
  countdown: true,
};

const KEY = 'vexsim.settings.v2';

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return structuredClone(DEFAULT_SETTINGS);
    const parsed = JSON.parse(raw) as Partial<Settings>;
    return deepMerge(structuredClone(DEFAULT_SETTINGS), parsed);
  } catch {
    return structuredClone(DEFAULT_SETTINGS);
  }
}

export function saveSettings(s: Settings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    // Storage unavailable (private mode); settings just won't persist.
  }
}

function deepMerge<T>(base: T, over: Partial<T>): T {
  for (const k of Object.keys(over) as (keyof T)[]) {
    const v = over[k];
    if (v === undefined) continue;
    const b = base[k];
    if (b && typeof b === 'object' && !Array.isArray(b) && typeof v === 'object' && v !== null) {
      base[k] = deepMerge(b, v as Partial<typeof b>);
    } else {
      base[k] = v as T[keyof T];
    }
  }
  return base;
}
