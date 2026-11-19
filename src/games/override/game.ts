import * as THREE from 'three';
import { RAPIER, PIECE_GROUPS, FIELD_GROUPS } from '../../core/physics';
import { ConvexGeometry } from 'three/addons/geometries/ConvexGeometry.js';
import { FieldBuilder, canvasTexture } from '../../core/builder';
import { IN } from '../../core/units';
import { mergeStatic } from '../../core/merge';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const LB = 0.4536;
import type { Phase } from '../../core/match';
import type { Action, ControlState } from '../../core/input';
import type { RobotConfig, Alliance } from '../../robot/robot';
import { vexModel } from '../../robot/models/vex';
import type {
  Footprint,
  GameContext,
  GameDef,
  GameRuntime,
  Gate,
  MatchSummary,
  ModeId,
  ScoreLine,
  StartPose,
} from '../types';
import {
  OVERRIDE,
  type GoalState,
  type PinColor,
  type Quadrant,
  type StackItem,
  autoWinner,
  canPlace,
  isInMidfield,
  scoreOverride,
  visibleHalves,
} from './rules';

// ------------------------------------------------------------------ field
// Coordinates: meters, field center origin, +X toward the blue wall (East), +Z toward
// the South wall (the audience side; the top of the top-down view is North). Numbers
// come from the game manual's Appendix A sheets (Field Element Locations, Scoring Object
// Locations, Perimeter, Toggle and Loader specifications). Appendix A measures from the
// audience-left (South-West) inside corner: our x = X - 70.205", our z = 70.205" - Y.
const HALF = 70.205 * IN; // 140.41" inside, wall to wall
const WALL_H = 11.54 * IN; // portable perimeter (the metal one is 11.50")
const WALL_T = 2.0 * IN;
/** Goal grid: every Goal and starting element sits on these offsets from the center. */
const G1 = 23.55 * IN;
const G2 = 47.1 * IN;

type GoalKind = 'alliance' | 'short' | 'tall';
// Goals (game manual drawings): every Goal is topped by the same 3.25" tapered module
// (0.39" flange, 5.61" across the flats tapering to 3.49", 2.37" hole); the neutral
// Short and Tall Goals stand it on a black base 2.52" / 5.52" tall.
const GOAL_H: Record<GoalKind, number> = { tall: 8.77 * IN, short: 5.77 * IN, alliance: 3.25 * IN };
const GOAL_BASE_H: Record<GoalKind, number> = { tall: 5.52 * IN, short: 2.52 * IN, alliance: 0 };
const GOAL_FLATS = 5.61 * IN; // across the flats of the chamfered-square footprint
const GOAL_CORNER = 3.22 * IN; // center to a chamfer corner
const GOAL_TOP_FLATS = 3.49 * IN;
const GOAL_FLANGE_H = 0.39 * IN;
const GOAL_MODULE_H = 3.25 * IN;
const GOAL_HOLE = 2.37 * IN;
const GOAL_R_BOTTOM = GOAL_CORNER;
const GOAL_R_TOP = (GOAL_TOP_FLATS / GOAL_FLATS) * GOAL_CORNER;

const GOALS: { id: string; kind: GoalKind; alliance?: Alliance; quadrant: Quadrant | null; x: number; z: number }[] = [
  { id: 'center', kind: 'tall', quadrant: null, x: 0, z: 0 },
  { id: 'N-short', kind: 'short', quadrant: 'N', x: -G1, z: -G2 },
  { id: 'N-blue', kind: 'alliance', alliance: 'blue', quadrant: 'N', x: G1, z: -G2 },
  { id: 'E-blue', kind: 'alliance', alliance: 'blue', quadrant: 'E', x: G2, z: -G1 },
  { id: 'E-short', kind: 'short', quadrant: 'E', x: G2, z: G1 },
  { id: 'S-short', kind: 'short', quadrant: 'S', x: G1, z: G2 },
  { id: 'S-red', kind: 'alliance', alliance: 'red', quadrant: 'S', x: -G1, z: G2 },
  { id: 'W-red', kind: 'alliance', alliance: 'red', quadrant: 'W', x: -G2, z: G1 },
  { id: 'W-short', kind: 'short', quadrant: 'W', x: -G2, z: -G1 },
];
// Toggles sit on top of the perimeter at the middle of each wall, turning on an axis
// 13.20" above the floor. Yellow starts facing up and into the field; the alliance color
// of that side (red on the West and South walls, blue on the North and East) faces out.
const TOGGLE_AXIS_H = 13.2 * IN;
const TOGGLE_FACE = 2.05 * IN; // each face of the triangle (52.2 mm)
const TOGGLE_LEN = 25.8 * IN; // 656.2 mm
const TOGGLE_ON_WALL = HALF + WALL_T / 2;
const TOGGLES: { q: Quadrant; x: number; z: number; alongX: boolean; n: [number, number]; side: Alliance }[] = [
  { q: 'N', x: 0, z: -TOGGLE_ON_WALL, alongX: true, n: [0, 1], side: 'blue' },
  { q: 'E', x: TOGGLE_ON_WALL, z: 0, alongX: false, n: [-1, 0], side: 'blue' },
  { q: 'S', x: 0, z: TOGGLE_ON_WALL, alongX: true, n: [0, -1], side: 'red' },
  { q: 'W', x: -TOGGLE_ON_WALL, z: 0, alongX: false, n: [1, 0], side: 'red' },
];
// Loaders hang on the inside of the alliance walls, 58.77" from the center line: a clear
// chute (22.97" tall, 4.02" inside) between an alliance-colored hopper and base, on a
// black slotted wall mount (11.85").
const LOADER_Z = 58.77 * IN;
const LOADER = { chuteH: 22.97 * IN, width: 4.02 * IN, mount: 11.85 * IN, bottom: 6.0 * IN, depth: 4.4 * IN };
const LOADERS: { alliance: Alliance; x: number; z: number }[] = [
  { alliance: 'red', x: -(HALF - LOADER.depth / 2), z: -LOADER_Z },
  { alliance: 'red', x: -(HALF - LOADER.depth / 2), z: LOADER_Z },
  { alliance: 'blue', x: HALF - LOADER.depth / 2, z: -LOADER_Z },
  { alliance: 'blue', x: HALF - LOADER.depth / 2, z: LOADER_Z },
];
// Tape (Appendix A tape sheet / field renders): an alliance-colored L marks the Load Zone
// in each corner; the Autonomous Line runs corner to corner through the Midfield diamond,
// doubled on the North-West to South-East diagonal.
const LOAD_ZONE = { across: 11.0 * IN, along: 23.4 * IN };
const AUTO_LINE_END = 58.5 * IN;

// ----------------------------------------------------------- game pieces
// Pin (manual drawing): 6.50" long and symmetric. Each half is a 0.64" tip 2.35"
// across, a taper out to 2.93" from its end, then a center collar 3.16" across.
const PIN_LEN = 6.5 * IN;
const PIN_R = 3.16 * IN / 2; // collar, across corners
const PIN_TIP_R = 2.35 * IN / 2;
const PIN_TIP_LEN = 0.64 * IN;
const PIN_TAPER_END = 2.93 * IN;
// Cup (manual drawing): 6.48" tall, 3.16" across the top, 2.32" waist at mid-height;
// clear lower half, opaque upper half.
const CUP_H = 6.48 * IN;
const CUP_TOP_R = 3.16 * IN / 2;
const CUP_WAIST_R = 2.32 * IN / 2;
// How the stack fits together: a Pin's tip drops into the Goal hole; a Cup's clear half
// slides over a Pin and rests on its collar; the next Pin's tip sits at the Cup's waist.
const NEST_PIN_IN_GOAL = PIN_TIP_LEN;
const CUP_ON_PIN = PIN_LEN / 2 + 0.32 * IN; // Cup base above the Pin's base (top of collar)
// next Pin's base above the Cup's base: its tip sits in the waist, collar on the top rim.
const PIN_IN_CUP = CUP_H / 2 + 0.12 * IN;
/** A Pin standing in a Cup: its center above the Cup's center. */
const PIN_OVER_CUP = PIN_IN_CUP - CUP_H / 2 + PIN_LEN / 2;
const COLORS: Record<PinColor, number> = { red: 0xbf2a1f, blue: 0x1f3fc7, yellow: 0xebbd19 };
const CSS: Record<PinColor, string> = { red: '#e04040', blue: '#3b6ff0', yellow: '#f2c518' };

// ----------------------------------------------------------------- robots
const PRESETS: RobotConfig[] = [
  {
    // From the team's regionals code (19109M-Regionals-26-27, src/main.cpp): 4 blue motors
    // geared 36:48 to 450 rpm on 3.25" omnis, split arcade, coast in driver control, 12.75"
    // track, 10.5" wheelbase, 15.5" x 17.8" frame; a 3-motor cascade; a pneumatic claw plate
    // on a swinging arm that scores out the back; grabs Cup + Pin stacks; R1 grabs and lifts
    // to mid height, holding R2 lowers onto the Goal and letting go releases.
    id: 'team-19109m',
    name: '19109M (regionals)',
    description: 'UTS Middle School: 4-motor 450 RPM omni drive, a 3-motor cascade and a pneumatic claw on a swing arm that scores off the back. Grabs a Cup with its Pin as one stack. R1 grabs and lifts to mid height; hold R2 to lower onto the Goal, let go to release. At a Loader, B is its L1 loading macro: cascade down, the claw arm swings in over the top, the load drops in, then R1 lifts and swings it back out.',
    team: '19109M',
    source: 'Team 19109M’s regionals robot code (drive, cascade, claw and driver macros). Weight, cascade height and claw reach are estimates.',
    length: 17.8 * IN, width: 15.5 * IN, height: 14 * IN,
    drive: 'splitArcade',
    power: { motors: 4, cartridge: 'blue', wheelRpm: 450, wheelDia: 3.25 * IN, mass: 15 * LB, mu: 0.75, trackWidth: 12.75 * IN, wheelbase: 10.5 * IN, scrub: 0.1, brake: 'coast' },
    capacity: 2, intakeWidth: 0.16, intakeReach: 0.12, liftTime: 0.85,
    reversed: true, grabsStacks: true, macros: 'lower-release',
    stats: { Lift: '3-motor cascade to ~33"', Claw: 'Pneumatic plate, scores off the back', Holds: 'Cup + Pin stack' },
    model: vexModel({ team: '19109M', length: 17.8, width: 15.5, drive: 'tank4', wheel: 3.25, cartridge: 'blue', lift: 'cascade', liftMin: 3, liftMax: 33, rollers: false, accent: 0x1d3f8f, swingArm: { length: 7.5, swingDeg: 180 } }),
  },
  {
    id: 'vex-dr4b',
    name: 'DR4B claw stacker',
    description: 'Six-motor 450 RPM drive with a double-reverse four-bar lift and a rotating claw. Reaches the top of tall stacks.',
    source: 'Inspired by early-season Override reveals (standoff-linkage DR4B claw bots, e.g. 8059A/8059Y).',
    length: 15 * IN, width: 15 * IN, height: 14 * IN,
    drive: 'tank',
    power: { motors: 6, cartridge: 'blue', wheelRpm: 450, wheelDia: 3.25 * IN, mass: 14 * LB, mu: 0.9, trackWidth: 12.5 * IN, wheelbase: 11 * IN, scrub: 0.22, brake: 'brake' },
    capacity: 2, intakeWidth: 0.2, intakeReach: 0.12, liftTime: 0.9,
    stats: { Lift: 'DR4B to ~42"', Holds: '1 Pin + 1 Cup (SG6 max)' },
    model: vexModel({ team: '2026A', length: 15, width: 15, drive: 'tank6', wheel: 3.25, cartridge: 'blue', lift: 'dr4b', liftMin: 3, liftMax: 42, rollers: true, accent: 0xe8862a }),
  },
  {
    id: 'vex-cascade',
    name: 'Cascade + horizontal intake',
    description: 'Six-motor 450 RPM drive, a 3-stage cascade lift that rises straight up, and a roller intake feeding a claw. Fast to the top of any stack.',
    source: 'Inspired by this season’s cascade reveals (ACE-style cascade with a horizontal intake, Formula 5).',
    length: 15 * IN, width: 15 * IN, height: 14 * IN,
    drive: 'tank',
    power: { motors: 6, cartridge: 'blue', wheelRpm: 450, wheelDia: 3.25 * IN, mass: 15 * LB, mu: 0.9, trackWidth: 12.5 * IN, wheelbase: 11 * IN, scrub: 0.22, brake: 'brake' },
    capacity: 2, intakeWidth: 0.24, intakeReach: 0.13, liftTime: 0.75,
    stats: { Lift: '3-stage cascade to ~44"', Holds: '1 Pin + 1 Cup (SG6 max)' },
    model: vexModel({ team: '2026D', length: 15, width: 15, drive: 'tank6', wheel: 3.25, cartridge: 'blue', lift: 'cascade', liftMin: 3, liftMax: 44, rollers: true, accent: 0xd8342b }),
  },
  {
    id: 'vex-flex',
    name: 'Clawbot "Flex"',
    description: 'Four-motor drive, single arm and claw, like VEX’s Override Hero Bot. Slower, simple and reliable. A great first robot.',
    source: 'Based on VEX’s official Override Hero Bot, Flex (arm + claw).',
    length: 16 * IN, width: 14 * IN, height: 13 * IN,
    drive: 'arcade',
    power: { motors: 4, cartridge: 'green', wheelRpm: 200, wheelDia: 4 * IN, mass: 11 * LB, mu: 0.75, trackWidth: 12 * IN, wheelbase: 12 * IN, scrub: 0.12, brake: 'brake' },
    capacity: 1, intakeWidth: 0.16, intakeReach: 0.13, liftTime: 1.1,
    stats: { Lift: 'Single arm to ~26"', Holds: '1 in the claw' },
    model: vexModel({ team: '2026B', length: 16, width: 14, drive: 'tank4', wheel: 4, cartridge: 'green', lift: 'arm', liftMin: 2, liftMax: 26, rollers: false, accent: 0x2e9be6 }),
  },
  {
    id: 'vex-chainbar',
    name: 'Chain-bar + roller intake',
    description: 'Fast 600 RPM drive. Rollers sweep Pins and Cups into a claw on a chain-bar that keeps them level.',
    source: 'Forklift / chain-bar stacker concept from the Override design discussions.',
    length: 15 * IN, width: 15 * IN, height: 13 * IN,
    drive: 'splitArcade',
    power: { motors: 6, cartridge: 'blue', wheelRpm: 600, wheelDia: 2.75 * IN, mass: 13 * LB, mu: 0.9, trackWidth: 12.5 * IN, wheelbase: 11 * IN, scrub: 0.22, brake: 'brake' },
    capacity: 2, intakeWidth: 0.26, intakeReach: 0.14, liftTime: 0.8,
    stats: { Lift: 'Chain-bar to ~32"', Holds: '1 Pin + 1 Cup (SG6 max)' },
    model: vexModel({ team: '2026C', length: 15, width: 15, drive: 'tank6', wheel: 2.75, cartridge: 'blue', lift: 'chainbar', liftMin: 3, liftMax: 32, rollers: true, accent: 0x7b4fd6 }),
  },
  {
    id: 'vex-xdrive',
    name: 'X-drive arm bot',
    description: 'Holonomic X-drive that strafes to line up on goals, with an arm and rotating claw. Try field-oriented control.',
    source: 'Holonomic “S-bot” style seen in Override design threads.',
    length: 16 * IN, width: 16 * IN, height: 13 * IN,
    drive: 'xdrive',
    power: { motors: 4, cartridge: 'blue', wheelRpm: 600, wheelDia: 3.25 * IN, mass: 12 * LB, mu: 0.75, trackWidth: 13 * IN, wheelbase: 13 * IN, scrub: 0, brake: 'brake' },
    capacity: 1, intakeWidth: 0.18, intakeReach: 0.13, liftTime: 1.0,
    stats: { Lift: 'Arm to ~30"', Holds: '1 in the claw' },
    model: vexModel({ team: '2026X', length: 16, width: 16, drive: 'xdrive', wheel: 3.25, cartridge: 'blue', lift: 'arm', liftMin: 2, liftMax: 30, rollers: false, accent: 0x18b38a }),
  },
];

