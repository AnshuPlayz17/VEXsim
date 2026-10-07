import * as THREE from 'three';
import { RAPIER, ROBOT_GROUPS, ROBOT_MOVE_FILTER, groups, GROUP } from '../core/physics';
import { yawQuat } from '../core/builder';
import { wrapAngle } from '../core/units';
import {
  type ChassisCommand,
  type DriveInput,
  type DriveParams,
  type DriveType,
  type DriverTuning,
  forwardOf,
  rightOf,
  stepChassis,
  targetCommand,
} from './drivetrain';

export type Alliance = 'red' | 'blue';

export interface RobotConfig {
  id: string;
  name: string;
  description: string;
  /** Frame length front-to-back, m (includes bumpers for FRC). */
  length: number;
  /** Frame width side-to-side, m. */
  width: number;
  height: number;
  drive: DriveType;
  params: DriveParams;
  /** Game pieces the robot can carry. */
  capacity: number;
  intakeWidth: number;
  /** How far ahead of the frame the intake reaches, m. */
  intakeReach: number;
  /** FRC shooter. */
  shooter?: { rate: number; angle: number; turret: boolean };
  /** Seconds to climb one tower level (FRC). */
  climbTime?: number;
  /** Highest tower level the mechanism can reach (FRC). */
  maxClimb?: 0 | 1 | 2 | 3;
  style: 'vex' | 'frc';
}

const ALLIANCE_COLOR: Record<Alliance, number> = { red: 0xd92b2b, blue: 0x1f5fd6 };

/**
 * A driven robot. It is a kinematic body moved by Rapier's character controller,
 * so it collides solidly with the field (walls, bumps, trench arms) while
 * shoving loose game pieces out of the way.
 */
export class Robot {
  readonly body: RAPIER.RigidBody;
  readonly collider: RAPIER.Collider;
  readonly mesh = new THREE.Group();
  private readonly visual = new THREE.Group();
  private readonly controller: RAPIER.KinematicCharacterController;
  private readonly rollers: THREE.Mesh[] = [];
  private readonly rotateTestShape: RAPIER.Cuboid;

  heading = 0;
  cmd: ChassisCommand = { vx: 0, vz: 0, omega: 0 };
  private vy = 0;
  /** Locked in place (climbing, disabled). */
  frozen = false;
  /** Extra visual lift (climbing animation). */
  lift = 0;
  distance = 0;
  intakeSpin = 0;
  private pitch = 0;
  private roll = 0;
  private groundY = 0;

  constructor(
    private world: RAPIER.World,
    scene: THREE.Scene,
    public readonly cfg: RobotConfig,
    public readonly alliance: Alliance,
    start: { x: number; z: number; heading: number },
    opts: { ghost?: boolean } = {},
  ) {
    this.heading = start.heading;
    const bodyDesc = RAPIER.RigidBodyDesc.kinematicPositionBased()
      .setTranslation(start.x, 0.02, start.z)
      .setRotation(yawQuat(start.heading));
    this.body = world.createRigidBody(bodyDesc);
    const hx = cfg.length / 2;
    const hz = cfg.width / 2;
    const hy = cfg.height / 2;
    this.collider = world.createCollider(
      RAPIER.ColliderDesc.roundCuboid(hx - 0.01, hy - 0.01, hz - 0.01, 0.01)
        .setTranslation(0, hy, 0)
        .setCollisionGroups(opts.ghost ? groups(0, 0) : ROBOT_GROUPS)
        .setFriction(0.2),
      this.body,
    );
    this.rotateTestShape = new RAPIER.Cuboid(hx, hy - 0.04, hz);

    this.controller = world.createCharacterController(0.005);
    this.controller.setUp({ x: 0, y: 1, z: 0 });
    this.controller.setMaxSlopeClimbAngle((40 * Math.PI) / 180);
    this.controller.setMinSlopeSlideAngle((55 * Math.PI) / 180);
    this.controller.enableSnapToGround(0.06);
    this.controller.enableAutostep(0.02, 0.05, false);
    this.controller.setApplyImpulsesToDynamicBodies(false);

    this.buildMesh(opts.ghost ?? false);
    scene.add(this.mesh);
    this.syncVisual(1);
  }

  get x(): number {
    return this.body.translation().x;
  }
  get z(): number {
    return this.body.translation().z;
  }
  get y(): number {
    return this.body.translation().y;
  }
  get speed(): number {
    return Math.hypot(this.cmd.vx, this.cmd.vz);
  }

