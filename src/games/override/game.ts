import * as THREE from 'three';
import { RAPIER, PIECE_GROUPS } from '../../core/physics';
import { FieldBuilder, canvasTexture } from '../../core/builder';
import { IN, FT } from '../../core/units';
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
// Coordinates: meters, field center origin, +X toward the blue wall, +Z toward
// the South wall (the top of the top-down view is North). Positions follow the
// official field layout (VEXcode VR playground / field CAD).
const HALF = 6 * FT; // 1.8288 m
const WALL_H = 0.3;

type GoalKind = 'alliance' | 'short' | 'tall';
const GOAL_H: Record<GoalKind, number> = { tall: 0.2227, short: 0.1465, alliance: 0.0825 };
const GOAL_R_BOTTOM = 0.077;
const GOAL_R_TOP = 0.048;

const GOALS: { id: string; kind: GoalKind; alliance?: Alliance; quadrant: Quadrant | null; x: number; z: number }[] = [
  { id: 'center', kind: 'tall', quadrant: null, x: 0, z: 0 },
  { id: 'N-short', kind: 'short', quadrant: 'N', x: -0.6, z: -1.2 },
  { id: 'N-blue', kind: 'alliance', alliance: 'blue', quadrant: 'N', x: 0.6, z: -1.2 },
  { id: 'E-blue', kind: 'alliance', alliance: 'blue', quadrant: 'E', x: 1.2, z: -0.6 },
  { id: 'E-short', kind: 'short', quadrant: 'E', x: 1.2, z: 0.6 },
  { id: 'S-short', kind: 'short', quadrant: 'S', x: 0.6, z: 1.2 },
  { id: 'S-red', kind: 'alliance', alliance: 'red', quadrant: 'S', x: -0.6, z: 1.2 },
  { id: 'W-red', kind: 'alliance', alliance: 'red', quadrant: 'W', x: -1.2, z: 0.6 },
  { id: 'W-short', kind: 'short', quadrant: 'W', x: -1.2, z: -0.6 },
];
const TOGGLES: { q: Quadrant; x: number; z: number; alongX: boolean; n: [number, number] }[] = [
  { q: 'N', x: 0, z: -1.78, alongX: true, n: [0, 1] },
  { q: 'E', x: 1.78, z: 0, alongX: false, n: [-1, 0] },
  { q: 'S', x: 0, z: 1.78, alongX: true, n: [0, -1] },
  { q: 'W', x: -1.78, z: 0, alongX: false, n: [1, 0] },
];
const TOGGLE_LEN = 0.656;
const LOADERS: { alliance: Alliance; x: number; z: number }[] = [
  { alliance: 'red', x: -1.74, z: -1.49 },
  { alliance: 'red', x: -1.74, z: 1.49 },
  { alliance: 'blue', x: 1.74, z: -1.49 },
  { alliance: 'blue', x: 1.74, z: 1.49 },
];

// ----------------------------------------------------------- game pieces
const PIN_LEN = 0.165;
const PIN_R = 0.0464; // hexagon circumradius
const PIN_CONE = 0.0907;
const PIN_TIP_R = 0.021;
const CUP_H = 0.1645;
const COLORS: Record<PinColor, number> = { red: 0xbf2a1f, blue: 0x1f3fc7, yellow: 0xebbd19 };
const CSS: Record<PinColor, string> = { red: '#e04040', blue: '#3b6ff0', yellow: '#f2c518' };