interface Piece {
  id: number;
  kind: 'pin' | 'cup';
  /** Pin half colors [A, B]; mesh half A is the lower one when unrotated. */
  colors: [PinColor, PinColor];
  body: RAPIER.RigidBody;
  mesh: THREE.Group;
  state: 'loose' | 'held' | 'placed';
  /** A Pin standing in a Cup rides along with it (no collider of its own) until disturbed. */
  nestedIn?: Piece;
}

interface Goal extends GoalState {
  x: number;
  z: number;
  pieces: Piece[];
}

interface ToggleViz {
  q: Quadrant;
  x: number;
  z: number;
  n: [number, number];
  alongX: boolean;
  side: Alliance;
  group: THREE.Group;
  angle: number;
  owner: Alliance | null;
  touched: boolean;
}

/** How close (m) the claw must be to a Goal's center for a Pin to drop into its hole: 1.4". */
const ALIGN = 1.4 * IN;

type LoadItem = 'cup' | 'yy' | Alliance;

type PlaceJob = { goal: Goal; piece: Piece; t: number; duration: number; height: number };

/** Chamfered-square Goal footprint (manual: 5.61" across the flats, 3.22" to a corner), scaled. */
function chamferedSquare(scale: number): [number, number][] {
  const f = (GOAL_FLATS / 2) * scale;
  const c = Math.sqrt(GOAL_CORNER * GOAL_CORNER - (GOAL_FLATS / 2) ** 2) * scale;
  return [[f, c], [c, f], [-c, f], [-f, c], [-f, -c], [-c, -f], [c, -f], [f, -c]];
}

let grainTex: THREE.Texture | null = null;
/** Fine noise used as a bump map for textured plastic. */
function grainTexture(): THREE.Texture {
  if (grainTex) return grainTex;
  grainTex = canvasTexture(128, 128, (g, w, h) => {
    const img = g.createImageData(w, h);
    for (let i = 0; i < img.data.length; i += 4) {
      const v = 100 + Math.random() * 110;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
      img.data[i + 3] = 255;
    }
    g.putImageData(img, 0, 0);
  });
  grainTex.wrapS = grainTex.wrapT = THREE.RepeatWrapping;
  grainTex.repeat.set(3, 3);
  grainTex.colorSpace = THREE.NoColorSpace;
  return grainTex;
}

let lineArtTex: THREE.Texture | null = null;
/** Yellow line art on the black neutral Goal bases. */
function goalLineArtTexture(): THREE.Texture {
  if (lineArtTex) return lineArtTex;
  lineArtTex = canvasTexture(256, 256, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    g.strokeStyle = '#e8c21b';
    g.lineWidth = 5;
    const hex = (cx: number, cy: number, r: number) => {
      g.beginPath();
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2 + Math.PI / 6;
        g[i ? 'lineTo' : 'moveTo'](cx + Math.cos(a) * r, cy + Math.sin(a) * r);
      }
      g.closePath();
      g.stroke();
    };
    g.beginPath();
    g.arc(w / 2, h * 0.62, w * 0.3, 0, Math.PI * 2);
    g.stroke();
    hex(w / 2, h * 0.62, w * 0.16);
    for (const sx of [0.12, 0.88]) {
      g.beginPath();
      g.arc(w * sx, h * 0.28, w * 0.16, 0, Math.PI * 2);
      g.stroke();
      hex(w * sx, h * 0.28, w * 0.08);
    }
  });
  return lineArtTex;
}

let markerTex: THREE.Texture | null = null;
/** Square field code marker on each Goal face (a black-and-white block code). */
function goalMarkerTexture(): THREE.Texture {
  if (markerTex) return markerTex;
  markerTex = canvasTexture(64, 64, (g) => {
    g.fillStyle = '#ffffff';
    g.fillRect(0, 0, 64, 64);
    g.fillStyle = '#000000';
    g.fillRect(8, 8, 48, 48);
    g.fillStyle = '#ffffff';
    const cells = [[1, 0], [3, 0], [0, 2], [4, 2], [2, 4], [1, 2], [2, 1], [3, 3], [2, 2]];
    for (const [cx, cy] of cells) g.fillRect(12 + cx * 8, 12 + cy * 8, 8, 8);
  });
  markerTex.magFilter = THREE.NearestFilter;
  return markerTex;
}

/**
 * Lower half of the Pin's side profile (r, y), local origin at the Pin's center: a flat end
 * with a small chamfer, the 0.64" straight tip, the taper out to the collar, then the collar
 * with a shallow groove where the two molded halves meet.
 */
function pinHalfProfile(): [number, number][] {
  const b = -PIN_LEN / 2;
  const ch = 0.08 * IN;
  const collarIn = PIN_R * 0.95;
  return [
    [0, b], [PIN_TIP_R - ch, b], [PIN_TIP_R, b + ch], [PIN_TIP_R, b + PIN_TIP_LEN], [collarIn, b + PIN_TAPER_END],
    [PIN_R, b + PIN_TAPER_END + 0.06 * IN], [PIN_R, -0.1 * IN], [PIN_R * 0.965, -0.05 * IN], [PIN_R * 0.965, 0], [0, 0],
  ];
}

/** Hexagonal Pin points for the convex collider. */
function pinHullPoints(): Float32Array {
  const pts: number[] = [];
  for (const [r, y] of pinHalfProfile()) {
    if (r === 0) continue;
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      pts.push(Math.cos(a) * r, y, Math.sin(a) * r, Math.cos(a) * r, -y, Math.sin(a) * r);
    }
  }
  return new Float32Array(pts);
}

class OverrideRuntime implements GameRuntime {
  private builder: FieldBuilder;
  private pieces: Piece[] = [];
  private goals: Goal[] = [];
  private toggles: ToggleViz[] = [];
  private held: Piece[] = [];
  private cupOpaqueUp = true;
  /** Which half of the next Pin goes down: false = its first color. */
  private pinFlip = false;
  private intakeCooldown = 0;
  private dropCooldown = 0;
  private prevScore = false;
  private prevOut = false;
  private prevIntake = false;
  /** A lift height a macro is driving to (null: hold where it is). */
  private liftGoal: number | null = null;
  /** 19109M R2 release: the height to go back to after letting go. */
  private releaseFrom: number | null = null;
  /** Holding a Cup with its Pin standing in it, as one unit. */
  private heldStack = false;
  /** Swinging claw arm: where it's going (0 out, 1 in). */
  private swingTarget = 0;
  /** Swing the arm back out once the lift passes this height (19109M: B_ARM_OUT_HEIGHT). */
  private swingOutAt: number | null = null;
  /** Seconds until a Match Load drops into the claw once the arm is in (null: none coming). */
  private loadPending: number | null = null;
  private job: PlaceJob | null = null;
  private wristTarget = 0;
  private autoBonus: Alliance | 'tie' | null = null;
  private loaderQueue: Record<Alliance, LoadItem[]>;
  private placedByMe = 0;
  private midfieldGlow!: THREE.Mesh;
  /** Ring on the Goal under the claw: green when lined up to score. */
  private alignRing!: THREE.Mesh;
  private readonly me: Alliance;
  private geo: { pinLow: THREE.BufferGeometry; pinHigh: THREE.BufferGeometry; cupLow: THREE.BufferGeometry; cupHigh: THREE.BufferGeometry };
  private mats: { pin: Record<PinColor, THREE.Material>; pinBody: THREE.Material; cupOpaque: THREE.Material; cupClear: THREE.Material };
  private pinHull = pinHullPoints();

