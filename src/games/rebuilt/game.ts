import * as THREE from 'three';
import { RAPIER, PIECE_GROUPS, groups, GROUP } from '../../core/physics';
import { FieldBuilder, canvasTexture } from '../../core/builder';
import { IN, wrapAngle } from '../../core/units';
import type { Phase } from '../../core/match';
import type { Action, ControlState } from '../../core/input';
import type { RobotConfig, Alliance } from '../../robot/robot';
import { frcModel, BUMPER } from '../../robot/models/frc';
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
  FUEL_DRAG_K,
  REBUILT,
  type RebuiltPhaseId,
  type TowerLevel,
  hubActive,
  scoreRebuilt,
  solveShot,
  towerPoints,
} from './rules';

// ------------------------------------------------------------- field (m)
// Dimensions from the 2026 game manual (Section 5, ARENA) and positions from the
// official field CAD / AprilTag layout. Positions are given per alliance as
// d = distance out from that alliance's wall, lat = offset to the drivers' LEFT
// of the field center line.
const FIELD_L = 651.2 * IN;
const FIELD_W = 317.7 * IN;
const HL = FIELD_L / 2;
const HW = FIELD_W / 2;
const ZONE = 158.6 * IN; // alliance zone depth = ROBOT STARTING LINE
const HUB = { size: 47 * IN, d: 158.6 * IN + (47 * IN) / 2, rimFront: 72 * IN, rimBack: 80 * IN, hexR: (41.7 * IN) / 2, aimY: 1.95, exitW: 35.56 * IN, exitY: 30.13 * IN, netOut: 10.26 * IN, netW: 58.41 * IN, netBottom: 49.75 * IN, netTop: 120.36 * IN };
const BUMP = { width: 73 * IN, depth: 44.4 * IN, height: 6.513 * IN };
const TRENCH = { width: 65.65 * IN, depth: 47 * IN, height: 40.25 * IN, clearWidth: 50.34 * IN, clearHeight: 22.25 * IN, armThick: 3 * IN };
const TOWER = { lat: 3.7457 - HW, baseW: 39 * IN, baseD: 45.18 * IN, uprightH: 72.1 * IN, uprightGap: 32.25 * IN, rungExt: 5.875 * IN, rungs: [27 * IN, 45 * IN, 63 * IN], rungR: (1.66 * IN) / 2 };
const TOWER_UPRIGHT_D = TOWER.baseD - 1.75 * IN - 0.02;
const DEPOT = { lat: 5.965 - HW, width: 42 * IN, depth: 27 * IN, barrierW: 3 * IN, barrierH: 1.125 * IN };
const OUTPOST = { lat: 0.666 - HW, chuteY: 28.1 * IN, chuteW: 31.8 * IN, corralW: 35.8 * IN, corralD: 37.6 * IN, corralH: 8.13 * IN };
const DS_BASE_H = 36.8 * IN;
const DS_GLASS_H = 42 * IN;
const GUARDRAIL_H = 20 * IN;
const DRIVER_LAT = [7.2 - HW, 5.45 - HW, 2.35 - HW];
const FUEL_R = (5.91 * IN) / 2;
const FUEL_MASS = 0.215;
const ROLL_DECEL = 0.35;
const SCORE_GRACE = 3;

const ALLIANCE_HEX: Record<Alliance, number> = { red: 0xd92b2b, blue: 0x1f5fd6 };

/** Alliance-relative (d, lat) to world (x, z). Red drivers face +X, so their left is −Z. */
function P(a: Alliance, d: number, lat: number): [number, number] {
  return a === 'red' ? [-HL + d, -lat] : [HL - d, lat];
}

const deg = (d: number) => (d * Math.PI) / 180;
const withBumpers = (inches: number) => (inches + 2 * BUMPER) * IN;

