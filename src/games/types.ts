import type * as THREE from 'three';
import type { RAPIER } from '../core/physics';
import type { MatchClock, Phase } from '../core/match';
import type { Action, ControlState } from '../core/input';
import type { Robot, RobotConfig, Alliance } from '../robot/robot';
import type { Settings } from '../config';

export type GameId = 'override' | 'rebuilt';
export type ModeId = 'match' | 'driver' | 'skills' | 'free' | 'gates' | 'sprint';

export interface ModeDef {
  id: ModeId;
  label: string;
  description: string;
}

export interface DriverStation {
  id: string;
  label: string;
  alliance: Alliance;
  eye: [number, number, number];
  target: [number, number, number];
  /** Direction the driver faces (robot heading convention). */
  yaw: number;
}

export interface StartPose {
  label: string;
  x: number;
  z: number;
  heading: number;
}

export interface ScoreLine {
  label: string;
  value: string | number;
}

/** 2D shapes for the post-match path map. Units: meters, field coordinates. */
export interface Footprint {
  x: number;
  z: number;
  w: number;
  d: number;
  color: string;
  shape?: 'rect' | 'circle' | 'diamond';
}

export interface Gate {
  x: number;
  z: number;
  /** Direction along the gate line (rad). */
  yaw: number;
  width: number;
}

export type ToastKind = 'good' | 'bad' | 'info' | 'red' | 'blue';

export interface GameContext {
  scene: THREE.Scene;
  world: RAPIER.World;
  robot: Robot;
  clock: MatchClock;
  mode: ModeId;
  settings: Settings;
  toast(text: string, kind?: ToastKind): void;
  /** Report a scoring cycle event for driver stats. */
  scored(pieces: number): void;
  intook(): void;
  beep(kind: 'start' | 'end' | 'warn' | 'phase' | 'score'): void;
}

export interface MatchSummary {
  total: number;
  lines: ScoreLine[];
  notes: string[];
}

export interface GameRuntime {
  /** Fixed-step update (physics rate). */
  update(dt: number, ctl: ControlState): void;
  /** Per-render sync of meshes. */
  render(): void;
  onAction(a: Action): void;
  onPhaseChange(prev: Phase | null, next: Phase | null): void;
  /** Live score for "your" alliance plus a breakdown. */
  liveScore(): { mine: number; other: number; lines: ScoreLine[] };
  /** Small HTML status widget (hub state, toggles...). */
  statusHtml(): string;
  /** What the robot is carrying, as HTML. */
  cargoHtml(): string;
  /** Pieces scored so far (sprint drill progress). */
  piecesScored(): number;
  finalize(): MatchSummary;
  footprints(): Footprint[];
  dispose(): void;
}

export interface GameDef {
  id: GameId;
  name: string;
  program: string;
  season: string;
  blurb: string;
  /** Field extent along X and Z (m). */
  fieldX: number;
  fieldZ: number;
  presets: RobotConfig[];
  modes: ModeDef[];
  stations: DriverStation[];
  startPoses(alliance: Alliance): StartPose[];
  phases(mode: ModeId): Phase[];
  gates(): Gate[];
  sprint: { count: number; label: string };
  create(ctx: GameContext): GameRuntime;
  /** Sources / assumptions shown on the About screen. */
  notes: string[];
}
