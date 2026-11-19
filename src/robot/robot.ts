import * as THREE from 'three';
import { RAPIER, ROBOT_GROUPS, ROBOT_MOVE_FILTER, groups, GROUP } from '../core/physics';
import { yawQuat } from '../core/builder';
import { wrapAngle } from '../core/units';
import { type RobotAnim, type RobotModel, type ModelBuilder, defaultAnim } from './models/types';
import {
  type ChassisState,
  type DriveInput,
  type DriveType,
  type DriverTuning,
  type Supply,
  type Powertrain,
  type Voltages,
  driverVoltages,
  forwardOf,
  rightOf,
  stepDrive,
} from './drivetrain';
import { type PowerState, freshPower, stepPower, supplyScale, thermalLimit } from './power';

export type Alliance = 'red' | 'blue';

export interface RobotConfig {
  id: string;
  name: string;
  description: string;
  /** Team the design comes from, if it is based on a real robot. */
  team?: string;
  /** Where the design comes from. */
  source?: string;
  /** Frame length front-to-back, m. */
  length: number;
  /** Frame width side-to-side, m. */
  width: number;
  height: number;
  drive: DriveType;
  power: Powertrain;
  /** Game pieces the robot can carry. */
  capacity: number;
  intakeWidth: number;
  /** How far ahead of the frame the intake reaches, m. */
  intakeReach: number;
  /** Seconds for the lift to travel its full range. */
  liftTime?: number;
  model: ModelBuilder;
  /** Short stat lines for the setup screen. */
  stats?: Record<string, string>;
  /** The claw is on the back: the sim's "front" is the claw side and the driver's forward is the other way. */
  reversed?: boolean;
  /** Closes on a Cup with a Pin standing in it and carries them as one stack. */
  grabsStacks?: boolean;
  /** Team driver macros. 'lower-release': grabbing lifts to mid height; hold R2 to lower, let go to release. */
  macros?: 'lower-release';
  /**
   * Open bay in the claw end of the frame (m): the robot backs over a Goal or a field stack
   * and the claw works inside the frame. `width` across, `depth` in from the end.
   */
  bay?: { width: number; depth: number };
}

/**
 * A driven robot. Its motion comes from the V5 motor model in drivetrain.ts;
 * Rapier's character controller then moves it through the field so it
 * collides solidly with walls and goals while shoving game pieces aside.
 */
export class Robot {
  readonly body: RAPIER.RigidBody;
  readonly collider: RAPIER.Collider;
  /** Every solid part of the frame (one box, or the U around an open bay). */
  private readonly parts: { collider: RAPIER.Collider; shape: RAPIER.Cuboid; offset: { x: number; y: number; z: number } }[] = [];
  readonly mesh = new THREE.Group();
  private readonly visual = new THREE.Group();
  private readonly controller: RAPIER.KinematicCharacterController;
  readonly model: RobotModel;
  /** Mechanism state for the model, set by the game each step. */
  anim: RobotAnim = defaultAnim();
  /** Last motor voltages (for sound and the HUD). */
  voltages: Voltages = [0, 0];

  /** Battery and drive-motor temperature. */
  power: PowerState = freshPower();
  /** Current drawn by the non-drive motors (set by the game), A. */
  mechAmps = 0;
  /** Chassis acceleration in the robot frame (forward, sideways), for body pitch and roll. */
  private accel: [number, number] = [0, 0];
  private tilt: [number, number] = [0, 0];

  heading = 0;
  cmd: ChassisState = { vx: 0, vz: 0, omega: 0 };
  private vy = 0;
  /** Locked in place. */
  frozen = false;
  distance = 0;
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
    // Frame boxes in robot space (x forward = claw end, z right). An open bay leaves a U.
    const boxes: { cx: number; cz: number; hx: number; hz: number }[] = [];
    const bay = cfg.bay;
    if (bay) {
      const solidLen = 2 * hx - bay.depth;
      boxes.push({ cx: -hx + solidLen / 2, cz: 0, hx: solidLen / 2, hz });
      const railW = (2 * hz - bay.width) / 2;
      for (const side of [-1, 1]) boxes.push({ cx: hx - bay.depth / 2, cz: side * (hz - railW / 2), hx: bay.depth / 2, hz: railW / 2 });
    } else boxes.push({ cx: 0, cz: 0, hx, hz });
    for (const b of boxes) {
      const collider = world.createCollider(
        RAPIER.ColliderDesc.roundCuboid(b.hx - 0.01, hy - 0.01, b.hz - 0.01, 0.01)
          .setTranslation(b.cx, hy, b.cz)
          .setCollisionGroups(opts.ghost ? groups(0, 0) : ROBOT_GROUPS)
          .setFriction(0.2),
        this.body,
      );
      this.parts.push({ collider, shape: new RAPIER.Cuboid(b.hx, hy - 0.04, b.hz), offset: { x: b.cx, y: 0, z: b.cz } });
    }
    this.collider = this.parts[0].collider;

    this.controller = world.createCharacterController(0.005);
    this.controller.setUp({ x: 0, y: 1, z: 0 });
    this.controller.setMaxSlopeClimbAngle((40 * Math.PI) / 180);
    this.controller.setMinSlopeSlideAngle((55 * Math.PI) / 180);
    this.controller.enableSnapToGround(0.06);
    this.controller.enableAutostep(0.02, 0.05, false);
    this.controller.setApplyImpulsesToDynamicBodies(false);