  /** Express a world (x, z) point in robot coordinates: [forward, right]. */
  toLocal(px: number, pz: number): [number, number] {
    const dx = px - this.x;
    const dz = pz - this.z;
    const [fx, fz] = forwardOf(this.heading);
    const [rx, rz] = rightOf(this.heading);
    return [dx * fx + dz * fz, dx * rx + dz * rz];
  }

  /** World point from robot coordinates. */
  toWorld(forward: number, right: number): [number, number] {
    const [fx, fz] = forwardOf(this.heading);
    const [rx, rz] = rightOf(this.heading);
    return [this.x + fx * forward + rx * right, this.z + fz * forward + rz * right];
  }

  /** Is a world point inside the intake mouth? */
  inIntake(px: number, pz: number, py: number, maxHeight = 0.35): boolean {
    const [f, r] = this.toLocal(px, pz);
    const front = this.cfg.length / 2;
    return (
      f > front - 0.08 &&
      f < front + this.cfg.intakeReach &&
      Math.abs(r) < this.cfg.intakeWidth / 2 &&
      py - this.groundY < maxHeight
    );
  }

  update(dt: number, input: DriveInput, enabled: boolean, driverYaw: number, tuning: DriverTuning): void {
    const p: DriveParams = this.cfg.params;
    const active = enabled && !this.frozen;
    const target = active
      ? targetCommand(this.cfg.drive, input, this.heading, driverYaw, p, tuning)
      : { vx: 0, vz: 0, omega: 0 };
    this.cmd = stepChassis(this.cfg.drive, this.cmd, target, this.heading, p, dt);
    if (this.frozen) this.cmd = { vx: 0, vz: 0, omega: 0 };

    // Rotation: refuse to rotate into a wall (the controller only resolves translation).
    const newHeading = wrapAngle(this.heading + this.cmd.omega * dt);
    if (this.cmd.omega !== 0 && this.blockedAt(newHeading) && !this.blockedAt(this.heading)) {
      this.cmd.omega = 0;
    } else {
      this.heading = newHeading;
    }

    if (this.frozen) return;

    this.vy -= 9.81 * dt;
    const desired = { x: this.cmd.vx * dt, y: this.vy * dt, z: this.cmd.vz * dt };
    this.controller.computeColliderMovement(
      this.collider,
      desired,
      RAPIER.QueryFilterFlags.EXCLUDE_SENSORS,
      ROBOT_MOVE_FILTER,
    );
    const mv = this.controller.computedMovement();
    if (this.controller.computedGrounded()) this.vy = 0;
    // A real collision (wall, goal, another robot) bleeds off the blocked velocity.
    // Ramps only redirect motion upward, so they must not count as a collision.
    if (dt > 0) {
      const want = Math.hypot(desired.x, desired.z);
      const got = Math.hypot(mv.x, mv.z);
      if (want > 1e-5 && got < want * 0.6) {
        this.cmd.vx = mv.x / dt;
        this.cmd.vz = mv.z / dt;
      }
    }
    this.distance += Math.hypot(mv.x, mv.z);
    const t = this.body.translation();
    this.body.setNextKinematicTranslation({ x: t.x + mv.x, y: Math.max(-0.05, t.y + mv.y), z: t.z + mv.z });
    this.body.setNextKinematicRotation(yawQuat(this.heading));
  }

  private blockedAt(heading: number): boolean {
    const t = this.body.translation();
    const hit = this.world.intersectionWithShape(
      { x: t.x, y: t.y + this.cfg.height / 2 + 0.04, z: t.z },
      yawQuat(heading),
      this.rotateTestShape,
      RAPIER.QueryFilterFlags.EXCLUDE_SENSORS,
      groups(GROUP.ROBOT, GROUP.FIELD | GROUP.OVERHEAD),
      this.collider,
      this.body,
    );
    return !!hit;
  }

  /** Teleport (used for climbing release and resets). */
  teleport(x: number, y: number, z: number, heading: number): void {
    this.heading = heading;
    this.body.setTranslation({ x, y, z }, true);
    this.body.setNextKinematicTranslation({ x, y, z });
    this.body.setRotation(yawQuat(heading), true);
    this.body.setNextKinematicRotation(yawQuat(heading));
    this.cmd = { vx: 0, vz: 0, omega: 0 };
    this.vy = 0;
  }