  constructor(private ctx: GameContext) {
    this.me = ctx.robot.alliance;
    this.builder = new FieldBuilder(ctx.world, ctx.scene);
    // Shared geometry: symmetric hexagonal Pins (two colored halves), straight-tapered Cups.
    const half = pinHalfProfile().map(([r, y]) => new THREE.Vector2(r, y));
    // Hexagonal: six flat faces, so the lathe is split into facets with their own normals.
    const pinLow = new THREE.LatheGeometry(half, 6, Math.PI / 6).toNonIndexed();
    pinLow.computeVertexNormals();
    const pinHigh = pinLow.clone().scale(1, -1, 1);
    const pos = pinHigh.getAttribute('position');
    for (let i = 0; i < pos.count; i += 3) {
      // Mirroring flips the winding: swap two corners of every triangle.
      for (let k = 0; k < 3; k++) {
        const t = pos.getComponent(i + 1, k);
        pos.setComponent(i + 1, k, pos.getComponent(i + 2, k));
        pos.setComponent(i + 2, k, t);
      }
    }
    const uv = pinHigh.getAttribute('uv');
    for (let i = 0; i < uv.count; i += 3) {
      for (let k = 0; k < 2; k++) {
        const t = uv.getComponent(i + 1, k);
        uv.setComponent(i + 1, k, uv.getComponent(i + 2, k));
        uv.setComponent(i + 2, k, t);
      }
    }
    pinHigh.computeVertexNormals();
    const c = CUP_H;
    const cupProfile = (pts: [number, number][]) => pts.map(([r, y]) => new THREE.Vector2(r, y - c / 2));
    // Hollow hourglass with a 0.06" wall. Clear lower half: a rolled base rim tapering in to
    // the waist. Opaque upper half: from the waist out to a rolled top rim. Each half is drawn
    // as a closed shell (outside up, over the rim, inside back down).
    const w = 0.06 * IN;
    const rim = 0.05 * IN;
    const shell = (outer: [number, number][]) => {
      const inner = outer.map(([r, y]) => [Math.max(0.001, r - w), y] as [number, number]).reverse();
      return cupProfile([...outer, ...inner, outer[0]]);
    };
    const R = CUP_TOP_R;
    const cupLow = new THREE.LatheGeometry(
      shell([[R - rim, 0], [R, 0.02 * IN], [R, 0.16 * IN], [R - rim * 1.4, 0.24 * IN], [CUP_WAIST_R + 0.02 * IN, c / 2 - 0.12 * IN], [CUP_WAIST_R, c / 2]]),
      24,
    );
    const cupHigh = new THREE.LatheGeometry(
      shell([[CUP_WAIST_R, c / 2], [CUP_WAIST_R + 0.03 * IN, c / 2 + 0.12 * IN], [R - rim * 1.6, c - 0.3 * IN], [R, c - 0.18 * IN], [R, c - 0.03 * IN], [R - rim, c]]),
      24,
    );
    cupLow.computeVertexNormals();
    cupHigh.computeVertexNormals();
    this.geo = { pinLow, pinHigh, cupLow, cupHigh };
    // Molded plastic: Pins have a fine textured (sand-blasted) finish, Cups a gray
    // opaque half and a glossy clear half.
    const grain = grainTexture();
    const plastic = (color: number) => new THREE.MeshStandardMaterial({ color, roughness: 0.72, bumpMap: grain, bumpScale: 0.35, flatShading: true });
    this.mats = {
      pin: { red: plastic(COLORS.red), blue: plastic(COLORS.blue), yellow: plastic(COLORS.yellow) },
      pinBody: new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.72, bumpMap: grain, bumpScale: 0.35, flatShading: true }),
      cupOpaque: new THREE.MeshStandardMaterial({ color: 0x4b4f55, roughness: 0.6, bumpMap: grain, bumpScale: 0.2, side: THREE.DoubleSide }),
      cupClear: new THREE.MeshPhysicalMaterial({ color: 0xeef5ff, roughness: 0.06, metalness: 0, transparent: true, opacity: 0.3, clearcoat: 1, clearcoatRoughness: 0.05, side: THREE.DoubleSide, depthWrite: false }),
    };
    // Match Loads: 10 Cups, 10 alliance/yellow Pins and 1 yellow/yellow Pin per alliance.
    // Robot Skills: 7 Cups, 3 red/yellow and 4 blue/yellow Pins. The order is our choice.
    const loads = (a: Alliance): LoadItem[] => {
      const q: LoadItem[] = [];
      if (ctx.mode === 'skills') {
        const pins: LoadItem[] = ['red', 'red', 'red', 'blue', 'blue', 'blue', 'blue'];
        for (const pin of pins) q.push('cup', pin);
        return q;
      }
      for (let i = 0; i < 10; i++) q.push('cup', a);
      q.push('yy');
      return q;
    };
    this.loaderQueue = { red: loads('red'), blue: loads('blue') };
    this.buildField();
    this.spawnLayout();
    // Preload: one alliance-color Pin in the claw.
    const pre = this.makePin(ctx.robot.x, 0.3, ctx.robot.z, this.me === 'red' ? ['red', 'yellow'] : ['blue', 'yellow']);
    this.hold(pre);
  }

  // ------------------------------------------------------------ field build
  private buildField(): void {
    const b = this.builder;
    b.floor(HALF * 2, HALF * 2);
    const px = (v: number, w: number) => (v / (HALF * 2) + 0.5) * w;
    const tiles = canvasTexture(2048, 2048, (g, w, h) => {
      g.fillStyle = '#4f535a';
      g.fillRect(0, 0, w, h);
      const n = 6;
      const s = w / n;
      // Foam tiles in two slightly different grays, like the official field renders.
      for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
        const base = (i + j) % 2 ? 92 : 84;
        g.fillStyle = `rgb(${base},${base + 2},${base + 6})`;
        g.fillRect(i * s, j * s, s, s);
        for (let k = 0; k < 900; k++) {
          g.fillStyle = Math.random() < 0.5 ? `rgba(255,255,255,${Math.random() * 0.04})` : `rgba(0,0,0,${Math.random() * 0.05})`;
          g.fillRect(i * s + Math.random() * s, j * s + Math.random() * s, 2, 2);
        }
      }
      // Interlocking jigsaw seams between tiles.
      g.strokeStyle = 'rgba(20,22,26,0.55)';
      g.lineWidth = 2.5;
      const teeth = 12;
      const tw = s / teeth;
      for (let k = 1; k < n; k++) {
        for (const vertical of [true, false]) {
          g.save();
          // Draw every seam along local +x, then rotate the vertical ones into place.
          if (vertical) {
            g.translate(k * s, 0);
            g.rotate(Math.PI / 2);
          } else g.translate(0, k * s);
          g.beginPath();
          g.moveTo(0, 0);
          for (let t = 0; t < n * teeth; t++) {
            const a0 = t * tw;
            const dir = t % 2 ? 1 : -1;
            const r = tw * 0.24;
            // Neck, then a round knob into the neighboring tile.
            const cx = a0 + tw / 2;
            const cy = dir * r * 1.25;
            g.lineTo(a0 + tw * 0.4, 0);
            for (let q = 0; q <= 12; q++) {
              const phi = -0.7 + (q / 12) * (Math.PI + 1.4);
              g.lineTo(cx - r * Math.cos(phi), cy + dir * r * Math.sin(phi));
            }
            g.lineTo(a0 + tw * 0.6, 0);
            g.lineTo(a0 + tw, 0);
          }
          g.stroke();
          g.restore();
        }
      }
      // Tape: 2" white lines; the North-West to South-East Autonomous Line is doubled.
      const sc = w / (HALF * 2);
      g.strokeStyle = 'rgba(245,245,245,0.94)';
      g.lineCap = 'butt';
      const d = OVERRIDE.midfieldHalfDiagonal;
      const line = (x1: number, z1: number, x2: number, z2: number, width: number, offset = 0) => {
        // offset shifts the line sideways (perpendicular), for the double line.
        const len = Math.hypot(x2 - x1, z2 - z1);
        const ox = (-(z2 - z1) / len) * offset;
        const oz = ((x2 - x1) / len) * offset;
        g.lineWidth = width * sc;
        g.beginPath();
        g.moveTo(px(x1 + ox, w), px(z1 + oz, h));
        g.lineTo(px(x2 + ox, w), px(z2 + oz, h));
        g.stroke();
      };
      const e = AUTO_LINE_END;
      const m = d / 2; // the diagonals meet the diamond at the middle of its edges
      for (const off of [-1.1 * IN, 1.1 * IN]) {
        line(-e, -e, -m, -m, 1 * IN, off);
        line(m, m, e, e, 1 * IN, off);
      }
      line(e, -e, m, -m, 2 * IN);
      line(-m, m, -e, e, 2 * IN);
      g.lineWidth = 2 * IN * sc;
      g.beginPath();
      g.moveTo(px(-d, w), px(0, h)); g.lineTo(px(0, w), px(-d, h)); g.lineTo(px(d, w), px(0, h)); g.lineTo(px(0, w), px(d, h)); g.closePath();
      g.stroke();
      // Load Zones: an alliance-colored L in each corner beside the Alliance Stations.
      for (const [sx, color] of [[-1, '#d3262b'], [1, '#2a74d6']] as const) {
        for (const sz of [-1, 1]) {
          const x = sx * (HALF - LOAD_ZONE.across);
          const z = sz * (HALF - LOAD_ZONE.along);
          g.strokeStyle = color;
          g.lineWidth = 2 * IN * sc;
          g.beginPath();
          g.moveTo(px(x, w), px(sz * HALF, h));
          g.lineTo(px(x, w), px(z, h));
          g.lineTo(px(sx * HALF, w), px(z, h));
          g.stroke();
        }
      }
    });
    const tileMesh = b.decal(tiles, HALF * 2, HALF * 2);
    // Foam tiles: a fine bumpy surface that catches the light.
    const foam = canvasTexture(256, 256, (g, w, h) => {
      const img = g.createImageData(w, h);
      for (let i = 0; i < img.data.length; i += 4) {
        const v = 110 + Math.random() * 60;
        img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
        img.data[i + 3] = 255;
      }
      g.putImageData(img, 0, 0);
    });
    foam.wrapS = foam.wrapT = THREE.RepeatWrapping;
    foam.repeat.set(36, 36);
    foam.colorSpace = THREE.NoColorSpace;
    const tm = tileMesh.material as THREE.MeshStandardMaterial;
    tm.bumpMap = foam;
    tm.bumpScale = 0.6;
    tm.roughness = 0.97;

    // Perimeter (Appendix A, portable): 11.54" tall, 2" thick. White extruded rails top
    // and bottom, a light gray inner panel, and a black-and-white checker band along the
    // top of the inside face. Red stands behind the West wall, blue behind the East wall.
    const white = b.mat(0xf1f3f5, { rough: 0.45 });
    const panel = b.mat(0xd3d7dc, { rough: 0.7 });
    const checker = canvasTexture(512, 32, (g, w, h) => {
      g.fillStyle = '#f4f4f4';
      g.fillRect(0, 0, w, h);
      g.fillStyle = '#111';
      const n = 32;
      const cw = w / n;
      for (let i = 0; i < n; i++) g.fillRect(i * cw, i % 2 ? 0 : h / 2, cw, h / 2);
    });
    checker.wrapS = THREE.RepeatWrapping;
    checker.magFilter = THREE.NearestFilter;
    const railH = 2.0 * IN;
    const bandH = 2.36 * IN;
    for (const [nx, nz] of [[0, -1], [0, 1], [-1, 0], [1, 0]] as const) {
      const along = nx === 0;
      const len = HALF * 2 + 2 * WALL_T;
      const cx = nx * (HALF + WALL_T / 2);
      const cz = nz * (HALF + WALL_T / 2);
      const size = (h: number, t: number): [number, number, number] => (along ? [len, h, t] : [t, h, len]);
      b.box({ center: [cx, railH / 2, cz], size: size(railH, WALL_T), material: white, collider: false });
      b.box({ center: [cx, WALL_H - railH / 2, cz], size: size(railH, WALL_T), material: white, collider: false });
      b.box({ center: [cx, WALL_H / 2, cz], size: size(WALL_H - 2 * railH, WALL_T * 0.8), material: panel, collider: false });
      b.solid([cx, 0.5, cz], size(1, WALL_T));
      // Checker band on the inside face, just under the top rail.
      const tex = checker.clone();
      tex.repeat.set((HALF * 2) / (32 * 2.36 * IN), 1);
      tex.needsUpdate = true;
      const band = new THREE.Mesh(new THREE.PlaneGeometry(HALF * 2, bandH), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.6 }));
      band.position.set(nx * (HALF - 0.0005), WALL_H - railH - bandH / 2 - 0.3 * IN, nz * (HALF - 0.0005));
      band.rotation.y = Math.atan2(-nx, -nz);
      b.group.add(band);
      // Panel seams every two tiles.
      for (let i = -2; i <= 2; i++) {
        const p = (i * 2 * HALF) / 6;
        const seam = along ? [p, 0] : [0, p];
        b.box({ center: [cx + seam[0] - nx * 0.001, WALL_H / 2, cz + seam[1] - nz * 0.001], size: along ? [0.4 * IN, WALL_H, WALL_T * 1.02] : [WALL_T * 1.02, WALL_H, 0.4 * IN], color: 0xb9bec5, collider: false, shadow: false });
      }
    }
    // Alliance-colored strip along the outside of each station wall.
    for (const [sx, color] of [[-1, 0xc62828], [1, 0x1f4fbf]] as const) {
      b.box({ center: [sx * (HALF + WALL_T + 0.003), WALL_H * 0.55, 0], size: [0.006, 1.2 * IN, HALF * 2], color, collider: false });
    }

    // Goals, from the manual drawings: a chamfered-square footprint; neutral Goals stand a
    // black base with yellow line art under the same 3.25" tapered module the Alliance
    // Goals use, which carries a 2.37" hole and a field code marker on each face.
    const lineArtMat = new THREE.MeshStandardMaterial({ map: goalLineArtTexture(), transparent: true, roughness: 0.6, depthWrite: false });
    const markerMat = new THREE.MeshStandardMaterial({ map: goalMarkerTexture(), roughness: 0.7 });
    for (const def of GOALS) {
      const baseH = GOAL_BASE_H[def.kind];
      const color = def.kind === 'alliance' ? COLORS[def.alliance!] : 0x18191b;
      const m = b.mat(color, { rough: 0.62 });
      const ring = (scale: number, y: number) => chamferedSquare(scale).map(([x, z]) => new THREE.Vector3(def.x + x, y, def.z + z));
      const solid = (pts: THREE.Vector3[]) => {
        const mesh = new THREE.Mesh(new ConvexGeometry(pts), m);
        mesh.castShadow = mesh.receiveShadow = true;
        b.group.add(mesh);
      };
      const taperBottom = 0.873; // taper body starts inside the flange
      const topScale = GOAL_TOP_FLATS / GOAL_FLATS;
      if (baseH > 0) {
        solid([...ring(1, 0), ...ring(1, baseH)]);
        // Yellow line art on the four flat faces.
        for (let k = 0; k < 4; k++) {
          const ang = (k * Math.PI) / 2;
          const plane = new THREE.Mesh(
            new THREE.PlaneGeometry(GOAL_CORNER * 0.95, baseH * 0.92),
            lineArtMat,
          );
          plane.position.set(def.x + Math.cos(ang) * (GOAL_FLATS / 2 + 0.001), baseH / 2, def.z - Math.sin(ang) * (GOAL_FLATS / 2 + 0.001));
          plane.rotation.y = ang + Math.PI / 2;
          b.group.add(plane);
        }
      }
      // Tapered module: flange, then the taper to the top.
      solid([...ring(1, baseH), ...ring(1, baseH + GOAL_FLANGE_H)]);
      solid([...ring(taperBottom, baseH + GOAL_FLANGE_H), ...ring(topScale, baseH + GOAL_MODULE_H)]);
      // Field code markers, 1.49" up the module, tilted with the taper.
      const yM = baseH + 1.49 * IN;
      const tilt = Math.atan2((taperBottom - topScale) * (GOAL_FLATS / 2), GOAL_MODULE_H - GOAL_FLANGE_H);
      const flatAt = (GOAL_FLATS / 2) * (taperBottom + (topScale - taperBottom) * ((yM - baseH - GOAL_FLANGE_H) / (GOAL_MODULE_H - GOAL_FLANGE_H)));
      for (let k = 0; k < 4; k++) {
        const ang = (k * Math.PI) / 2;
        const tag = new THREE.Mesh(new THREE.PlaneGeometry(1.15 * IN, 1.15 * IN), markerMat);
        tag.position.set(def.x + Math.cos(ang) * (flatAt + 0.0015), yM, def.z - Math.sin(ang) * (flatAt + 0.0015));
        tag.rotation.set(0, ang + Math.PI / 2, 0);
        tag.rotateX(-tilt);
        b.group.add(tag);
      }
      const hole = new THREE.Mesh(new THREE.CylinderGeometry(GOAL_HOLE / 2, GOAL_HOLE / 2, 0.006, 24), b.mat(0x0b0b0b));
      hole.position.set(def.x, GOAL_H[def.kind] - 0.002, def.z);
      b.group.add(hole);
      const pts: number[] = [];
      for (const v of [...ring(1, 0), ...ring(topScale, GOAL_H[def.kind])]) pts.push(v.x, v.y, v.z);
      const desc = RAPIER.ColliderDesc.convexHull(new Float32Array(pts));
      if (desc) this.ctx.world.createCollider(desc.setCollisionGroups(FIELD_GROUPS).setFriction(0.5));
      this.goals.push({ id: def.id, kind: def.kind, alliance: def.alliance, quadrant: def.quadrant, stack: [], x: def.x, z: def.z, pieces: [] });
    }
    this.midfieldGlow = new THREE.Mesh(
      new THREE.RingGeometry(0.09, 0.115, 8),
      new THREE.MeshBasicMaterial({ color: 0xffe14d, transparent: true, opacity: 0, side: THREE.DoubleSide }),
    );
    this.alignRing = new THREE.Mesh(
      new THREE.RingGeometry(GOAL_TOP_FLATS * 0.42, GOAL_TOP_FLATS * 0.55, 32),
      new THREE.MeshBasicMaterial({ color: 0x3ddc84, transparent: true, opacity: 0.85, side: THREE.DoubleSide, depthTest: false }),
    );
    this.alignRing.rotation.x = -Math.PI / 2;
    this.alignRing.renderOrder = 5;
    this.alignRing.userData.dynamic = true;
    this.alignRing.visible = false;
    b.group.add(this.alignRing);
    this.midfieldGlow.rotation.x = -Math.PI / 2;
    this.midfieldGlow.userData.dynamic = true;
    this.midfieldGlow.position.y = 0.004;
    b.group.add(this.midfieldGlow);

    // Toggles: triangular prisms on top of the perimeter (Appendix A). Each face's normal,
    // in the toggle frame (local +Z points into the field, the prism turns about local X):
    // yellow up-and-in, the side's own alliance color up-and-out, the other color down.
    const ri = TOGGLE_FACE / (2 * Math.sqrt(3)); // inradius
    for (const def of TOGGLES) {
      const group = new THREE.Group();
      const prism = new THREE.Group();
      prism.userData.dynamic = true;
      const other: Alliance = def.side === 'red' ? 'blue' : 'red';
      const faces: [PinColor, number][] = [
        ['yellow', Math.PI / 6],
        [def.side, Math.PI - Math.PI / 6],
        [other, -Math.PI / 2],
      ];
      const faceGeo = new THREE.BoxGeometry(TOGGLE_LEN, 0.003, TOGGLE_FACE * 1.02);
      for (const [c, elev] of faces) {
        // elev: angle of the face normal above the +Z (inward) horizontal.
        const ny = Math.sin(elev);
        const nz = Math.cos(elev);
        const f = new THREE.Mesh(faceGeo, b.mat(COLORS[c], { rough: 0.45 }));
        f.position.set(0, ny * ri, nz * ri);
        f.rotation.x = Math.atan2(nz, ny);
        f.castShadow = true;
        prism.add(f);
      }
      for (const s of [-1, 1]) {
        const cap = new THREE.Mesh(new THREE.CylinderGeometry(ri * 2, ri * 2, 0.35 * IN, 3), b.mat(0x1b1b1b));
        cap.rotation.z = Math.PI / 2;
        cap.position.x = s * (TOGGLE_LEN / 2 + 0.17 * IN);
        prism.add(cap);
        const mount = new THREE.Mesh(new THREE.BoxGeometry(0.6 * IN, TOGGLE_AXIS_H - WALL_H + 0.6 * IN, WALL_T * 0.9), b.mat(0x1c1c1c, { rough: 0.5 }));
        mount.position.set(s * (TOGGLE_LEN / 2 + 0.65 * IN), -(TOGGLE_AXIS_H - WALL_H) / 2 + 0.3 * IN, 0);
        group.add(mount);
      }
      group.add(prism);
      group.position.set(def.x, TOGGLE_AXIS_H, def.z);
      group.rotation.y = Math.atan2(def.n[0], def.n[1]);
      b.group.add(group);
      this.toggles.push({ q: def.q, x: def.x, z: def.z, n: def.n, alongX: def.alongX, side: def.side, group: prism, angle: 0, owner: null, touched: false });
    }

    // Loaders: hang on the inside of the alliance walls by the corners.
    for (const l of LOADERS) {
      const sx = Math.sign(l.x);
      const ally = b.mat(l.alliance === 'red' ? 0xc62828 : 0x1f4fbf, { rough: 0.5 });
      const black = b.mat(0x151515, { rough: 0.5 });
      const clearM = b.mat(0xe2efff, { opacity: 0.22, rough: 0.05 });
      const face = HALF; // inside face of the wall
      const cx = sx * (face - LOADER.depth / 2);
      const top = LOADER.bottom + LOADER.chuteH;
      // Black slotted mount against the wall.
      b.box({ center: [sx * (face - 0.15 * IN), 0.5 * IN + LOADER.mount / 2, l.z], size: [0.3 * IN, LOADER.mount, LOADER.width * 0.7], material: black, collider: false });
      // Clear chute with an open alliance-colored hopper on top and a tray at the bottom.
      const w = LOADER.width;
      const walls = (y: number, h: number, t: number, ww: number, m: THREE.Material) => {
        for (const s of [-1, 1]) {
          b.box({ center: [cx + s * (ww / 2), y, l.z], size: [t, h, ww + t], material: m, collider: false, shadow: m !== clearM });
          b.box({ center: [cx, y, l.z + s * (ww / 2)], size: [ww + t, h, t], material: m, collider: false, shadow: m !== clearM });
        }
      };
      walls(LOADER.bottom + LOADER.chuteH / 2, LOADER.chuteH, 0.12 * IN, w, clearM);
      walls(LOADER.bottom + 0.5 * IN, 1 * IN, 0.25 * IN, w + 0.3 * IN, ally);
      walls(top - 1 * IN, 2 * IN, 0.25 * IN, w + 0.5 * IN, ally);
      b.box({ center: [cx + sx * (w / 2 - 0.6 * IN), LOADER.bottom - 1.5 * IN, l.z], size: [1.2 * IN, 3 * IN, w * 0.5], material: ally, collider: false });
      b.solid([cx, top / 2, l.z], [LOADER.depth, top, w + 0.6 * IN]);
    }
    // One draw call per material for everything that doesn't move.
    mergeStatic(b.group);
  }

  // ------------------------------------------------------------- pieces
  private makePin(x: number, y: number, z: number, colors: [PinColor, PinColor], rot?: THREE.Quaternion): Piece {
    const group = new THREE.Group();
    // One mesh (one draw call) per Pin: both halves in one geometry, colored per vertex.
    const m = new THREE.Mesh(this.pinGeometry(colors), this.mats.pinBody);
    m.castShadow = m.receiveShadow = true;
    group.add(m);
    this.ctx.scene.add(group);
    const body = this.ctx.world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(x, y, z)
        .setRotation(rot ? { x: rot.x, y: rot.y, z: rot.z, w: rot.w } : { x: 0, y: 0, z: 0, w: 1 })
        .setLinearDamping(0.5)
        .setAngularDamping(1.5)
        .setCanSleep(true),
    );
    if (rot) group.quaternion.copy(rot);
    group.position.set(x, y, z);
    const hull = RAPIER.ColliderDesc.convexHull(this.pinHull) ?? RAPIER.ColliderDesc.cylinder(PIN_LEN / 2, 0.04);
    this.ctx.world.createCollider(hull.setMass(0.073).setFriction(0.6).setRestitution(0.05).setCollisionGroups(PIECE_GROUPS), body);
    const p: Piece = { id: this.pieces.length, kind: 'pin', colors, body, mesh: group, state: 'loose' };
    this.pieces.push(p);
    return p;
  }

  private pinGeos = new Map<string, THREE.BufferGeometry>();
  /** Both Pin halves in one geometry with per-vertex colors, cached per color pair. */
  private pinGeometry(colors: [PinColor, PinColor]): THREE.BufferGeometry {
    const key = colors.join('/');
    const hit = this.pinGeos.get(key);
    if (hit) return hit;
    const paint = (g: THREE.BufferGeometry, c: PinColor) => {
      const col = new THREE.Color(COLORS[c]);
      const n = g.getAttribute('position').count;
      const arr = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) col.toArray(arr, i * 3);
      const out = g.clone();
      out.setAttribute('color', new THREE.BufferAttribute(arr, 3));
      return out;
    };
    const a = paint(this.geo.pinLow, colors[0]);
    const b = paint(this.geo.pinHigh, colors[1]);
    const merged = mergeGeometries([a, b], false)!;
    a.dispose();
    b.dispose();
    this.pinGeos.set(key, merged);
    return merged;
  }

  private makeCup(x: number, y: number, z: number, opaqueUp = true): Piece {
    const group = new THREE.Group();
    const low = new THREE.Mesh(this.geo.cupLow, this.mats.cupClear);
    const high = new THREE.Mesh(this.geo.cupHigh, this.mats.cupOpaque);
    high.castShadow = true;
    group.add(low, high);
    this.ctx.scene.add(group);
    const body = this.ctx.world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(x, y, z)
        .setRotation(opaqueUp ? { x: 0, y: 0, z: 0, w: 1 } : { x: 1, y: 0, z: 0, w: 0 })
        .setLinearDamping(0.5)
        .setAngularDamping(1.5)
        .setCanSleep(true),
    );
    group.position.set(x, y, z);
    if (!opaqueUp) group.rotation.x = Math.PI;
    this.ctx.world.createCollider(
      RAPIER.ColliderDesc.cylinder(CUP_H / 2, 0.038).setMass(0.078).setFriction(0.55).setCollisionGroups(PIECE_GROUPS),
      body,
    );
    const p: Piece = { id: this.pieces.length, kind: 'cup', colors: ['yellow', 'yellow'], body, mesh: group, state: 'loose' };
    this.pieces.push(p);
    return p;
  }

  /** Starting layout from the manual's Scoring Object Locations sheet (see startingLayout()). */
  private spawnLayout(): void {
    const layout = startingLayout();
    const cups = layout.cups.map((c) => this.makeCup(c.x, CUP_H / 2 + 0.002, c.z, c.opaqueUp));
    const skills = this.ctx.mode === 'skills';
    for (const p of layout.pins) {
      if (p.pose === 'goal') {
        // Robot Skills Matches start with the neutral Goals empty (RSC4-1).
        if (skills) continue;
        const goal = this.goals.find((g) => g.id === p.goal)!;
        const pin = this.makePin(goal.x, 0.5, goal.z, p.colors);
        this.placeOn(goal, pin, { type: 'pin', down: p.colors[0], up: p.colors[1] });
      } else if (p.pose === 'lying') {
        const [dx, dz] = p.outward!;
        // Mesh half A (colors[0]) is local -Y: point it outward, lying on the tiles.
        const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, -1, 0), new THREE.Vector3(dx, 0, dz));
        this.makePin(p.x, PIN_R + 0.001, p.z, p.colors, q);
      } else if (p.pose === 'inCup') {
        const cup = cups[p.cup!];
        const pin = this.makePin(p.x, CUP_H / 2 + PIN_OVER_CUP, p.z, p.colors);
        pin.nestedIn = cup;
        pin.body.setEnabled(false);
      } else {
        this.makePin(p.x, PIN_LEN / 2 + 0.002, p.z, p.colors);
      }
    }
  }

  /** Keep Pins standing in Cups with their Cup; drop them once the Cup is moved off its feet or taken. */
  private updateNested(): void {
    for (const p of this.pieces) {
      const c = p.nestedIn;
      if (!c || p.state !== 'loose') continue;
      const q = c.body.rotation();
      const up = new THREE.Vector3(0, 1, 0).applyQuaternion(new THREE.Quaternion(q.x, q.y, q.z, q.w));
      const t = c.body.translation();
      if (c.state !== 'loose' || Math.abs(up.y) < 0.94) {
        this.unnest(p);
        continue;
      }
      p.body.setTranslation({ x: t.x, y: t.y + PIN_OVER_CUP, z: t.z }, false);
    }
  }

  private unnest(p: Piece): void {
    const t = p.body.translation();
    p.nestedIn = undefined;
    p.body.setEnabled(true);
    p.body.setTranslation({ x: t.x, y: t.y + 0.01, z: t.z }, true);
    p.body.wakeUp();
  }

  private hold(p: Piece): void {
    p.nestedIn = undefined;
    p.state = 'held';
    p.body.setEnabled(false);
    this.held.push(p);
  }

  private release(p: Piece, x: number, y: number, z: number, vx = 0, vz = 0): void {
    this.heldStack = false;
    p.state = 'loose';
    p.body.setEnabled(true);
    p.body.setTranslation({ x, y, z }, true);
    p.body.setRotation({ x: 0, y: 0, z: 0, w: 1 }, true);
    p.body.setLinvel({ x: vx, y: 0, z: vz }, true);
    p.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    this.held = this.held.filter((h) => h !== p);
  }

  private placeOn(g: Goal, piece: Piece, item: StackItem): void {
    piece.state = 'placed';
    piece.body.setEnabled(false);
    g.stack.push(item);
    g.pieces.push(piece);
    this.layoutGoal(g);
  }

  /** Base heights of each stacked element, following how the parts physically nest. */
  private stackBases(g: Goal, extra?: StackItem): number[] {
    const items = extra ? [...g.stack, extra] : g.stack;
    const bases: number[] = [];
    items.forEach((item, i) => {
      if (i === 0) bases.push(GOAL_H[g.kind] - NEST_PIN_IN_GOAL);
      else bases.push(bases[i - 1] + (item.type === 'cup' ? CUP_ON_PIN : PIN_IN_CUP));
    });
    return bases;
  }

  /** Height the next element's bottom would sit at on a goal. */
  private stackTop(g: Goal): number {
    const next: StackItem = g.stack[g.stack.length - 1]?.type === 'pin' ? { type: 'cup', opaqueUp: true } : { type: 'pin', down: 'red', up: 'red' };
    const bases = this.stackBases(g, next);
    return bases[bases.length - 1];
  }

  private layoutGoal(g: Goal): void {
    const bases = this.stackBases(g);
    g.stack.forEach((item, i) => {
      const piece = g.pieces[i];
      if (item.type === 'pin') {
        piece.mesh.position.set(g.x, bases[i] + PIN_LEN / 2, g.z);
        // Mesh half A is the lower half when unrotated.
        piece.mesh.rotation.set(piece.colors[0] === item.down ? 0 : Math.PI, 0, 0);
      } else {
        piece.mesh.position.set(g.x, bases[i] + CUP_H / 2, g.z);
        piece.mesh.rotation.set(item.opaqueUp ? 0 : Math.PI, 0, 0);
      }
    });
  }

  // ----------------------------------------------------------- update
  update(dt: number, ctl: ControlState): void {
    const robot = this.ctx.robot;
    const enabled = this.ctx.clock.enabled;
    const anim = robot.anim;
    const range = robot.model.liftRange ?? [0.05, 0.6];
    const liftRate = (range[1] - range[0]) / (robot.cfg.liftTime ?? 1);
    this.intakeCooldown -= dt;
    this.dropCooldown -= dt;
    anim.intake = enabled && ctl.intake ? 1 : enabled && ctl.outtake ? -1 : 0;
    this.updateNested();
    if (this.ctx.settings.assist) this.updateAssisted(dt, ctl, range, liftRate);
    else this.updateManual(dt, ctl, range, liftRate);
    this.updateSwing(dt, range);

    // Toggles: a robot pushing a Toggle rotates it to its alliance face.
    for (const tv of this.toggles) {
      tv.touched = this.robotTouchesToggle(tv);
      if (tv.touched && enabled && tv.owner !== robot.alliance) {
        tv.owner = robot.alliance;
        this.ctx.toast(`${tv.q} Toggle → ${robot.alliance.toUpperCase()}`, robot.alliance);
        this.ctx.beep('score');
      }
      // Turn the owner's face to where yellow started (up and into the field).
      const target = tv.owner === null ? 0 : tv.owner === tv.side ? (2 * Math.PI) / 3 : (-2 * Math.PI) / 3;
      tv.angle += THREE.MathUtils.clamp(target - tv.angle, -8 * dt, 8 * dt);
    }
  }

  /** The swinging claw arm (19109M): about 1.1 s end to end, like its timed swing. */
  private updateSwing(dt: number, range: [number, number]): void {
    const robot = this.ctx.robot;
    if (!robot.model.swingArm) return;
    const anim = robot.anim;
    if (this.swingOutAt !== null && anim.lift >= this.swingOutAt - 0.002) {
      this.swingTarget = 0;
      this.swingOutAt = null;
    }
    const before = anim.swing;
    anim.swing += THREE.MathUtils.clamp(this.swingTarget - anim.swing, -dt / 1.1, dt / 1.1);
    if (anim.swing !== before) robot.mechAmps += 1.5;
    if (this.loadPending !== null && anim.swing > 0.98 && anim.lift <= range[0] + 0.01) {
      this.loadPending -= dt;
      if (this.loadPending <= 0) {
        this.loadPending = null;
        this.giveStackLoad();
      }
    }
  }

  /** Beginner mode: the lift runs itself and one button places on the Goal in front. */
  private updateAssisted(dt: number, ctl: ControlState, range: [number, number], liftRate: number): void {
    const robot = this.ctx.robot;
    const enabled = this.ctx.clock.enabled;
    const anim = robot.anim;
    let liftTarget = this.held.length ? range[0] + 0.12 : range[0] + 0.02;
    if (this.job) {
      const j = this.job;
      j.t += dt;
      liftTarget = j.height + 0.06;
      if (j.t >= j.duration) this.finishPlace(j);
    }
    if (enabled && ctl.intake && !this.job) liftTarget = range[0];
    anim.lift += THREE.MathUtils.clamp(liftTarget - anim.lift, -liftRate * dt, liftRate * dt);
    anim.claw += THREE.MathUtils.clamp((this.held.length && !(this.job && this.job.t > this.job.duration - 0.2) ? 1 : 0.15) - anim.claw, -6 * dt, 6 * dt);
    anim.wrist += THREE.MathUtils.clamp(this.wristTarget - anim.wrist, -9 * dt, 9 * dt);
    const liftMoving = Math.abs(liftTarget - anim.lift) > 0.01;
    robot.mechAmps = (liftMoving ? 2.2 : this.held.length ? 0.6 : 0.2) + (anim.intake !== 0 ? 1.2 : 0);
    if (enabled && ctl.intake && !this.job) this.grabFromFloor(dt);
    const outEdge = ctl.outtake && !this.prevOut;
    this.prevOut = ctl.outtake;
    if (enabled && outEdge && this.held.length && !this.job && this.goalInFront()) this.startPlace();
    else if (enabled && ctl.outtake && this.held.length && this.dropCooldown <= 0 && !this.job) {
      const p = this.held[this.held.length - 1];
      const [x, z] = robot.toWorld(robot.cfg.length / 2 + 0.1, 0);
      const [fx, fz] = [Math.cos(robot.heading), -Math.sin(robot.heading)];
      this.release(p, x, (p.kind === 'pin' ? PIN_LEN : CUP_H) / 2 + 0.02, z, robot.cmd.vx + fx * 0.3, robot.cmd.vz + fz * 0.3);
      this.dropCooldown = 0.4;
    }
    if (enabled && ctl.score && !this.prevScore) this.startPlace();
    this.prevScore = ctl.score;
  }

  /**
   * Real driving: the driver runs the lift, closes the claw low to grab (or at the top of a
   * stack to descore), lines the claw up over a Goal and opens it. A held element rests on
   * the Goal instead of going through it, and only counts if it's seated on the stack.
   * Robots with team macros (19109M) lift to mid height after a grab, and lower while R2 is
   * held, letting go when it's released.
   */
  private updateManual(dt: number, ctl: ControlState, range: [number, number], liftRate: number): void {
    const robot = this.ctx.robot;
    const enabled = this.ctx.clock.enabled;
    const anim = robot.anim;
    const macros = robot.cfg.macros === 'lower-release';
    const dir = enabled ? (ctl.liftUp ? 1 : 0) - (ctl.liftDown ? 1 : 0) : 0;
    if (dir !== 0) {
      this.liftGoal = null; // the driver takes over from any macro
      this.releaseFrom = null;
    }
    let target = anim.lift;
    if (dir !== 0) target = dir > 0 ? range[1] : range[0];
    else if (this.liftGoal !== null) target = this.liftGoal;
    if (macros && enabled && ctl.outtake && this.held.length) {
      // R2 held: lower onto the Goal.
      if (this.releaseFrom === null) this.releaseFrom = anim.lift;
      this.liftGoal = null;
      target = range[0];
    }
    const before = anim.lift;
    if (enabled) anim.lift += THREE.MathUtils.clamp(target - anim.lift, -liftRate * dt, liftRate * dt);
    // What's in the claw can't pass through a Goal: it rests on the stack (or hits the rim).
    const seat = this.held.length ? this.goalUnderClaw(0.09) : null;
    if (seat) {
      const gap = this.unitBottom() - this.stackTop(seat.goal);
      if (gap < 0) anim.lift -= gap;
    }
    anim.lift = THREE.MathUtils.clamp(anim.lift, range[0], range[1]);
    const moving = Math.abs(anim.lift - before) > 1e-5;
    anim.claw += THREE.MathUtils.clamp((this.held.length ? 1 : 0.15) - anim.claw, -8 * dt, 8 * dt);
    anim.wrist += THREE.MathUtils.clamp(this.wristTarget - anim.wrist, -9 * dt, 9 * dt);
    robot.mechAmps = (moving ? 2.2 : this.held.length ? 0.6 : 0.2) + (anim.intake !== 0 ? 1.2 : 0);

    // Grab: low for the floor, at the top of a stack to descore.
    const intakeEdge = ctl.intake && !this.prevIntake;
    this.prevIntake = ctl.intake;
    if (enabled && ctl.intake) {
      const low = anim.lift <= range[0] + 0.05;
      const had = this.held.length;
      const armIn = !!robot.model.swingArm && anim.swing > 0.5;
      if (low && !armIn) this.grabFromFloor(dt);
      else if (intakeEdge && !armIn) this.grabFromStack();
      if (macros && intakeEdge && had && armIn) {
        // R1 after loading: lift to mid height; the arm swings out on the way (past ~30% of the travel).
        this.liftGoal = range[0] + (range[1] - range[0]) * 0.66;
        this.swingOutAt = range[0] + (range[1] - range[0]) * 0.305;
      } else if (macros && this.held.length > had) {
        // R1: close, then lift to mid height (CASCADE_MIDDLE is ~66% of the cascade's travel).
        this.liftGoal = range[0] + (range[1] - range[0]) * 0.66;
      } else if (macros && intakeEdge && had && this.liftGoal !== null && this.liftGoal < range[1]) {
        this.liftGoal = range[1]; // R1 again while lifting: to the top
      }
    }

    // Release.
    const outEdge = ctl.outtake && !this.prevOut;
    const outLetGo = !ctl.outtake && this.prevOut;
    this.prevOut = ctl.outtake;
    if (enabled && this.held.length) {
      if (macros && outLetGo) {
        this.releaseAtClaw();
        if (this.releaseFrom !== null) this.liftGoal = this.releaseFrom; // back up to where it was
        this.releaseFrom = null;
      } else if (!macros && outEdge) this.releaseAtClaw();
    }
  }

  /** Rollers pull nearby elements in; the claw grabs one that reaches it (a Cup with its Pin for stack grabbers). */
  private grabFromFloor(dt: number): void {
    const robot = this.ctx.robot;
    if (this.held.length >= robot.cfg.capacity) return;
    const front = robot.cfg.length / 2;
    for (const p of this.pieces) {
      if (p.state !== 'loose' || p.nestedIn || this.held.some((h) => h.kind === p.kind)) continue;
      const t = p.body.translation();
      const [f, side] = robot.toLocal(t.x, t.z);
      const reach = robot.cfg.intakeReach + 0.1;
      if (f < front - 0.05 || f > front + reach || Math.abs(side) > robot.cfg.intakeWidth / 2 + 0.06 || t.y > 0.3) continue;
      const [mx, mz] = robot.toWorld(front, 0);
      const dx = mx - t.x;
      const dz = mz - t.z;
      const d = Math.hypot(dx, dz) || 1;
      const v = p.body.linvel();
      const tx = robot.cmd.vx + (dx / d) * 0.9;
      const tz = robot.cmd.vz + (dz / d) * 0.9;
      const k = Math.min(1, 12 * dt);
      p.body.setLinvel({ x: v.x + (tx - v.x) * k, y: v.y, z: v.z + (tz - v.z) * k }, true);
    }
    if (this.intakeCooldown > 0) return;
    for (const p of this.pieces) {
      if (p.state !== 'loose') continue;
      // SG6: a robot may hold at most one Pin and one Cup.
      if (this.held.some((h) => h.kind === p.kind)) continue;
      const t = p.body.translation();
      const [f] = robot.toLocal(t.x, t.z);
      if (!(robot.inIntake(t.x, t.z, t.y, 0.3) && f < front + Math.max(robot.cfg.intakeReach * 0.6, 0.1))) continue;
      const rider = p.kind === 'cup' ? this.pieces.find((q) => q.nestedIn === p) : undefined;
      if (rider && robot.cfg.grabsStacks && this.held.length === 0) {
        // Close on the Cup with its Pin standing in it, as one stack.
        this.hold(p);
        this.hold(rider);
        this.heldStack = true;
      } else if (p.nestedIn) {
        if (!robot.cfg.grabsStacks) this.hold(p); // pluck the Pin out of its Cup
        else continue;
      } else this.hold(p);
      this.intakeCooldown = 0.35;
      this.ctx.intook();
      break;
    }
  }

  /** Claw closed at the top of a stack: take the top element (descore). */
  private grabFromStack(): void {
    const at = this.goalUnderClaw(0.05);
    if (!at || !at.goal.stack.length || this.held.length >= this.ctx.robot.cfg.capacity) return;
    const g = at.goal;
    const top = g.pieces[g.pieces.length - 1];
    const bases = this.stackBases(g);
    const center = bases[bases.length - 1] + (top.kind === 'pin' ? PIN_LEN : CUP_H) / 2;
    if (Math.abs(this.clawWorld().y - center) > 1.5 * IN || this.held.some((h) => h.kind === top.kind)) return;
    const item = g.stack.pop()!;
    g.pieces.pop();
    if (item.type === 'pin') this.placedByMe = Math.max(0, this.placedByMe - 1);
    this.hold(top);
    this.ctx.toast('Descored the top of the stack', 'info');
  }

  /** The pieces that leave the claw together: a held Cup + Pin stack, or the one in the claw. */
  private clawUnit(): Piece[] {
    if (this.heldStack && this.held.length >= 2) return [this.held[0], this.held[1]];
    return this.held.length ? [this.held[0]] : [];
  }

  /** Bottom of what's in the claw, world height. */
  private unitBottom(): number {
    const u = this.clawUnit();
    if (!u.length) return Infinity;
    return this.clawWorld().y - (u[0].kind === 'pin' ? PIN_LEN : CUP_H) / 2;
  }

  /** Claw (carry point) in world coordinates. */
  private clawWorld(): THREE.Vector3 {
    const r = this.ctx.robot;
    const out = new THREE.Vector3();
    const carry = r.model.carry;
    if (carry) {
      carry.updateWorldMatrix(true, false);
      return carry.getWorldPosition(out);
    }
    const [x, z] = r.toWorld(r.cfg.length / 2 + 0.07, 0);
    return out.set(x, r.mesh.position.y + r.anim.lift, z);
  }

  /** The Goal whose center is within `within` (m) of the claw, horizontally. */
  private goalUnderClaw(within: number): { goal: Goal; d: number } | null {
    const c = this.clawWorld();
    let best: { goal: Goal; d: number } | null = null;
    for (const g of this.goals) {
      const d = Math.hypot(c.x - g.x, c.z - g.z);
      if (d < within && (!best || d < best.d)) best = { goal: g, d };
    }
    return best;
  }

  /** Open the claw: seat the piece(s) on the Goal under it, or drop them. */
  private releaseAtClaw(): void {
    const unit = this.clawUnit();
    if (!unit.length) return;
    const c = this.clawWorld();
    const at = this.goalUnderClaw(0.09);
    if (at) {
      const g = at.goal;
      const gap = this.unitBottom() - this.stackTop(g);
      const items = unit.map((p) => this.itemFor(p));
      const want = g.stack[g.stack.length - 1]?.type === 'pin' ? 'cup' : 'pin';
      let why = '';
      if (at.d > ALIGN) why = `Not lined up: the claw is ${((at.d - ALIGN) / IN).toFixed(1)}″ off the Goal’s center`;
      else if (gap > 1.2 * IN) why = `Too high: lower ${(gap / IN).toFixed(1)}″ more before letting go`;
      else if (items[0].type !== want) why = want === 'cup' ? 'This Pin needs a Cup on it before the next Pin' : 'Goals take a Pin here, not a Cup';
      else {
        const res = canPlace(g, items[0], this.me);
        if (!res.ok) why = res.reason;
      }
      if (!why) {
        this.held = this.held.filter((h) => !unit.includes(h));
        this.heldStack = false;
        unit.forEach((p, i) => {
          if (i > 0 && !canPlace(g, items[i], this.me).ok) {
            this.release(p, g.x, this.stackTop(g) + PIN_LEN, g.z);
            return;
          }
          this.placeOn(g, p, items[i]);
          if (items[i].type === 'pin') this.placedByMe++;
        });
        const pins = items.filter((it) => it.type === 'pin').length;
        const halves = visibleHalves(g).slice(-2).join(' + ');
        this.ctx.toast(pins ? `Scored: ${halves} showing on ${g.id}` : `Cup seated on ${g.id}`, 'good');
        if (pins) this.ctx.scored(pins);
        this.ctx.beep('score');
        return;
      }
      if (gap > 1.2 * IN || at.d > ALIGN) this.ctx.toast(why, 'bad');
      else {
        this.ctx.toast(why, 'bad');
        return; // seated but not allowed: keep holding
      }
    }
    // Drop it where the claw is (a stack stays together).
    const r = this.ctx.robot;
    this.held = this.held.filter((h) => !unit.includes(h));
    const [base, rider] = unit;
    this.release(base, c.x, c.y, c.z, r.cmd.vx, r.cmd.vz);
    if (rider) {
      this.release(rider, c.x, c.y + PIN_OVER_CUP, c.z, r.cmd.vx, r.cmd.vz);
      rider.nestedIn = base;
      rider.body.setEnabled(false);
    }
    this.heldStack = false;
  }

  private robotTouchesToggle(tv: ToggleViz): boolean {
    const r = this.ctx.robot;
    // The Toggle rides on the wall top: a robot touches it by reaching over from the wall face.
    const faceOffset = WALL_T / 2 + 1.5 * IN;
    const d = (r.x - tv.x) * tv.n[0] + (r.z - tv.z) * tv.n[1];
    const [fx, fz] = [Math.cos(r.heading), -Math.sin(r.heading)];
    const [rx, rz] = [Math.sin(r.heading), Math.cos(r.heading)];
    const ext = Math.abs((r.cfg.length / 2) * (fx * tv.n[0] + fz * tv.n[1])) + Math.abs((r.cfg.width / 2) * (rx * tv.n[0] + rz * tv.n[1]));
    const lat = Math.abs((r.x - tv.x) * tv.n[1] - (r.z - tv.z) * tv.n[0]);
    const latExt = Math.abs((r.cfg.length / 2) * (fx * tv.n[1] - fz * tv.n[0])) + Math.abs((r.cfg.width / 2) * (rx * tv.n[1] - rz * tv.n[0]));
    return d - ext < faceOffset && lat < TOGGLE_LEN / 2 + latExt;
  }

  private goalInFront(): Goal | null {
    const r = this.ctx.robot;
    let best: Goal | null = null;
    let bestD = Infinity;
    for (const g of this.goals) {
      const [f, l] = r.toLocal(g.x, g.z);
      const front = r.cfg.length / 2;
      if (f > front - 0.04 && f < front + 0.2 && Math.abs(l) < 0.1) {
        const d = Math.hypot(f - front - 0.06, l);
        if (d < bestD) {
          bestD = d;
          best = g;
        }
      }
    }
    return best;
  }

  private startPlace(): void {
    if (this.job) return;
    const g = this.goalInFront();
    if (!g) {
      this.ctx.toast('Drive up so the Goal is centered in front of your claw', 'info');
      return;
    }
    const top = g.stack[g.stack.length - 1];
    const want: 'pin' | 'cup' = top && top.type === 'pin' ? 'cup' : 'pin';
    const piece = this.held.find((p) => p.kind === want);
    if (!piece) {
      this.ctx.toast(want === 'cup' ? 'This Pin needs a Cup on it before the next Pin' : 'You need a Pin for this Goal', 'bad');
      return;
    }
    const item = this.itemFor(piece);
    const res = canPlace(g, item, this.me);
    if (!res.ok) {
      this.ctx.toast(res.reason, 'bad');
      return;
    }
    const height = this.stackTop(g);
    const range = this.ctx.robot.model.liftRange ?? [0.05, 0.6];
    if (height > range[1] + 0.04) {
      this.ctx.toast(`Too tall for this lift (stack at ${(height / IN).toFixed(0)}")`, 'bad');
      return;
    }
    const rate = (range[1] - range[0]) / (this.ctx.robot.cfg.liftTime ?? 1);
    // Pins are picked up flat-end down; the wrist flips them tip-down to nest.
    const flip = piece.kind === 'pin' ? 0.35 : 0;
    if (piece.kind === 'pin') this.wristTarget += Math.PI;
    if (piece.kind === 'cup' && !this.cupOpaqueUp) this.wristTarget += 0; // already oriented in the claw
    const travel = Math.abs(height + 0.06 - this.ctx.robot.anim.lift) / rate;
    this.job = { goal: g, piece, t: 0, duration: Math.max(travel, flip) + 0.25, height };
  }

  private finishPlace(j: PlaceJob): void {
    this.job = null;
    const g = j.goal;
    if (this.goalInFront() !== g) {
      this.ctx.toast('Missed: you drove off the Goal while placing', 'bad');
      return;
    }
    const piece = j.piece;
    const item = this.itemFor(piece);
    if (!canPlace(g, item, this.me).ok) return;
    this.held = this.held.filter((h) => h !== piece);
    this.placeOn(g, piece, item);
    if (item.type === 'pin') {
      this.placedByMe++;
      const halves = visibleHalves(g).slice(-2).join(' + ');
      this.ctx.toast(`Pin placed: ${item.down} down / ${item.up} up (scoring ${halves})`, item.down === 'yellow' && item.up === 'yellow' ? 'good' : this.me);
      this.ctx.scored(1);
    } else {
      this.ctx.toast(item.opaqueUp ? 'Cup placed: opaque half up' : 'Cup placed upside-down: hides the Pin below’s top half', 'info');
    }
    this.ctx.beep('score');
  }

  /** The stack item a held piece becomes, using the driver's chosen orientation. */
  private itemFor(piece: Piece): StackItem {
    if (piece.kind === 'cup') return { type: 'cup', opaqueUp: this.cupOpaqueUp };
    const [a, b] = piece.colors;
    return this.pinFlip ? { type: 'pin', down: b, up: a } : { type: 'pin', down: a, up: b };
  }

  /** What the next placement would be: decides what the flip button turns over. */
  private nextKind(): 'pin' | 'cup' {
    const g = this.goalInFront();
    if (g) return g.stack[g.stack.length - 1]?.type === 'pin' ? 'cup' : 'pin';
    return this.held.some((h) => h.kind === 'pin') ? 'pin' : 'cup';
  }

  private descore(): void {
    const g = this.goalInFront();
    if (!g || !g.stack.length) {
      this.ctx.toast('No stack in front of you', 'info');
      return;
    }
    const item = g.stack.pop()!;
    const piece = g.pieces.pop()!;
    if (item.type === 'pin') this.placedByMe = Math.max(0, this.placedByMe - 1);
    if (this.held.length < this.ctx.robot.cfg.capacity) {
      this.hold(piece);
      this.ctx.toast('Descored into your claw', 'info');
    } else {
      const r = this.ctx.robot;
      const [x, z] = r.toWorld(r.cfg.length / 2 + 0.15, 0.15);
      this.release(piece, x, 0.15, z);
      this.ctx.toast('Descored onto the floor', 'info');
    }
  }

  onAction(a: Action): void {
    if (a === 'flip') {
      // Turns over whatever goes on next: a Pin (which color half goes down) or a Cup.
      this.wristTarget += Math.PI;
      if (this.nextKind() === 'pin') {
        this.pinFlip = !this.pinFlip;
        const pin = this.held.find((h) => h.kind === 'pin');
        const it = pin ? (this.itemFor(pin) as { down: PinColor; up: PinColor }) : null;
        this.ctx.toast(it ? `Pin flipped: ${it.down.toUpperCase()} half down, ${it.up.toUpperCase()} up` : 'Next Pin flipped', 'info');
      } else {
        this.cupOpaqueUp = !this.cupOpaqueUp;
        this.ctx.toast(this.cupOpaqueUp ? 'Cup: opaque half UP (hides the next Pin’s lower half)' : 'Cup: opaque half DOWN (hides the Pin below’s upper half)', 'info');
      }
    } else if (a === 'descore') {
      if (this.ctx.clock.enabled && !this.job) this.descore();
    } else if (a === 'feed') {
      this.matchLoad();
    }
  }

  /** A person drops a Cup with a Pin in it into the open claw. */
  private giveStackLoad(): void {
    const r = this.ctx.robot;
    const q = this.loaderQueue[this.me];
    if (q[0] !== 'cup' || !q[1] || q[1] === 'cup' || this.held.length) return;
    q.shift();
    const pinKind = q.shift()!;
    const cup = this.makeCup(r.x, 0.3, r.z);
    const pin = this.makePin(r.x, 0.4, r.z, pinKind === 'yy' ? ['yellow', 'yellow'] : [pinKind as Alliance, 'yellow']);
    this.hold(cup);
    this.hold(pin);
    this.heldStack = true;
    this.ctx.toast(`Match Load: Cup + ${pinKind === 'yy' ? 'yellow/yellow' : `${pinKind}/yellow`} Pin stack (${q.length} left)`, 'info');
  }

  private matchLoad(): void {
    const r = this.ctx.robot;
    const near = LOADERS.filter((l) => l.alliance === this.me).some((l) => Math.hypot(r.x - l.x, r.z - l.z) < 0.6);
    if (!near) {
      this.ctx.toast('Match loads: drive to one of your Loaders (corners on your side)', 'info');
      return;
    }
    const q = this.loaderQueue[this.me];
    if (!q.length) {
      this.ctx.toast('No Match Loads left', 'bad');
      return;
    }
    if (this.held.length >= r.cfg.capacity) {
      this.ctx.toast('Robot is full', 'bad');
      return;
    }
    if (r.cfg.grabsStacks && r.model.swingArm && q[0] === 'cup' && q[1] && q[1] !== 'cup' && this.held.length === 0) {
      // 19109M's L1: cascade down, the arm swings in over the top and the claw opens; a person
      // drops the load in (its MATCH_LOAD_TIME is 0.8 s).
      if (this.loadPending !== null) return;
      this.liftGoal = (r.model.liftRange ?? [0.05, 0.6])[0];
      this.swingTarget = 1;
      this.swingOutAt = null;
      this.loadPending = 0.8;
      this.ctx.toast('Loading position: cascade down, arm swinging in. Press R1 once it’s loaded.', 'info');
      return;
    }
    if (r.cfg.grabsStacks && q[0] === 'cup' && q[1] && q[1] !== 'cup' && this.held.length === 0) {
      this.giveStackLoad();
      return;
    }
    const nextKind = q[0] === 'cup' ? 'cup' : 'pin';
    if (this.held.some((h) => h.kind === nextKind)) {
      this.ctx.toast(`SG6: you can only hold one ${nextKind === 'cup' ? 'Cup' : 'Pin'} at a time`, 'bad');
      return;
    }
    const next = q.shift()!;
    const piece = next === 'cup'
      ? this.makeCup(r.x, 0.3, r.z)
      : this.makePin(r.x, 0.3, r.z, next === 'yy' ? ['yellow', 'yellow'] : [next, 'yellow']);
    this.hold(piece);
    this.ctx.toast(`Match Load: ${next === 'cup' ? 'Cup' : next === 'yy' ? 'yellow/yellow Pin' : `${next}/yellow Pin`} (${q.length} left)`, 'info');
  }

  onPhaseChange(prev: Phase | null): void {
    if (prev?.kind === 'auto') {
      this.autoBonus = autoWinner(this.state());
      this.ctx.toast(
        this.autoBonus === this.me ? `Autonomous Bonus +${OVERRIDE.points.autoBonus}!` : this.autoBonus === 'tie' ? 'Autonomous tied: +6 each' : 'Opponent wins the Autonomous Bonus',
        this.autoBonus === this.me ? 'good' : 'info',
      );
    }
  }

  /** Any part of the robot inside the Midfield diamond. */
  private robotInMidfield(): boolean {
    const r = this.ctx.robot;
    const hl = r.cfg.length / 2;
    const hw = r.cfg.width / 2;
    for (const [f, s] of [[0, 0], [hl, hw], [hl, -hw], [-hl, hw], [-hl, -hw], [hl, 0], [-hl, 0], [0, hw], [0, -hw]] as const) {
      const [x, z] = r.toWorld(f, s);
      if (isInMidfield(x, z)) return true;
    }
    return false;
  }

  private state(atEnd = false) {
    const mid = this.robotInMidfield() ? 1 : 0;
    const toggles = Object.fromEntries(this.toggles.map((t) => [t.q, atEnd && t.touched ? null : t.owner])) as Record<Quadrant, Alliance | null>;
    return {
      goals: this.goals,
      toggles,
      robotsInMidfield: { red: this.me === 'red' ? mid : 0, blue: this.me === 'blue' ? mid : 0 },
      autoBonus: this.ctx.mode === 'match' ? this.autoBonus : null,
    };
  }

  liveScore(): { mine: number; other: number; lines: ScoreLine[] } {
    const s = scoreOverride(this.state());
    const m = s[this.me];
    return {
      mine: m.total,
      other: s[this.me === 'red' ? 'blue' : 'red'].total,
      lines: [
        { label: 'Alliance halves', value: m.alliancePins },
        { label: 'Yellow halves', value: m.yellowPins },
        { label: 'Midfield', value: m.midfield },
        { label: 'Auto bonus', value: m.autoBonus },
      ],
    };
  }

  statusHtml(): string {
    const chip = (t: ToggleViz) => {
      const c = t.owner === 'red' ? 'var(--red)' : t.owner === 'blue' ? 'var(--blue)' : 'var(--yellow)';
      return `<span class="chip" style="--c:${c}" title="${t.touched ? 'touching: does not count' : ''}">${t.q}${t.touched ? '✋' : ''}</span>`;
    };
    const mid = this.robotInMidfield();
    const loads = this.loaderQueue[this.me].length;
    let claw = '';
    if (!this.ctx.settings.assist) {
      const h = this.clawWorld().y / IN;
      const g = this.held.length ? this.goalUnderClaw(0.25) : null;
      let tip = this.held.length ? 'line up over a Goal' : 'lower to grab';
      if (g) {
        const gap = (this.unitBottom() - this.stackTop(g.goal)) / IN;
        tip = g.d > ALIGN ? `${((g.d - ALIGN) / IN).toFixed(1)}″ off ${g.goal.id}` : gap > 1.2 ? `lower ${gap.toFixed(1)}″ onto ${g.goal.id}` : `seated on ${g.goal.id}: release!`;
      }
      claw = `<div class="row"><span class="lbl">Claw</span><b>${h.toFixed(1)}″</b> <span class="hint">${tip}</span></div>`;
    }
    return `${claw}
      <div class="row"><span class="lbl">Toggles</span>${this.toggles.map(chip).join('')}</div>
      <div class="row"><span class="lbl">Next Cup</span><b>${this.cupOpaqueUp ? 'opaque up' : 'opaque DOWN'}</b> <span class="hint">R / A to flip</span></div>
      <div class="row"><span class="lbl">Midfield</span><b style="color:${mid ? 'var(--good)' : 'var(--muted)'}">${mid ? 'IN (+8, owns center yellows)' : 'out'}</b></div>
      <div class="row"><span class="lbl">Match Loads</span><b>${loads}</b> <span class="hint">B at your Loader</span></div>
      ${this.job ? `<div class="row"><span class="lbl">Placing</span><b>${Math.round((this.job.t / this.job.duration) * 100)}%</b></div>` : ''}`;
  }

  cargoHtml(): string {
    const slots: string[] = [];
    for (let i = 0; i < this.ctx.robot.cfg.capacity; i++) {
      const p = this.held[i];
      if (!p) slots.push('<span class="slot"></span>');
      else if (p.kind === 'cup') slots.push('<span class="slot cup" title="Cup"></span>');
      else {
        const it = this.itemFor(p) as { down: PinColor; up: PinColor };
        slots.push(`<span class="slot pin" style="--a:${CSS[it.up]};--b:${CSS[it.down]}" title="Pin: ${it.down} half goes down"></span>`);
      }
    }
    return slots.join('');
  }

  piecesScored(): number {
    return this.placedByMe;
  }

  render(): void {
    const r = this.ctx.robot;
    for (const p of this.pieces) {
      if (p.state === 'loose') {
        const t = p.body.translation();
        const q = p.body.rotation();
        p.mesh.position.set(t.x, t.y, t.z);
        p.mesh.quaternion.set(q.x, q.y, q.z, q.w);
        if (t.y < -1) p.body.setTranslation({ x: 0, y: 0.3, z: 0.4 }, true);
      }
    }
    // First held element in the claw, the rest riding on the robot.
    const carry = r.model.carry;
    this.held.forEach((p, i) => {
      if (i === 1 && this.heldStack) {
        // The Pin standing in the held Cup.
        const cup = this.held[0].mesh;
        const up = new THREE.Vector3(0, 1, 0).applyQuaternion(cup.quaternion);
        if (up.y < 0) up.negate();
        p.mesh.position.copy(cup.position).addScaledVector(up, PIN_OVER_CUP);
        p.mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), up);
        return;
      }
      if (i === 0 && carry) {
        carry.updateWorldMatrix(true, false);
        const pos = new THREE.Vector3();
        const quat = new THREE.Quaternion();
        carry.getWorldPosition(pos);
        carry.getWorldQuaternion(quat);
        p.mesh.position.copy(pos);
        p.mesh.quaternion.copy(quat);
        if (p.kind === 'pin' && (this.itemFor(p) as { down: PinColor }).down !== p.colors[0]) p.mesh.rotateX(Math.PI);
        if (p.kind === 'cup' && !this.cupOpaqueUp) p.mesh.rotateX(Math.PI);
      } else {
        const [x, z] = r.toWorld(r.cfg.length * 0.15, 0);
        p.mesh.position.set(x, r.mesh.position.y + 0.12 + i * 0.02, z);
        p.mesh.rotation.set(0, -r.heading, Math.PI / 2);
      }
    });
    for (const tv of this.toggles) tv.group.rotation.x = tv.angle;
    const near = !this.ctx.settings.assist && this.held.length ? this.goalUnderClaw(0.25) : null;
    this.alignRing.visible = !!near;
    if (near) {
      this.alignRing.position.set(near.goal.x, this.stackTop(near.goal) + 0.004, near.goal.z);
      const ok = near.d <= ALIGN;
      const seated = ok && this.unitBottom() - this.stackTop(near.goal) < 1.2 * IN;
      (this.alignRing.material as THREE.MeshBasicMaterial).color.setHex(seated ? 0x3ddc84 : ok ? 0x9be15d : 0xffb02e);
    }
    const glow = this.midfieldGlow.material as THREE.MeshBasicMaterial;
    glow.opacity = this.robotInMidfield() ? 0.7 + Math.sin(performance.now() / 150) * 0.25 : 0;
  }

  finalize(): MatchSummary {
    const st = this.state(true);
    const s = scoreOverride(st);
    const m = s[this.me];
    const o = s[this.me === 'red' ? 'blue' : 'red'];
    const lines: ScoreLine[] = [
      { label: 'Alliance-color Pin halves', value: m.alliancePins },
      { label: 'Owned yellow Pin halves', value: m.yellowPins },
      { label: 'Robot in Midfield', value: m.midfield },
    ];
    if (this.ctx.mode === 'match') lines.push({ label: 'Autonomous Bonus', value: m.autoBonus });
    lines.push({ label: 'Pins placed', value: this.placedByMe });
    lines.push({ label: 'Toggles owned at the end', value: `${Object.values(st.toggles).filter((t) => t === this.me).length}/4` });
    const notes: string[] = [];
    const touched = this.toggles.filter((t) => t.touched).map((t) => t.q);
    if (touched.length) notes.push(`You ended touching the ${touched.join(', ')} Toggle, so it didn’t count. Back off before the buzzer.`);
    if (o.total > 0) notes.push(`The opposing alliance got ${o.total} points from colored halves you placed.`);
    if (this.ctx.mode === 'match') notes.push('The Autonomous Win Point isn’t modeled.');
    return { total: m.total, lines, notes };
  }

  footprints(): Footprint[] {
    const out: Footprint[] = [
      { x: 0, z: 0, w: OVERRIDE.midfieldHalfDiagonal * 2, d: OVERRIDE.midfieldHalfDiagonal * 2, color: 'rgba(255,225,77,0.16)', shape: 'diamond' },
    ];
    for (const g of this.goals) {
      out.push({ x: g.x, z: g.z, w: GOAL_R_BOTTOM * 2.4, d: GOAL_R_BOTTOM * 2.4, color: g.kind === 'alliance' ? (g.alliance === 'red' ? '#d92b2b' : '#1f5fd6') : '#cfcfcf', shape: 'circle' });
    }
    for (const t of this.toggles) out.push({ x: t.x, z: t.z, w: t.alongX ? TOGGLE_LEN : 0.06, d: t.alongX ? 0.06 : TOGGLE_LEN, color: '#f2c518' });
    for (const l of LOADERS) out.push({ x: l.x, z: l.z, w: LOADER.depth, d: LOADER.width, color: l.alliance === 'red' ? '#d92b2b' : '#1f5fd6' });
    return out;
  }

  dispose(): void {
    for (const g of Object.values(this.geo)) g.dispose();
    for (const m of Object.values(this.mats.pin)) m.dispose();
    this.mats.pinBody.dispose();
    for (const g of this.pinGeos.values()) g.dispose();
    this.mats.cupClear.dispose();
    this.mats.cupOpaque.dispose();
  }
}

