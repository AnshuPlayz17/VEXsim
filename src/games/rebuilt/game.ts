import * as THREE from 'three';
import { RAPIER, PIECE_GROUPS, groups, GROUP } from '../../core/physics';
import { FieldBuilder, canvasTexture } from '../../core/builder';
import { IN } from '../../core/units';
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
import { REBUILT, type RebuiltPhaseId, type TowerLevel, hubActive, launchSpeedFor, scoreRebuilt, towerPoints } from './rules';

// Field geometry, inches (origin at field center, X along the length, red wall at -X).
const HL = 651.2 / 2;
const HW = 317.7 / 2;
const ZONE = 158.6;
const HUB = 47;
const HUB_NEAR = -HL + ZONE; // red hub near face
const HUB_X = HUB_NEAR + HUB / 2;
const BUMP_W = 73;
const BUMP_H = 6.513;
const TRENCH_CLEAR = 22.25;
const HUB_TOP = 72;
const FUEL_R = (5.91 / 2) * IN;
const TOWER_Z = -50;
const TOWER_SPAN = 40;
const TOWER_X_OFF = 28;
const RUNGS = [27, 45, 63];
const DEPOT_Z = 80;
const OUTPOST_Z = -138;

const ALLIANCE_HEX: Record<Alliance, number> = { red: 0xd92b2b, blue: 0x1f5fd6 };

/** Mirror a red-side point to an alliance (180° rotation about the field center). */
function side(alliance: Alliance, x: number, z: number): [number, number] {
  return alliance === 'red' ? [x * IN, z * IN] : [-x * IN, -z * IN];
}

const deg = (d: number) => (d * Math.PI) / 180;

const PRESETS: RobotConfig[] = [
  {
    id: 'frc-swerve',
    name: 'Swerve turret shooter',
    description: 'Low (21.7") so it fits under the TRENCH. Turret, deep hopper, L3 climber.',
    length: 0.84, width: 0.84, height: 0.55,
    drive: 'swerve',
    params: { maxSpeed: 4.6, maxAccel: 9, maxDecel: 13, maxTurnRate: 11, maxTurnAccel: 45, trackWidth: 0.6 },
    capacity: 45, intakeWidth: 0.7, intakeReach: 0.16,
    shooter: { rate: 9, angle: deg(65), turret: true },
    climbTime: 1.4, maxClimb: 3, style: 'frc',
  },
  {
    id: 'frc-tank',
    name: 'KitBot tank',
    description: 'Simple tank drive with a fixed shooter. Aim with the whole robot. L1 climb only.',
    length: 0.8, width: 0.72, height: 0.52,
    drive: 'tank',
    params: { maxSpeed: 3.7, maxAccel: 7, maxDecel: 10, maxTurnRate: 8.5, maxTurnAccel: 35, trackWidth: 0.55 },
    capacity: 25, intakeWidth: 0.55, intakeReach: 0.14,
    shooter: { rate: 4, angle: deg(55), turret: false },
    climbTime: 2.5, maxClimb: 1, style: 'frc',
  },
  {
    id: 'frc-tall',
    name: 'Tall hopper swerve',
    description: 'Huge hopper and fast shooter, but at 37" it can NOT drive under the TRENCH. Use the BUMPs.',
    length: 0.86, width: 0.86, height: 0.95,
    drive: 'swerve',
    params: { maxSpeed: 4.2, maxAccel: 8, maxDecel: 12, maxTurnRate: 10, maxTurnAccel: 40, trackWidth: 0.6 },
    capacity: 70, intakeWidth: 0.72, intakeReach: 0.16,
    shooter: { rate: 11, angle: deg(65), turret: true },
    climbTime: 1.6, maxClimb: 3, style: 'frc',
  },
  {
    id: 'frc-mecanum',
    name: 'Mecanum shooter',
    description: 'Holonomic without swerve complexity. Fixed shooter, L2 climber.',
    length: 0.8, width: 0.8, height: 0.53,
    drive: 'xdrive',
    params: { maxSpeed: 3.9, maxAccel: 7.5, maxDecel: 11, maxTurnRate: 9, maxTurnAccel: 38, trackWidth: 0.55 },
    capacity: 35, intakeWidth: 0.62, intakeReach: 0.14,
    shooter: { rate: 6, angle: deg(60), turret: false },
    climbTime: 2, maxClimb: 2, style: 'frc',
  },
];

type FuelState = 0 | 1 | 2; // loose | held | reserve (waiting in an OUTPOST)
const LOOSE = 0;
const HELD = 1;
const RESERVE = 2;

class RebuiltRuntime implements GameRuntime {
  private b: FieldBuilder;
  private bodies: RAPIER.RigidBody[] = [];
  private state: FuelState[] = [];
  private fuelMesh!: THREE.InstancedMesh;
  private held: number[] = [];
  private outpostQueue: Record<Alliance, number[]> = { red: [], blue: [] };
  private hubLights: Record<Alliance, THREE.Mesh[]> = { red: [], blue: [] };
  private readonly me: Alliance;
  private readonly hubPos: [number, number];
  private tally = { autoFuel: 0, teleopFuel: 0, inactiveFuel: 0, autoTower: 0 as TowerLevel, endTower: 0 as TowerLevel };
  private autoWinner: Alliance | null = null;
  private shootCooldown = 0;
  private intakeCooldown = 0;
  private feedCooldown = 0;
  private manualSpeed = 9;
  private climb = 0;
  private descending = false;
  private trajLine: THREE.Line;
  private trajGood = false;
  private totalScored = 0;
  private matrix = new THREE.Matrix4();
  private hidden = new THREE.Matrix4().makeScale(0, 0, 0);