// ----------------------------------------------------------------- robots
const PRESETS: RobotConfig[] = [
  {
    id: 'vex-dr4b',
    name: 'DR4B claw stacker',
    description: 'Six-motor 450 RPM drive with a double-reverse four-bar lift and a rotating claw. Reaches the top of tall stacks.',
    source: 'Inspired by early-season Override reveals (standoff-linkage DR4B claw bots, e.g. 8059A/8059Y).',
    length: 15 * IN, width: 15 * IN, height: 14 * IN,
    drive: 'tank',
    params: { maxSpeed: 1.95, maxAccel: 5.2, maxDecel: 8, maxTurnRate: 6.2, maxTurnAccel: 28, trackWidth: 0.33 },
    capacity: 2, intakeWidth: 0.2, intakeReach: 0.12, liftTime: 0.9, style: 'vex',
    stats: { Drive: '6× 11W, 450 RPM, 3.25" omni/traction', Lift: 'DR4B to ~42"', Holds: 'claw + 1 in the tray' },
    model: vexModel({ team: '2026A', length: 15, width: 15, drive: 'tank6', wheel: 3.25, cartridge: 'blue', lift: 'dr4b', liftMin: 3, liftMax: 42, rollers: true, accent: 0xe8862a }),
  },
  {
    id: 'vex-flex',
    name: 'Clawbot "Flex"',
    description: 'Four-motor drive, single arm and claw, like VEX’s Override Hero Bot. Slower, simple and reliable. A great first robot.',
    source: 'Based on VEX’s official Override Hero Bot, Flex (arm + claw).',
    length: 16 * IN, width: 14 * IN, height: 13 * IN,
    drive: 'arcade',
    params: { maxSpeed: 1.3, maxAccel: 4.5, maxDecel: 7, maxTurnRate: 4.8, maxTurnAccel: 22, trackWidth: 0.3 },
    capacity: 1, intakeWidth: 0.16, intakeReach: 0.13, liftTime: 1.1, style: 'vex',
    stats: { Drive: '4× 11W, 200 RPM, 4" omni', Lift: 'Single arm to ~26"', Holds: '1 in the claw' },
    model: vexModel({ team: '2026B', length: 16, width: 14, drive: 'tank4', wheel: 4, cartridge: 'green', lift: 'arm', liftMin: 2, liftMax: 26, rollers: false, accent: 0x2e9be6 }),
  },
  {
    id: 'vex-chainbar',
    name: 'Chain-bar + roller intake',
    description: 'Fast 600 RPM drive. Rollers sweep Pins and Cups into a claw on a chain-bar that keeps them level.',
    source: 'Forklift / chain-bar stacker concept from the Override design discussions.',
    length: 15 * IN, width: 15 * IN, height: 13 * IN,
    drive: 'splitArcade',
    params: { maxSpeed: 2.35, maxAccel: 4.8, maxDecel: 7.5, maxTurnRate: 7, maxTurnAccel: 30, trackWidth: 0.33 },
    capacity: 2, intakeWidth: 0.26, intakeReach: 0.14, liftTime: 0.8, style: 'vex',
    stats: { Drive: '6× 11W, 600 RPM, 2.75" wheels', Lift: 'Chain-bar to ~32"', Holds: 'claw + 1 in the rollers' },
    model: vexModel({ team: '2026C', length: 15, width: 15, drive: 'tank6', wheel: 2.75, cartridge: 'blue', lift: 'chainbar', liftMin: 3, liftMax: 32, rollers: true, accent: 0x7b4fd6 }),
  },
  {
    id: 'vex-xdrive',
    name: 'X-drive arm bot',
    description: 'Holonomic X-drive that strafes to line up on goals, with an arm and rotating claw. Try field-oriented control.',
    source: 'Holonomic “S-bot” style seen in Override design threads.',
    length: 16 * IN, width: 16 * IN, height: 13 * IN,
    drive: 'xdrive',
    params: { maxSpeed: 1.75, maxAccel: 4.2, maxDecel: 6.5, maxTurnRate: 5.5, maxTurnAccel: 24, trackWidth: 0.34 },
    capacity: 1, intakeWidth: 0.18, intakeReach: 0.13, liftTime: 1.0, style: 'vex',
    stats: { Drive: '4× 11W, 600 RPM, 3.25" omni at 45°', Lift: 'Arm to ~30"', Holds: '1 in the claw' },
    model: vexModel({ team: '2026X', length: 16, width: 16, drive: 'xdrive', wheel: 3.25, cartridge: 'blue', lift: 'arm', liftMin: 2, liftMax: 30, rollers: false, accent: 0x18b38a }),
  },
];

interface Piece {
  id: number;
  kind: 'pin' | 'cup';
  /** Pin halves: tapered end, flat (prism) end. */
  cone: PinColor;
  prism: PinColor;
  body: RAPIER.RigidBody;
  mesh: THREE.Group;
  state: 'loose' | 'held' | 'placed';
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
  group: THREE.Group;
  angle: number;
  owner: Alliance | null;
  touched: boolean;
}

type PlaceJob = { goal: Goal; piece: Piece; t: number; duration: number; height: number };