    this.model = cfg.model(alliance, opts.ghost ?? false);
    this.visual.add(this.model.root);
    this.mesh.add(this.visual);
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
    const active = enabled && !this.frozen;
    this.voltages = active
      ? driverVoltages(this.cfg.drive, input, this.heading, driverYaw, tuning)
      : this.cfg.drive === 'xdrive' ? [0, 0, 0, 0] : [0, 0];
    // Driving a robot whose claw is on the back: the driver's forward is away from the claw.
    if (this.cfg.reversed && this.voltages.length === 2) this.voltages = [-this.voltages[1], -this.voltages[0]];
    const supply: Supply = { voltage: supplyScale(this.power), limit: thermalLimit(this.power.temp) };
    const prev = this.cmd;
    this.cmd = stepDrive(this.cfg.drive, this.cfg.power, this.cfg.length, this.cfg.width, this.cmd, this.voltages, this.heading, dt, supply);
    if (active || this.power.temp > 26) this.power = stepPower(this.power, dt, supply.amps ?? 0, this.cfg.power.motors, active ? this.mechAmps : 0);
    if (dt > 0) {
      const [fx, fz] = forwardOf(this.heading);
      const [rx, rz] = rightOf(this.heading);
      const ax = (this.cmd.vx - prev.vx) / dt;
      const az = (this.cmd.vz - prev.vz) / dt;
      // Centripetal acceleration in a turn shows up as sideways load.
      const side = ax * rx + az * rz + Math.hypot(this.cmd.vx, this.cmd.vz) * this.cmd.omega * -1;
      const k = 1 - Math.exp(-dt / 0.06);
      this.accel[0] += (ax * fx + az * fz - this.accel[0]) * k;
      this.accel[1] += (side - this.accel[1]) * k;
    }
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
    // Each part of the frame in turn trims the move, so the U's rails stop on walls and
    // Goals too while a Goal can slide into the open bay.
    let mv = desired;
    let grounded = false;
    for (const p of this.parts) {
      this.controller.computeColliderMovement(p.collider, mv, RAPIER.QueryFilterFlags.EXCLUDE_SENSORS, ROBOT_MOVE_FILTER);
      const m = this.controller.computedMovement();
      mv = { x: m.x, y: m.y, z: m.z };
      grounded ||= this.controller.computedGrounded();
    }
    if (grounded) this.vy = 0;
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
    const sp = Math.hypot(this.cmd.vx, this.cmd.vz);
    const [ffx, ffz] = forwardOf(this.heading);
    const along = this.cmd.vx * ffx + this.cmd.vz * ffz;
    this.anim.wheelSpin += ((Math.sign(along) || 1) * sp + Math.abs(this.cmd.omega) * this.cfg.width * 0.4) * dt / 0.05;
    const t = this.body.translation();
    this.body.setNextKinematicTranslation({ x: t.x + mv.x, y: Math.max(-0.05, t.y + mv.y), z: t.z + mv.z });
    this.body.setNextKinematicRotation(yawQuat(this.heading));
  }

  private blockedAt(heading: number): boolean {
    const t = this.body.translation();
    const [fx, fz] = forwardOf(heading);
    const [rx, rz] = rightOf(heading);
    return this.parts.some((p) => {
      const hit = this.world.intersectionWithShape(
        { x: t.x + fx * p.offset.x + rx * p.offset.z, y: t.y + this.cfg.height / 2 + 0.04, z: t.z + fz * p.offset.x + rz * p.offset.z },
        yawQuat(heading),
        p.shape,
        RAPIER.QueryFilterFlags.EXCLUDE_SENSORS,
        groups(GROUP.ROBOT, GROUP.FIELD | GROUP.OVERHEAD),
        p.collider,
        this.body,
      );
      return !!hit;
    });
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
    const targetPitch = Math.atan2(hf - hb, 2 * hl);
    const targetRoll = Math.atan2(hr - hL, 2 * hw);
    this.pitch += (targetPitch - this.pitch) * alpha;
    this.roll += (targetRoll - this.roll) * alpha;
    this.groundY = Math.max(t.y, (hf + hb) / 2);
    this.mesh.position.set(t.x, this.groundY, t.z);
    this.mesh.rotation.set(0, this.heading, 0);
    // Local +x is forward, so pitch is a rotation about local z and roll about local x.
    // Weight transfer: the chassis squats back under acceleration and leans out in turns
    // (about 0.6° per m/s², from the wheels' and frame's give).
    const kTilt = (0.6 * Math.PI) / 180;
    this.tilt[0] += (clampTilt(this.accel[0] * kTilt) - this.tilt[0]) * 0.3;
    this.tilt[1] += (clampTilt(-this.accel[1] * kTilt) - this.tilt[1]) * 0.3;
    this.visual.rotation.set(-this.roll + this.tilt[1], 0, this.pitch + this.tilt[0], 'YXZ');
    this.model.animate(this.anim, 1 / 60);
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

const clampTilt = (a: number) => Math.max(-0.05, Math.min(0.05, a));
