import * as THREE from 'three';
import { RAPIER, PIECE_GROUPS } from '../../core/physics';
import { FieldBuilder, canvasTexture } from '../../core/builder';
import { IN, FT } from '../../core/units';
import type { Phase } from '../../core/match';
import type { Action, ControlState } from '../../core/input';
import type { RobotConfig, Alliance } from '../../robot/robot';
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
  canPlace,
  isInMidfield,
  scoreOverride,
} from './rules';

const HALF = 6 * FT; // 72"
const WALL_H = 0.3;
const COLORS: Record<PinColor, number> = { red: 0xd62f2f, blue: 0x2563d9, yellow: 0xf2c518 };
const CSS: Record<PinColor, string> = { red: '#e04040', blue: '#3b7bf0', yellow: '#f2c518' };

const PIN_R = 0.8 * IN;
const PIN_H = 6.5 * IN;
const CUP_R = 1.575 * IN;
const CUP_H = 6.5 * IN;

const QUADS: Quadrant[] = ['N', 'E', 'S', 'W'];
/** Axis pointing from field center into each quadrant, and its perpendicular. */
const AXIS: Record<Quadrant, { a: [number, number]; p: [number, number] }> = {
  W: { a: [-1, 0], p: [0, -1] },
  N: { a: [0, -1], p: [1, 0] },
  E: { a: [1, 0], p: [0, 1] },
  S: { a: [0, 1], p: [-1, 0] },
};
/** Alliance that owns the Alliance Goal in each quadrant (180° rotational symmetry). */
const QUAD_ALLIANCE: Record<Quadrant, Alliance> = { W: 'red', S: 'red', E: 'blue', N: 'blue' };

/** Quadrant-local inches -> world meters. */
function q2w(q: Quadrant, along: number, perp: number): [number, number] {
  const { a, p } = AXIS[q];
  return [(a[0] * along + p[0] * perp) * IN, (a[1] * along + p[1] * perp) * IN];
}

const GOAL_HEIGHT = { alliance: 3.25 * IN, short: 5.8 * IN, tall: 8.7 * IN };
const GOAL_RADIUS = { alliance: 2.2 * IN, short: 2.2 * IN, tall: 3 * IN };

const PRESETS: RobotConfig[] = [
  {
    id: 'vex-tank-450',
    name: '450 RPM tank (18")',
    description: 'Six-motor 3.25" drive. The all-round competition standard.',
    length: 18 * IN, width: 18 * IN, height: 14 * IN,
    drive: 'tank',
    params: { maxSpeed: 1.95, maxAccel: 5.5, maxDecel: 8, maxTurnRate: 6.5, maxTurnAccel: 30, trackWidth: 0.3 },
    capacity: 3, intakeWidth: 0.3, intakeReach: 0.09, style: 'vex',
  },
  {
    id: 'vex-tank-600',
    name: '600 RPM speed tank (15")',
    description: 'Fast and twitchy. Rewards smooth throttle control.',
    length: 15 * IN, width: 15 * IN, height: 13 * IN,
    drive: 'tank',
    params: { maxSpeed: 2.5, maxAccel: 4.8, maxDecel: 7, maxTurnRate: 7.5, maxTurnAccel: 32, trackWidth: 0.27 },
    capacity: 2, intakeWidth: 0.26, intakeReach: 0.08, style: 'vex',
  },
  {
    id: 'vex-xdrive',
    name: 'X-drive holonomic (15")',
    description: 'Strafe in any direction. Try field-oriented control.',
    length: 15 * IN, width: 15 * IN, height: 13 * IN,
    drive: 'xdrive',
    params: { maxSpeed: 1.7, maxAccel: 4.2, maxDecel: 6.5, maxTurnRate: 5.5, maxTurnAccel: 24, trackWidth: 0.3 },
    capacity: 3, intakeWidth: 0.26, intakeReach: 0.08, style: 'vex',
  },
  {
    id: 'vex-tank-333',
    name: '333 RPM torque tank (18")',
    description: 'Slower but pushes hard and turns precisely.',
    length: 18 * IN, width: 18 * IN, height: 14 * IN,
    drive: 'arcade',
    params: { maxSpeed: 1.45, maxAccel: 6.5, maxDecel: 9, maxTurnRate: 4.8, maxTurnAccel: 26, trackWidth: 0.3 },
    capacity: 4, intakeWidth: 0.32, intakeReach: 0.09, style: 'vex',
  },
];

interface Piece {
  id: number;
  kind: 'pin' | 'cup';
  /** Pin halves: [first, second]. */
  colors: [PinColor, PinColor];
  body: RAPIER.RigidBody;
  mesh: THREE.Object3D;
  state: 'loose' | 'held' | 'placed' | 'reserve';
  goal?: string;
}