export interface LayoutPin {
  x: number;
  z: number;
  /**
   * Half colors. Standing ('floor', 'inCup', 'goal'): [down, up]. Lying: [outer, inner],
   * the outer half pointing along `outward`.
   */
  colors: [PinColor, PinColor];
  pose: 'floor' | 'lying' | 'inCup' | 'goal';
  outward?: [number, number];
  /** Index into cups for a Pin standing in a Cup. */
  cup?: number;
  /** Goal id for a Pin starting on a Goal. */
  goal?: string;
}
export interface LayoutCup {
  x: number;
  z: number;
  /** Opaque (gray) half up; false = clear side up. */
  opaqueUp: boolean;
}

/**
 * Starting positions of the field's Scoring Objects for a Head-to-Head Match (meters,
 * field-center origin), from the manual's Scoring Object Locations sheet and field
 * renders. Every element sits on the Goal grid (±23.55", ±47.10") or against a wall:
 *  - a yellow/yellow Pin on each of the 5 neutral Goals;
 *  - 4 "stars" on the NW-SE Autonomous Line: a Cup with 4 Pins lying around it, their
 *    colored ends out (blue/yellow to the North and East, red/yellow to the West and South);
 *  - the other diagonal: 4 Cups, each holding a standing yellow/yellow Pin;
 *  - the Midfield diamond's corners: 4 Cups holding red/blue Pins (blue up on the
 *    North and East corners, red up on the West and South);
 *  - 8 wall groups (Cup, Cup holding a yellow/yellow Pin, Cup) against each wall,
 *    at ±23.55" from its middle.
 * That is 37 Pins (8 red/yellow, 8 blue/yellow, 17 yellow/yellow, 4 red/blue) and 36
 * Cups, matching the manual's counts. Which 12 Cups start clear side up isn't legible on
 * the sheets; we put the 12 away from the walls clear side up (ASSUMPTION).
 */
