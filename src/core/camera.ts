import * as THREE from 'three';
import type { CameraMode } from '../config';
import type { DriverStation } from '../games/types';
import type { Robot } from '../robot/robot';

export const CAMERA_LABELS: Record<CameraMode, string> = {
  driver: 'Driver station',
  follow: 'Chase cam',
  top: 'Top-down',
  pov: 'Robot POV',
};
const ORDER: CameraMode[] = ['driver', 'follow', 'top', 'pov'];

export class CameraRig {
  readonly camera = new THREE.PerspectiveCamera(50, 1, 0.03, 200);
  private pos = new THREE.Vector3();
  private look = new THREE.Vector3();
  private initialized = false;

  constructor(
    public mode: CameraMode,
    private station: DriverStation,
    private field: { x: number; z: number },
  ) {}

  next(): CameraMode {
    this.mode = ORDER[(ORDER.indexOf(this.mode) + 1) % ORDER.length];
    this.initialized = false;
    return this.mode;
  }

  resize(w: number, h: number): void {
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  update(robot: Robot, dt: number): void {
    const cam = this.camera;
    const desiredPos = new THREE.Vector3();
    const desiredLook = new THREE.Vector3();
    const size = Math.max(robot.cfg.length, robot.cfg.width);
    const yaw = this.station.yaw;
    const fwd = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
    cam.up.set(0, 1, 0);
    let fov = 50;
    let snap = 6;

    switch (this.mode) {
      case 'driver': {
        desiredPos.set(...this.station.eye);
        desiredLook.set(...this.station.target);
        fov = this.field.x > 8 ? 62 : 58;
        snap = 30;
        break;
      }
      case 'follow': {
        const back = size * 2.6 + 0.4;
        const h = size * 1.6 + 0.35;
        const rf = new THREE.Vector3(Math.cos(robot.heading), 0, -Math.sin(robot.heading));
        desiredPos.set(robot.x - rf.x * back, h + robot.mesh.position.y, robot.z - rf.z * back);
        desiredLook.set(robot.x + rf.x * size * 2, 0.1 + robot.mesh.position.y, robot.z + rf.z * size * 2);
        fov = 60;
        snap = 5;
        break;
      }
      case 'top': {
        const big = this.field.x > 8;
        const h = big ? 9 : this.field.x * 1.15;
        const cx = big ? THREE.MathUtils.clamp(robot.x, -this.field.x / 2 + 3.5, this.field.x / 2 - 3.5) : 0;
        const cz = big ? 0 : 0;
        // Small offset toward the driver so "up" on screen is away from the driver.
        desiredPos.set(cx - fwd.x * 0.01, h, cz - fwd.z * 0.01);
        desiredLook.set(cx, 0, cz);
        cam.up.copy(fwd);
        fov = 50;
        snap = big ? 5 : 30;
        break;
      }
      case 'pov': {
        const rf = new THREE.Vector3(Math.cos(robot.heading), 0, -Math.sin(robot.heading));
        const y = robot.mesh.position.y + robot.cfg.height + 0.08;
        desiredPos.set(robot.x - rf.x * robot.cfg.length * 0.3, y, robot.z - rf.z * robot.cfg.length * 0.3);
        desiredLook.set(robot.x + rf.x * 3, y - 0.45, robot.z + rf.z * 3);
        fov = 75;
        snap = 40;
        break;
      }
    }
    if (!this.initialized) {
      this.pos.copy(desiredPos);
      this.look.copy(desiredLook);
      this.initialized = true;
    } else {
      const k = 1 - Math.exp(-snap * dt);
      this.pos.lerp(desiredPos, k);
      this.look.lerp(desiredLook, k);
    }
    if (cam.fov !== fov) {
      cam.fov = fov;
      cam.updateProjectionMatrix();
    }
    cam.position.copy(this.pos);
    cam.lookAt(this.look);
  }
}