interface Goal extends GoalState {
  x: number;
  z: number;
  pieces: Piece[];
}

interface ToggleViz {
  q: Quadrant;
  mesh: THREE.Mesh;
  x: number;
  z: number;
  /** Inward wall normal. */
  n: [number, number];
  cooldown: number;
}

class OverrideRuntime implements GameRuntime {
  private builder: FieldBuilder;
  private pieces: Piece[] = [];
  private goals: Goal[] = [];
  private toggles: Record<Quadrant, Alliance | null> = { N: null, E: null, S: null, W: null };
  private toggleViz: ToggleViz[] = [];
  private held: Piece[] = [];
  private orientation: 'alliance' | 'yellow' = 'alliance';
  private intakeCooldown = 0;
  private placeCooldown = 0;
  private dropCooldown = 0;
  private prevScore = false;
  private autoBonus: Alliance | 'tie' | null = null;
  private matchLoads = OVERRIDE.matchLoadCupsPerAlliance;
  private placedByMe = 0;
  private midfieldRing!: THREE.Mesh;
  private readonly me: Alliance;
  private pinGeo = new THREE.CylinderGeometry(PIN_R, PIN_R, PIN_H / 2, 20);
  private cupGeo = new THREE.CylinderGeometry(CUP_R, CUP_R * 0.82, CUP_H, 24, 1, true);
  private cupBase = new THREE.CircleGeometry(CUP_R * 0.82, 24);
  private pinMats: Record<PinColor, THREE.Material>;
  private cupMat: THREE.Material;

  constructor(private ctx: GameContext) {
    this.me = ctx.robot.alliance;
    this.builder = new FieldBuilder(ctx.world, ctx.scene);
    this.pinMats = {
      red: new THREE.MeshStandardMaterial({ color: COLORS.red, roughness: 0.45 }),
      blue: new THREE.MeshStandardMaterial({ color: COLORS.blue, roughness: 0.45 }),
      yellow: new THREE.MeshStandardMaterial({ color: COLORS.yellow, roughness: 0.45 }),
    };
    this.cupMat = new THREE.MeshStandardMaterial({ color: 0xe9eef5, roughness: 0.25, metalness: 0.05, transparent: true, opacity: 0.82, side: THREE.DoubleSide });
    this.buildField();
    this.spawnPieces();
    // Preload: one pin in the robot.
    const preload = this.makePin(ctx.robot.x, 0.1, ctx.robot.z, [this.me, 'yellow']);
    this.hold(preload);
  }

  // ---------------------------------------------------------------- field
  private buildField(): void {
    const b = this.builder;
    b.floor(HALF * 2, HALF * 2);
    const tiles = canvasTexture(1536, 1536, (g, w, h) => {
      g.fillStyle = '#5d6168';
      g.fillRect(0, 0, w, h);
      const n = 6;
      const s = w / n;
      for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
        const shade = 92 + ((i + j) % 2) * 6 + Math.random() * 4;
        g.fillStyle = `rgb(${shade},${shade + 3},${shade + 9})`;
        g.fillRect(i * s + 2, j * s + 2, s - 4, s - 4);
        // foam texture speckle
        for (let k = 0; k < 500; k++) {
          g.fillStyle = `rgba(255,255,255,${Math.random() * 0.04})`;
          g.fillRect(i * s + Math.random() * s, j * s + Math.random() * s, 2, 2);
        }
      }
      const px = (v: number) => (v / (HALF * 2) + 0.5) * w;
      g.strokeStyle = 'rgba(255,255,255,0.85)';
      g.lineWidth = w * (2 * IN) / (HALF * 2);
      // Quadrant diagonals.
      g.globalAlpha = 0.55;
      g.beginPath();
      g.moveTo(0, 0); g.lineTo(w, h);
      g.moveTo(w, 0); g.lineTo(0, h);
      g.stroke();
      g.globalAlpha = 1;
      // Midfield diamond.
      const d = OVERRIDE.midfieldHalfDiagonalIn * IN;
      g.beginPath();
      g.moveTo(px(-d), px(0)); g.lineTo(px(0), px(-d)); g.lineTo(px(d), px(0)); g.lineTo(px(0), px(d)); g.closePath();
      g.stroke();
      // Alliance station stripes.
      g.fillStyle = 'rgba(217,43,43,0.85)';
      g.fillRect(0, 0, w * 0.012, h);
      g.fillStyle = 'rgba(31,95,214,0.85)';
      g.fillRect(w * 0.988, 0, w * 0.012, h);
    });
    b.decal(tiles, HALF * 2, HALF * 2);