const PRESETS: RobotConfig[] = [
  {
    id: 'frc-2910',
    name: '2910 Jack in the Bot · Re•Blitz',
    team: '2910',
    description: '“Dumper”: a huge hopper and a 4-wide drum fixed to the chassis that fires out the back at 30+ FUEL/s. The whole robot turns to aim. No climber.',
    source: 'Team 2910’s published 2026 specs and CAD (27″×27.5″ frame, 21.5″ tall, 14.1 ft/s, 58 FUEL).',
    length: withBumpers(27), width: withBumpers(27.5), height: 21.5 * IN,
    drive: 'swerve',
    params: { maxSpeed: 4.3, maxAccel: 10, maxDecel: 13, maxTurnRate: 10, maxTurnAccel: 45, trackWidth: 0.6 },
    capacity: 58, intakeWidth: 25.5 * IN, intakeReach: 7.8 * IN,
    shooter: { rate: 32, angle: deg(58), turret: false, facing: 'back', hoodMin: deg(42), hoodMax: deg(74), speedMax: 17, height: 0.5 },
    maxClimb: 0, style: 'frc',
    stats: { 'Shot rate': '32 FUEL/s', Aim: 'whole robot (shoots backward)', 'Top speed': '14.1 ft/s', Trench: 'fits' },
    model: frcModel({ team: '2910', frameL: 27, frameW: 27.5, height: 21.5, drive: 'swerve', colors: { frame: 0xb9bec5, accent: 0x5c6168, trim: 0xc6cbd1 }, hopper: { wallH: 21, net: false, front: 12, back: -8 }, shooter: { type: 'drum', facing: 'back', x: -10.5, z: 0 }, intake: 'slapdown', climber: false }),
  },
  {
    id: 'frc-4414',
    name: '4414 HighTide · RIPCURRENT',
    team: '4414',
    description: 'Extending hopper (~88 FUEL) under a net, a Dye Rotor single-streaming FUEL into a turret that shoots on the move. 2026 World Champion. No climber.',
    source: 'Team 4414’s published 2026 specs (25″×32″ frame, 21.75″ tall, 13.1 ft/s, 88 FUEL, 18 FUEL/s turret).',
    length: withBumpers(25), width: withBumpers(32), height: 21.75 * IN,
    drive: 'swerve',
    params: { maxSpeed: 3.99, maxAccel: 10, maxDecel: 13, maxTurnRate: 9.5, maxTurnAccel: 42, trackWidth: 0.62 },
    capacity: 88, intakeWidth: 30 * IN, intakeReach: 0.2,
    shooter: { rate: 18, angle: deg(62), turret: true, facing: 'front', hoodMin: deg(44), hoodMax: deg(82), speedMax: 16, height: 0.55 },
    maxClimb: 0, style: 'frc',
    stats: { 'Shot rate': '18 FUEL/s', Aim: 'turret', 'Top speed': '13.1 ft/s', Trench: 'fits' },
    model: frcModel({ team: '4414', frameL: 25, frameW: 32, height: 21.75, drive: 'swerve', colors: { frame: 0x0fa3b1, accent: 0x0fa3b1, trim: 0x2b2f36 }, hopper: { wallH: 21, net: true, front: 11, back: -11 }, shooter: { type: 'turret', facing: 'front', x: -1, z: 0 }, intake: 'slapdown', climber: false }),
  },
  {
    id: 'frc-1678',
    name: '1678 Citrus Circuits · Limestone',
    team: '1678',
    description: 'Full-width drum with three hood rollers that fires out the back, fed by a roller floor and ball tunnel. Climbs Level 1.',
    source: 'Team 1678’s published 2026 specs (27″×27″ frame, 21.6″ tall, 14.8 ft/s, 26 FUEL/s, L1 climb). Hopper size estimated.',
    length: withBumpers(27), width: withBumpers(27), height: 21.6 * IN,
    drive: 'swerve',
    params: { maxSpeed: 4.51, maxAccel: 10.5, maxDecel: 13, maxTurnRate: 10, maxTurnAccel: 45, trackWidth: 0.6 },
    capacity: 50, intakeWidth: 25 * IN, intakeReach: 0.29,
    shooter: { rate: 26, angle: deg(56), turret: false, facing: 'back', hoodMin: deg(38), hoodMax: deg(76), speedMax: 17, height: 0.5 },
    maxClimb: 1, climbTime: 1.6, style: 'frc',
    stats: { 'Shot rate': '26 FUEL/s', Aim: 'whole robot (shoots backward)', 'Top speed': '14.8 ft/s', Trench: 'fits', Climb: 'Level 1' },
    model: frcModel({ team: '1678', frameL: 27, frameW: 27, height: 21.6, drive: 'swerve', colors: { frame: 0x1d1f24, accent: 0x5fd13a, trim: 0x2a2c31 }, hopper: { wallH: 21, net: true, front: 12, back: -8 }, shooter: { type: 'drum', facing: 'back', x: -10.5, z: 0 }, intake: 'slapdown', climber: true }),
  },
  {
    id: 'frc-971',
    name: '971 Spartan Robotics · Mixtape',
    team: '971',
    description: 'Two independently aimed turrets fed by a roller floor and a powered separator. Climbs Level 1.',
    source: 'Team 971’s published 2026 specs (24.5″×29.5″ frame, 22″ tall, 14.4 ft/s, 2 turrets ≈ 20 FUEL/s, L1). Hopper size estimated.',
    length: withBumpers(24.5), width: withBumpers(29.5), height: 22 * IN,
    drive: 'swerve',
    params: { maxSpeed: 4.39, maxAccel: 10, maxDecel: 13, maxTurnRate: 10, maxTurnAccel: 45, trackWidth: 0.6 },
    capacity: 45, intakeWidth: 29 * IN, intakeReach: 0.18,
    shooter: { rate: 20, angle: deg(60), turret: true, facing: 'front', hoodMin: deg(35), hoodMax: deg(85), speedMax: 16, height: 0.55 },
    maxClimb: 1, climbTime: 2.0, style: 'frc',
    stats: { 'Shot rate': '20 FUEL/s (2 turrets)', Aim: 'twin turrets', 'Top speed': '14.4 ft/s', Trench: 'fits', Climb: 'Level 1' },
    model: frcModel({ team: '971', frameL: 24.5, frameW: 29.5, height: 22, drive: 'swerve', colors: { frame: 0xb4b9c1, accent: 0xc62828, trim: 0x2a2c31 }, hopper: { wallH: 21, net: true, front: 10, back: -9 }, shooter: { type: 'twin', facing: 'front', x: -5.8, z: 0 }, intake: 'fourbar', climber: true }),
  },
  {
    id: 'frc-1690',
    name: '1690 Orbit · Kepler',
    team: '1690',
    description: 'Compact gear-driven turret on an 8″ bearing that shoots on the move while the intake keeps running. Hopper expands forward under a lattice frame and netting.',
    source: 'Team 1690’s published 2026 specs (25″×29″ frame, 21.5″ tall, 13.1 ft/s, 12 FUEL/s). Hopper size estimated.',
    length: withBumpers(25), width: withBumpers(29), height: 21.5 * IN,
    drive: 'swerve',
    params: { maxSpeed: 3.99, maxAccel: 10, maxDecel: 13, maxTurnRate: 9.5, maxTurnAccel: 42, trackWidth: 0.6 },
    capacity: 40, intakeWidth: 27 * IN, intakeReach: 0.2,
    shooter: { rate: 12, angle: deg(62), turret: true, facing: 'front', hoodMin: deg(40), hoodMax: deg(80), speedMax: 16, height: 0.55 },
    maxClimb: 0, style: 'frc',
    stats: { 'Shot rate': '12 FUEL/s', Aim: 'turret', 'Top speed': '13.1 ft/s', Trench: 'fits' },
    model: frcModel({ team: '1690', frameL: 25, frameW: 29, height: 21.5, drive: 'swerve', colors: { frame: 0x2a2d33, accent: 0x2d6fd6, trim: 0x9aa0a8 }, hopper: { wallH: 21, net: true, front: 11, back: -10 }, shooter: { type: 'turret', facing: 'front', x: -4.7, z: -6.7 }, intake: 'slapdown', climber: false }),
  },
  {
    id: 'frc-4946',
    name: '4946 The Alpha Dogs · Moto Moto',
    team: '4946',
    description: 'A round robot: a 35″ hopper around a turret on the center of rotation, fed by a Dye Rotor. Too tall for the TRENCH, so it takes the BUMPS.',
    source: 'Team 4946’s published 2026 specs (32.75″ round frame, 29.5″ tall, 12.8 ft/s, 20 FUEL/s). Hopper size estimated.',
    length: withBumpers(32.75), width: withBumpers(32.75), height: 29.5 * IN,
    drive: 'swerve',
    params: { maxSpeed: 3.9, maxAccel: 9.5, maxDecel: 12, maxTurnRate: 9, maxTurnAccel: 40, trackWidth: 0.62 },
    capacity: 75, intakeWidth: 27 * IN, intakeReach: 0.22,
    shooter: { rate: 20, angle: deg(62), turret: true, facing: 'front', hoodMin: deg(42), hoodMax: deg(80), speedMax: 16, height: 0.75 },
    maxClimb: 0, style: 'frc',
    stats: { 'Shot rate': '20 FUEL/s', Aim: 'turret', 'Top speed': '12.8 ft/s', Trench: 'too tall: BUMPS only' },
    model: frcModel({ team: '4946', frameL: 32.75, frameW: 32.75, height: 29.5, drive: 'swerve', shape: 'round', colors: { frame: 0x9aa0a8, accent: 0xd32f2f, trim: 0x1d1f24 }, hopper: { wallH: 28, net: true, front: 14, back: -14 }, shooter: { type: 'turret', facing: 'front', x: 0.8, z: 0 }, intake: 'slapdown', climber: false }),
  },
  {
    id: 'frc-practice-l3',
    name: 'Practice bot: L3 climber',
    description: 'Not a real team’s robot: a balanced swerve with a turret and a Level 3 climber, for practicing the full TOWER.',
    source: 'Generic design for TOWER practice.',
    length: withBumpers(27), width: withBumpers(27), height: 21.5 * IN,
    drive: 'swerve',
    params: { maxSpeed: 4.2, maxAccel: 10, maxDecel: 13, maxTurnRate: 10, maxTurnAccel: 45, trackWidth: 0.6 },
    capacity: 35, intakeWidth: 25 * IN, intakeReach: 0.2,
    shooter: { rate: 10, angle: deg(62), turret: true, facing: 'front', hoodMin: deg(40), hoodMax: deg(80), speedMax: 16, height: 0.55 },
    maxClimb: 3, climbTime: 1.5, style: 'frc',
    stats: { 'Shot rate': '10 FUEL/s', Aim: 'turret', 'Top speed': '13.8 ft/s', Trench: 'fits', Climb: 'Level 3' },
    model: frcModel({ team: '9999', frameL: 27, frameW: 27, height: 21.5, drive: 'swerve', colors: { frame: 0xc3c8ce, accent: 0xf2a91c, trim: 0x2a2d33 }, hopper: { wallH: 21, net: false, front: 11, back: -9 }, shooter: { type: 'turret', facing: 'front', x: -3, z: 0 }, intake: 'slapdown', climber: true }),
  },
];

type FuelState = 0 | 1 | 2 | 3; // loose | held | reserve (OUTPOST) | inside a HUB
const LOOSE = 0;
const HELD = 1;
const RESERVE = 2;
const IN_HUB = 3;

interface ShotSolution {
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  /** Shooter direction (field yaw) and hood angle, for the model and auto-align. */
  yaw: number;
  hood: number;
  ok: boolean;
}

class RebuiltRuntime implements GameRuntime {
  private b: FieldBuilder;
  private bodies: RAPIER.RigidBody[] = [];
  private state: FuelState[] = [];
  private fuelMesh!: THREE.InstancedMesh;
  private held: number[] = [];
  private outpostQueue: Record<Alliance, number[]> = { red: [], blue: [] };
  private hubQueue: { i: number; a: Alliance; at: number }[] = [];
  private hubLights: Record<Alliance, THREE.Mesh[]> = { red: [], blue: [] };
  private readonly me: Alliance;
  private readonly hub: Record<Alliance, [number, number]>;
  private tally = { autoFuel: 0, teleopFuel: 0, inactiveFuel: 0, autoTower: 0 as TowerLevel, endTower: 0 as TowerLevel };
  private autoWinner: Alliance | null = null;
  private lastActive: Record<Alliance, number> = { red: 0, blue: 0 };
  private time = 0;
  private shootCooldown = 0;
  private intakeCooldown = 0;
  private feedCooldown = 0;
  private manualSpeed = 9;
  private climb = 0;
  private descending = false;
  private trajLine: THREE.Line;
  private trajGood = false;
  private totalScored = 0;
  private sol: ShotSolution | null = null;
  private matrix = new THREE.Matrix4();
  private hidden = new THREE.Matrix4().makeScale(0, 0, 0);

