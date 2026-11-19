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
  /** Accumulated wheel rotation, rad. */
  wheelSpin: number;
  /** Swinging claw arm: 0 out (claw past the frame, scoring), 1 swung in over the top (loading). */
  swing: number;
}

export const defaultAnim = (): RobotAnim => ({
  intake: 0, lift: 0, claw: 1, wrist: 0, wheelSpin: 0, swing: 0,
});

export interface RobotModel {
  root: THREE.Group;
  animate(a: RobotAnim, dt: number): void;
  /** Where carried game pieces are shown (VEX claw). */
  carry?: THREE.Object3D;
  /** Lowest and highest end-effector heights the lift can reach, m. */
  liftRange?: [number, number];
  /** The claw is on a swinging arm (anim.swing moves it). */
  swingArm?: boolean;
}

export type ModelBuilder = (alliance: 'red' | 'blue', ghost: boolean) => RobotModel;