    // Perimeter: steel base rail with clear polycarbonate above it.
    const steel = b.mat(0xaab2bc, { metal: 0.8, rough: 0.35 });
    const clear = b.mat(0xd8eaff, { opacity: 0.18, rough: 0.05 });
    const t = 1 * IN;
    for (const [cx, cz, w, d] of [
      [0, -HALF - t / 2, HALF * 2 + 2 * t, t],
      [0, HALF + t / 2, HALF * 2 + 2 * t, t],
      [-HALF - t / 2, 0, t, HALF * 2],
      [HALF + t / 2, 0, t, HALF * 2],
    ] as const) {
      b.box({ center: [cx, 0.035, cz], size: [w, 0.07, d], material: steel, collider: false });
      b.box({ center: [cx, 0.07 + (WALL_H - 0.07) / 2, cz], size: [w, WALL_H - 0.07, d], material: clear, shadow: false, collider: false });
      b.solid([cx, 0.5, cz], [w, 1, d]);
    }
    // Corner posts.
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      b.box({ center: [sx * (HALF + t / 2), WALL_H / 2, sz * (HALF + t / 2)], size: [t * 1.5, WALL_H, t * 1.5], material: steel, collider: false });
    }

    // Goals.
    const tall: Goal = { id: 'tall', kind: 'tall', quadrant: null, stack: [], x: 0, z: 0, pieces: [] };
    this.goals.push(tall);
    for (const q of QUADS) {
      const [ax, az] = q2w(q, 36, -16);
      const [sx, sz] = q2w(q, 36, 16);
      this.goals.push({ id: `${q}-alliance`, kind: 'alliance', alliance: QUAD_ALLIANCE[q], quadrant: q, stack: [], x: ax, z: az, pieces: [] });
      this.goals.push({ id: `${q}-short`, kind: 'short', quadrant: q, stack: [], x: sx, z: sz, pieces: [] });
    }
    for (const g of this.goals) {
      const h = GOAL_HEIGHT[g.kind];
      const r = GOAL_RADIUS[g.kind];
      const color = g.kind === 'alliance' ? (g.alliance === 'red' ? 0xc22828 : 0x1f56c4) : 0x30343a;
      b.cylinder({ center: [g.x, h / 2, g.z], radius: r, height: h, color });
      b.cylinder({ center: [g.x, 0.006, g.z], radius: r * 1.8, height: 0.012, color: 0x24272c, collider: false });
      // Socket ring on top.
      const ring = new THREE.Mesh(new THREE.TorusGeometry(r * 0.75, 0.006, 8, 24), b.mat(0xd8dde3, { metal: 0.7, rough: 0.3 }));
      ring.rotation.x = Math.PI / 2;
      ring.position.set(g.x, h + 0.002, g.z);
      b.group.add(ring);
      if (g.kind === 'tall') {
        this.midfieldRing = new THREE.Mesh(
          new THREE.RingGeometry(r * 2.2, r * 2.6, 32),
          new THREE.MeshBasicMaterial({ color: 0xffe14d, transparent: true, opacity: 0.0, side: THREE.DoubleSide }),
        );
        this.midfieldRing.rotation.x = -Math.PI / 2;
        this.midfieldRing.position.set(0, 0.004, 0);
        b.group.add(this.midfieldRing);
      }
    }

    // Toggles: a 25.8" beam at the center of each wall.
    for (const q of QUADS) {
      const { a } = AXIS[q];
      const len = 25.8 * IN;
      const depth = 2.05 * IN;
      const x = a[0] * (HALF - depth / 2);
      const z = a[1] * (HALF - depth / 2);
      const along = a[0] !== 0;
      const mesh = b.box({
        center: [x, depth / 2 + 0.01, z],
        size: along ? [depth, depth, len] : [len, depth, depth],
        material: new THREE.MeshStandardMaterial({ color: 0xe8e8e8, roughness: 0.5, emissive: 0x000000 }),
      });
      this.toggleViz.push({ q, mesh, x, z, n: [-a[0], -a[1]], cooldown: 0 });
    }
  }

  // --------------------------------------------------------------- pieces
  private makePin(x: number, y: number, z: number, colors: [PinColor, PinColor], standing = true): Piece {
    const group = new THREE.Group();
    const top = new THREE.Mesh(this.pinGeo, this.pinMats[colors[0]]);
    top.position.y = PIN_H / 4;
    const bot = new THREE.Mesh(this.pinGeo, this.pinMats[colors[1]]);
    bot.position.y = -PIN_H / 4;
    for (const m of [top, bot]) {
      m.castShadow = true;
      m.receiveShadow = true;
      group.add(m);
    }
    this.ctx.scene.add(group);
    const rot = standing ? { x: 0, y: 0, z: 0, w: 1 } : { x: Math.SQRT1_2, y: 0, z: 0, w: Math.SQRT1_2 };
    const body = this.ctx.world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(x, y, z)
        .setRotation(rot)
        .setLinearDamping(0.6)
        .setAngularDamping(1.2)
        .setCanSleep(true),
    );
    this.ctx.world.createCollider(
      RAPIER.ColliderDesc.cylinder(PIN_H / 2, PIN_R).setMass(0.08).setFriction(0.7).setRestitution(0.05).setCollisionGroups(PIECE_GROUPS),
      body,
    );
    const p: Piece = { id: this.pieces.length, kind: 'pin', colors, body, mesh: group, state: 'loose' };
    this.pieces.push(p);
    return p;
  }

  private makeCup(x: number, y: number, z: number): Piece {
    const group = new THREE.Group();
    const wall = new THREE.Mesh(this.cupGeo, this.cupMat);
    const base = new THREE.Mesh(this.cupBase, this.cupMat);
    base.rotation.x = -Math.PI / 2;
    base.position.y = -CUP_H / 2;
    wall.castShadow = true;
    group.add(wall, base);
    this.ctx.scene.add(group);
    const body = this.ctx.world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic().setTranslation(x, y, z).setLinearDamping(0.6).setAngularDamping(1.2),
    );
    this.ctx.world.createCollider(
      RAPIER.ColliderDesc.cylinder(CUP_H / 2, CUP_R * 0.92).setMass(0.05).setFriction(0.6).setCollisionGroups(PIECE_GROUPS),
      body,
    );
    const p: Piece = { id: this.pieces.length, kind: 'cup', colors: ['yellow', 'yellow'], body, mesh: group, state: 'loose' };
    this.pieces.push(p);
    return p;
  }

  private spawnPieces(): void {
    // ASSUMPTION: starting layout is symmetric per quadrant; see README.
    const pinSpots: [number, number][] = [
      [20, 0], [28, 8], [28, -8], [48, 0], [44, 28], [44, -28], [58, 10], [58, -10],
      [64, 24], [64, -24], [36, 34], [36, -34], [26, 20], [26, -20],
    ];
    const quadColors = (q: Quadrant): [PinColor, PinColor][] => {
      const near = QUAD_ALLIANCE[q];
      const far: Alliance = near === 'red' ? 'blue' : 'red';
      // 5 red/yellow, 5 blue/yellow, 4 yellow/yellow per quadrant.
      return [
        ['yellow', 'yellow'], [near, 'yellow'], [far, 'yellow'], ['yellow', 'yellow'],
        [near, 'yellow'], [far, 'yellow'], [near, 'yellow'], [far, 'yellow'],
        ['yellow', 'yellow'], ['yellow', 'yellow'], [near, 'yellow'], [far, 'yellow'],
        [near, 'yellow'], [far, 'yellow'],
      ];
    };
    const reserved = this.ctx.robot;
    const clear = (x: number, z: number): [number, number] => {
      // Keep the starting tile around the robot clear.
      const [f, r] = reserved.toLocal(x, z);
      const hl = reserved.cfg.length / 2 + 0.08;
      const hw = reserved.cfg.width / 2 + 0.08;
      if (Math.abs(f) < hl && Math.abs(r) < hw) return [x * 0.6, z * 0.6];
      return [x, z];
    };
    for (const q of QUADS) {
      const colors = quadColors(q);
      pinSpots.forEach(([al, pe], i) => {
        const [x, z] = clear(...q2w(q, al, pe));
        this.makePin(x, PIN_H / 2 + 0.001, z, colors[i]);
      });
      const cupSpots: [number, number][] = [[66, 40], [66, -40], [66, 52], [66, -52], [58, 46], [58, -46], [54, 50], [54, -50], [40, 0]];
      for (const [al, pe] of cupSpots) {
        const [x, z] = clear(...q2w(q, al, pe));
        this.makeCup(x, CUP_H / 2 + 0.001, z);
      }
    }
    // Around the Tall Goal: 3 yellow/yellow + 4 red/blue.
    const center: [PinColor, PinColor][] = [
      ['red', 'blue'], ['yellow', 'yellow'], ['red', 'blue'], ['yellow', 'yellow'],
      ['red', 'blue'], ['yellow', 'yellow'], ['red', 'blue'],
    ];
    center.forEach((c, i) => {
      const ang = (i / center.length) * Math.PI * 2 + 0.3;
      this.makePin(Math.cos(ang) * 11 * IN, PIN_H / 2 + 0.001, Math.sin(ang) * 11 * IN, c);
    });
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

  // --------------------------------------------------------------- update
  update(dt: number, ctl: ControlState): void {
    const robot = this.ctx.robot;
    const enabled = this.ctx.clock.enabled;
    this.intakeCooldown -= dt;
    this.placeCooldown -= dt;
    this.dropCooldown -= dt;
    robot.intakeSpin = enabled && ctl.intake ? 1 : enabled && ctl.outtake ? -1 : 0;

    if (enabled && ctl.intake && this.held.length < robot.cfg.capacity && this.intakeCooldown <= 0) {
      for (const p of this.pieces) {
        if (p.state !== 'loose') continue;
        const t = p.body.translation();
        if (robot.inIntake(t.x, t.z, t.y)) {
          this.hold(p);
          this.intakeCooldown = 0.22;
          this.ctx.intook();
          break;
        }
      }
    }

    if (enabled && ctl.outtake && this.held.length && this.dropCooldown <= 0) {
      const p = this.held[this.held.length - 1];
      const [x, z] = robot.toWorld(robot.cfg.length / 2 + 0.07, 0);
      const [fx, fz] = robot.toWorld(1, 0);
      this.release(p, x, (p.kind === 'pin' ? PIN_H : CUP_H) / 2 + 0.01, z, robot.cmd.vx + (fx - robot.x) * 0.4, robot.cmd.vz + (fz - robot.z) * 0.4);
      this.dropCooldown = 0.35;
    }

    if (enabled && ctl.score && !this.prevScore) this.tryPlace();
    this.prevScore = ctl.score;

    // Toggles: touching one sets it to your alliance color.
    for (const tv of this.toggleViz) {
      tv.cooldown -= dt;
      if (!enabled || tv.cooldown > 0 || this.toggles[tv.q] === robot.alliance) continue;
      if (this.robotTouchesToggle(tv)) {
        this.toggles[tv.q] = robot.alliance;
        tv.cooldown = 0.6;
        this.ctx.toast(`${tv.q} Toggle → ${robot.alliance.toUpperCase()}`, robot.alliance);
        this.ctx.beep('score');
      }
    }
  }

  private robotTouchesToggle(tv: ToggleViz): boolean {
    const r = this.ctx.robot;
    // Distance from robot center to the wall face along the inward normal.
    const wallX = tv.x - tv.n[0] * (1.025 * IN);
    const wallZ = tv.z - tv.n[1] * (1.025 * IN);
    const d = (r.x - wallX) * tv.n[0] + (r.z - wallZ) * tv.n[1];
    const [fx, fz] = [Math.cos(r.heading), -Math.sin(r.heading)];
    const [rx, rz] = [Math.sin(r.heading), Math.cos(r.heading)];
    const extent =
      Math.abs((r.cfg.length / 2) * (fx * tv.n[0] + fz * tv.n[1])) + Math.abs((r.cfg.width / 2) * (rx * tv.n[0] + rz * tv.n[1]));
    // Lateral overlap with the 25.8" beam.
    const lat = Math.abs((r.x - tv.x) * tv.n[1] - (r.z - tv.z) * tv.n[0]);
    const latExtent =
      Math.abs((r.cfg.length / 2) * (fx * tv.n[1] - fz * tv.n[0])) + Math.abs((r.cfg.width / 2) * (rx * tv.n[1] - rz * tv.n[0]));
    return d - extent < 2.05 * IN + 0.025 && lat < 12.9 * IN + latExtent;
  }

  /** The goal directly in front of the robot's scoring mechanism, if any. */
  private goalInFront(): Goal | null {
    const r = this.ctx.robot;
    let best: Goal | null = null;
    let bestD = Infinity;
    for (const g of this.goals) {
      const [f, l] = r.toLocal(g.x, g.z);
      const front = r.cfg.length / 2;
      if (f > front - 0.06 && f < front + 0.22 && Math.abs(l) < 0.16) {
        const d = Math.hypot(f - front, l);
        if (d < bestD) {
          bestD = d;
          best = g;
        }
      }
    }
    return best;
  }

  private tryPlace(): void {
    if (this.placeCooldown > 0) return;
    const g = this.goalInFront();
    if (!g) {
      this.ctx.toast('Line up a goal with your intake', 'info');
      return;
    }
    const top = g.stack[g.stack.length - 1];
    const wantKind: 'pin' | 'cup' = top && top.type === 'pin' ? 'cup' : 'pin';
    const piece = this.held.find((p) => p.kind === wantKind);
    if (!piece) {
      this.ctx.toast(wantKind === 'cup' ? 'Need a Cup to stack on that Pin' : 'Need a Pin for that goal', 'bad');
      return;
    }
    const item: StackItem =
      piece.kind === 'cup' ? { type: 'cup' } : { type: 'pin', up: this.upColor(piece), down: this.downColor(piece) };
    const res = canPlace(g, item, this.me);
    if (!res.ok) {
      this.ctx.toast(res.reason, 'bad');
      return;
    }
    this.held = this.held.filter((h) => h !== piece);
    piece.state = 'placed';
    piece.goal = g.id;
    g.stack.push(item);
    g.pieces.push(piece);
    this.placeCooldown = 0.3;
    this.layoutGoal(g);
    if (item.type === 'pin') {
      this.placedByMe++;
      const owner = item.up === 'yellow' ? (g.quadrant ? this.toggles[g.quadrant] : null) : item.up;
      const pts = item.up === 'yellow' ? OVERRIDE.points.ownedYellowPin : OVERRIDE.points.alliancePin;
      this.ctx.toast(
        item.up === 'yellow'
          ? `Yellow Pin placed${owner ? ` (+${pts} ${owner.toUpperCase()})` : ' (flip the Toggle to own it)'}`
          : `+${pts} ${item.up.toUpperCase()} Pin`,
        item.up === 'yellow' ? 'good' : item.up,
      );
      this.ctx.scored(1);
      this.ctx.beep('score');
    } else {
      this.ctx.toast('Cup stacked: ready for another Pin', 'info');
    }
  }

  /** Pin orientation chosen by the driver: which half faces up. */
  private upColor(p: Piece): PinColor {
    const [a, b] = p.colors;
    if (this.orientation === 'yellow') return a === 'yellow' || b === 'yellow' ? 'yellow' : a;
    if (a === this.me || b === this.me) return this.me;
    return a;
  }

  private downColor(p: Piece): PinColor {
    const up = this.upColor(p);
    return p.colors[0] === up ? p.colors[1] : p.colors[0];
  }

  private layoutGoal(g: Goal): void {
    let cursor = GOAL_HEIGHT[g.kind];
    g.stack.forEach((item, i) => {
      const piece = g.pieces[i];
      let base: number;
      if (item.type === 'pin') {
        base = cursor - 1 * IN;
        cursor = base + PIN_H;
        const flipped = piece.colors[0] !== item.up;
        piece.mesh.rotation.set(flipped ? Math.PI : 0, 0, 0);
      } else {
        base = cursor - 2.5 * IN;
        cursor = base + CUP_H;
        piece.mesh.rotation.set(0, 0, 0);
      }
      piece.mesh.position.set(g.x, base + PIN_H / 2, g.z);
    });
  }

  private descore(): void {
    const g = this.goalInFront();
    if (!g || !g.stack.length) {
      this.ctx.toast('No goal stack in front of you', 'info');
      return;
    }
    const item = g.stack.pop()!;
    const piece = g.pieces.pop()!;
    if (item.type === 'pin') this.placedByMe = Math.max(0, this.placedByMe - 1);
    if (this.held.length < this.ctx.robot.cfg.capacity) {
      this.hold(piece);
      this.ctx.toast('Descored into robot', 'info');
    } else {
      const r = this.ctx.robot;
      const [x, z] = r.toWorld(r.cfg.length / 2 + 0.12, 0.12);
      this.release(piece, x, 0.12, z);
      this.ctx.toast('Descored onto the floor', 'info');
    }
  }

  onAction(a: Action): void {
    if (a === 'flip') {
      this.orientation = this.orientation === 'alliance' ? 'yellow' : 'alliance';
      this.ctx.toast(`Pins now place ${this.orientation === 'yellow' ? 'YELLOW' : 'ALLIANCE color'} side up`, 'info');
    } else if (a === 'descore') {
      if (this.ctx.clock.enabled) this.descore();
    } else if (a === 'feed') {
      this.matchLoad();
    }
  }

  private matchLoad(): void {
    const r = this.ctx.robot;
    const wallX = this.me === 'red' ? -HALF : HALF;
    if (Math.abs(r.x - wallX) > 0.75) {
      this.ctx.toast('Match loads: drive next to your alliance wall', 'info');
      return;
    }
    if (this.matchLoads <= 0) {
      this.ctx.toast('No match-load Cups left', 'bad');
      return;
    }
    if (this.held.length >= r.cfg.capacity) {
      this.ctx.toast('Robot is full', 'bad');
      return;
    }
    this.matchLoads--;
    const cup = this.makeCup(r.x, 0.2, r.z);
    this.hold(cup);
    this.ctx.toast(`Match-load Cup (${this.matchLoads} left)`, 'info');
  }

  onPhaseChange(prev: Phase | null): void {
    if (prev?.kind === 'auto') {
      const s = this.scores(false);
      const mine = s[this.me].total;
      const other = s[this.me === 'red' ? 'blue' : 'red'].total;
      this.autoBonus = mine > other ? this.me : other > mine ? (this.me === 'red' ? 'blue' : 'red') : 'tie';
      this.ctx.toast(
        this.autoBonus === this.me ? `Autonomous Bonus +${OVERRIDE.points.autoBonus}!` : this.autoBonus === 'tie' ? 'Autonomous tied: bonus split' : 'Opponent wins the Autonomous Bonus',
        this.autoBonus === this.me ? 'good' : 'info',
      );
    }
  }

  private robotInMidfield(): boolean {
    const r = this.ctx.robot;
    return isInMidfield(r.x / IN, r.z / IN);
  }

  private scores(includeMidfield = true) {
    const mid = includeMidfield && this.robotInMidfield() ? 1 : 0;
    return scoreOverride({
      goals: this.goals,
      toggles: this.toggles,
      robotsInMidfield: { red: this.me === 'red' ? mid : 0, blue: this.me === 'blue' ? mid : 0 },
      autoBonus: this.ctx.mode === 'match' ? this.autoBonus : null,
    });
  }

  liveScore(): { mine: number; other: number; lines: ScoreLine[] } {
    const s = this.scores();
    const m = s[this.me];
    return {
      mine: m.total,
      other: s[this.me === 'red' ? 'blue' : 'red'].total,
      lines: [
        { label: 'Alliance Pins', value: m.alliancePins },
        { label: 'Owned yellow Pins', value: m.yellowPins },
        { label: 'Midfield', value: m.midfield },
        { label: 'Auto bonus', value: m.autoBonus },
      ],
    };
  }

  statusHtml(): string {
    const chip = (q: Quadrant) => {
      const o = this.toggles[q];
      const c = o === 'red' ? 'var(--red)' : o === 'blue' ? 'var(--blue)' : 'var(--muted)';
      return `<span class="chip" style="--c:${c}">${q}</span>`;
    };
    const mid = this.robotInMidfield();
    return `
      <div class="row"><span class="lbl">Toggles</span>${QUADS.map(chip).join('')}</div>
      <div class="row"><span class="lbl">Pin side up</span><b>${this.orientation === 'yellow' ? '<span style="color:var(--yellow)">YELLOW</span>' : `<span style="color:var(--${this.me})">${this.me.toUpperCase()}</span>`}</b> <span class="hint">R / A to flip</span></div>
      <div class="row"><span class="lbl">Midfield</span><b style="color:${mid ? 'var(--good)' : 'var(--muted)'}">${mid ? 'IN (+8)' : 'out'}</b></div>
      <div class="row"><span class="lbl">Match loads</span><b>${this.matchLoads}</b></div>`;
  }

  cargoHtml(): string {
    const slots: string[] = [];
    for (let i = 0; i < this.ctx.robot.cfg.capacity; i++) {
      const p = this.held[i];
      if (!p) slots.push('<span class="slot"></span>');
      else if (p.kind === 'cup') slots.push('<span class="slot cup" title="Cup"></span>');
      else slots.push(`<span class="slot pin" style="--a:${CSS[p.colors[0]]};--b:${CSS[p.colors[1]]}" title="Pin"></span>`);
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
        if (t.y < -1) p.body.setTranslation({ x: 0, y: 0.2, z: 0 }, true);
      }
    }
    // Carried pieces ride on the robot.
    this.held.forEach((p, i) => {
      const [x, z] = r.toWorld(-r.cfg.length * 0.15 + i * 0.02, (i - (this.held.length - 1) / 2) * 0.09);
      p.mesh.position.set(x, r.mesh.position.y + r.cfg.height * 0.55 + i * 0.01, z);
      p.mesh.rotation.set(0, 0, 0);
    });
    // Toggle colors.
    for (const tv of this.toggleViz) {
      const owner = this.toggles[tv.q];
      const m = tv.mesh.material as THREE.MeshStandardMaterial;
      const col = owner === 'red' ? 0xd92b2b : owner === 'blue' ? 0x1f5fd6 : 0xe8e8e8;
      m.color.setHex(col);
      m.emissive.setHex(owner ? col : 0);
      m.emissiveIntensity = owner ? 0.35 : 0;
    }
    const ringMat = this.midfieldRing.material as THREE.MeshBasicMaterial;
    ringMat.opacity = this.robotInMidfield() ? 0.6 + Math.sin(performance.now() / 150) * 0.2 : 0;
  }

  finalize(): MatchSummary {
    const s = this.scores();
    const m = s[this.me];
    const o = s[this.me === 'red' ? 'blue' : 'red'];
    const lines: ScoreLine[] = [
      { label: 'Alliance-color Pins', value: m.alliancePins },
      { label: 'Owned yellow Pins', value: m.yellowPins },
      { label: 'Robot in Midfield', value: m.midfield },
    ];
    if (this.ctx.mode === 'match') lines.push({ label: 'Autonomous Bonus', value: m.autoBonus });
    lines.push({ label: 'Pins placed', value: this.placedByMe });
    lines.push({ label: 'Toggles owned', value: `${QUADS.filter((q) => this.toggles[q] === this.me).length}/4` });
    const notes: string[] = [];
    if (o.total > 0) notes.push(`You also gave the opposing alliance ${o.total} points (check which side of your Pins faces up).`);
    if (this.ctx.mode === 'match') notes.push('Autonomous Win Point tasks are not modeled.');
    return { total: m.total, lines, notes };
  }

  footprints(): Footprint[] {
    const out: Footprint[] = [
      { x: 0, z: 0, w: OVERRIDE.midfieldHalfDiagonalIn * 2 * IN, d: OVERRIDE.midfieldHalfDiagonalIn * 2 * IN, color: 'rgba(255,225,77,0.18)', shape: 'diamond' },
    ];
    for (const g of this.goals) {
      out.push({
        x: g.x, z: g.z, w: GOAL_RADIUS[g.kind] * 3, d: GOAL_RADIUS[g.kind] * 3,
        color: g.kind === 'alliance' ? (g.alliance === 'red' ? '#d92b2b' : '#1f5fd6') : '#aaaaaa',
        shape: 'circle',
      });
    }
    for (const tv of this.toggleViz) {
      const along = tv.n[0] !== 0;
      out.push({ x: tv.x, z: tv.z, w: along ? 0.06 : 0.66, d: along ? 0.66 : 0.06, color: '#e8e8e8' });
    }
    return out;
  }

  dispose(): void {
    this.pinGeo.dispose();
    this.cupGeo.dispose();
    this.cupBase.dispose();
    for (const m of Object.values(this.pinMats)) m.dispose();
    this.cupMat.dispose();
  }
}