  constructor(private ctx: GameContext) {
    this.me = ctx.robot.alliance;
    this.hub = { red: P('red', HUB.d, 0), blue: P('blue', HUB.d, 0) };
    this.b = new FieldBuilder(ctx.world, ctx.scene);
    this.buildField();
    this.spawnFuel();
    const geo = new THREE.BufferGeometry().setFromPoints(new Array(60).fill(0).map(() => new THREE.Vector3()));
    this.trajLine = new THREE.Line(geo, new THREE.LineDashedMaterial({ color: 0x9cff9c, dashSize: 0.12, gapSize: 0.08, transparent: true, opacity: 0.85 }));
    this.trajLine.frustumCulled = false;
    ctx.scene.add(this.trajLine);
    if (ctx.mode === 'driver') this.autoWinner = this.decideAutoWinner(0);
  }

  // ---------------------------------------------------------------- field
  private buildField(): void {
    const b = this.b;
    b.floor(FIELD_L, FIELD_W);
    const carpet = canvasTexture(2048, 1000, (g, w, h) => {
      g.fillStyle = '#4b4f55';
      g.fillRect(0, 0, w, h);
      for (let i = 0; i < 12000; i++) {
        const v = 66 + Math.random() * 22;
        g.fillStyle = `rgba(${v},${v + 2},${v + 6},0.35)`;
        g.fillRect(Math.random() * w, Math.random() * h, 3, 3);
      }
      const X = (x: number) => ((x + HL) / FIELD_L) * w;
      const Z = (z: number) => ((z + HW) / FIELD_W) * h;
      const tape = (x1: number, z1: number, x2: number, z2: number, color: string, width = 2 * IN) => {
        g.strokeStyle = color;
        g.lineWidth = (width / FIELD_L) * w;
        g.beginPath();
        g.moveTo(X(x1), Z(z1));
        g.lineTo(X(x2), Z(z2));
        g.stroke();
      };
      tape(0, -HW, 0, HW, '#f5f5f5');
      tape(-HL + ZONE, -HW, -HL + ZONE, HW, '#e04848');
      tape(HL - ZONE, -HW, HL - ZONE, HW, '#3b7bf0');
      g.fillStyle = 'rgba(217,43,43,0.09)';
      g.fillRect(0, 0, X(-HL + ZONE), h);
      g.fillStyle = 'rgba(31,95,214,0.09)';
      g.fillRect(X(HL - ZONE), 0, w - X(HL - ZONE), h);
    });
    b.decal(carpet, FIELD_L, FIELD_W);

    // Guardrails (20" polycarbonate on aluminum) along both long sides.
    const rail = b.mat(0xb7bec7, { metal: 0.7, rough: 0.35 });
    const clear = b.mat(0xd8eaff, { opacity: 0.15, rough: 0.05 });
    const t = 2 * IN;
    for (const sz of [-1, 1]) {
      b.box({ center: [0, 0.05, sz * (HW + t / 2)], size: [FIELD_L, 0.1, t], material: rail, collider: false });
      b.box({ center: [0, 0.1 + (GUARDRAIL_H - 0.1) / 2, sz * (HW + t / 2)], size: [FIELD_L, GUARDRAIL_H - 0.1, t], material: clear, shadow: false, collider: false });
      b.box({ center: [0, GUARDRAIL_H, sz * (HW + t / 2)], size: [FIELD_L, 0.03, t * 1.2], material: rail, collider: false });
      b.solid([0, 1, sz * (HW + t / 2)], [FIELD_L + 1, 2, t]);
    }
    for (const a of ['red', 'blue'] as const) this.buildAllianceSide(a);
  }