export function startingLayout(): { pins: LayoutPin[]; cups: LayoutCup[] } {
  const pins: LayoutPin[] = [];
  const cups: LayoutCup[] = [];
  const cup = (x: number, z: number, opaqueUp: boolean) => cups.push({ x, z, opaqueUp }) - 1;
  for (const g of GOALS) if (g.kind !== 'alliance') pins.push({ x: g.x, z: g.z, colors: ['yellow', 'yellow'], pose: 'goal', goal: g.id });
  // Stars along the North-West to South-East diagonal.
  const arm = CUP_TOP_R + PIN_LEN / 2 + 0.2 * IN;
  const arms: [number, number, PinColor][] = [[0, -1, 'blue'], [1, 0, 'blue'], [-1, 0, 'red'], [0, 1, 'red']];
  for (const k of [-G2, -G1, G1, G2]) {
    cup(k, k, false);
    for (const [dx, dz, c] of arms) pins.push({ x: k + dx * arm, z: k + dz * arm, colors: [c, 'yellow'], pose: 'lying', outward: [dx, dz] });
  }
  // Cups holding yellow/yellow Pins along the other diagonal.
  for (const k of [-G2, -G1, G1, G2]) {
    const i = cup(k, -k, false);
    pins.push({ x: k, z: -k, colors: ['yellow', 'yellow'], pose: 'inCup', cup: i });
  }
  // Red/blue Pins in Cups on the Midfield diamond's corners.
  for (const [x, z, up] of [[0, -G1, 'blue'], [G1, 0, 'blue'], [-G1, 0, 'red'], [0, G1, 'red']] as const) {
    const i = cup(x, z, false);
    pins.push({ x, z, colors: [up === 'blue' ? 'red' : 'blue', up], pose: 'inCup', cup: i });
  }
  // Wall groups: Cup, Cup + yellow/yellow Pin, Cup, touching the wall.
  const off = HALF - CUP_TOP_R;
  const step = CUP_TOP_R * 2;
  for (const [nx, nz] of [[0, -1], [1, 0], [0, 1], [-1, 0]] as const) {
    for (const s of [-1, 1]) {
      for (const t of [-1, 0, 1]) {
        const along = s * G1 + t * step;
        const x = nx === 0 ? along : nx * off;
        const z = nz === 0 ? along : nz * off;
        const i = cup(x, z, true);
        if (t === 0) pins.push({ x, z, colors: ['yellow', 'yellow'], pose: 'inCup', cup: i });
      }
    }
  }
  return { pins, cups };
}

