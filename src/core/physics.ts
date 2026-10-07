import RAPIER from '@dimforge/rapier3d-compat';

export { RAPIER };

let ready: Promise<void> | null = null;
export function initPhysics(): Promise<void> {
  ready ??= RAPIER.init();
  return ready;
}

/** Collision groups (membership bit, filter mask). */
export const GROUP = {
  FIELD: 0x0001,
  ROBOT: 0x0002,
  PIECE: 0x0004,
  /** Overhead structures (trench arms): hit robots only. */
  OVERHEAD: 0x0008,
};

export function groups(member: number, filter: number): number {
  return (member << 16) | filter;
}

export const FIELD_GROUPS = groups(GROUP.FIELD, GROUP.ROBOT | GROUP.PIECE);
export const OVERHEAD_GROUPS = groups(GROUP.OVERHEAD, GROUP.ROBOT);
export const PIECE_GROUPS = groups(GROUP.PIECE, GROUP.FIELD | GROUP.ROBOT | GROUP.PIECE);
export const ROBOT_GROUPS = groups(GROUP.ROBOT, GROUP.FIELD | GROUP.PIECE | GROUP.OVERHEAD | GROUP.ROBOT);
/** What the robot's character controller treats as a solid obstacle. */
export const ROBOT_MOVE_FILTER = groups(GROUP.ROBOT, GROUP.FIELD | GROUP.OVERHEAD | GROUP.ROBOT);