  private buildAllianceSide(a: Alliance): void {
    const b = this.b;
    const color = ALLIANCE_HEX[a];
    const sx = a === 'red' ? -1 : 1; // which end of the field
    const out = -sx; // direction from the wall into the field (+d)
    const t = 2 * IN;
    // Alliance wall: 36.8" base with 42" of glass above, driver station shelves.
    const wallX = sx * (HL + t / 2);
    b.box({ center: [wallX, DS_BASE_H / 2, 0], size: [t, DS_BASE_H, FIELD_W], color: 0x30343b, collider: false });
    b.box({ center: [wallX, DS_BASE_H + DS_GLASS_H / 2, 0], size: [t, DS_GLASS_H, FIELD_W], material: b.mat(0xd8eaff, { opacity: 0.14, rough: 0.05 }), shadow: false, collider: false });
    b.box({ center: [wallX, DS_BASE_H, 0], size: [t * 1.3, 0.05, FIELD_W], color, collider: false });
    b.solid([wallX, 1.2, 0], [t, 2.4, FIELD_W + 1]);
    for (const lat of DRIVER_LAT) {
      const [, z] = P(a, 0, lat);
      b.box({ center: [sx * (HL + 0.35), 0.95, z], size: [0.6, 0.06, 1.4], color: 0x22252a, collider: false });
    }

    // ------------------------------------------------------------ HUB
    const [hx, hz] = P(a, HUB.d, 0);
    const half = HUB.size / 2;
    const shell = b.mat(0x4a525e, { metal: 0.45, rough: 0.45 });
    const wt = 2 * IN;
    // Alliance-side face up to the 72" front rim, neutral-side face up to 80".
    b.box({ center: [hx - out * (half - wt / 2), HUB.rimFront / 2, hz], size: [wt, HUB.rimFront, HUB.size], material: shell });
    const backX = hx + out * (half - wt / 2);
    // Neutral face has the FUEL exit opening near the bottom (30"–39").
    b.box({ center: [backX, HUB.exitY / 2, hz], size: [wt, HUB.exitY, HUB.size], material: shell });
    b.box({ center: [backX, (39 * IN + HUB.rimBack) / 2, hz], size: [wt, HUB.rimBack - 39 * IN, HUB.size], material: shell });
    for (const s of [-1, 1]) {
      b.box({ center: [backX, (HUB.exitY + 39 * IN) / 2, hz + s * (HUB.size / 2 - (HUB.size - HUB.exitW) / 4)], size: [wt, 39 * IN - HUB.exitY, (HUB.size - HUB.exitW) / 2], material: shell });
    }
    // Side faces slope from the 72" front rim up to the 80" back rim.
    for (const s of [-1, 1]) {
      const z = hz + s * (half - wt / 2);
      const pts: [number, number, number][] = [];
      for (const zz of [z - wt / 2, z + wt / 2]) {
        pts.push([hx - out * half, 0, zz], [hx + out * half, 0, zz], [hx - out * half, HUB.rimFront, zz], [hx + out * half, HUB.rimBack, zz]);
      }
      b.convex(pts, 0x4a525e);
    }
    // Sloped hexagonal crown around the opening (alliance colored), and LED diffusers.
    const crown = new THREE.Mesh(
      new THREE.CylinderGeometry(HUB.hexR + 0.05, HUB.hexR, 0.08, 6, 1, true),
      new THREE.MeshStandardMaterial({ color, roughness: 0.4, side: THREE.DoubleSide, emissive: color, emissiveIntensity: 0.6 }),
    );
    crown.position.set(hx, (HUB.rimFront + HUB.rimBack) / 2 + 0.03, hz);
    crown.rotation.z = out * Math.atan2(HUB.rimBack - HUB.rimFront, HUB.size);
    b.group.add(crown);
    this.hubLights[a].push(crown);
    for (const [ox, oz, w, d] of [
      [half + 0.006, 0, 0.012, HUB.size * 0.86],
      [-half - 0.006, 0, 0.012, HUB.size * 0.86],
      [0, half + 0.006, HUB.size * 0.86, 0.012],
      [0, -half - 0.006, HUB.size * 0.86, 0.012],
    ] as const) {
      const bar = b.box({
        center: [hx + ox, (1.275 + 1.51) / 2, hz + oz],
        size: [w, 1.51 - 1.275, d],
        material: new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 1, transparent: true, opacity: 0.9 }),
        collider: false,
        shadow: false,
      });
      this.hubLights[a].push(bar);
    }
    // NET behind the HUB catches over-shots (FUEL only).
    const netX = hx + out * (half + HUB.netOut);
    const netH = HUB.netTop - HUB.netBottom;
    const net = b.box({ center: [netX, HUB.netBottom + netH / 2, hz], size: [0.01, netH, HUB.netW], material: b.mat(0x111111, { opacity: 0.25 }), collider: false, shadow: false });
    net.renderOrder = 2;
    this.ctx.world.createCollider(
      RAPIER.ColliderDesc.cuboid(0.01, netH / 2, HUB.netW / 2).setTranslation(netX, HUB.netBottom + netH / 2, hz).setCollisionGroups(groups(GROUP.FIELD, GROUP.PIECE)).setRestitution(0.05),
    );
    for (const s of [-1, 1]) b.box({ center: [netX, HUB.netTop / 2, hz + s * HUB.netW / 2], size: [0.05, HUB.netTop, 0.05], color: 0x30343b, collider: false });

    // ---------------------------------------------------- BUMPS + TRENCHES
    const d0 = HUB.d - BUMP.depth / 2;
    const d3 = HUB.d + BUMP.depth / 2;
    const ramp = 17 * IN;
    const trenchInner = HW - TRENCH.width;
    for (const side of [1, -1]) {
      // BUMP from the HUB's side face out to the TRENCH structure.
      const l0 = side * half;
      const l1 = side * trenchInner;
      const pts: [number, number, number][] = [];
      for (const [d, y] of [[d0, 0], [d0 + ramp, BUMP.height], [d3 - ramp, BUMP.height], [d3, 0]] as const) {
        for (const l of [l0, l1]) {
          const [x, z] = P(a, d, l);
          pts.push([x, y, z]);
        }
      }
      b.convex(pts, a === 'red' ? 0x6e3a3a : 0x3a4670);
      const [cx, cz] = P(a, HUB.d, (l0 + l1) / 2);
      b.box({ center: [cx, BUMP.height + 0.003, cz], size: [(BUMP.depth - 2 * ramp), 0.004, Math.abs(l1 - l0) * 0.9], color: 0xf0c419, collider: false, shadow: false });

      // TRENCH: two posts, a 3" arm at 22.25" and a top beam at 40.25".
      const postW = (TRENCH.width - TRENCH.clearWidth) / 2;
      const tMat = b.mat(0x5a6170, { metal: 0.6, rough: 0.35 });
      for (const lp of [trenchInner + postW / 2, HW - postW / 2]) {
        const [px, pz] = P(a, HUB.d, side * lp);
        b.box({ center: [px, TRENCH.height / 2, pz], size: [TRENCH.depth, TRENCH.height, postW], material: tMat });
      }
      const [ax, az] = P(a, HUB.d, side * (trenchInner + TRENCH.width / 2));
      b.box({ center: [ax, TRENCH.clearHeight + TRENCH.armThick / 2, az], size: [TRENCH.depth, TRENCH.armThick, TRENCH.clearWidth], material: tMat, collider: 'overhead' });
      b.box({ center: [ax, TRENCH.height - 1.5 * IN, az], size: [TRENCH.depth, 3 * IN, TRENCH.clearWidth], material: tMat, collider: 'overhead' });
      b.box({ center: [ax, (TRENCH.clearHeight + TRENCH.height) / 2, az], size: [TRENCH.depth * 0.96, TRENCH.height - TRENCH.clearHeight - 3 * IN, TRENCH.clearWidth * 0.98], material: b.mat(color, { opacity: 0.25 }), collider: 'overhead', shadow: false });
      b.box({ center: [ax, TRENCH.clearHeight - 0.006, az], size: [TRENCH.depth * 0.98, 0.012, TRENCH.clearWidth * 0.98], material: b.mat(0xf0c419, { emissive: 0x3a2f00 }), collider: false, shadow: false });
    }

    // ------------------------------------------------------------- TOWER
    const upright = b.mat(0x9aa3ad, { metal: 0.8, rough: 0.3 });
    const [bx, bz] = P(a, TOWER.baseD / 2, TOWER.lat);
    b.box({ center: [bx, 0.003, bz], size: [TOWER.baseD, 0.006, TOWER.baseW], material: b.mat(0x3a3f47, { metal: 0.6 }), collider: 'field' });
    for (const s of [-1, 1]) {
      const lat = TOWER.lat + s * (TOWER.uprightGap / 2 + 0.75 * IN);
      const [ux, uz] = P(a, TOWER_UPRIGHT_D, lat);
      b.box({ center: [ux, TOWER.uprightH / 2, uz], size: [3.5 * IN, TOWER.uprightH, 1.5 * IN], material: upright });
      // Diagonal support back to the wall.
      const [sx2, sz2] = P(a, TOWER_UPRIGHT_D / 2, lat);
      const brace = b.box({ center: [sx2, 0.55, sz2], size: [Math.hypot(TOWER_UPRIGHT_D, 1.0), 1.5 * IN, 1.5 * IN], material: upright, collider: false });
      brace.rotation.z = -out * Math.atan2(1.0, TOWER_UPRIGHT_D);
    }
    const rungSpan = TOWER.uprightGap + 3 * IN + 2 * TOWER.rungExt;
    for (const h of TOWER.rungs) {
      const [rx, rz] = P(a, TOWER_UPRIGHT_D, TOWER.lat);
      const rung = new THREE.Mesh(new THREE.CylinderGeometry(TOWER.rungR, TOWER.rungR, rungSpan, 16), b.mat(0xf0c419, { metal: 0.4 }));
      rung.rotation.x = Math.PI / 2;
      rung.position.set(rx, h, rz);
      rung.castShadow = true;
      b.group.add(rung);
      b.solid([rx, h, rz], [TOWER.rungR * 2, TOWER.rungR * 2, rungSpan], 'overhead');
    }
    const [tx, tz] = P(a, TOWER_UPRIGHT_D, TOWER.lat);
    b.box({ center: [tx, TOWER.uprightH, tz], size: [3.5 * IN, 2 * IN, TOWER.uprightGap + 3 * IN], material: b.mat(color), collider: false });

    // ------------------------------------------------------------- DEPOT
    const pieceAndRobot = groups(GROUP.FIELD, GROUP.PIECE | GROUP.ROBOT);
    const barrier = (d: number, lat: number, dd: number, ll: number) => {
      const [x, z] = P(a, d, lat);
      const size: [number, number, number] = [dd, DEPOT.barrierH, ll];
      const m = b.box({ center: [x, DEPOT.barrierH / 2, z], size, color, collider: false });
      m.castShadow = false;
      this.ctx.world.createCollider(RAPIER.ColliderDesc.cuboid(dd / 2, DEPOT.barrierH / 2, ll / 2).setTranslation(x, DEPOT.barrierH / 2, z).setCollisionGroups(pieceAndRobot));
    };
    barrier(DEPOT.depth + DEPOT.barrierW / 2, DEPOT.lat, DEPOT.barrierW, DEPOT.width);
    barrier(DEPOT.depth / 2, DEPOT.lat + DEPOT.width / 2, DEPOT.depth, DEPOT.barrierW);
    barrier(DEPOT.depth / 2, DEPOT.lat - DEPOT.width / 2, DEPOT.depth, DEPOT.barrierW);

    // ----------------------------------------------------------- OUTPOST
    const [ox, oz] = P(a, -0.2, OUTPOST.lat);
    b.box({ center: [ox, 1.0, oz], size: [0.4, 2.0, OUTPOST.corralW + 0.2], color: 0x3a3f47, collider: false });
    const [cx, cz] = P(a, 0.02, OUTPOST.lat);
    b.box({ center: [cx, OUTPOST.chuteY + 3.5 * IN, cz], size: [0.04, 7 * IN, OUTPOST.chuteW], material: b.mat(color, { emissive: color }), collider: false, shadow: false });
    for (const s of [-1, 1]) {
      const [wx, wz] = P(a, OUTPOST.corralD / 2, OUTPOST.lat + s * OUTPOST.corralW / 2);
      b.box({ center: [wx, OUTPOST.corralH / 2, wz], size: [OUTPOST.corralD, OUTPOST.corralH, 1 * IN], color: 0x6b7280 });
    }
  }

  // ----------------------------------------------------------------- fuel
  private addFuel(x: number, y: number, z: number, state: FuelState): void {
    const body = this.ctx.world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic().setTranslation(x, y, z).setLinearDamping(0).setAngularDamping(0.05).setCcdEnabled(true).setCanSleep(true),
    );
    this.ctx.world.createCollider(
      RAPIER.ColliderDesc.ball(FUEL_R).setMass(FUEL_MASS).setRestitution(0.45).setFriction(0.35).setCollisionGroups(PIECE_GROUPS),
      body,
    );
    if (state !== LOOSE) body.setEnabled(false);
    this.bodies.push(body);
    this.state.push(state);
  }

  private spawnFuel(): void {
    const sp = 6.1 * IN;
    // NEUTRAL ZONE: 360 FUEL staged in a block on the center line.
    for (let i = 0; i < 12; i++) for (let j = 0; j < 30; j++) {
      this.addFuel((i - 5.5) * sp, FUEL_R + 0.002, (j - 14.5) * sp, LOOSE);
    }
    for (const a of ['red', 'blue'] as const) {
      // DEPOT: 24 FUEL (4 deep x 6 wide).
      for (let i = 0; i < 4; i++) for (let j = 0; j < 6; j++) {
        const [x, z] = P(a, 3.5 * IN + i * sp, DEPOT.lat - 2.5 * sp + j * sp);
        this.addFuel(x, FUEL_R + 0.002, z, LOOSE);
      }
      // OUTPOST: 24 FUEL with the human player.
      for (let k = 0; k < REBUILT.outpostFuel; k++) {
        const [x, z] = P(a, -0.5, OUTPOST.lat + ((k % 6) - 2.5) * 0.16);
        this.addFuel(x, 0.4 + Math.floor(k / 6) * 0.17, z, RESERVE);
        this.outpostQueue[a].push(this.bodies.length - 1);
      }
    }
    for (let k = 0; k < REBUILT.maxPreload; k++) {
      this.addFuel(this.ctx.robot.x, 0.3, this.ctx.robot.z, HELD);
      this.held.push(this.bodies.length - 1);
    }
    const geo = new THREE.IcosahedronGeometry(FUEL_R, 2);
    const mat = new THREE.MeshStandardMaterial({ color: 0xf2d21b, roughness: 0.8 });
    this.fuelMesh = new THREE.InstancedMesh(geo, mat, this.bodies.length);
    this.fuelMesh.castShadow = this.ctx.settings.quality === 'high';
    this.fuelMesh.receiveShadow = true;
    this.fuelMesh.frustumCulled = false;
    this.ctx.scene.add(this.fuelMesh);
  }

  // ------------------------------------------------------------ update
  private phaseId(): RebuiltPhaseId {
    return (this.ctx.clock.phase?.id as RebuiltPhaseId) ?? 'free';
  }

  private timedHubs(): boolean {
    return this.ctx.mode === 'match' || this.ctx.mode === 'driver';
  }

  isHubActive(a: Alliance = this.me): boolean {
    if (!this.timedHubs()) return true;
    return hubActive(a, this.phaseId(), this.autoWinner);
  }

  update(dt: number, ctl: ControlState): void {
    const r = this.ctx.robot;
    const enabled = this.ctx.clock.enabled;
    const anim = r.anim;
    this.time += dt;
    this.shootCooldown -= dt;
    this.intakeCooldown -= dt;
    this.feedCooldown -= dt;
    for (const a of ['red', 'blue'] as const) if (this.isHubActive(a)) this.lastActive[a] = this.time;

    const intaking = enabled && ctl.intake && this.climb === 0;
    anim.intake = intaking ? 1 : enabled && ctl.outtake ? -1 : 0;
    anim.intakeDeploy += THREE.MathUtils.clamp((intaking || (enabled && ctl.outtake) ? 1 : 0) - anim.intakeDeploy, -3 * dt, 3 * dt);

    // Intake (once the intake is down).
    if (intaking && anim.intakeDeploy > 0.6) {
      for (let i = 0; i < this.bodies.length && this.held.length < r.cfg.capacity; i++) {
        if (this.state[i] !== LOOSE || this.intakeCooldown > 0) continue;
        const t = this.bodies[i].translation();
        if (r.inIntake(t.x, t.z, t.y, 0.3)) {
          this.state[i] = HELD;
          this.bodies[i].setEnabled(false);
          this.held.push(i);
          this.intakeCooldown = 1 / 20;
          this.ctx.intook();
        }
      }
    }

    // Outtake: spit FUEL out over the intake.
    if (enabled && ctl.outtake && this.held.length && this.shootCooldown <= 0 && anim.intakeDeploy > 0.6) {
      const i = this.held.pop()!;
      const [x, z] = r.toWorld(r.cfg.length / 2 + 0.15, (Math.random() - 0.5) * 0.3);
      const [fx, fz] = [Math.cos(r.heading), -Math.sin(r.heading)];
      this.launch(i, x, 0.2, z, r.cmd.vx + fx * 1.8, 0.4, r.cmd.vz + fz * 1.8);
      this.shootCooldown = 0.08;
    }

    // Shooter.
    const sh = r.cfg.shooter;
    const sol = (this.sol = this.solution());
    const assist = this.ctx.settings.aimAssist;
    r.aimHeading = null;
    if (sh && sol) {
      anim.hood = sol.hood;
      if (sh.turret) anim.turretYaw = wrapAngle(sol.yaw - r.heading);
      // Full assist on a chassis-aimed robot: the robot turns itself to face (or back up to) the HUB.
      if (assist === 'full' && !sh.turret && ctl.score && enabled) r.aimHeading = wrapAngle(sol.yaw - (sh.facing === 'back' ? Math.PI : 0));
    }
    anim.flywheel += ((enabled && ctl.score ? 1 : 0.25) - anim.flywheel) * Math.min(1, dt * 4);
    if (enabled && sh && ctl.score && this.held.length && this.shootCooldown <= 0 && this.climb === 0 && sol?.ok) {
      const aligned = r.aimHeading === null || Math.abs(wrapAngle(r.aimHeading - r.heading)) < deg(5);
      if (aligned) {
        const i = this.held.pop()!;
        // Real shooters scatter a little: ~1.5% speed, ~0.8° direction.
        const jitter = 1 + (Math.random() - 0.5) * 0.03;
        const yawJ = (Math.random() - 0.5) * deg(1.6);
        const c = Math.cos(yawJ);
        const s = Math.sin(yawJ);
        const vx = (sol.vx * c - sol.vz * s) * jitter;
        const vz = (sol.vx * s + sol.vz * c) * jitter;
        this.launch(i, sol.x, sol.y, sol.z, vx, sol.vy * jitter, vz);
        this.shootCooldown = 1 / sh.rate;
      }
    }

    this.fuelPhysics(dt);
    this.updateClimb(dt, ctl);
  }

  /** Air drag, carpet rolling resistance, HUB scoring and the HUB's exit. */
  private fuelPhysics(dt: number): void {
    const inner = HUB.size / 2 - 3 * IN;
    for (let i = 0; i < this.bodies.length; i++) {
      if (this.state[i] !== LOOSE) continue;
      const body = this.bodies[i];
      if (body.isSleeping()) continue;
      const t = body.translation();
      const v = body.linvel();
      const speed = Math.hypot(v.x, v.y, v.z);
      if (t.y > FUEL_R + 0.03) {
        if (speed > 0.5) {
          const k = FUEL_DRAG_K * speed * dt;
          body.setLinvel({ x: v.x - k * v.x, y: v.y - k * v.y, z: v.z - k * v.z }, true);
        }
      } else {
        const hs = Math.hypot(v.x, v.z);
        if (hs > 0.01) {
          const f = Math.max(0, hs - ROLL_DECEL * dt) / hs;
          body.setLinvel({ x: v.x * f, y: v.y, z: v.z * f }, true);
        }
      }
      for (const a of ['red', 'blue'] as const) {
        const [hx, hz] = this.hub[a];
        if (Math.abs(t.x - hx) < inner && Math.abs(t.z - hz) < inner && t.y < HUB.rimFront - 0.15 && t.y > 0.3) {
          this.onHubScore(a);
          this.state[i] = IN_HUB;
          body.setEnabled(false);
          // FUEL drops through the funnel and rolls out of the exit in single file.
          const last = this.hubQueue.filter((q) => q.a === a).reduce((m, q) => Math.max(m, q.at), this.time);
          this.hubQueue.push({ i, a, at: Math.max(this.time + 0.7, last + 0.09) });
        }
      }
      if (t.y < -1) this.launch(i, 0, 0.3, 0, 0, 0, 0);
    }
    if (this.hubQueue.length) {
      const still: typeof this.hubQueue = [];
      for (const q of this.hubQueue) {
        if (q.at > this.time) {
          still.push(q);
          continue;
        }
        const [hx, hz] = this.hub[q.a];
        const out = q.a === 'red' ? 1 : -1;
        this.launch(q.i, hx + out * (HUB.size / 2 + FUEL_R + 0.03), HUB.exitY + FUEL_R + 0.01, hz + (Math.random() - 0.5) * (HUB.exitW - 0.2), out * (1.0 + Math.random() * 0.8), 0.1, (Math.random() - 0.5) * 0.6);
      }
      this.hubQueue = still;
    }
  }

  private onHubScore(a: Alliance): void {
    if (a !== this.me) return;
    // FUEL is still assessed for up to 3 s after the HUB deactivates.
    const active = this.isHubActive(a) || this.time - this.lastActive[a] <= SCORE_GRACE;
    if (!active) {
      this.tally.inactiveFuel++;
      this.ctx.toast('HUB inactive: 0 pts', 'bad');
      return;
    }
    if (this.ctx.clock.isAuto) this.tally.autoFuel++;
    else this.tally.teleopFuel++;
    this.totalScored++;
    this.ctx.scored(1);
  }

  private launch(i: number, x: number, y: number, z: number, vx: number, vy: number, vz: number): void {
    const body = this.bodies[i];
    this.state[i] = LOOSE;
    body.setEnabled(true);
    body.setTranslation({ x, y, z }, true);
    body.setLinvel({ x: vx, y: vy, z: vz }, true);
    body.setAngvel({ x: 0, y: 0, z: 0 }, true);
  }

  /** The shot the shooter would take right now, given the aim assist. */
  private solution(): ShotSolution | null {
    const r = this.ctx.robot;
    const sh = r.cfg.shooter;
    if (!sh) return null;
    const assist = this.ctx.settings.aimAssist;
    const back = !sh.turret && sh.facing === 'back';
    // Muzzle: over the drum at the back, or at the turret.
    const [mx, mz] = r.toWorld(back ? -r.cfg.length / 2 + 0.12 : -0.05, 0);
    const my = r.mesh.position.y + sh.height;
    const [hx, hz] = this.hub[this.me];
    const dx = hx - mx;
    const dz = hz - mz;
    const dist = Math.hypot(dx, dz);
    const toHub = Math.atan2(-dz, dx);
    const chassisYaw = wrapAngle(r.heading + (back ? Math.PI : 0));
    const vel = (yaw: number, speed: number, angle: number, inherit: boolean) => ({
      vx: Math.cos(yaw) * Math.cos(angle) * speed + (inherit ? r.cmd.vx : 0),
      vy: Math.sin(angle) * speed,
      vz: -Math.sin(yaw) * Math.cos(angle) * speed + (inherit ? r.cmd.vz : 0),
    });

    if (assist === 'manual') {
      return { x: mx, y: my, z: mz, ...vel(chassisYaw, this.manualSpeed, sh.angle, true), yaw: chassisYaw, hood: sh.angle, ok: true };
    }
    const shot = solveShot(dist, HUB.aimY - my, sh.hoodMin, sh.hoodMax, sh.speedMax);
    if (!shot) return { x: mx, y: my, z: mz, ...vel(chassisYaw, sh.speedMax * 0.6, sh.angle, true), yaw: chassisYaw, hood: sh.angle, ok: false };
    if (assist === 'full') {
      // Shoot-on-the-move: lead the target by the robot's velocity over the flight time.
      const lx = hx - r.cmd.vx * shot.time;
      const lz = hz - r.cmd.vz * shot.time;
      const d2 = Math.hypot(lx - mx, lz - mz);
      const shot2 = solveShot(d2, HUB.aimY - my, sh.hoodMin, sh.hoodMax, sh.speedMax) ?? shot;
      const yaw = Math.atan2(-(lz - mz), lx - mx);
      return { x: mx, y: my, z: mz, ...vel(yaw, shot2.speed, shot2.angle, true), yaw, hood: shot2.angle, ok: true };
    }
    // 'distance': hood and speed are set from the distance, the driver points the shooter.
    void toHub;
    return { x: mx, y: my, z: mz, ...vel(chassisYaw, shot.speed, shot.angle, true), yaw: chassisYaw, hood: shot.angle, ok: true };
  }

  private updateClimb(dt: number, ctl: ControlState): void {
    const r = this.ctx.robot;
    const ph = this.ctx.clock.phase;
    const untimed = this.ctx.clock.untimed;
    const allowed = untimed || ph?.kind === 'auto' || ph?.kind === 'endgame';
    const cap = ph?.kind === 'auto' ? Math.min(1, r.cfg.maxClimb ?? 0) : (r.cfg.maxClimb ?? 0);
    const climbTime = r.cfg.climbTime ?? 2;

    if (this.descending) {
      this.climb = Math.max(0, this.climb - dt / (climbTime * 0.5));
      if (this.climb === 0) this.descending = false;
    } else if (ctl.climb && this.ctx.clock.enabled) {
      if (this.climb === 0) {
        if (cap === 0) {
          if (this.inClimbZone()) this.ctx.toast('This robot has no climber', 'info');
          return;
        }
        if (!this.inClimbZone()) return;
        if (!allowed) {
          this.ctx.toast('Climb during AUTO (L1) or END GAME', 'info');
          return;
        }
        this.ctx.toast('Climbing… hold to go higher', 'info');
      }
      const before = Math.floor(this.climb + 1e-6);
      this.climb = Math.min(cap, this.climb + dt / climbTime);
      const after = Math.floor(this.climb + 1e-6);
      if (after > before) {
        this.ctx.toast(`TOWER LEVEL ${after}`, 'good');
        this.ctx.beep('score');
      }
    }
    r.frozen = this.climb > 0;
    const rungLift = (lvl: number) => (lvl <= 0 ? 0 : Math.max(0.1, TOWER.rungs[lvl - 1] - 0.5));
    const lo = Math.floor(this.climb);
    const frac = this.climb - lo;
    r.lift = rungLift(lo) + (rungLift(Math.min(3, lo + 1)) - rungLift(lo)) * frac;
    r.anim.climb = Math.min(0.5, this.climb * 0.25 + (ctl.climb && this.inClimbZone() ? 0.15 : 0));
  }

  /** Bumpers up against the rungs, centered on the TOWER. */
  private inClimbZone(): boolean {
    const r = this.ctx.robot;
    const [tx, tz] = P(this.me, TOWER_UPRIGHT_D, TOWER.lat);
    const along = Math.abs(r.x - tx);
    const halfDepth = Math.max(r.cfg.length, r.cfg.width) / 2;
    return along < halfDepth + 0.4 && along > 0.1 && Math.abs(r.z - tz) < 0.5;
  }

  private decideAutoWinner(myAuto: number): Alliance | null {
    const other: Alliance = this.me === 'red' ? 'blue' : 'red';
    const s = this.ctx.settings.autoWinner;
    if (s === 'me') return this.me;
    if (s === 'opponent') return other;
    const opp = this.ctx.settings.opponentAutoFuel;
    if (myAuto > opp) return this.me;
    if (opp > myAuto) return other;
    return Math.random() < 0.5 ? this.me : other;
  }

  onAction(a: Action): void {
    if (a === 'shooterUp') this.manualSpeed = Math.min(18, this.manualSpeed + 0.25);
    if (a === 'shooterDown') this.manualSpeed = Math.max(3, this.manualSpeed - 0.25);
    if ((a === 'shooterUp' || a === 'shooterDown') && this.ctx.settings.aimAssist === 'manual') {
      this.ctx.toast(`Shooter ${this.manualSpeed.toFixed(2)} m/s`, 'info');
    }
    if (a === 'descore' && this.climb > 0) this.descending = true;
    if (a === 'feed') this.humanPlayerFeed();
  }

  /** The human player rolls FUEL down the CHUTE into the OUTPOST corral. */
  private humanPlayerFeed(): void {
    if (this.feedCooldown > 0) return;
    const q = this.outpostQueue[this.me];
    if (!q.length) {
      this.ctx.toast('OUTPOST is empty', 'bad');
      return;
    }
    const i = q.shift()!;
    const out = this.me === 'red' ? 1 : -1;
    const [x, z] = P(this.me, 0.06, OUTPOST.lat + (Math.random() - 0.5) * (OUTPOST.chuteW - 0.2));
    this.launch(i, x, OUTPOST.chuteY + FUEL_R, z, out * (1.4 + Math.random() * 0.5), 0.2, (Math.random() - 0.5) * 0.3);
    this.feedCooldown = 0.25;
  }

  onPhaseChange(prev: Phase | null, next: Phase | null): void {
    if (prev?.kind === 'auto') {
      this.tally.autoTower = this.climb >= 1 ? 1 : 0;
      this.autoWinner = this.decideAutoWinner(this.tally.autoFuel);
      const won = this.autoWinner === this.me;
      this.ctx.toast(won ? 'You won AUTO: your HUB is off in SHIFTS 1 & 3' : 'Opponent won AUTO: your HUB is off in SHIFTS 2 & 4', 'info');
    }
    if (next && prev && this.timedHubs()) {
      const was = hubActive(this.me, prev.id as RebuiltPhaseId, this.autoWinner);
      const now = hubActive(this.me, next.id as RebuiltPhaseId, this.autoWinner);
      if (was !== now) this.ctx.toast(now ? 'YOUR HUB IS ACTIVE' : 'HUB INACTIVE: collect FUEL', now ? 'good' : 'bad');
    }
  }

  private nextHubChange(): { seconds: number; active: boolean } | null {
    const clock = this.ctx.clock;
    if (clock.untimed || !this.timedHubs()) return null;
    const cur = this.isHubActive();
    let t = 0;
    for (const p of clock.phases) {
      const start = t;
      t += p.duration;
      if (start <= clock.elapsed || p.kind === 'break') continue;
      const act = hubActive(this.me, p.id as RebuiltPhaseId, this.autoWinner);
      if (act !== cur) return { seconds: start - clock.elapsed, active: act };
    }
    return null;
  }

  private currentLevel(): TowerLevel {
    return Math.floor(this.climb + 1e-6) as TowerLevel;
  }

  liveScore(): { mine: number; other: number; lines: ScoreLine[] } {
    const s = scoreRebuilt({ ...this.tally, endTower: this.currentLevel() });
    return { mine: s.total, other: 0, lines: [{ label: 'FUEL', value: s.fuelPoints }, { label: 'TOWER', value: s.towerPoints }] };
  }

  statusHtml(): string {
    const active = this.isHubActive();
    const next = this.nextHubChange();
    const warn = next && next.seconds <= 5 && !next.active;
    const hub = `<span class="chip big ${warn ? 'blink' : ''}" style="--c:${active ? 'var(--good)' : 'var(--bad)'}">HUB ${active ? 'ACTIVE' : 'INACTIVE'}</span>`;
    const nextTxt = next ? `<span class="hint">${next.active ? 'on' : 'off'} in ${Math.ceil(next.seconds)}s</span>` : '';
    const sh = this.ctx.robot.cfg.shooter;
    const assist = this.ctx.settings.aimAssist;
    const aim = assist === 'manual'
      ? `Manual · ${this.manualSpeed.toFixed(1)} m/s <span class="hint">[ ] / D-pad</span>`
      : assist === 'full'
        ? sh?.turret ? 'Turret auto-aim + lead' : 'Auto-align robot + lead'
        : sh?.turret ? 'Auto hood · turret locked' : `Auto hood · aim the ${sh?.facing === 'back' ? 'BACK' : 'front'}`;
    const shot = this.trajGood ? '<b style="color:var(--good)">ON TARGET</b>' : this.sol && !this.sol.ok ? '<span style="color:var(--bad)">out of range</span>' : '<span style="color:var(--muted)">off target</span>';
    const lvl = this.currentLevel();
    const cfg = this.ctx.robot.cfg;
    return `
      <div class="row">${hub}${nextTxt}</div>
      <div class="row"><span class="lbl">Shooter</span>${aim}</div>
      <div class="row"><span class="lbl">Shot</span>${shot}</div>
      <div class="row"><span class="lbl">Tower</span><b>${lvl ? `L${lvl}` : (cfg.maxClimb ?? 0) === 0 ? '<span style="color:var(--muted)">no climber</span>' : this.inClimbZone() ? '<span style="color:var(--good)">in zone: hold T / A</span>' : '—'}</b></div>
      <div class="row"><span class="lbl">Outpost</span><b>${this.outpostQueue[this.me].length}</b> <span class="hint">B: human player</span></div>`;
  }

  cargoHtml(): string {
    const cap = this.ctx.robot.cfg.capacity;
    const n = this.held.length;
    return `<div class="fuelbar"><div style="width:${(n / cap) * 100}%"></div></div><span class="fuelcount">${n} / ${cap} FUEL</span>`;
  }

  piecesScored(): number {
    return this.totalScored;
  }

  render(): void {
    for (let i = 0; i < this.bodies.length; i++) {
      if (this.state[i] === LOOSE) {
        const t = this.bodies[i].translation();
        this.matrix.makeTranslation(t.x, t.y, t.z);
        this.fuelMesh.setMatrixAt(i, this.matrix);
      } else {
        this.fuelMesh.setMatrixAt(i, this.hidden);
      }
    }
    this.fuelMesh.instanceMatrix.needsUpdate = true;
    const tt = performance.now() / 1000;
    for (const a of ['red', 'blue'] as const) {
      let on = this.timedHubs() ? hubActive(a, this.phaseId(), this.autoWinner) : true;
      if (a === this.me) {
        const next = this.nextHubChange();
        if (on && next && !next.active && next.seconds < 3) on = Math.sin(tt * 18) > 0;
      }
      for (const m of this.hubLights[a]) (m.material as THREE.MeshStandardMaterial).emissiveIntensity = on ? 1.2 : 0.04;
    }
    this.updateTrajectory();
  }

  private updateTrajectory(): void {
    const sol = this.sol;
    const show = this.ctx.settings.showTrajectory && this.held.length > 0 && this.climb === 0 && !!sol;
    this.trajLine.visible = show;
    this.trajGood = false;
    if (!sol) return;
    const [hx, hz] = this.hub[this.me];
    const pos = this.trajLine.geometry.attributes.position as THREE.BufferAttribute;
    const n = pos.count;
    let { x, y, z, vx, vy, vz } = sol;
    const dt = 1 / 60;
    let k = 0;
    for (let step = 0; step < 240 && k < n; step++) {
      const sp = Math.hypot(vx, vy, vz);
      vx -= FUEL_DRAG_K * sp * vx * dt;
      vy -= (9.81 + FUEL_DRAG_K * sp * vy) * dt;
      vz -= FUEL_DRAG_K * sp * vz * dt;
      const ny = y + vy * dt;
      if (y >= HUB.rimFront && ny < HUB.rimFront && Math.hypot(x - hx, z - hz) < HUB.hexR * 0.9) this.trajGood = true;
      x += vx * dt;
      y = ny;
      z += vz * dt;
      if (step % 4 === 0) pos.setXYZ(k++, x, Math.max(0, y), z);
      if (y < 0) break;
    }
    for (; k < n; k++) pos.setXYZ(k, x, Math.max(0, y), z);
    pos.needsUpdate = true;
    this.trajLine.computeLineDistances();
    (this.trajLine.material as THREE.LineDashedMaterial).color.setHex(this.trajGood ? 0x7dff8a : 0xff8a7d);
  }

  finalize(): MatchSummary {
    this.tally.endTower = this.currentLevel();
    const s = scoreRebuilt(this.tally);
    const lines: ScoreLine[] = [
      { label: 'AUTO FUEL', value: this.tally.autoFuel },
      { label: 'TELEOP FUEL', value: this.tally.teleopFuel },
      { label: 'FUEL into inactive HUB (0 pts)', value: this.tally.inactiveFuel },
    ];
    if (this.ctx.mode === 'match') lines.push({ label: 'AUTO TOWER (L1) pts', value: towerPoints(this.tally.autoTower, true) });
    lines.push({ label: `END TOWER (L${this.tally.endTower}) pts`, value: towerPoints(this.tally.endTower, false) });
    const notes: string[] = [];
    if (this.timedHubs()) {
      notes.push(
        `Ranking points (solo): ENERGIZED ${s.energizedRP ? '✔' : '✘'} (${REBUILT.rp.energizedFuel} FUEL), SUPERCHARGED ${s.superchargedRP ? '✔' : '✘'} (${REBUILT.rp.superchargedFuel}), TRAVERSAL ${s.traversalRP ? '✔' : '✘'} (${REBUILT.rp.traversalTowerPoints} TOWER pts).`,
      );
    }
    if (this.tally.inactiveFuel > 0) notes.push(`${this.tally.inactiveFuel} FUEL went into an inactive HUB. Use those shifts to collect FUEL instead.`);
    return { total: s.total, lines, notes };
  }

  footprints(): Footprint[] {
    const out: Footprint[] = [];
    const rect = (a: Alliance, d: number, lat: number, dd: number, ll: number, color: string) => {
      const [x, z] = P(a, d, lat);
      out.push({ x, z, w: dd, d: ll, color });
    };
    for (const a of ['red', 'blue'] as const) {
      const c = a === 'red' ? '#d92b2b' : '#1f5fd6';
      rect(a, HUB.d, 0, HUB.size, HUB.size, c);
      for (const s of [1, -1]) {
        rect(a, HUB.d, s * (HUB.size / 2 + (HW - TRENCH.width - HUB.size / 2) / 2), BUMP.depth, HW - TRENCH.width - HUB.size / 2, 'rgba(240,196,25,0.45)');
        rect(a, HUB.d, s * (HW - TRENCH.width / 2), TRENCH.depth, TRENCH.width, 'rgba(120,120,140,0.4)');
      }
      rect(a, TOWER.baseD / 2, TOWER.lat, TOWER.baseD, TOWER.baseW, '#f0c419');
      rect(a, DEPOT.depth / 2, DEPOT.lat, DEPOT.depth, DEPOT.width, 'rgba(255,255,255,0.25)');
      rect(a, OUTPOST.corralD / 2, OUTPOST.lat, OUTPOST.corralD, OUTPOST.corralW, 'rgba(160,160,170,0.3)');
    }
    return out;
  }

  dispose(): void {
    this.fuelMesh.geometry.dispose();
    (this.fuelMesh.material as THREE.Material).dispose();
    this.trajLine.geometry.dispose();
  }
}

