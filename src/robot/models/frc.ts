import * as THREE from 'three';
import { IN } from '../../core/units';
import { type ModelCtx, bar, makeCtx, mat, mesh, netTexture, numberTexture, omniWheel, roller, tractionWheel } from './parts';
import type { ModelBuilder, RobotAnim, RobotModel } from './types';

/**
 * FRC robots: swerve (or tank) chassis, numbered bumpers, hopper, shooter
 * (turret, fixed drum, twin turrets or triple flywheels), intake and climber,
 * proportioned from the teams' published specs.
 */
export interface FrcSpec {
  team: string;
  /** Frame perimeter (without bumpers), inches. */
  frameL: number;
  frameW: number;
  /** Overall height, inches. */
  height: number;
  drive: 'swerve' | 'tank' | 'mecanum';
  shape?: 'rect' | 'round';
  colors: { frame: number; accent: number; trim: number };
  hopper: { wallH: number; net: boolean; front: number; back: number };
  shooter: { type: 'turret' | 'drum' | 'twin' | 'triple'; facing: 'front' | 'back'; x: number; z: number };
  intake: 'slapdown' | 'fourbar';
  climber: boolean;
}

export const BUMPER = 3.25; // inches of bumper outside the frame

export function frcModel(spec: FrcSpec): ModelBuilder {
  return (alliance, ghost) => buildFrc(spec, alliance, makeCtx(ghost));
}