/** Fixed field geometry, exported for the reference spec and diagrams. */
export const OVERRIDE_FIELD = {
  half: HALF,
  wallHeight: WALL_H,
  wallThickness: WALL_T,
  grid: [G1, G2],
  goals: GOALS,
  goalHeight: GOAL_H,
  goalRadiusBottom: GOAL_R_BOTTOM,
  goalRadiusTop: GOAL_R_TOP,
  toggles: TOGGLES,
  toggleLength: TOGGLE_LEN,
  toggleAxisHeight: TOGGLE_AXIS_H,
  toggleFace: TOGGLE_FACE,
  loaders: LOADERS,
  loader: LOADER,
  loadZone: LOAD_ZONE,
  autoLineEnd: AUTO_LINE_END,
  pin: { length: PIN_LEN, radius: PIN_R, tipRadius: PIN_TIP_R, tipLength: PIN_TIP_LEN, taperEnd: PIN_TAPER_END },
  goal: { flats: GOAL_FLATS, corner: GOAL_CORNER, topFlats: GOAL_TOP_FLATS, flange: GOAL_FLANGE_H, module: GOAL_MODULE_H, hole: GOAL_HOLE, baseHeight: GOAL_BASE_H },
  cup: { height: CUP_H, topRadius: CUP_TOP_R, waistRadius: CUP_WAIST_R },
  cupHeight: CUP_H,
  startPoses,
};