  constructor(private ctx: GameContext) {
    this.me = ctx.robot.alliance;
    this.hubPos = side(this.me, HUB_X, 0);
    this.b = new FieldBuilder(ctx.world, ctx.scene);
    this.buildField();
    this.spawnFuel();
    const geo = new THREE.BufferGeometry().setFromPoints(new Array(48).fill(0).map(() => new THREE.Vector3()));
    this.trajLine = new THREE.Line(geo, new THREE.LineDashedMaterial({ color: 0x9cff9c, dashSize: 0.12, gapSize: 0.08, transparent: true, opacity: 0.85 }));
    this.trajLine.frustumCulled = false;
    ctx.scene.add(this.trajLine);
    // Driver mode starts in TELEOP, so the AUTO result comes from settings.
    if (ctx.mode === 'driver') this.autoWinner = this.decideAutoWinner(0);
  }

  // ---------------------------------------------------------------- field
  private buildField(): void {
    const b = this.b;
    const L = HL * 2 * IN;
    const W = HW * 2 * IN;
    b.floor(L, W);
    const carpet = canvasTexture(2048, 1000, (g, w, h) => {
      g.fillStyle = '#4d5157';
      g.fillRect(0, 0, w, h);
      for (let i = 0; i < 9000; i++) {
        const v = 70 + Math.random() * 20;
        g.fillStyle = `rgba(${v},${v + 2},${v + 6},0.35)`;
        g.fillRect(Math.random() * w, Math.random() * h, 3, 3);
      }
      const X = (xin: number) => ((xin + HL) / (HL * 2)) * w;
      const Z = (zin: number) => ((zin + HW) / (HW * 2)) * h;
      const tape = (x1: number, z1: number, x2: number, z2: number, color: string, width = 2) => {
        g.strokeStyle = color;
        g.lineWidth = (width / (HL * 2)) * w;
        g.beginPath();
        g.moveTo(X(x1), Z(z1));
        g.lineTo(X(x2), Z(z2));
        g.stroke();
      };
      tape(0, -HW, 0, HW, '#f5f5f5');
      // Robot starting lines (alliance zone boundary).
      tape(HUB_NEAR, -HW, HUB_NEAR, HW, '#e04848');
      tape(-HUB_NEAR, -HW, -HUB_NEAR, HW, '#3b7bf0');
      // Alliance zone tint.
      g.fillStyle = 'rgba(217,43,43,0.10)';
      g.fillRect(0, 0, X(HUB_NEAR), h);
      g.fillStyle = 'rgba(31,95,214,0.10)';
      g.fillRect(X(-HUB_NEAR), 0, w - X(-HUB_NEAR), h);
    });
    b.decal(carpet, L, W);

    // Guardrails (long sides) and alliance walls.
    const rail = b.mat(0xb7bec7, { metal: 0.7, rough: 0.35 });
    const clear = b.mat(0xd8eaff, { opacity: 0.16, rough: 0.05 });
    const t = 2 * IN;
    for (const sz of [-1, 1]) {
      b.box({ center: [0, 0.1, sz * (W / 2 + t / 2)], size: [L, 0.2, t], material: rail, collider: false });
      b.box({ center: [0, 0.2 + 0.15, sz * (W / 2 + t / 2)], size: [L, 0.3, t], material: clear, shadow: false, collider: false });
      b.solid([0, 1, sz * (W / 2 + t / 2)], [L + 1, 2, t]);
    }
    for (const a of ['red', 'blue'] as const) {
      const sx = a === 'red' ? -1 : 1;
      const color = ALLIANCE_HEX[a];
      b.box({ center: [sx * (L / 2 + t / 2), 0.45, 0], size: [t, 0.9, W], color: 0x2b2f36, collider: false });
      b.box({ center: [sx * (L / 2 + t / 2), 0.9 + 0.5, 0], size: [t, 1.0, W], material: clear, shadow: false, collider: false });
      b.box({ center: [sx * (L / 2 + t / 2), 0.88, 0], size: [t * 1.2, 0.04, W], color, collider: false });
      b.solid([sx * (L / 2 + t / 2), 1, 0], [t, 2, W + 1]);
    }

    for (const a of ['red', 'blue'] as const) this.buildAllianceSide(a);
  }