function buildFrc(s: FrcSpec, alliance: 'red' | 'blue', ctx: ModelCtx): RobotModel {
  const root = new THREE.Group();
  const L = s.frameL * IN;
  const W = s.frameW * IN;
  const H = s.height * IN;
  const B = BUMPER * IN;
  const bumperH = 5 * IN;
  const bumperY = 0.75 * IN + bumperH / 2;
  const { frame, accent, trim } = s.colors;
  const frameMat = mat(ctx, frame, { metal: 0.65, rough: 0.35 });
  const accentMat = mat(ctx, accent, { metal: 0.3, rough: 0.45 });

  // ------------------------------------------------------------- bumpers
  const allianceHex = alliance === 'red' ? '#c62828' : '#1f4fbf';
  const numTex = numberTexture(s.team, allianceHex, '#ffffff');
  const bumperFabric = new THREE.MeshStandardMaterial({ color: alliance === 'red' ? 0xc62828 : 0x1f4fbf, roughness: 0.9, transparent: ctx.ghost, opacity: ctx.ghost ? 0.3 : 1 });
  const numMat = new THREE.MeshStandardMaterial({ map: numTex, roughness: 0.9, transparent: ctx.ghost, opacity: ctx.ghost ? 0.3 : 1 });
  if (s.shape === 'round') {
    const ring = mesh(ctx, new THREE.CylinderGeometry(L / 2 + B, L / 2 + B, bumperH, 40, 1, true), bumperFabric, root, 0, bumperY, 0);
    (ring.material as THREE.Material).side = THREE.DoubleSide;
    const label = mesh(ctx, new THREE.CylinderGeometry(L / 2 + B + 0.002, L / 2 + B + 0.002, bumperH * 0.8, 40, 1, true, -0.5, 1), numMat, root, 0, bumperY, 0);
    label.rotation.y = Math.PI / 2;
  } else {
    const sides: [number, number, number, number, number][] = [
      [L + 2 * B, B, 0, W / 2 + B / 2, 0],
      [L + 2 * B, B, 0, -W / 2 - B / 2, Math.PI],
      [W, B, L / 2 + B / 2, 0, -Math.PI / 2],
      [W, B, -L / 2 - B / 2, 0, Math.PI / 2],
    ];
    for (const [len, thick, x, z, rot] of sides) {
      const g = new THREE.Group();
      g.position.set(x, bumperY, z);
      g.rotation.y = rot;
      root.add(g);
      // Rotated so local +z points outward: the face with the number.
      mesh(ctx, new THREE.BoxGeometry(len, bumperH, thick), bumperFabric, g, 0, 0, 0);
      if (len > 18 * IN) {
        const face = mesh(ctx, new THREE.PlaneGeometry(Math.min(len * 0.8, 20 * IN), bumperH * 0.85), numMat, g, 0, 0, thick / 2 + 0.001);
        face.castShadow = false;
      }
    }
  }

  // --------------------------------------------------------------- frame
  const tube = 1 * IN;
  const frameY = 2.2 * IN;
  if (s.shape !== 'round') {
    bar(ctx, root, [L, 2 * IN, tube], [0, frameY, W / 2 - tube / 2], frame);
    bar(ctx, root, [L, 2 * IN, tube], [0, frameY, -W / 2 + tube / 2], frame);
    bar(ctx, root, [tube, 2 * IN, W - 2 * tube], [L / 2 - tube / 2, frameY, 0], frame);
    bar(ctx, root, [tube, 2 * IN, W - 2 * tube], [-L / 2 + tube / 2, frameY, 0], frame);
  } else {
    const ring = mesh(ctx, new THREE.TorusGeometry(L / 2 - tube, tube / 2, 8, 48), frameMat, root, 0, frameY, 0);
    ring.rotation.x = Math.PI / 2;
  }
  // Belly pan, battery, RoboRIO, radio.
  bar(ctx, root, [L - 2 * tube, 0.1 * IN, W - 2 * tube], [0, 1.3 * IN, 0], 0x3a3e45, { metal: 0.5 });
  bar(ctx, root, [7 * IN, 3 * IN, 3 * IN], [-L / 2 + 6 * IN, 3 * IN, -W / 2 + 6 * IN], 0x111111, { metal: 0.1, rough: 0.8 });
  bar(ctx, root, [4 * IN, 1 * IN, 5.5 * IN], [-L / 2 + 6 * IN, 2.3 * IN, W / 2 - 7 * IN], 0xdfe3e8, { metal: 0.2 });

  // --------------------------------------------------------- drivetrain
  const modules: { steer: THREE.Group; wheel: THREE.Group }[] = [];
  const wheels: THREE.Group[] = [];
  const modInset = 2.75 * IN;
  if (s.drive === 'swerve') {
    const corners: [number, number][] = s.shape === 'round'
      ? [[0.7, 0.7], [0.7, -0.7], [-0.7, 0.7], [-0.7, -0.7]].map(([a, b]) => [a * (L / 2 - modInset), b * (L / 2 - modInset)])
      : [[1, 1], [1, -1], [-1, 1], [-1, -1]].map(([a, b]) => [a * (L / 2 - modInset), b * (W / 2 - modInset)]);
    for (const [x, z] of corners) {
      // SDS MK4i/MK5-style module: base plate, steering housing, two motors on top.
      bar(ctx, root, [4.6 * IN, 0.25 * IN, 4.6 * IN], [x, 3.4 * IN, z], 0x2b2e33, { metal: 0.5 });
      const steer = new THREE.Group();
      steer.position.set(x, 0, z);
      root.add(steer);
      const wheel = tractionWheel(ctx, steer, 4 * IN, 1.5 * IN, 0, 2 * IN, 0, 0x202020);
      bar(ctx, steer, [3.2 * IN, 2.6 * IN, 0.3 * IN], [0, 2.4 * IN, 1 * IN], 0x9aa1a9, { metal: 0.7 });
      for (const [mx, mz] of [[-0.9, 0.9], [0.9, -0.9]] as const) {
        mesh(ctx, new THREE.CylinderGeometry(1.2 * IN, 1.2 * IN, 3.6 * IN, 18), mat(ctx, 0x1b1c1f, { metal: 0.4, rough: 0.4 }), root, x + mx * IN, 5.4 * IN, z + mz * IN);
        mesh(ctx, new THREE.CylinderGeometry(1.25 * IN, 1.25 * IN, 0.3 * IN, 18), mat(ctx, 0xb8bec6, { metal: 0.8, rough: 0.3 }), root, x + mx * IN, 7.3 * IN, z + mz * IN);
      }
      modules.push({ steer, wheel });
    }
  } else {
    const n = s.drive === 'tank' ? 3 : 2;
    for (const side of [-1, 1]) for (let i = 0; i < n; i++) {
      const x = n === 3 ? (i - 1) * (L / 2 - 4 * IN) : (i === 0 ? 1 : -1) * (L / 2 - 4 * IN);
      const w = s.drive === 'mecanum'
        ? omniWheel(ctx, root, 6 * IN, 2 * IN, x, 3 * IN, side * (W / 2 - 2.2 * IN), { hub: 0x777d85, roller: 0x222222, rollers: 10 })
        : tractionWheel(ctx, root, 6 * IN, 1.6 * IN, x, 3 * IN, side * (W / 2 - 2.2 * IN), 0x1a1a1a);
      wheels.push(w);
    }
    for (const side of [-1, 1]) bar(ctx, root, [L - 2 * IN, 3 * IN, 0.25 * IN], [0, 3.2 * IN, side * (W / 2 - 3.6 * IN)], frame);
  }

  // -------------------------------------------------------------- hopper
  const hFront = s.hopper.front * IN;
  const hBack = s.hopper.back * IN;
  const hopH = s.hopper.wallH * IN;
  const hopLen = hFront - hBack;
  const hopX = (hFront + hBack) / 2;
  const polyMat = mat(ctx, 0xd6e6f5, { opacity: 0.22, rough: 0.1, metal: 0 });
  const hopperW = s.shape === 'round' ? L * 0.92 : W - 2 * IN;
  if (s.shape === 'round') {
    const wall = mesh(ctx, new THREE.CylinderGeometry(L / 2 - 1 * IN, L / 2 - 1 * IN, hopH - 4 * IN, 40, 1, true), polyMat, root, 0, 4 * IN + (hopH - 4 * IN) / 2, 0);
    wall.castShadow = false;
  } else {
    for (const side of [-1, 1]) {
      const p = mesh(ctx, new THREE.BoxGeometry(hopLen, hopH - 4 * IN, 0.1 * IN), polyMat, root, hopX, 4 * IN + (hopH - 4 * IN) / 2, side * hopperW / 2);
      p.castShadow = false;
      // Posts holding the panels.
      for (const px of [hFront, hBack]) bar(ctx, root, [1 * IN, hopH - 4 * IN, 1 * IN], [px, 4 * IN + (hopH - 4 * IN) / 2, side * hopperW / 2], frame);
    }
    bar(ctx, root, [hopLen, 1 * IN, 1 * IN], [hopX, hopH, hopperW / 2], frame);
    bar(ctx, root, [hopLen, 1 * IN, 1 * IN], [hopX, hopH, -hopperW / 2], frame);
    // Powered roller floor (the "floor" that feeds the shooter).
    for (let i = 0; i < 5; i++) {
      roller(ctx, root, 1.5 * IN, hopperW - 2 * IN, hBack + ((i + 0.5) / 5) * hopLen, 5 * IN + i * 0.3 * IN, 0, 0x2d2f33);
    }
  }
  if (s.hopper.net) {
    const net = new THREE.MeshStandardMaterial({ map: netTexture(), transparent: true, alphaTest: 0.3, side: THREE.DoubleSide, color: 0x111111 });
    const top = mesh(ctx, new THREE.PlaneGeometry(s.shape === 'round' ? L * 0.9 : hopLen, hopperW), net, root, s.shape === 'round' ? 0 : hopX, hopH + 0.2 * IN, 0);
    top.rotation.x = -Math.PI / 2;
    top.castShadow = false;
  }

  // ------------------------------------------------------------- shooter
  const face = s.shooter.facing === 'back' ? -1 : 1;
  const shooterBase = new THREE.Group();
  shooterBase.position.set(s.shooter.x * IN, 0, s.shooter.z * IN);
  root.add(shooterBase);
  const spinners: THREE.Mesh[] = [];
  const hoods: THREE.Group[] = [];
  const turrets: THREE.Group[] = [];
  const shooterTop = H;
  const buildHoodedFlywheel = (parent: THREE.Object3D, width: number, dir: number, y: number) => {
    const hood = new THREE.Group();
    hood.position.set(0, y, 0);
    parent.add(hood);
    const fw = mesh(ctx, new THREE.CylinderGeometry(2 * IN, 2 * IN, width, 20), mat(ctx, 0x303236, { metal: 0.5, rough: 0.4 }), hood, 0, 0, 0);
    fw.rotation.x = Math.PI / 2;
    spinners.push(fw);
    // Curved hood over the wheel.
    const arc = mesh(ctx, new THREE.CylinderGeometry(3.4 * IN, 3.4 * IN, width + 0.6 * IN, 20, 1, true, 0, Math.PI * 0.7), mat(ctx, trim, { metal: 0.3, rough: 0.5, side: THREE.DoubleSide }), hood, 0, 0, 0);
    arc.rotation.x = Math.PI / 2;
    arc.rotation.y = dir > 0 ? 0 : Math.PI;
    for (const sz of [-1, 1]) bar(ctx, hood, [6 * IN, 5 * IN, 0.25 * IN], [-dir * 0.8 * IN, 0, (sz * (width + 0.8 * IN)) / 2], accent, { metal: 0.3 });
    hoods.push(hood);
    return hood;
  };
  if (s.shooter.type === 'turret' || s.shooter.type === 'twin') {
    const mounts = s.shooter.type === 'twin' ? [-W / 4, W / 4] : [0];
    for (const mz of mounts) {
      const t = new THREE.Group();
      t.position.set(0, shooterTop - 5.5 * IN, mz);
      shooterBase.add(t);
      const ring = mesh(ctx, new THREE.TorusGeometry(4.2 * IN, 0.45 * IN, 8, 32), mat(ctx, 0x1d1f23, { metal: 0.5 }), t, 0, 0, 0);
      ring.rotation.x = Math.PI / 2;
      mesh(ctx, new THREE.CylinderGeometry(4 * IN, 4 * IN, 0.4 * IN, 32), accentMat, t, 0, 0.3 * IN, 0);
      buildHoodedFlywheel(t, 5.5 * IN, 1, 3.2 * IN);
      turrets.push(t);
    }
  } else if (s.shooter.type === 'drum') {
    // Full-width drum across the back (or front), fixed to the chassis.
    const g = new THREE.Group();
    g.position.set(0, 0, 0);
    shooterBase.add(g);
    buildHoodedFlywheel(g, W - 3 * IN, face, shooterTop - 4 * IN);
    bar(ctx, g, [3 * IN, shooterTop - 8 * IN, 1 * IN], [0, (shooterTop - 8 * IN) / 2 + 4 * IN, W / 2 - 1.5 * IN], frame);
    bar(ctx, g, [3 * IN, shooterTop - 8 * IN, 1 * IN], [0, (shooterTop - 8 * IN) / 2 + 4 * IN, -W / 2 + 1.5 * IN], frame);
  } else {
    // Three hooded flywheels on one shaft.
    const g = new THREE.Group();
    shooterBase.add(g);
    for (const z of [-W / 3, 0, W / 3]) {
      const sub = new THREE.Group();
      sub.position.z = z;
      g.add(sub);
      buildHoodedFlywheel(sub, 5 * IN, face, shooterTop - 4 * IN);
    }
  }

  // -------------------------------------------------------------- intake
  const intake = new THREE.Group();
  intake.position.set(L / 2 - 1 * IN, 9 * IN, 0);
  root.add(intake);
  const armLen = s.intake === 'fourbar' ? 11 * IN : 12 * IN;
  const iw = s.shape === 'round' ? L * 0.7 : W - 2 * IN;
  for (const sz of [-1, 1]) bar(ctx, intake, [armLen, 1 * IN, 0.5 * IN], [armLen / 2, 0, (sz * iw) / 2], accent, { metal: 0.4 });
  const intakeRollers = [
    roller(ctx, intake, 2 * IN, iw, armLen, 0, 0, 0x2f9e4f),
    roller(ctx, intake, 1.5 * IN, iw, armLen * 0.55, 1 * IN, 0, 0x2f9e4f),
  ];
  // Compliant wheels on the front roller.
  for (let i = 0; i < 6; i++) {
    const w = mesh(ctx, new THREE.CylinderGeometry(1.4 * IN, 1.4 * IN, 0.9 * IN, 10), mat(ctx, 0xe87a1c, { rough: 0.9 }), intakeRollers[0], 0, -iw / 2 + ((i + 0.5) / 6) * iw, 0);
    w.rotation.set(0, 0, 0);
  }

  // ------------------------------------------------------------- climber
  const climbTubes: THREE.Mesh[] = [];
  if (s.climber) {
    for (const sz of [-1, 1]) {
      const x = -L / 2 + 2.5 * IN;
      const z = sz * (W / 2 - 3 * IN);
      bar(ctx, root, [1.5 * IN, H - 4 * IN, 1.5 * IN], [x, (H - 4 * IN) / 2 + 2 * IN, z], trim);
      const inner = bar(ctx, root, [1.1 * IN, H - 6 * IN, 1.1 * IN], [x, (H - 6 * IN) / 2 + 3 * IN, z], 0xb5bcc4);
      bar(ctx, inner, [3 * IN, 0.6 * IN, 1 * IN], [1.2 * IN, (H - 6 * IN) / 2, 0], 0x222222);
      climbTubes.push(inner);
    }
  }

  const baseInnerY = climbTubes.map((t) => t.position.y);
  const animate = (a: RobotAnim) => {
    for (const m of modules) {
      m.steer.rotation.y = a.driveDir;
      m.wheel.rotation.z = -a.wheelSpin;
    }
    for (const w of wheels) w.rotation.z = -a.wheelSpin;
    for (const t of turrets) t.rotation.y = a.turretYaw;
    for (const h of hoods) h.rotation.z = (a.hood - 0.9) * 0.4 * (s.shooter.type === 'turret' || s.shooter.type === 'twin' ? 1 : face);
    for (const sp of spinners) sp.rotation.y += a.flywheel * 0.9;
    // Intake: stowed upright inside the frame, deployed out over the bumper.
    intake.rotation.z = THREE.MathUtils.lerp(1.45, -0.55, a.intakeDeploy);
    for (const r of intakeRollers) r.rotation.y += a.intake * 0.6;
    climbTubes.forEach((t, i) => (t.position.y = baseInnerY[i] + a.climb));
  };
  return { root, animate };
}