function startPoses(alliance: Alliance): StartPose[] {
  const s = alliance === 'red' ? -1 : 1;
  const heading = alliance === 'red' ? 0 : Math.PI;
  // ASSUMPTION: the manual sheets we have don't mark starting tiles. These sit against the
  // alliance wall either side of its Toggle, clear of every starting element (checked by
  // tests/layout.test.ts). Driver's left is -Z for red (facing +X) and +Z for blue.
  const x = s * (HALF - 11 * IN);
  return [
    { label: 'Left of the Toggle', x, z: s * 9.5 * IN, heading },
    { label: 'Right of the Toggle', x, z: -s * 9.5 * IN, heading },
  ];
}

function phases(mode: ModeId): Phase[] {
  const driverMain = OVERRIDE.driverSeconds - OVERRIDE.endgameSeconds;
  const driver: Phase[] = [
    { id: 'driver', label: 'DRIVER', kind: 'teleop', duration: driverMain, period: 'driver' },
    { id: 'endgame', label: 'ENDGAME', kind: 'endgame', duration: OVERRIDE.endgameSeconds, period: 'driver' },
  ];
  switch (mode) {
    case 'match':
      return [
        { id: 'auto', label: 'AUTONOMOUS', kind: 'auto', duration: OVERRIDE.autoSeconds, period: 'auto' },
        { id: 'break', label: 'DISABLED', kind: 'break', duration: 2, period: 'break' },
        ...driver,
      ];
    case 'driver':
      return driver;
    case 'skills':
      return [{ id: 'skills', label: 'DRIVER SKILLS', kind: 'teleop', duration: OVERRIDE.skillsSeconds, period: 'skills' }];
    default:
      return [];
  }
}