function startPoses(alliance: Alliance): StartPose[] {
  const d = ZONE - 0.55; // bumpers on the ROBOT STARTING LINE
  const lanes: [string, number][] = [
    ['Left TRENCH lane', HW - TRENCH.width / 2],
    ['Center (facing the HUB)', 0],
    ['Right TRENCH lane', -(HW - TRENCH.width / 2)],
  ];
  return lanes.map(([label, lat]) => {
    const [x, z] = P(alliance, d, lat);
    return { label, x, z, heading: alliance === 'red' ? 0 : Math.PI };
  });
}

function phases(mode: ModeId): Phase[] {
  const teleop: Phase[] = [
    { id: 'transition', label: 'TRANSITION', kind: 'teleop', duration: REBUILT.transitionSeconds, period: 'teleop' },
    { id: 'shift1', label: 'SHIFT 1', kind: 'teleop', duration: REBUILT.shiftSeconds, period: 'teleop' },
    { id: 'shift2', label: 'SHIFT 2', kind: 'teleop', duration: REBUILT.shiftSeconds, period: 'teleop' },
    { id: 'shift3', label: 'SHIFT 3', kind: 'teleop', duration: REBUILT.shiftSeconds, period: 'teleop' },
    { id: 'shift4', label: 'SHIFT 4', kind: 'teleop', duration: REBUILT.shiftSeconds, period: 'teleop' },
    { id: 'endgame', label: 'END GAME', kind: 'endgame', duration: REBUILT.endgameSeconds, period: 'teleop' },
  ];
  switch (mode) {
    case 'match':
      return [
        { id: 'auto', label: 'AUTO', kind: 'auto', duration: REBUILT.autoSeconds, period: 'auto' },
        { id: 'break', label: 'DISABLED', kind: 'break', duration: 3, period: 'break' },
        ...teleop,
      ];
    case 'driver':
      return teleop;
    default:
      return [];
  }
}