  private buildAllianceSide(a: Alliance): void {
    const b = this.b;
    const color = ALLIANCE_HEX[a];
    const P = (x: number, z: number): [number, number] => side(a, x, z);

    // HUB: hollow box, open top at 72". FUEL that drops inside is counted and fed back out.
    const [hx, hz] = P(HUB_X, 0);
    const half = (HUB / 2) * IN;
    const wt = 2 * IN;
    const top = HUB_TOP * IN;
    const shell = b.mat(0x4a525e, { metal: 0.45, rough: 0.45 });
    for (const [ox, oz, w, d] of [
      [half - wt / 2, 0, wt, HUB * IN],
      [-half + wt / 2, 0, wt, HUB * IN],
      [0, half - wt / 2, HUB * IN, wt],
      [0, -half + wt / 2, HUB * IN, wt],
    ] as const) {
      b.box({ center: [hx + ox, top / 2, hz + oz], size: [w, top, d], material: shell });
    }
    // Funnel lip and hex crown.
    const crown = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.53, 0.12, 6, 1, true), b.mat(color, { rough: 0.4 }));
    crown.position.set(hx, top + 0.06, hz);
    crown.material = new THREE.MeshStandardMaterial({ color, roughness: 0.4, side: THREE.DoubleSide, emissive: color, emissiveIntensity: 0.6 });
    b.group.add(crown);
    this.hubLights[a].push(crown);
    // Light bars on each face.
    for (const [ox, oz, w, d] of [
      [half + 0.005, 0, 0.01, HUB * IN * 0.8],
      [-half - 0.005, 0, 0.01, HUB * IN * 0.8],
      [0, half + 0.005, HUB * IN * 0.8, 0.01],
      [0, -half - 0.005, HUB * IN * 0.8, 0.01],
    ] as const) {
      const bar = b.box({
        center: [hx + ox, top - 0.12, hz + oz],
        size: [w, 0.06, d],
        material: new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 1 }),
        collider: false,
        shadow: false,
      });
      this.hubLights[a].push(bar);
    }
    // BUMPS beside the hub (ramped, 6.5" tall).
    const x0 = HUB_NEAR;
    const x3 = HUB_NEAR + HUB;
    const x1 = x0 + 17;
    const x2 = x3 - 17;
    for (const zs of [1, -1]) {
      const z0 = zs * (HUB / 2);
      const z1 = zs * (HUB / 2 + BUMP_W);
      const pts: [number, number, number][] = [];
      for (const [x, y] of [[x0, 0], [x1, BUMP_H], [x2, BUMP_H], [x3, 0]] as const) {
        for (const z of [z0, z1]) {
          const [wx, wz] = P(x, z);
          pts.push([wx, y * IN, wz]);
        }
      }
      b.convex(pts, a === 'red' ? 0x7a3a3a : 0x3a4a7a);
      // Tread stripes.
      const [cx, cz] = P(HUB_X, zs * (HUB / 2 + BUMP_W / 2));
      b.box({ center: [cx, BUMP_H * IN + 0.003, cz], size: [((x2 - x1) * IN), 0.004, BUMP_W * IN * 0.9], color: 0xf0c419, collider: false, shadow: false });

      // TRENCH: overhead arm at 22.25" between the bump and the guardrail.
      const tz0 = zs * (HUB / 2 + BUMP_W);
      const tz1 = zs * HW;
      const [ax, az] = P(HUB_X, (tz0 + tz1) / 2);
      const armT = 4 * IN;
      const tw = Math.abs(tz1 - tz0) * IN;
      b.box({
        center: [ax, TRENCH_CLEAR * IN + armT / 2, az],
        size: [HUB * IN, armT, tw],
        material: b.mat(0x5a6170, { metal: 0.6, rough: 0.35 }),
        collider: 'overhead',
      });
      b.box({
        center: [ax, TRENCH_CLEAR * IN - 0.01, az],
        size: [HUB * IN * 0.98, 0.02, tw * 0.98],
        material: b.mat(color, { emissive: color }),
        collider: false,
        shadow: false,
      });
      // Divider post between bump and trench.
      const [px, pz] = P(HUB_X, tz0);
      b.box({ center: [px, ((TRENCH_CLEAR + 4) * IN) / 2, pz], size: [HUB * IN, (TRENCH_CLEAR + 4) * IN, 2 * IN], color: 0x3a3f47 });
    }

    // TOWER against the alliance wall: two uprights and three rungs.
    const towerX = -HL + TOWER_X_OFF;
    const uprightMat = b.mat(0x9aa3ad, { metal: 0.8, rough: 0.3 });
    for (const dz of [-TOWER_SPAN / 2, TOWER_SPAN / 2]) {
      const [ux, uz] = P(towerX, TOWER_Z + dz);
      b.box({ center: [ux, 0.9, uz], size: [3 * IN, 1.8, 3 * IN], material: uprightMat });
      const [bx, bz] = P(-HL + TOWER_X_OFF / 2, TOWER_Z + dz);
      b.box({ center: [bx, 0.05, bz], size: [TOWER_X_OFF * IN, 0.1, 3 * IN], material: uprightMat });
    }
    for (const h of RUNGS) {
      const [rx, rz] = P(towerX, TOWER_Z);
      const rung = new THREE.Mesh(new THREE.CylinderGeometry(0.83 * IN, 0.83 * IN, TOWER_SPAN * IN, 16), b.mat(0xf0c419, { metal: 0.4 }));
      rung.rotation.x = Math.PI / 2;
      rung.position.set(rx, h * IN, rz);
      rung.castShadow = true;
      b.group.add(rung);
      b.solid([rx, h * IN, rz], [1.66 * IN, 1.66 * IN, TOWER_SPAN * IN], 'overhead');
    }
    const [tpx, tpz] = P(towerX, TOWER_Z);
    b.box({ center: [tpx, 1.8 + 0.03, tpz], size: [4 * IN, 0.06, (TOWER_SPAN + 3) * IN], material: b.mat(color), collider: false });

    // DEPOT: low border holds FUEL; robots drive over it.
    const dx0 = -HL;
    const dx1 = -HL + 27;
    const dz0 = DEPOT_Z - 21;
    const dz1 = DEPOT_Z + 21;
    const pieceOnly = groups(GROUP.FIELD, GROUP.PIECE);
    const border = (xa: number, za: number, xb: number, zb: number) => {
      const [ax, az] = P(xa, za);
      const [bx, bz] = P(xb, zb);
      const cx = (ax + bx) / 2;
      const cz = (az + bz) / 2;
      const w = Math.max(Math.abs(bx - ax), 1 * IN);
      const d = Math.max(Math.abs(bz - az), 1 * IN);
      const mesh = b.box({ center: [cx, 0.02, cz], size: [w, 0.04, d], color, collider: false });
      mesh.castShadow = false;
      this.ctx.world.createCollider(
        RAPIER.ColliderDesc.cuboid(w / 2, 0.06, d / 2).setTranslation(cx, 0.06, cz).setCollisionGroups(pieceOnly),
      );
    };
    border(dx1, dz0, dx1, dz1);
    border(dx0, dz0, dx1, dz0);
    border(dx0, dz1, dx1, dz1);

    // OUTPOST + CHUTE in the corner: the human player feeds FUEL from here.
    const [ox, oz] = P(-HL - 8, OUTPOST_Z);
    b.box({ center: [ox, 0.6, oz], size: [16 * IN, 1.2, 40 * IN], color: 0x3a3f47, collider: false });
    const [cx, cz] = P(-HL + 1, OUTPOST_Z);
    b.box({ center: [cx, 0.55, cz], size: [3 * IN, 0.12, 14 * IN], material: b.mat(color, { emissive: color }), collider: false, shadow: false });
  }

  // ----------------------------------------------------------------- fuel
  private addFuel(x: number, y: number, z: number, state: FuelState): void {
    const body = this.ctx.world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(x, y, z)
        .setLinearDamping(0.05)
        .setAngularDamping(1.5)
        .setCcdEnabled(true)
        .setCanSleep(true),
    );
    this.ctx.world.createCollider(
      RAPIER.ColliderDesc.ball(FUEL_R).setMass(0.23).setRestitution(0.35).setFriction(0.7).setCollisionGroups(PIECE_GROUPS),
      body,
    );
    if (state !== LOOSE) body.setEnabled(false);
    this.bodies.push(body);
    this.state.push(state);
  }

  private spawnFuel(): void {
    const sp = 6.15;
    // NEUTRAL ZONE: 360 FUEL in a 12 x 30 block on the center line.
    for (let i = 0; i < 12; i++) for (let j = 0; j < 30; j++) {
      this.addFuel((i - 5.5) * sp * IN, FUEL_R + 0.002, (j - 14.5) * sp * IN, LOOSE);
    }
    // DEPOTS: 24 each.
    for (const a of ['red', 'blue'] as const) {
      for (let i = 0; i < 4; i++) for (let j = 0; j < 6; j++) {
        const [x, z] = side(a, -HL + 4 + i * sp, DEPOT_Z - 15.4 + j * sp);
        this.addFuel(x, FUEL_R + 0.002, z, LOOSE);
      }
      // OUTPOSTS: 24 each, held by the human player.
      for (let k = 0; k < REBUILT.outpostFuel; k++) {
        const [x, z] = side(a, -HL - 20, OUTPOST_Z + (k % 6) * 3);
        this.addFuel(x, 0.5 + Math.floor(k / 6) * 0.2, z, RESERVE);
        this.outpostQueue[a].push(this.bodies.length - 1);
      }
    }
    // Preload.
    for (let k = 0; k < REBUILT.maxPreload; k++) {
      this.addFuel(this.ctx.robot.x, 0.3, this.ctx.robot.z, HELD);
      this.held.push(this.bodies.length - 1);
    }
    const geo = new THREE.IcosahedronGeometry(FUEL_R, 2);
    const mat = new THREE.MeshStandardMaterial({ color: 0xf2d21b, roughness: 0.75 });
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

  isHubActive(a: Alliance = this.me): boolean {
    if (this.ctx.mode !== 'match' && this.ctx.mode !== 'driver') return true;
    return hubActive(a, this.phaseId(), this.autoWinner);
  }

  update(dt: number, ctl: ControlState): void {
    const r = this.ctx.robot;
    const enabled = this.ctx.clock.enabled;
    this.shootCooldown -= dt;
    this.intakeCooldown -= dt;
    this.feedCooldown -= dt;
    r.intakeSpin = enabled && ctl.intake && this.climb === 0 ? 1 : 0;

    // Intake.
    if (enabled && ctl.intake && this.climb === 0) {
      for (let i = 0; i < this.bodies.length && this.held.length < r.cfg.capacity; i++) {
        if (this.state[i] !== LOOSE || this.intakeCooldown > 0) continue;
        const t = this.bodies[i].translation();
        if (r.inIntake(t.x, t.z, t.y, 0.28)) {
          this.state[i] = HELD;
          this.bodies[i].setEnabled(false);
          this.held.push(i);
          this.intakeCooldown = 1 / 14;
          this.ctx.intook();
        }
      }
    }

    // Outtake: dump FUEL out the front.
    if (enabled && ctl.outtake && this.held.length && this.shootCooldown <= 0) {
      const i = this.held.pop()!;
      const [x, z] = r.toWorld(r.cfg.length / 2 + 0.12, (Math.random() - 0.5) * 0.3);
      const [fx, fz] = [Math.cos(r.heading), -Math.sin(r.heading)];
      this.launch(i, x, 0.2, z, r.cmd.vx + fx * 1.5, 0.5, r.cmd.vz + fz * 1.5);
      this.shootCooldown = 0.06;
    }

    // Shooter.
    const sh = r.cfg.shooter;
    if (enabled && sh && ctl.score && this.held.length && this.shootCooldown <= 0 && this.climb === 0) {
      const sol = this.solution();
      if (sol) {
        const i = this.held.pop()!;
        this.launch(i, sol.x, sol.y, sol.z, sol.vx + (Math.random() - 0.5) * 0.12, sol.vy + (Math.random() - 0.5) * 0.12, sol.vz + (Math.random() - 0.5) * 0.12);
        this.shootCooldown = 1 / sh.rate;
      }
    }

    // Hub scoring: FUEL inside a hub below the rim is counted, then fed back to the neutral zone.
    for (const a of ['red', 'blue'] as const) {
      const [hx, hz] = side(a, HUB_X, 0);
      const inner = (HUB / 2 - 2) * IN;
      for (let i = 0; i < this.bodies.length; i++) {
        if (this.state[i] !== LOOSE) continue;
        const t = this.bodies[i].translation();
        if (Math.abs(t.x - hx) < inner && Math.abs(t.z - hz) < inner && t.y < HUB_TOP * IN - 0.25 && t.y > 0.05) {
          this.onHubScore(a);
          const out = a === 'red' ? 1 : -1;
          const ex = hx + out * (HUB / 2 + 6) * IN;
          const ez = hz + (Math.random() - 0.5) * 0.8;
          this.launch(i, ex, 0.15, ez, out * (1 + Math.random() * 1.5), 0.2, (Math.random() - 0.5) * 1.2);
        }
        if (t.y < -1) this.launch(i, 0, 0.3, 0, 0, 0, 0);
      }
    }

    this.updateClimb(dt, ctl);
  }

  private onHubScore(a: Alliance): void {
    if (a !== this.me) return;
    const active = this.isHubActive(a);
    const auto = this.ctx.clock.isAuto;
    if (!active) {
      this.tally.inactiveFuel++;
      this.ctx.toast('HUB inactive: 0 pts', 'bad');
      return;
    }
    if (auto) this.tally.autoFuel++;
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

  /** Current shot: muzzle position and launch velocity, depending on the aim assist. */
  private solution(): { x: number; y: number; z: number; vx: number; vy: number; vz: number } | null {
    const r = this.ctx.robot;
    const sh = r.cfg.shooter;
    if (!sh) return null;
    const assist = this.ctx.settings.aimAssist;
    const [mx, mz] = r.toWorld(-0.05, 0);
    const my = r.mesh.position.y + r.cfg.height + 0.1;
    const [hx, hz] = this.hubPos;
    const dx = hx - mx;
    const dz = hz - mz;
    const dist = Math.hypot(dx, dz);
    const dy = HUB_TOP * IN + 0.25 - my;
    const heading: [number, number] = [Math.cos(r.heading), -Math.sin(r.heading)];

    if (assist === 'manual') {
      const v = this.manualSpeed;
      const c = Math.cos(sh.angle);
      return {
        x: mx, y: my, z: mz,
        vx: heading[0] * v * c + r.cmd.vx,
        vy: v * Math.sin(sh.angle),
        vz: heading[1] * v * c + r.cmd.vz,
      };
    }
    // Pick the flattest angle that still drops into the opening on the way down.
    let best: { v: number; a: number } | null = null;
    for (let a = 75; a >= 40; a -= 1) {
      const ang = deg(a);
      const v = launchSpeedFor(dist, dy, ang);
      if (!v || v > 15) continue;
      const tHit = dist / (v * Math.cos(ang));
      const vyHit = v * Math.sin(ang) - 9.81 * tHit;
      if (vyHit < -1.5) {
        best = { v, a: ang };
        if (Math.abs(a - (sh.angle * 180) / Math.PI) < 1) break;
      }
    }
    if (!best) return null;
    const c = Math.cos(best.a);
    if (assist === 'full') {
      // Turret aims and the shooter compensates for robot motion.
      const ux = dx / dist;
      const uz = dz / dist;
      return { x: mx, y: my, z: mz, vx: ux * best.v * c, vy: best.v * Math.sin(best.a), vz: uz * best.v * c };
    }
    // 'distance': correct speed, but the driver aims the robot; FUEL inherits robot velocity.
    return {
      x: mx, y: my, z: mz,
      vx: heading[0] * best.v * c + r.cmd.vx,
      vy: best.v * Math.sin(best.a),
      vz: heading[1] * best.v * c + r.cmd.vz,
    };
  }

  private updateClimb(dt: number, ctl: ControlState): void {
    const r = this.ctx.robot;
    const ph = this.ctx.clock.phase;
    const untimed = this.ctx.clock.untimed;
    const allowed = untimed || ph?.kind === 'auto' || ph?.kind === 'endgame';
    const cap = ph?.kind === 'auto' ? 1 : (r.cfg.maxClimb ?? 0);
    const climbTime = r.cfg.climbTime ?? 2;

    if (this.descending) {
      this.climb = Math.max(0, this.climb - dt / (climbTime * 0.5));
      if (this.climb === 0) this.descending = false;
    } else if (ctl.climb && this.ctx.clock.enabled) {
      if (this.climb === 0) {
        if (!this.inClimbZone()) return;
        if (!allowed) {
          this.ctx.toast('Climb during AUTO (L1) or END GAME', 'info');
          return;
        }
        if (cap === 0) return;
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
    const rungLift = (lvl: number) => (lvl <= 0 ? 0 : Math.max(0.12, RUNGS[lvl - 1] * IN - 0.45));
    const lo = Math.floor(this.climb);
    const frac = this.climb - lo;
    r.lift = rungLift(lo) + (rungLift(Math.min(3, lo + 1)) - rungLift(lo)) * frac;
  }

  private inClimbZone(): boolean {
    const r = this.ctx.robot;
    const [tx, tz] = side(this.me, -HL + TOWER_X_OFF, TOWER_Z);
    const along = Math.abs(r.x - tx);
    return along < r.cfg.length / 2 + 0.45 && Math.abs(r.z - tz) < (TOWER_SPAN / 2) * IN;
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
    if (a === 'shooterUp') this.manualSpeed = Math.min(16, this.manualSpeed + 0.25);
    if (a === 'shooterDown') this.manualSpeed = Math.max(3, this.manualSpeed - 0.25);
    if ((a === 'shooterUp' || a === 'shooterDown') && this.ctx.settings.aimAssist === 'manual') {
      this.ctx.toast(`Shooter ${this.manualSpeed.toFixed(2)} m/s`, 'info');
    }
    if (a === 'descore' && this.climb > 0) this.descending = true;
    if (a === 'feed') this.humanPlayerFeed();
  }

  private humanPlayerFeed(): void {
    if (this.feedCooldown > 0) return;
    const q = this.outpostQueue[this.me];
    if (!q.length) {
      this.ctx.toast('OUTPOST is empty', 'bad');
      return;
    }
    const i = q.shift()!;
    const s = this.me === 'red' ? 1 : -1;
    const [x, z] = side(this.me, -HL + 4, OUTPOST_Z + (Math.random() - 0.5) * 8);
    this.launch(i, x, 0.55, z, s * (1.6 + Math.random() * 0.4), 0.3, (Math.random() - 0.5) * 0.3);
    this.feedCooldown = 0.3;
  }

  onPhaseChange(prev: Phase | null, next: Phase | null): void {
    if (prev?.kind === 'auto') {
      this.tally.autoTower = this.climb >= 1 ? 1 : 0;
      this.autoWinner = this.decideAutoWinner(this.tally.autoFuel);
      const won = this.autoWinner === this.me;
      this.ctx.toast(won ? 'You won AUTO: your HUB is off in SHIFTS 1 & 3' : 'Opponent won AUTO: your HUB is off in SHIFTS 2 & 4', 'info');
    }
    if (next && prev && (this.ctx.mode === 'match' || this.ctx.mode === 'driver')) {
      const was = hubActive(this.me, prev.id as RebuiltPhaseId, this.autoWinner);
      const now = hubActive(this.me, next.id as RebuiltPhaseId, this.autoWinner);
      if (was !== now) this.ctx.toast(now ? 'YOUR HUB IS ACTIVE' : 'HUB INACTIVE: collect FUEL', now ? 'good' : 'bad');
    }
  }

  /** Seconds until this alliance's hub changes state, or null if it won't. */
  private nextHubChange(): { seconds: number; active: boolean } | null {
    const clock = this.ctx.clock;
    if (clock.untimed || (this.ctx.mode !== 'match' && this.ctx.mode !== 'driver')) return null;
    const cur = this.isHubActive();
    let t = 0;
    for (const p of clock.phases) {
      const start = t;
      t += p.duration;
      if (start <= clock.elapsed) continue;
      if (p.kind === 'break') continue;
      const act = hubActive(this.me, p.id as RebuiltPhaseId, this.autoWinner);
      if (act !== cur) return { seconds: start - clock.elapsed, active: act };
    }
    return null;
  }

  liveScore(): { mine: number; other: number; lines: ScoreLine[] } {
    const s = scoreRebuilt({ ...this.tally, endTower: this.currentLevel() as TowerLevel });
    return {
      mine: s.total,
      other: 0,
      lines: [
        { label: 'FUEL', value: s.fuelPoints },
        { label: 'TOWER', value: s.towerPoints },
      ],
    };
  }

  private currentLevel(): TowerLevel {
    return Math.floor(this.climb + 1e-6) as TowerLevel;
  }

  statusHtml(): string {
    const active = this.isHubActive();
    const next = this.nextHubChange();
    const warn = next && next.seconds <= 5 && !next.active;
    const hub = `<span class="chip big ${warn ? 'blink' : ''}" style="--c:${active ? 'var(--good)' : 'var(--bad)'}">HUB ${active ? 'ACTIVE' : 'INACTIVE'}</span>`;
    const nextTxt = next ? `<span class="hint">${next.active ? 'on' : 'off'} in ${Math.ceil(next.seconds)}s</span>` : '';
    const assist = this.ctx.settings.aimAssist;
    const aim =
      assist === 'manual'
        ? `Manual · ${this.manualSpeed.toFixed(1)} m/s <span class="hint">[ ] / D-pad</span>`
        : assist === 'full'
          ? 'Full auto-aim'
          : 'Auto speed · you aim';
    const shot = this.trajGood ? '<b style="color:var(--good)">ON TARGET</b>' : '<span style="color:var(--muted)">off target</span>';
    const lvl = this.currentLevel();
    return `
      <div class="row">${hub}${nextTxt}</div>
      <div class="row"><span class="lbl">Shooter</span>${aim}</div>
      <div class="row"><span class="lbl">Shot</span>${shot}</div>
      <div class="row"><span class="lbl">Tower</span><b>${lvl ? `L${lvl}` : this.inClimbZone() ? '<span style="color:var(--good)">in zone: hold T / A</span>' : '—'}</b></div>
      <div class="row"><span class="lbl">Outpost</span><b>${this.outpostQueue[this.me].length}</b> <span class="hint">B to feed</span></div>`;
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

    // Hub lights: lit when active, blinking just before turning off.
    const t = performance.now() / 1000;
    for (const a of ['red', 'blue'] as const) {
      let on = this.ctx.mode === 'match' || this.ctx.mode === 'driver' ? hubActive(a, this.phaseId(), this.autoWinner) : true;
      if (a === this.me) {
        const next = this.nextHubChange();
        if (on && next && !next.active && next.seconds < 3) on = Math.sin(t * 18) > 0;
      }
      for (const m of this.hubLights[a]) {
        const mat = m.material as THREE.MeshStandardMaterial;
        mat.emissiveIntensity = on ? 1.1 : 0.05;
      }
    }
    this.updateTrajectory();
  }

  private updateTrajectory(): void {
    const show = this.ctx.settings.showTrajectory && this.held.length > 0 && this.climb === 0;
    this.trajLine.visible = show;
    this.trajGood = false;
    const sol = this.solution();
    if (!sol) {
      this.trajLine.visible = false;
      return;
    }
    const [hx, hz] = this.hubPos;
    const pos = this.trajLine.geometry.attributes.position as THREE.BufferAttribute;
    const n = pos.count;
    const tMax = 2.2;
    let lastY = sol.y;
    for (let k = 0; k < n; k++) {
      const tt = (k / (n - 1)) * tMax;
      const x = sol.x + sol.vx * tt;
      const y = sol.y + sol.vy * tt - 0.5 * 9.81 * tt * tt;
      const z = sol.z + sol.vz * tt;
      pos.setXYZ(k, x, Math.max(0, y), z);
      if (lastY >= HUB_TOP * IN && y < HUB_TOP * IN && Math.hypot(x - hx, z - hz) < 0.48) this.trajGood = true;
      lastY = y;
    }
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
    if (this.ctx.mode === 'match' || this.ctx.mode === 'driver') {
      notes.push(
        `Ranking points (solo): ENERGIZED ${s.energizedRP ? '✔' : '✘'} (${REBUILT.rp.energizedFuel} FUEL), SUPERCHARGED ${s.superchargedRP ? '✔' : '✘'} (${REBUILT.rp.superchargedFuel}), TRAVERSAL ${s.traversalRP ? '✔' : '✘'} (${REBUILT.rp.traversalTowerPoints} TOWER pts).`,
      );
    }
    if (this.tally.inactiveFuel > 0) notes.push(`${this.tally.inactiveFuel} FUEL went into an inactive HUB. Use those shifts to collect FUEL instead.`);
    return { total: s.total, lines, notes };
  }

  footprints(): Footprint[] {
    const out: Footprint[] = [];
    for (const a of ['red', 'blue'] as const) {
      const c = a === 'red' ? '#d92b2b' : '#1f5fd6';
      const P = (x: number, z: number) => side(a, x, z);
      const [hx, hz] = P(HUB_X, 0);
      out.push({ x: hx, z: hz, w: HUB * IN, d: HUB * IN, color: c });
      for (const zs of [1, -1]) {
        const [bx, bz] = P(HUB_X, zs * (HUB / 2 + BUMP_W / 2));
        out.push({ x: bx, z: bz, w: HUB * IN, d: BUMP_W * IN, color: 'rgba(240,196,25,0.45)' });
        const [tx, tz] = P(HUB_X, zs * (HUB / 2 + BUMP_W + (HW - HUB / 2 - BUMP_W) / 2));
        out.push({ x: tx, z: tz, w: HUB * IN, d: (HW - HUB / 2 - BUMP_W) * IN, color: 'rgba(120,120,140,0.35)' });
      }
      const [tx, tz] = P(-HL + TOWER_X_OFF / 2, TOWER_Z);
      out.push({ x: tx, z: tz, w: TOWER_X_OFF * IN, d: TOWER_SPAN * IN, color: '#f0c419' });
      const [dx, dz] = P(-HL + 13.5, DEPOT_Z);
      out.push({ x: dx, z: dz, w: 27 * IN, d: 42 * IN, color: 'rgba(255,255,255,0.25)' });
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
  const x = HUB_NEAR - 20;
  const raw: StartPose[] = [
    { label: 'Trench side (left)', x, z: -125, heading: 0 },
    { label: 'Center (facing HUB)', x, z: 0, heading: 0 },
    { label: 'Trench side (right)', x, z: 125, heading: 0 },
  ];
  return raw.map((p) => {
    const [wx, wz] = side(alliance, p.x, p.z);
    return { ...p, x: wx, z: wz, heading: alliance === 'red' ? 0 : Math.PI };
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
  blurb: '54′ field. Shoot FUEL into your HUB while it is active, go over BUMPS or under TRENCHES, and climb the TOWER in END GAME.',
  fieldX: HL * 2 * IN,
  fieldZ: HW * 2 * IN,
  presets: PRESETS,
  modes: [
    { id: 'match', label: 'Full match', description: '0:20 AUTO (drive it to rehearse) + 2:20 TELEOP with alternating HUB shifts and a 0:30 END GAME.' },
    { id: 'driver', label: 'TELEOP only', description: '2:20 TELEOP with HUB shifts. The AUTO winner comes from the settings.' },
    { id: 'sprint', label: 'Scoring sprint', description: 'Score 40 FUEL as fast as you can (HUB always active).' },
    { id: 'gates', label: 'Gate course', description: 'Lap the field through TRENCHES and over BUMPS.' },
    { id: 'free', label: 'Free practice', description: 'No clock. HUB always active.' },
  ],
  stations: (['red', 'blue'] as const).flatMap((a) =>
    [1, 2, 3].map((n) => {
      const [ex, ez] = side(a, -HL - 72, (n - 2) * 72);
      const [tx, tz] = side(a, -40, (n - 2) * 20);
      return {
        id: `${a}-${n}`,
        label: `${a === 'red' ? 'Red' : 'Blue'} ${n}`,
        alliance: a,
        eye: [ex, 2.6, ez] as [number, number, number],
        target: [tx, 0, tz] as [number, number, number],
        yaw: a === 'red' ? 0 : Math.PI,
      };
    }),
  ),
  startPoses,
  phases,
  gates(): Gate[] {
    const g = (x: number, z: number, yaw: number, w: number): Gate => ({ x: x * IN, z: z * IN, yaw, width: w * IN });
    const trenchZ = HUB / 2 + BUMP_W + (HW - HUB / 2 - BUMP_W) / 2;
    const bumpZ = HUB / 2 + BUMP_W / 2;
    // One lap: out under the near TRENCH, over the far BUMP, around the far alliance zone,
    // back under the other far TRENCH and over your own BUMP to finish at home.
    return [
      g(HUB_X, trenchZ, Math.PI / 2, 56),
      g(0, trenchZ, Math.PI / 2, 56),
      g(-HUB_X, bumpZ, Math.PI / 2, 66),
      g(HL - 70, 0, 0, 90),
      g(-HUB_X, -trenchZ, Math.PI / 2, 56),
      g(0, -trenchZ, Math.PI / 2, 56),
      g(HUB_X, -bumpZ, Math.PI / 2, 66),
      g(-HL + 70, 0, 0, 90),
    ];
  },
  sprint: { count: 40, label: 'FUEL scored' },
  create: (ctx) => new RebuiltRuntime(ctx),
  notes: [
    'Field size (317.7" × 651.2"), 158.6" alliance zones, 47" HUBs with a 72" opening, 6.5" BUMPS, 22.25" TRENCH clearance, TOWER rungs at 27/45/63", 504 FUEL (360 neutral, 24 per DEPOT, 24 per OUTPOST, 8 preload), match timing, HUB shift rules and point values come from the 2026 game manual and its summaries.',
    'APPROXIMATIONS: the exact positions of the TOWER, DEPOT and OUTPOST along the alliance wall, BUMP ramp length, the shape of the HUB funnel, and how scored FUEL exits the HUB. The physics leaves out air drag. All the dimensions are constants at the top of src/games/rebuilt/game.ts.',
  ],
};
