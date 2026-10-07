import type * as THREE from 'three';

/** Mechanism state the games drive; models turn it into motion. */
export interface RobotAnim {
  /** Intake roller direction: 1 in, -1 out, 0 off. */
  intake: number;
  /** Lift / arm end-effector height above the floor, m (VEX). */
  lift: number;
  /** Claw: 0 open, 1 closed (VEX). */
  claw: number;
  /** Wrist roll, rad (VEX flipping). */
  wrist: number;
  /** Turret yaw relative to the chassis, rad (FRC). */
  turretYaw: number;
  /** Hood angle, rad from horizontal (FRC). */
  hood: number;
  /** Climber extension, m (FRC). */
  climb: number;
  /** Shooter wheels spinning (0..1). */
  flywheel: number;
  /** Intake deployed (0 stowed .. 1 out) (FRC). */
  intakeDeploy: number;
  /** Direction of travel relative to the chassis, rad (swerve modules steer to it). */
  driveDir: number;
  /** Accumulated wheel rotation, rad. */
  wheelSpin: number;
}

export const defaultAnim = (): RobotAnim => ({
  intake: 0, lift: 0, claw: 1, wrist: 0, turretYaw: 0, hood: 0.9, climb: 0,
  flywheel: 0, intakeDeploy: 0, driveDir: 0, wheelSpin: 0,
});

export interface RobotModel {
  root: THREE.Group;
  animate(a: RobotAnim, dt: number): void;
  /** Where carried game pieces are shown (VEX claw). */
  carry?: THREE.Object3D;
  /** Lowest and highest end-effector heights the lift can reach, m. */
  liftRange?: [number, number];
}

export type ModelBuilder = (alliance: 'red' | 'blue', ghost: boolean) => RobotModel;