  private groundHeight(fx: number, fz: number): number {
    const t = this.body.translation();
    const ray = new RAPIER.Ray({ x: fx, y: t.y + 0.4, z: fz }, { x: 0, y: -1, z: 0 });
    const hit = this.world.castRay(
      ray,
      1.5,
      true,
      RAPIER.QueryFilterFlags.EXCLUDE_SENSORS,
      groups(GROUP.ROBOT, GROUP.FIELD),
      this.collider,
      this.body,
    );
    return hit ? t.y + 0.4 - hit.timeOfImpact : 0;
  }

  /** Update the rendered mesh. `alpha` smooths pitch/roll. */
  syncVisual(alpha = 0.25): void {
    const t = this.body.translation();
    const hl = this.cfg.length * 0.42;
    const hw = this.cfg.width * 0.42;
    const [fx, fz] = forwardOf(this.heading);
    const [rx, rz] = rightOf(this.heading);
    const hf = this.groundHeight(t.x + fx * hl, t.z + fz * hl);
    const hb = this.groundHeight(t.x - fx * hl, t.z - fz * hl);
    const hr = this.groundHeight(t.x + rx * hw, t.z + rz * hw);
    const hL = this.groundHeight(t.x - rx * hw, t.z - rz * hw);
    const targetPitch = this.lift > 0 ? 0 : Math.atan2(hf - hb, 2 * hl);
    const targetRoll = this.lift > 0 ? 0 : Math.atan2(hr - hL, 2 * hw);
    this.pitch += (targetPitch - this.pitch) * alpha;
    this.roll += (targetRoll - this.roll) * alpha;
    this.groundY = Math.max(t.y, (hf + hb) / 2);
    this.mesh.position.set(t.x, this.groundY + this.lift, t.z);
    this.mesh.rotation.set(0, this.heading, 0);
    // Local +x is forward, so pitch is a rotation about local z and roll about local x.
    this.visual.rotation.set(-this.roll, 0, this.pitch, 'YXZ');
    for (const r of this.rollers) r.rotation.y += this.intakeSpin * 0.35;
  }