function startPoses(alliance: Alliance): StartPose[] {
  const s = alliance === 'red' ? -1 : 1;
  const heading = alliance === 'red' ? 0 : Math.PI;
  return [
    { label: 'Left tile', x: s * 56 * IN, z: s * 40 * IN, heading },
    { label: 'Right tile', x: s * 56 * IN, z: -s * 40 * IN, heading },
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
  blurb: '12′×12′ field. Stack Pins and Cups on nine Goals, flip the four wall Toggles to own the yellow Pins, and finish in the Midfield.',
  fieldX: HALF * 2,
  fieldZ: HALF * 2,
  presets: PRESETS,
  modes: [
    { id: 'match', label: 'Full match', description: '0:15 autonomous (drive it yourself to rehearse your route) + 1:45 driver control, with the Autonomous Bonus.' },
    { id: 'driver', label: 'Driver period', description: '1:45 driver control with a 10 s endgame.' },
    { id: 'skills', label: 'Driver skills', description: '60 s solo run. Score as much as you can.' },
    { id: 'sprint', label: 'Placement sprint', description: 'Place 8 Pins as fast as possible. Timed.' },
    { id: 'gates', label: 'Gate course', description: 'Figure-eight through the Goals. Pure driving accuracy and speed.' },
    { id: 'free', label: 'Free practice', description: 'No clock. Try things out.' },
  ],
  stations: [
    { id: 'red-left', label: 'Red, left', alliance: 'red', eye: [-HALF - 1.1, 1.65, -0.75], target: [0.15, 0, -0.1], yaw: 0 },
    { id: 'red-right', label: 'Red, right', alliance: 'red', eye: [-HALF - 1.1, 1.65, 0.75], target: [0.15, 0, 0.1], yaw: 0 },
    { id: 'blue-left', label: 'Blue, left', alliance: 'blue', eye: [HALF + 1.1, 1.65, 0.75], target: [-0.15, 0, 0.1], yaw: Math.PI },
    { id: 'blue-right', label: 'Blue, right', alliance: 'blue', eye: [HALF + 1.1, 1.65, -0.75], target: [-0.15, 0, -0.1], yaw: Math.PI },
  ],
  startPoses,
  phases,
  gates(): Gate[] {
    // Figure-eight around the W/S/E/N short goals and back through the Midfield.
    const g = (x: number, z: number, yaw: number): Gate => ({ x: x * IN, z: z * IN, yaw, width: 22 * IN });
    return [
      g(-36, 0, Math.PI / 2),
      g(-20, 44, 0),
      g(20, 44, 0),
      g(44, 0, Math.PI / 2),
      g(20, -44, 0),
      g(0, 0, Math.PI / 4),
      g(-20, -44, 0),
      g(-50, -20, Math.PI / 2),
    ];
  },
  sprint: { count: 8, label: 'Pins placed' },
  create: (ctx) => new OverrideRuntime(ctx),
  notes: [
    'Match timing (0:15 auto + 1:45 driver), point values (12 auto bonus, 5 alliance Pin, 10 owned yellow Pin, 8 Midfield), the goal counts and heights, Pin and Cup counts, the Toggle-ownership rule and the Midfield diamond come from published summaries of the Override game manual.',
    'ASSUMPTIONS: the starting layout of Pins and Cups, the exact Goal positions, which half of a Pin counts (we score the half facing up), goal stack limits, how a Toggle is flipped (we treat touching it as flipping it), and how yellow Pins on the Tall Goal are owned. All of these live in src/games/override/rules.ts and game.ts so you can match them to the official manual.',
  ],
};