export const RebuiltGame: GameDef = {
  id: 'rebuilt',
  name: 'REBUILT',
  program: 'FIRST Robotics Competition',
  season: '2026',
  blurb: '54′ field. Shoot FUEL into your HUB while it is active, go over BUMPS or under TRENCHES, and climb the TOWER. Drive real 2026 robots like 2910, 4414 and 1678.',
  fieldX: FIELD_L,
  fieldZ: FIELD_W,
  presets: PRESETS,
  modes: [
    { id: 'match', label: 'Full match', description: '0:20 AUTO (drive it to rehearse) + 2:20 TELEOP with alternating HUB shifts and a 0:30 END GAME.' },
    { id: 'driver', label: 'TELEOP only', description: '2:20 TELEOP with HUB shifts. The AUTO winner comes from the settings.' },
    { id: 'sprint', label: 'Scoring sprint', description: 'Score 40 FUEL as fast as you can (HUB always active).' },
    { id: 'gates', label: 'Gate course', description: 'Lap the field through TRENCHES and over BUMPS.' },
    { id: 'free', label: 'Free practice', description: 'No clock. HUB always active.' },
  ],
  stations: (['red', 'blue'] as const).flatMap((a) =>
    DRIVER_LAT.map((lat, n) => {
      const [ex, ez] = P(a, -0.65, lat);
      const [tx, tz] = P(a, HL * 0.95, lat * 0.25);
      return {
        id: `${a}-${n + 1}`,
        label: `${a === 'red' ? 'Red' : 'Blue'} ${n + 1}`,
        alliance: a,
        eye: [ex, 1.8, ez] as [number, number, number],
        target: [tx, 0, tz] as [number, number, number],
        yaw: a === 'red' ? 0 : Math.PI,
      };
    }),
  ),
  startPoses,
  phases,
  gates(): Gate[] {
    // A lap: under your left TRENCH, along the field, over the far BUMP, round the far
    // alliance zone, back under the far right TRENCH and over your own BUMP home.
    const trenchLat = HW - TRENCH.width / 2;
    const bumpLat = HUB.size / 2 + (HW - TRENCH.width - HUB.size / 2) / 2;
    const g = (d: number, lat: number, along: boolean, w: number): Gate => {
      const [x, z] = P('red', d, lat);
      return { x, z, yaw: along ? Math.PI / 2 : 0, width: w };
    };
    return [
      g(HUB.d, trenchLat, true, 1.2),
      g(HL, trenchLat, true, 1.2),
      g(FIELD_L - HUB.d, bumpLat, true, 1.4),
      g(FIELD_L - 1.8, 0, false, 2.0),
      g(FIELD_L - HUB.d, -trenchLat, true, 1.2),
      g(HL, -trenchLat, true, 1.2),
      g(HUB.d, -bumpLat, true, 1.4),
      g(1.8, 0, false, 2.0),
    ];
  },
  sprint: { count: 40, label: 'FUEL scored' },
  create: (ctx) => new RebuiltRuntime(ctx),
  notes: [
    'From the 2026 game manual (Section 5, ARENA) and the official field CAD / AprilTag layout: the 651.2″×317.7″ field, 158.6″ alliance zones, 47″ HUBs with a sloped opening (72″ front rim, 80″ back rim), the exit in the HUB’s neutral face and the NET behind it, 73″×44.4″×6.5″ BUMPS, 65.65″ TRENCHES with 22.25″ clearance, the TOWER (rungs at 27/45/63″), DEPOT and OUTPOST positions, alliance wall heights and driver station positions, 504 FUEL (5.91″, 0.215 kg), match timing, HUB shifts (with the 3 s grace period) and point values.',
    'Robots are modeled on the teams’ published 2026 specs and CAD (frame size, height, top speed, hopper size, shot rate, turret or fixed shooter, climber); capacities marked “estimated” weren’t published. FUEL flies with air drag and rolls with carpet resistance.',
    'APPROXIMATIONS: the FUEL staging in the neutral zone, the inside of the HUB (FUEL is counted when it drops in and rolls out of the exit after ~0.7 s), and robot mechanisms simplified to buttons.',
  ],
};