/** Hexagonal pin points for the convex collider (tip down, local origin at center). */
function pinHullPoints(): Float32Array {
  const pts: number[] = [];
  const bottom = -PIN_LEN / 2;
  const mid = bottom + PIN_CONE;
  const top = PIN_LEN / 2;
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    pts.push(Math.cos(a) * PIN_TIP_R, bottom, Math.sin(a) * PIN_TIP_R);
    pts.push(Math.cos(a) * PIN_R, mid, Math.sin(a) * PIN_R);
    pts.push(Math.cos(a) * PIN_R, top, Math.sin(a) * PIN_R);
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
  private intakeCooldown = 0;
  private dropCooldown = 0;
  private prevScore = false;
  private job: PlaceJob | null = null;
  private wristTarget = 0;
  private autoBonus: Alliance | 'tie' | null = null;
  private loaderQueue: Record<Alliance, ('cup' | 'pin' | 'yy')[]>;
  private placedByMe = 0;
  private midfieldGlow!: THREE.Mesh;
  private readonly me: Alliance;
  private geo: { cone: THREE.BufferGeometry; prism: THREE.BufferGeometry; cupLow: THREE.BufferGeometry; cupHigh: THREE.BufferGeometry };
  private mats: { pin: Record<PinColor, THREE.Material>; cupOpaque: THREE.Material; cupClear: THREE.Material };
  private pinHull = pinHullPoints();

  constructor(private ctx: GameContext) {
    this.me = ctx.robot.alliance;
    this.builder = new FieldBuilder(ctx.world, ctx.scene);
    // Shared geometry: hex cone + hex prism Pins, hourglass Cups.
    const cone = new THREE.CylinderGeometry(PIN_R, PIN_TIP_R, PIN_CONE, 6);
    cone.translate(0, -PIN_LEN / 2 + PIN_CONE / 2, 0);
    const prism = new THREE.CylinderGeometry(PIN_R, PIN_R, PIN_LEN - PIN_CONE, 6);
    prism.translate(0, -PIN_LEN / 2 + PIN_CONE + (PIN_LEN - PIN_CONE) / 2, 0);
    const profile = [
      [0.0399, 0], [0.037, 0.018], [0.0345, 0.035], [0.0315, 0.06], [0.031, 0.0822],
      [0.032, 0.1], [0.0345, 0.125], [0.038, 0.15], [0.0401, 0.1645],
    ].map(([r, y]) => new THREE.Vector2(r, y - CUP_H / 2));
    const half = Math.ceil(profile.length / 2);
    const cupLow = new THREE.LatheGeometry(profile.slice(0, half), 28);
    const cupHigh = new THREE.LatheGeometry(profile.slice(half - 1), 28);
    this.geo = { cone, prism, cupLow, cupHigh };
    this.mats = {
      pin: {
        red: new THREE.MeshStandardMaterial({ color: COLORS.red, roughness: 0.45 }),
        blue: new THREE.MeshStandardMaterial({ color: COLORS.blue, roughness: 0.45 }),
        yellow: new THREE.MeshStandardMaterial({ color: COLORS.yellow, roughness: 0.45 }),
      },
      cupOpaque: new THREE.MeshStandardMaterial({ color: 0xb8b8bd, roughness: 0.4, side: THREE.DoubleSide }),
      cupClear: new THREE.MeshStandardMaterial({ color: 0xdcebff, roughness: 0.08, transparent: true, opacity: 0.32, side: THREE.DoubleSide, depthWrite: false }),
    };
    const loads = (a: Alliance): ('cup' | 'pin' | 'yy')[] => {
      const q: ('cup' | 'pin' | 'yy')[] = [];
      for (let i = 0; i < 10; i++) q.push('cup', 'pin');
      q.push('yy');
      void a;
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
      for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
        const base = 86 + Math.random() * 6;
        g.fillStyle = `rgb(${base},${base + 2},${base + 7})`;
        g.fillRect(i * s + 3, j * s + 3, s - 6, s - 6);
        // Interlocking foam-tile edge teeth.
        g.fillStyle = 'rgba(0,0,0,0.18)';
        for (let k = 0; k < 10; k++) {
          g.fillRect(i * s + (k + 0.25) * (s / 10), j * s, s / 20, 4);
          g.fillRect(i * s, j * s + (k + 0.25) * (s / 10), 4, s / 20);
        }
        for (let k = 0; k < 700; k++) {
          g.fillStyle = `rgba(255,255,255,${Math.random() * 0.035})`;
          g.fillRect(i * s + Math.random() * s, j * s + Math.random() * s, 2, 2);
        }
      }
      const tape = 2 * IN * (w / (HALF * 2));
      g.strokeStyle = 'rgba(245,245,245,0.92)';
      g.lineWidth = tape;
      g.lineCap = 'butt';
      // Corner-to-corner diagonals split the field into the four Quadrants.
      g.beginPath();
      g.moveTo(0, 0); g.lineTo(w, h);
      g.moveTo(w, 0); g.lineTo(0, h);
      g.stroke();
      // Midfield diamond with its center cross.
      const d = OVERRIDE.midfieldHalfDiagonal;
      g.beginPath();
      g.moveTo(px(-d, w), px(0, h)); g.lineTo(px(0, w), px(-d, h)); g.lineTo(px(d, w), px(0, h)); g.lineTo(px(0, w), px(d, h)); g.closePath();
      g.moveTo(px(-d, w), px(0, h)); g.lineTo(px(d, w), px(0, h));
      g.moveTo(px(0, w), px(-d, h)); g.lineTo(px(0, w), px(d, h));
      g.stroke();
    });
    b.decal(tiles, HALF * 2, HALF * 2);

    // Perimeter: steel rails with clear polycarbonate panels, alliance-colored station side.
    const steel = b.mat(0xaab2bc, { metal: 0.8, rough: 0.35 });
    const clear = b.mat(0xd8eaff, { opacity: 0.16, rough: 0.05 });
    const t = 1 * IN;
    for (const [cx, cz, w, d, color] of [
      [0, -HALF - t / 2, HALF * 2 + 2 * t, t, 0],
      [0, HALF + t / 2, HALF * 2 + 2 * t, t, 0],
      [-HALF - t / 2, 0, t, HALF * 2, 0xc62828],
      [HALF + t / 2, 0, t, HALF * 2, 0x1f4fbf],
    ] as const) {
      b.box({ center: [cx, 0.035, cz], size: [w, 0.07, d], material: steel, collider: false });
      b.box({ center: [cx, 0.07 + (WALL_H - 0.07) / 2, cz], size: [w, WALL_H - 0.07, d], material: clear, shadow: false, collider: false });
      if (color) b.box({ center: [cx, WALL_H + 0.006, cz], size: [w * 1.5, 0.012, d], color, collider: false });
      b.solid([cx, 0.5, cz], [w, 1, d]);
    }
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      b.box({ center: [sx * (HALF + t / 2), WALL_H / 2, sz * (HALF + t / 2)], size: [t * 1.6, WALL_H + 0.01, t * 1.6], material: steel, collider: false });
    }

    // Goals: octagonal tapered towers with a receptacle on top.
    for (const def of GOALS) {
      const h = GOAL_H[def.kind];
      const color = def.kind === 'alliance' ? COLORS[def.alliance!] : 0xdcdcdc;
      const geo = new THREE.CylinderGeometry(GOAL_R_TOP, GOAL_R_BOTTOM, h, 8);
      geo.rotateY(Math.PI / 8);
      const mesh = new THREE.Mesh(geo, b.mat(color, { rough: 0.5 }));
      mesh.position.set(def.x, h / 2, def.z);
      mesh.castShadow = mesh.receiveShadow = true;
      b.group.add(mesh);
      const rec = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.008, 20), b.mat(0x141414));
      rec.position.set(def.x, h - 0.003, def.z);
      b.group.add(rec);
      const pts: number[] = [];
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
        pts.push(def.x + Math.cos(a) * GOAL_R_BOTTOM, 0, def.z + Math.sin(a) * GOAL_R_BOTTOM);
        pts.push(def.x + Math.cos(a) * GOAL_R_TOP, h, def.z + Math.sin(a) * GOAL_R_TOP);
      }
      const desc = RAPIER.ColliderDesc.convexHull(new Float32Array(pts));
      if (desc) this.ctx.world.createCollider(desc.setCollisionGroups((0x0001 << 16) | 0x0006).setFriction(0.5));
      this.goals.push({ id: def.id, kind: def.kind, alliance: def.alliance, quadrant: def.quadrant, stack: [], x: def.x, z: def.z, pieces: [] });
    }
    this.midfieldGlow = new THREE.Mesh(
      new THREE.RingGeometry(0.09, 0.115, 8),
      new THREE.MeshBasicMaterial({ color: 0xffe14d, transparent: true, opacity: 0, side: THREE.DoubleSide }),
    );
    this.midfieldGlow.rotation.x = -Math.PI / 2;
    this.midfieldGlow.position.y = 0.004;
    b.group.add(this.midfieldGlow);

    // Toggles: 656 mm triangular prisms (yellow / red / blue faces) on shafts at mid-wall.
    for (const def of TOGGLES) {
      const group = new THREE.Group();
      const prism = new THREE.Group();
      const faceGeo = new THREE.BoxGeometry(TOGGLE_LEN, 0.004, 0.0562);
      const faces: [PinColor, number, number, number][] = [
        ['yellow', 0, 0.01507, 0],
        ['blue', -0.01305, -0.007535, Math.PI / 6],
        ['red', 0.01305, -0.007535, Math.PI - Math.PI / 6],
      ];
      for (const [c, zz, yy, rot] of faces) {
        const f = new THREE.Mesh(faceGeo, b.mat(COLORS[c], { rough: 0.45 }));
        f.position.set(0, yy, zz);
        f.rotation.x = rot;
        f.castShadow = true;
        prism.add(f);
      }
      for (const s of [-1, 1]) {
        const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.06, 10), b.mat(0x202020));
        shaft.rotation.z = Math.PI / 2;
        shaft.position.x = s * (TOGGLE_LEN / 2 + 0.02);
        group.add(shaft);
        const mount = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.09, 0.05), b.mat(0x9aa3ad, { metal: 0.7 }));
        mount.position.set(s * (TOGGLE_LEN / 2 + 0.05), 0, -0.01);
        group.add(mount);
      }
      group.add(prism);
      group.position.set(def.x, 0.045, def.z);
      if (!def.alongX) group.rotation.y = Math.PI / 2;
      b.group.add(group);
      b.solid([def.x, 0.045, def.z], def.alongX ? [TOGGLE_LEN, 0.06, 0.05] : [0.05, 0.06, TOGGLE_LEN]);
      this.toggles.push({ q: def.q, x: def.x, z: def.z, n: def.n, alongX: def.alongX, group: prism, angle: 0, owner: null, touched: false });
    }

    // Loaders at the corners beside each Alliance Station.
    for (const l of LOADERS) {
      const sx = Math.sign(l.x);
      const cx = sx * (HALF - 0.13);
      b.box({ center: [cx, 0.045, l.z], size: [0.26, 0.09, 0.24], color: 0x8c9198 });
      const rim = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.012, 24), b.mat(l.alliance === 'red' ? 0xc62828 : 0x1f4fbf));
      rim.position.set(cx, 0.096, l.z);
      b.group.add(rim);
      const hole = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.075, 0.014, 24), b.mat(0x141414));
      hole.position.set(cx, 0.097, l.z);
      b.group.add(hole);
    }
  }

  // ------------------------------------------------------------- pieces
  private makePin(x: number, y: number, z: number, colors: [PinColor, PinColor], prismDown = true): Piece {
    const group = new THREE.Group();
    const cone = new THREE.Mesh(this.geo.cone, this.mats.pin[colors[0]]);
    const prism = new THREE.Mesh(this.geo.prism, this.mats.pin[colors[1]]);
    for (const m of [cone, prism]) {
      m.castShadow = m.receiveShadow = true;
      group.add(m);
    }
    this.ctx.scene.add(group);
    const rot = prismDown ? { x: 1, y: 0, z: 0, w: 0 } : { x: 0, y: 0, z: 0, w: 1 };
    const body = this.ctx.world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic().setTranslation(x, y, z).setRotation(rot).setLinearDamping(0.5).setAngularDamping(1.5).setCanSleep(true),
    );
    const hull = RAPIER.ColliderDesc.convexHull(this.pinHull) ?? RAPIER.ColliderDesc.cylinder(PIN_LEN / 2, 0.04);
    this.ctx.world.createCollider(hull.setMass(0.073).setFriction(0.6).setRestitution(0.05).setCollisionGroups(PIECE_GROUPS), body);
    const p: Piece = { id: this.pieces.length, kind: 'pin', cone: colors[0], prism: colors[1], body, mesh: group, state: 'loose' };
    this.pieces.push(p);
    return p;
  }

  private makeCup(x: number, y: number, z: number): Piece {
    const group = new THREE.Group();
    const low = new THREE.Mesh(this.geo.cupLow, this.mats.cupClear);
    const high = new THREE.Mesh(this.geo.cupHigh, this.mats.cupOpaque);
    high.castShadow = true;
    group.add(low, high);
    this.ctx.scene.add(group);
    const body = this.ctx.world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic().setTranslation(x, y, z).setLinearDamping(0.5).setAngularDamping(1.5).setCanSleep(true),
    );
    this.ctx.world.createCollider(
      RAPIER.ColliderDesc.cylinder(CUP_H / 2, 0.038).setMass(0.078).setFriction(0.55).setCollisionGroups(PIECE_GROUPS),
      body,
    );
    const p: Piece = { id: this.pieces.length, kind: 'cup', cone: 'yellow', prism: 'yellow', body, mesh: group, state: 'loose' };
    this.pieces.push(p);
    return p;
  }

  /**
   * Starting layout. The 20 elements of the official VEXcode VR layout are placed
   * exactly; the rest of the field elements (37 Pins and 36 Cups in total on the
   * field, the remainder being Match Loads and Preloads) are filled in on the same
   * 1-foot grid with the field's 180° red/blue symmetry. ASSUMPTION for the extras.
   */
  private spawnLayout(): void {
    const mirror = (c: PinColor): PinColor => (c === 'red' ? 'blue' : c === 'blue' ? 'red' : c);
    const pins: { x: number; z: number; c: [PinColor, PinColor] }[] = [];
    const cups: { x: number; z: number }[] = [];
    const addPinPair = (x: number, z: number, c: [PinColor, PinColor]) => {
      pins.push({ x, z, c });
      pins.push({ x: -x, z: -z, c: [mirror(c[0]), mirror(c[1])] });
    };
    const addCupPair = (x: number, z: number) => {
      cups.push({ x, z }, { x: -x, z: -z });
    };
    // Official VR layout (converted: VR +Y = North = our -Z).
    addPinPair(-0.6, -1.745, ['red', 'yellow']);
    addPinPair(-1.745, -0.6, ['red', 'yellow']);
    addPinPair(0.6, -1.745, ['blue', 'yellow']);
    addPinPair(1.745, -0.6, ['blue', 'yellow']);
    addPinPair(0, -0.6, ['yellow', 'yellow']);
    addPinPair(-0.6, 0, ['red', 'blue']);
    addCupPair(-1.2, -1.2);
    addCupPair(1.2, -1.2);
    addCupPair(-0.6, -0.6);
    addCupPair(0.6, -0.6);

    // Fill the rest on the 0.3 m grid, away from goals, toggles, loaders and robot start tiles.
    const occupied = (x: number, z: number) =>
      GOALS.some((g) => Math.hypot(g.x - x, g.z - z) < 0.22) ||
      LOADERS.some((l) => Math.hypot(l.x - x, l.z - z) < 0.3) ||
      TOGGLES.some((t) => Math.hypot(t.x - x, t.z - z) < 0.42) ||
      pins.some((p) => Math.hypot(p.x - x, p.z - z) < 0.2) ||
      cups.some((c) => Math.hypot(c.x - x, c.z - z) < 0.2) ||
      startPoses('red').concat(startPoses('blue')).some((s) => Math.abs(s.x - x) < 0.36 && Math.abs(s.z - z) < 0.36);
    const candidates: [number, number][] = [];
    for (let i = -5; i <= 5; i++) for (let j = -5; j <= 5; j++) {
      const x = i * 0.3;
      const z = j * 0.3;
      if (x < 0 || (x === 0 && z < 0)) candidates.push([x, z]); // one of each mirrored pair
    }
    // Deterministic shuffle so the layout is the same every match.
    let seed = 20262027;
    const rand = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    for (let i = candidates.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
    }
    const extraPins: [PinColor, PinColor][] = [
      ['red', 'yellow'], ['red', 'yellow'], ['blue', 'yellow'], ['blue', 'yellow'],
      ['yellow', 'yellow'], ['yellow', 'yellow'], ['yellow', 'yellow'], ['yellow', 'yellow'],
      ['yellow', 'yellow'], ['yellow', 'yellow'], ['yellow', 'yellow'], ['red', 'blue'],
    ];
    let cupPairs = 14;
    for (const [x, z] of candidates) {
      if (occupied(x, z) || occupied(-x, -z)) continue;
      if (extraPins.length) addPinPair(x, z, extraPins.shift()!);
      else if (cupPairs > 0) {
        addCupPair(x, z);
        cupPairs--;
      } else break;
    }
    for (const p of pins) this.makePin(p.x, PIN_LEN / 2 + 0.002, p.z, p.c);
    for (const c of cups) this.makeCup(c.x, CUP_H / 2 + 0.002, c.z);
    // The odd yellow/yellow Pin starts Placed on the Tall Goal. ASSUMPTION.
    const center = this.goals.find((g) => g.id === 'center')!;
    const yy = this.makePin(0, 0.5, 0, ['yellow', 'yellow'], false);
    this.placeOn(center, yy, { type: 'pin', cone: 'yellow', prism: 'yellow' });
  }

  private hold(p: Piece): void {
    p.state = 'held';
    p.body.setEnabled(false);
    this.held.push(p);
  }

  private release(p: Piece, x: number, y: number, z: number, vx = 0, vz = 0): void {
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

  /** Height where the next element's bottom would sit on a goal. */
  private stackTop(g: Goal): number {
    let cursor = GOAL_H[g.kind];
    for (const item of g.stack) cursor = item.type === 'pin' ? cursor - 0.03 + PIN_LEN : cursor - 0.07 + CUP_H;
    return cursor;
  }

  private layoutGoal(g: Goal): void {
    let cursor = GOAL_H[g.kind];
    g.stack.forEach((item, i) => {
      const piece = g.pieces[i];
      if (item.type === 'pin') {
        const base = cursor - 0.03;
        piece.mesh.position.set(g.x, base + PIN_LEN / 2, g.z);
        piece.mesh.rotation.set(0, 0, 0); // cone down
        cursor = base + PIN_LEN;
      } else {
        const base = cursor - 0.07;
        piece.mesh.position.set(g.x, base + CUP_H / 2, g.z);
        piece.mesh.rotation.set(item.opaqueUp ? 0 : Math.PI, 0, 0);
        cursor = base + CUP_H;
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

    // Placement in progress: lift rises, wrist orients, claw opens at the end.
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

    // Intake: grab the element in front of the claw / rollers.
    if (enabled && ctl.intake && !this.job && this.held.length < robot.cfg.capacity && this.intakeCooldown <= 0) {
      for (const p of this.pieces) {
        if (p.state !== 'loose') continue;
        const t = p.body.translation();
        if (robot.inIntake(t.x, t.z, t.y, 0.3)) {
          this.hold(p);
          this.intakeCooldown = 0.35;
          this.ctx.intook();
          break;
        }
      }
    }

    if (enabled && ctl.outtake && this.held.length && this.dropCooldown <= 0 && !this.job) {
      const p = this.held[this.held.length - 1];
      const [x, z] = robot.toWorld(robot.cfg.length / 2 + 0.1, 0);
      const [fx, fz] = [Math.cos(robot.heading), -Math.sin(robot.heading)];
      this.release(p, x, (p.kind === 'pin' ? PIN_LEN : CUP_H) / 2 + 0.02, z, robot.cmd.vx + fx * 0.3, robot.cmd.vz + fz * 0.3);
      this.dropCooldown = 0.4;
    }

    if (enabled && ctl.score && !this.prevScore) this.startPlace();
    this.prevScore = ctl.score;

    // Toggles: a robot pushing a Toggle rotates it to its alliance face.
    for (const tv of this.toggles) {
      tv.touched = this.robotTouchesToggle(tv);
      if (tv.touched && enabled && tv.owner !== robot.alliance) {
        tv.owner = robot.alliance;
        this.ctx.toast(`${tv.q} Toggle → ${robot.alliance.toUpperCase()}`, robot.alliance);
        this.ctx.beep('score');
      }
      const target = tv.owner === 'red' ? (2 * Math.PI) / 3 : tv.owner === 'blue' ? (-2 * Math.PI) / 3 : 0;
      tv.angle += THREE.MathUtils.clamp(target - tv.angle, -8 * dt, 8 * dt);
    }
  }

  private robotTouchesToggle(tv: ToggleViz): boolean {
    const r = this.ctx.robot;
    const faceOffset = 0.05;
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
    const item: StackItem = piece.kind === 'cup' ? { type: 'cup', opaqueUp: this.cupOpaqueUp } : { type: 'pin', cone: piece.cone, prism: piece.prism };
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
    const item: StackItem = piece.kind === 'cup' ? { type: 'cup', opaqueUp: this.cupOpaqueUp } : { type: 'pin', cone: piece.cone, prism: piece.prism };
    if (!canPlace(g, item, this.me).ok) return;
    this.held = this.held.filter((h) => h !== piece);
    this.placeOn(g, piece, item);
    if (item.type === 'pin') {
      this.placedByMe++;
      const halves = visibleHalves(g).slice(-2).join(' + ');
      this.ctx.toast(`Pin placed (${halves})`, item.cone === 'yellow' && item.prism === 'yellow' ? 'good' : this.me);
      this.ctx.scored(1);
    } else {
      this.ctx.toast(item.opaqueUp ? 'Cup placed: opaque half up' : 'Cup placed upside-down: hides the Pin below’s top half', 'info');
    }
    this.ctx.beep('score');
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
      this.cupOpaqueUp = !this.cupOpaqueUp;
      this.wristTarget += Math.PI;
      this.ctx.toast(this.cupOpaqueUp ? 'Cups: opaque half UP (hides the next Pin’s lower half)' : 'Cups: opaque half DOWN (hides the lower Pin’s top half)', 'info');
    } else if (a === 'descore') {
      if (this.ctx.clock.enabled && !this.job) this.descore();
    } else if (a === 'feed') {
      this.matchLoad();
    }
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
    const next = q.shift()!;
    const piece = next === 'cup'
      ? this.makeCup(r.x, 0.3, r.z)
      : this.makePin(r.x, 0.3, r.z, next === 'yy' ? ['yellow', 'yellow'] : [this.me, 'yellow']);
    this.hold(piece);
    this.ctx.toast(`Match Load: ${next === 'cup' ? 'Cup' : next === 'yy' ? 'yellow Pin' : 'alliance Pin'} (${q.length} left)`, 'info');
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
    return `
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
      else slots.push(`<span class="slot pin" style="--a:${CSS[p.prism]};--b:${CSS[p.cone]}" title="Pin"></span>`);
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
      if (i === 0 && carry) {
        carry.updateWorldMatrix(true, false);
        const pos = new THREE.Vector3();
        const quat = new THREE.Quaternion();
        carry.getWorldPosition(pos);
        carry.getWorldQuaternion(quat);
        p.mesh.position.copy(pos);
        p.mesh.quaternion.copy(quat);
        if (p.kind === 'pin') p.mesh.rotateX(Math.PI);
        if (p.kind === 'cup' && !this.cupOpaqueUp) p.mesh.rotateX(Math.PI);
      } else {
        const [x, z] = r.toWorld(r.cfg.length * 0.15, 0);
        p.mesh.position.set(x, r.mesh.position.y + 0.12 + i * 0.02, z);
        p.mesh.rotation.set(0, -r.heading, Math.PI / 2);
      }
    });
    for (const tv of this.toggles) tv.group.rotation.x = tv.angle;
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
    for (const l of LOADERS) out.push({ x: Math.sign(l.x) * (HALF - 0.13), z: l.z, w: 0.26, d: 0.24, color: '#8c9198' });
    return out;
  }

  dispose(): void {
    for (const g of Object.values(this.geo)) g.dispose();
    for (const m of Object.values(this.mats.pin)) m.dispose();
    this.mats.cupClear.dispose();
    this.mats.cupOpaque.dispose();
  }
}

function startPoses(alliance: Alliance): StartPose[] {
  const s = alliance === 'red' ? -1 : 1;
  const heading = alliance === 'red' ? 0 : Math.PI;
  // Driver's left is -Z for red (facing +X) and +Z for blue.
  return [
    { label: 'Left of the Toggle', x: s * 1.5, z: s * 1.0, heading },
    { label: 'Right of the Toggle', x: s * 1.5, z: -s * 1.0, heading },
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
    'From the game manual and the official field layout: match timing (0:15 auto + 1:45 driver), points (12 auto bonus or 6 each on a tie, 5 per alliance-color Pin half, 10 per owned yellow half, 8 per Robot in the Midfield), per-half scoring with Cups hiding halves inside their opaque half, Toggles only counting when no robot touches them, the nine octagonal Goals and their heights (8.77″ / 5.77″ / 3.25″) and positions, Toggle and Loader positions, element counts, and the 48″ Midfield diamond.',
    'ASSUMPTIONS: where the field elements beyond the 20 in the official VEXcode VR layout start (filled in symmetrically), one yellow Pin starting on the Tall Goal, the order Match Loads come out of a Loader, how a Toggle turns (pushing it shows your color), and that the Tall Goal’s yellow halves go to the alliance with more robots in the Midfield. The Autonomous Win Point isn’t modeled. These live in src/games/override/.',
  ],
};