export const OverrideGame: GameDef = {
  id: 'override',
  name: 'Override',
  program: 'VEX V5RC',
  season: '2026–27',
  blurb: '12′×12′ field. Stack hex Pins and hourglass Cups on nine octagonal Goals, flip the four wall Toggles to own the yellow halves, and finish in the Midfield.',
  fieldX: HALF * 2,
  fieldZ: HALF * 2,
  presets: PRESETS,
  modes: [
    { id: 'match', label: 'Full match', description: '0:15 autonomous (drive it yourself to rehearse your route) + 1:45 driver control, with the Autonomous Bonus.' },
    { id: 'driver', label: 'Driver period', description: '1:45 driver control with a 10 s endgame.' },
    { id: 'skills', label: 'Driver skills', description: '60 s solo run. Score as much as you can.' },
    { id: 'sprint', label: 'Placement sprint', description: 'Place 6 Pins as fast as possible. Timed.' },
    { id: 'gates', label: 'Gate course', description: 'Weave between the Goals. Pure driving accuracy and speed.' },
    { id: 'free', label: 'Free practice', description: 'No clock. Try things out.' },
  ],
  // Red drivers stand along the West wall (−X), blue along the East wall.
  stations: [
    { id: 'red-left', label: 'Red, left', alliance: 'red', eye: [-HALF - 0.9, 1.6, -0.75], target: [0.2, 0, -0.1], yaw: 0 },
    { id: 'red-right', label: 'Red, right', alliance: 'red', eye: [-HALF - 0.9, 1.6, 0.75], target: [0.2, 0, 0.1], yaw: 0 },
    { id: 'blue-left', label: 'Blue, left', alliance: 'blue', eye: [HALF + 0.9, 1.6, 0.75], target: [-0.2, 0, 0.1], yaw: Math.PI },
    { id: 'blue-right', label: 'Blue, right', alliance: 'blue', eye: [HALF + 0.9, 1.6, -0.75], target: [-0.2, 0, -0.1], yaw: Math.PI },
  ],
  startPoses,
  phases,
  gates(): Gate[] {
    const g = (x: number, z: number, yaw: number): Gate => ({ x, z, yaw, width: 0.5 });
    return [
      g(-0.9, 0.9, Math.PI / 4),
      g(0, 1.2, Math.PI / 2),
      g(0.9, 0.9, -Math.PI / 4),
      g(1.2, 0, 0),
      g(0.9, -0.9, Math.PI / 4),
      g(0, -1.2, Math.PI / 2),
      g(-0.9, -0.9, -Math.PI / 4),
      g(-1.5, 0.3, 0),
    ];
  },
  sprint: { count: 6, label: 'Pins placed' },
  create: (ctx) => new OverrideRuntime(ctx),
  notes: [
    'From the game manual and its Appendix A field drawings: match timing (0:15 auto + 1:45 driver), points (12 auto bonus or 6 each on a tie, 5 per alliance-color Pin half, 10 per owned yellow half, 8 per Robot in the Midfield), per-half scoring with Cups hiding halves inside their opaque half, Toggles only counting when no robot touches them, the 140.41″ field and its 11.54″ perimeter, Goal, Toggle and Loader positions and sizes, the tape lines, the full starting layout of all 37 Pins and 36 Cups, Match Loads, Preloads and the Skills setup.',
    'ASSUMPTIONS: which 12 Cups start clear side up, where the robots start, the order Match Loads come out of a Loader, how a Toggle turns (touching it turns your color into the field), and that the Tall Goal’s yellow halves go to the alliance with more robots in the Midfield. The Autonomous Win Point isn’t modeled. These live in src/games/override/.',
  ],
};