  private buildMesh(ghost: boolean): void {
    const { length: L, width: W, height: H } = this.cfg;
    const allianceColor = ALLIANCE_COLOR[this.alliance];
    const mat = (color: number, extra: Partial<THREE.MeshStandardMaterialParameters> = {}) =>
      new THREE.MeshStandardMaterial({
        color,
        roughness: 0.55,
        metalness: 0.3,
        transparent: ghost,
        opacity: ghost ? 0.28 : 1,
        depthWrite: !ghost,
        ...extra,
      });
    const add = (geo: THREE.BufferGeometry, m: THREE.Material, x: number, y: number, z: number) => {
      const mesh = new THREE.Mesh(geo, m);
      mesh.position.set(x, y, z);
      mesh.castShadow = !ghost;
      mesh.receiveShadow = !ghost;
      this.visual.add(mesh);
      return mesh;
    };
    this.mesh.add(this.visual);

    if (this.cfg.style === 'frc') {
      // Bumpers in alliance color around a dark aluminium frame.
      const bh = 0.13;
      const bt = 0.085;
      const bumper = mat(allianceColor, { roughness: 0.85, metalness: 0 });
      add(new THREE.BoxGeometry(L, bh, bt), bumper, 0, 0.1, W / 2 - bt / 2);
      add(new THREE.BoxGeometry(L, bh, bt), bumper, 0, 0.1, -W / 2 + bt / 2);
      add(new THREE.BoxGeometry(bt, bh, W - 2 * bt), bumper, L / 2 - bt / 2, 0.1, 0);
      add(new THREE.BoxGeometry(bt, bh, W - 2 * bt), bumper, -L / 2 + bt / 2, 0.1, 0);
      const frame = mat(0x2a2d33);
      add(new THREE.BoxGeometry(L - 2 * bt, 0.05, W - 2 * bt), frame, 0, 0.07, 0);
      // Hopper / superstructure.
      const hop = add(
        new THREE.BoxGeometry(L * 0.55, H - 0.2, W * 0.7),
        mat(0x9aa3ad, { transparent: true, opacity: ghost ? 0.2 : 0.35, metalness: 0.1 }),
        -L * 0.08,
        0.1 + (H - 0.2) / 2,
        0,
      );
      hop.castShadow = false;
      // Shooter hood.
      add(new THREE.BoxGeometry(0.18, 0.12, W * 0.4), mat(0x3b3f47), -L * 0.12, H - 0.06, 0);
      // Number plates.
      const plate = mat(0xffffff, { roughness: 0.9, metalness: 0 });
      add(new THREE.BoxGeometry(0.18, 0.06, 0.002), plate, 0, 0.1, W / 2 + 0.001);
      add(new THREE.BoxGeometry(0.18, 0.06, 0.002), plate, 0, 0.1, -W / 2 - 0.001);
      // Swerve modules / wheels.
      const wheelMat = mat(0x111111, { roughness: 0.9, metalness: 0 });
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
        const w = add(new THREE.CylinderGeometry(0.05, 0.05, 0.04, 16), wheelMat, sx * (L / 2 - 0.16), 0.05, sz * (W / 2 - 0.16));
        w.rotation.x = Math.PI / 2;
      }
    } else {
      // VEX: C-channel frame, colored side plates, flex-wheel intake.
      const metal = mat(0xb8bec7, { metalness: 0.75, roughness: 0.35 });
      const ch = 0.025;
      add(new THREE.BoxGeometry(L, ch, ch), metal, 0, 0.05, W / 2 - ch);
      add(new THREE.BoxGeometry(L, ch, ch), metal, 0, 0.05, -W / 2 + ch);
      add(new THREE.BoxGeometry(ch, ch, W), metal, -L / 2 + ch, 0.05, 0);
      add(new THREE.BoxGeometry(ch, ch, W), metal, L / 2 - ch, 0.05, 0);
      add(new THREE.BoxGeometry(ch, H * 0.8, ch), metal, -L / 2 + ch, H * 0.4 + 0.05, W / 2 - ch);
      add(new THREE.BoxGeometry(ch, H * 0.8, ch), metal, -L / 2 + ch, H * 0.4 + 0.05, -W / 2 + ch);
      const side = mat(allianceColor, { metalness: 0.1, roughness: 0.6 });
      add(new THREE.BoxGeometry(L * 0.8, H * 0.45, 0.006), side, 0, H * 0.35, W / 2 - 0.004);
      add(new THREE.BoxGeometry(L * 0.8, H * 0.45, 0.006), side, 0, H * 0.35, -W / 2 + 0.004);
      add(new THREE.BoxGeometry(L * 0.5, 0.05, W * 0.6), mat(0x222222), -L * 0.1, 0.12, 0); // brain + battery
      // Mast for the pin placer.
      add(new THREE.BoxGeometry(0.04, H * 0.9, 0.04), metal, L * 0.2, H * 0.45, 0);
      const wheelMat = mat(0x1d1d1d, { roughness: 0.9, metalness: 0 });
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
        const w = add(new THREE.CylinderGeometry(0.041, 0.041, 0.03, 18), wheelMat, sx * (L / 2 - 0.07), 0.041, sz * (W / 2 - 0.035));
        w.rotation.x = Math.PI / 2;
      }
    }
    // Intake rollers across the front.
    const rollerMat = mat(this.cfg.style === 'frc' ? 0x30b050 : 0x2fae4f, { roughness: 0.8, metalness: 0 });
    for (const yy of [0.06, 0.16]) {
      const r = add(
        new THREE.CylinderGeometry(0.025, 0.025, this.cfg.intakeWidth, 12),
        rollerMat,
        L / 2 + 0.03,
        yy,
        0,
      );
      r.rotation.x = Math.PI / 2;
      this.rollers.push(r);
    }
    // Direction arrow on top so the driver always knows where the front is.
    const arrow = new THREE.Mesh(
      new THREE.ConeGeometry(0.06, 0.14, 3),
      new THREE.MeshBasicMaterial({ color: 0xffe14d, transparent: ghost, opacity: ghost ? 0.4 : 1 }),
    );
    arrow.rotation.z = -Math.PI / 2;
    arrow.position.set(L * 0.25, H + 0.02, 0);
    this.visual.add(arrow);
  }

  dispose(scene: THREE.Scene): void {
    scene.remove(this.mesh);
    this.world.removeCharacterController(this.controller);
    this.world.removeRigidBody(this.body);
    this.mesh.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        o.geometry.dispose();
        (o.material as THREE.Material).dispose();
      }
    });
  }
}
