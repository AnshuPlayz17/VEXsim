import * as THREE from 'three';
import { IN } from '../../core/units';
import {
  type ModelCtx, bar, cable, cChannel, gear, makeCtx, mat, mesh, numberTexture, nut, omniWheel, roller, rubberBand, standoff,
  tractionWheel, v5Battery, v5Brain, v5Motor,
} from './parts';
import type { ModelBuilder, RobotAnim, RobotModel } from './types';
import { mergeStatic } from '../../core/merge';

/**
 * VEX V5 robots built from V5 parts: aluminum C-channel, 11W smart motors,
 * the V5 brain and battery, omni/traction wheels and alliance license plates.
 */
export interface VexSpec {
  team: string;
  /** Frame size, inches. */
  length: number;
  width: number;
  drive: 'tank6' | 'tank4' | 'xdrive';
  wheel: 3.25 | 4 | 2.75;
  cartridge: 'blue' | 'green' | 'red';
  lift: 'dr4b' | 'arm' | 'chainbar' | 'cascade';
  /** End-effector height range, inches. */
  liftMin: number;
  liftMax: number;
  /** Front roller intake feeding the claw. */
  rollers: boolean;
  /** Metal color: aluminum or steel. */
  metal?: number;
  /** Team accent color (polycarbonate / 3D-printed parts). */
  accent: number;
  /**
   * Claw on a motor-driven arm at the top of the lift that swings it over the robot:
   * out past the frame to score, in over the top to load. Arm length (in) and swing (deg).
   */
  swingArm?: { length: number; swingDeg: number };
}

export function vexModel(spec: VexSpec): ModelBuilder {
  return (alliance, ghost) => {
    const m = buildVex(spec, alliance, makeCtx(ghost));
    mergeStatic(m.root);
    return m;
  };
}

function buildVex(s: VexSpec, alliance: 'red' | 'blue', ctx: ModelCtx): RobotModel {
  const root = new THREE.Group();
  const L = s.length * IN;
  const W = s.width * IN;
  const metal = s.metal ?? 0xc9ced4;
  const wheelD = s.wheel * IN;
  const axleY = wheelD / 2;
  const railY = axleY + 0.2 * IN;
  const wheels: THREE.Group[] = [];
  /** Motor positions, wired to the brain at the end. */
  const motorAt: THREE.Vector3[] = [];

  // ---------------------------------------------------------- drivetrain
  if (s.drive === 'xdrive') {
    // Square base with chamfered corners and wheels at 45 degrees.
    const c = L / 2 - 1.2 * IN;
    for (const sx of [-1, 1]) {
      cChannel(ctx, root, L - 4 * IN, 0, railY, sx * (W / 2 - 1.5 * IN), { color: metal });
      cChannel(ctx, root, W - 4 * IN, sx * (L / 2 - 1.5 * IN), railY, 0, { color: metal, along: 'z' });
    }
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      const pod = new THREE.Group();
      pod.position.set(sx * c, 0, sz * c);
      pod.rotation.y = (sx * sz > 0 ? 1 : -1) * Math.PI / 4;
      root.add(pod);
      const w = omniWheel(ctx, pod, wheelD, 1.1 * IN, 0, axleY, 0);
      w.userData.dynamic = true;
      wheels.push(w);
      v5Motor(ctx, pod, 0, axleY + 0.3 * IN, -1.7 * IN * sz, s.cartridge, sz);
      motorAt.push(new THREE.Vector3(sx * c * 0.8, axleY + 1.2 * IN, sz * c * 0.8));
      bar(ctx, pod, [2.6 * IN, 0.06 * IN, 3.2 * IN], [0, axleY + 1.4 * IN, -0.8 * IN * sz], metal, { metal: 0.7 });
    }
  } else {
    const perSide = s.drive === 'tank6' ? 3 : 2;
    for (const side of [-1, 1]) {
      const zr = side * (W / 2 - 0.55 * IN);
      // Two C-channel rails sandwich the wheels (classic VEX drive).
      cChannel(ctx, root, L, 0, railY, zr, { color: metal });
      cChannel(ctx, root, L - 1 * IN, 0, railY, zr - side * 2.2 * IN, { color: metal });
      for (let i = 0; i < perSide; i++) {
        const fx = perSide === 3 ? (i - 1) * (L / 2 - wheelD / 2 - 0.4 * IN) : (i === 0 ? 1 : -1) * (L / 2 - wheelD / 2 - 0.5 * IN);
        const traction = perSide === 3 && i === 1;
        const w = traction
          ? tractionWheel(ctx, root, wheelD, 1 * IN, fx, axleY, zr - side * 1.1 * IN)
          : omniWheel(ctx, root, wheelD, 1 * IN, fx, axleY, zr - side * 1.1 * IN);
        w.userData.dynamic = true;
      wheels.push(w);
        v5Motor(ctx, root, fx, axleY + 0.35 * IN, zr - side * 3.6 * IN, s.cartridge, side);
        motorAt.push(new THREE.Vector3(fx, axleY + 1.5 * IN, zr - side * 3.6 * IN));
        nut(ctx, root, fx, axleY, side * (W / 2 + 0.1 * IN));
      }
    }
    // Cross members front and back.
    cChannel(ctx, root, W - 1 * IN, L / 2 - 0.6 * IN, railY, 0, { color: metal, along: 'z' });
    cChannel(ctx, root, W - 1 * IN, -L / 2 + 0.6 * IN, railY, 0, { color: metal, along: 'z' });
  }
  // Electronics.
  const brainPos = new THREE.Vector3(-L / 2 + 3 * IN, railY + 2.2 * IN, 0);
  v5Brain(ctx, root, brainPos.x, brainPos.y, brainPos.z);
  // Standoffs holding the brain plate, and nuts at the frame corners.
  for (const sz of [-1, 1]) for (const sx of [-1, 1]) {
    standoff(ctx, root, new THREE.Vector3(brainPos.x + sx * 1.8 * IN, railY, sz * 1.4 * IN), new THREE.Vector3(brainPos.x + sx * 1.8 * IN, brainPos.y - 0.55 * IN, sz * 1.4 * IN));
    nut(ctx, root, sx * (L / 2 - 0.3 * IN), railY + 0.3 * IN, sz * (W / 2 + 0.1 * IN));
  }
  v5Battery(ctx, root, -1.5 * IN, railY + 1.2 * IN, W / 2 - 4.2 * IN);
  v5Battery(ctx, root, -1.5 * IN, railY + 1.2 * IN, W / 2 - 4.2 * IN);
  // Air tank for pistons (common on stacking bots).
  const tank = mesh(ctx, new THREE.CylinderGeometry(0.75 * IN, 0.75 * IN, 5 * IN, 14), mat(ctx, 0xd7dde4, { metal: 0.6, rough: 0.3, opacity: 0.85 }), root, -1.5 * IN, railY + 1 * IN, -W / 2 + 3.6 * IN);
  tank.rotation.z = Math.PI / 2;

  // License plates: alliance colored with the team number (required in V5RC).
  const plateTex = numberTexture(s.team, alliance === 'red' ? '#c62828' : '#1e4fc2', '#ffffff');
  const plateMat = new THREE.MeshStandardMaterial({ map: plateTex, roughness: 0.6, transparent: ctx.ghost, opacity: ctx.ghost ? 0.3 : 1 });
  for (const side of [-1, 1]) {
    const p = mesh(ctx, new THREE.BoxGeometry(6 * IN, 1.4 * IN, 0.04 * IN), plateMat, root, -1 * IN, railY + 2.1 * IN, side * (W / 2 + 0.05 * IN));
    if (side < 0) p.rotation.y = Math.PI;
  }

  // ---------------------------------------------------------------- lift
  const liftMin = s.liftMin * IN;
  const liftMax = s.liftMax * IN;
  const accent = mat(ctx, s.accent, { rough: 0.45, opacity: 0.85 });
  const towerX = s.lift === 'arm' ? -L / 2 + 2.5 * IN : s.lift === 'dr4b' ? -L / 2 + 4 * IN : s.lift === 'cascade' ? -L / 2 + 5 * IN : -1 * IN;
  // DR4B stages are about the robot's length; the towers are as tall as needed to reach liftMax.
  const dr4bStage = Math.min(L * 0.85, (liftMax - liftMin) / 2 / 0.9);
  const pivotY = s.lift === 'dr4b' ? Math.max(railY + 3 * IN, liftMax - 2 * 0.9 * dr4bStage) : railY + (s.lift === 'arm' ? 10 : 8) * IN;
  // Towers (vertical C-channels) on both sides.
  const towerZ = W / 2 - 2.6 * IN;
  // Cascade: a fixed outer stage plus nested stages that slide up on string.
  const cascadeStages = 3;
  // Stages are 14" so the robot starts under the 18" limit; the stack tops out under 50".
  const stageH = 14 * IN;
  const cascade: THREE.Group[] = [];
  if (s.lift === 'cascade') {
    for (let k = 0; k <= cascadeStages; k++) {
      const st = new THREE.Group();
      root.add(st);
      for (const side of [-1, 1]) {
        cChannel(ctx, st, stageH, towerX + k * 0.55 * IN, stageH / 2, side * (towerZ - k * 0.6 * IN), { color: metal, along: 'y' });
      }
      // Cross brace at the top of each stage.
      bar(ctx, st, [0.5 * IN, 0.5 * IN, 2 * (towerZ - k * 0.6 * IN)], [towerX + k * 0.55 * IN, stageH - 0.3 * IN, 0], metal);
      st.userData.dynamic = true;
      cascade.push(st);
    }
    for (const side of [-1, 1]) v5Motor(ctx, root, towerX - 1.5 * IN, railY + 2 * IN, side * (towerZ - 1.6 * IN), 'red', -side);
    motorAt.push(new THREE.Vector3(towerX - 1.5 * IN, railY + 3 * IN, 0));
  } else {
    for (const side of [-1, 1]) {
      cChannel(ctx, root, pivotY - railY + 1 * IN, towerX, (pivotY + railY) / 2, side * towerZ, { color: metal, along: 'y' });
      v5Motor(ctx, root, towerX, pivotY, side * (towerZ - 1.3 * IN), 'red', -side);
      // Driven gear on the lift pivot.
      gear(ctx, root, 1.8 * IN, 36, towerX, pivotY, side * (towerZ + 0.5 * IN));
    }
    motorAt.push(new THREE.Vector3(towerX, pivotY - 1 * IN, 0));
  }

  const effector = new THREE.Group(); // carries the claw; kept level
  effector.userData.dynamic = true;
  root.add(effector);
  const arms: { g: THREE.Group; kind: 'stage1' | 'stage2' | 'arm' }[] = [];
  const stageLen = s.lift === 'dr4b' ? dr4bStage : 0;
  const armLen = s.lift === 'dr4b' || s.lift === 'cascade' ? 0 : Math.max(L / 2 - towerX + 2 * IN, (liftMax - liftMin) / 1.7);

  const makeArmBars = (len: number, kind: 'stage1' | 'stage2' | 'arm') => {
    const g = new THREE.Group();
    root.add(g);
    for (const side of [-1, 1]) {
      // Parallel bars (four-bar linkage) on each side.
      for (const off of [0, 1.5 * IN]) {
        const b = cChannel(ctx, g, len, len / 2, off, side * towerZ, { color: metal, w: 0.5 * IN, h: 0.5 * IN });
        b.rotation.x = Math.PI / 2;
      }
      standoff(ctx, g, new THREE.Vector3(len * 0.5, 0, side * towerZ), new THREE.Vector3(len * 0.5, 1.5 * IN, side * towerZ));
    }
    // Cross brace with accent rubber-band anchor.
    mesh(ctx, new THREE.BoxGeometry(0.4 * IN, 0.4 * IN, towerZ * 2), accent, g, len * 0.6, 0.7 * IN, 0);
    g.userData.dynamic = true;
    arms.push({ g, kind });
    return g;
  };
  // DR4B carriage: horizontal rails from the top of the lift out over the front.
  const carriage = new THREE.Group();
  carriage.userData.dynamic = true;
  root.add(carriage);
  if (s.lift === 'dr4b' || s.lift === 'cascade') {
    for (const side of [-1, 1]) cChannel(ctx, carriage, L / 2 - towerX, (L / 2 - towerX) / 2, 0, side * (towerZ - 0.8 * IN), { color: metal });
    if (s.lift === 'dr4b') {
      makeArmBars(stageLen, 'stage1');
      makeArmBars(stageLen, 'stage2');
    }
  } else {
    makeArmBars(armLen, 'arm');
  }

  // Claw on a wrist (rotates to flip Pins/Cups), plus optional front rollers.
  const wristG = new THREE.Group();
  wristG.userData.dynamic = true;
  // Optional swinging arm: effector → arm (rotates about the pivot) → a level carrier → wrist.
  const sw = s.swingArm;
  const swLen = sw ? sw.length * IN : 0;
  const effX = L / 2 - 1 * IN - swLen;
  const swingG = new THREE.Group();
  const levelG = new THREE.Group();
  swingG.userData.dynamic = levelG.userData.dynamic = true;
  if (sw) {
    effector.add(swingG);
    swingG.add(levelG);
    levelG.position.x = swLen;
    levelG.add(wristG);
    for (const side of [-1, 1]) cChannel(ctx, swingG, swLen + 1 * IN, swLen / 2, 0, side * 2.3 * IN, { color: metal, w: 0.5 * IN, h: 0.5 * IN });
    // Red-cartridge arm motor at the pivot, and the claw's pneumatic cylinder.
    v5Motor(ctx, effector, 0, 0, -3.2 * IN, 'red', 1);
    mesh(ctx, new THREE.CylinderGeometry(0.45 * IN, 0.45 * IN, 3.2 * IN, 12), mat(ctx, 0xc9ced6, { metal: 0.8, rough: 0.3 }), levelG, -1.6 * IN, 1.6 * IN, 0).rotation.z = Math.PI / 2;
  } else effector.add(wristG);
  bar(ctx, wristG, [1 * IN, 3 * IN, 4.2 * IN], [0.6 * IN, 0, 0], 0x1d1f23, { metal: 0.2, rough: 0.6 });
  const fingers: THREE.Mesh[] = [];
  for (const side of [-1, 1]) {
    const f = mesh(ctx, new THREE.BoxGeometry(3.6 * IN, 2.6 * IN, 0.35 * IN), accent, wristG, 2.6 * IN, 0, side * 1.8 * IN);
    f.userData.dynamic = true;
    fingers.push(f);
  }
  v5Motor(ctx, wristG, -0.6 * IN, 0, 0, 'green', 1).scale.setScalar(0.8);
  const carry = new THREE.Object3D();
  carry.position.set(2.8 * IN, 0, 0);
  wristG.add(carry);

  const rollerMeshes: THREE.Mesh[] = [];
  if (s.rollers) {
    for (const side of [-1, 1]) {
      bar(ctx, root, [5 * IN, 0.5 * IN, 0.5 * IN], [L / 2 + 0.5 * IN, railY + 1.6 * IN, side * (W / 2 - 3 * IN)], metal);
    }
    rollerMeshes.push(roller(ctx, root, 2.6 * IN, W - 6 * IN, L / 2 + 2.2 * IN, 1.5 * IN, 0, 0x2fae4f));
    rollerMeshes.push(roller(ctx, root, 2 * IN, W - 6 * IN, L / 2 + 1.2 * IN, 4 * IN, 0, 0x2fae4f));
    for (const r of rollerMeshes) r.userData.dynamic = true;
  }

  // Rubber bands from the tower to the first stage / arm (lift assist).
  const bands: THREE.Mesh[] = [];
  if (s.lift !== 'cascade') for (let i = 0; i < 2; i++) bands.push(rubberBand(ctx, root, new THREE.Vector3(), new THREE.Vector3(0, 0.01, 0)));
  for (const b of bands) b.userData.dynamic = true;
  const bandTo = (m: THREE.Mesh, a: THREE.Vector3, b: THREE.Vector3) => {
    const len = Math.max(0.001, a.distanceTo(b));
    m.position.copy(a).add(b).multiplyScalar(0.5);
    m.scale.set(1, len / 0.01, 1);
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
  };
  // Smart cables from every motor to the brain.
  for (const m of motorAt) cable(ctx, root, m, new THREE.Vector3(brainPos.x + 1.5 * IN, brainPos.y - 0.2 * IN, brainPos.z + (m.z > 0 ? 1 : -1) * 1.2 * IN));

  const animate = (a: RobotAnim) => {
    const h = THREE.MathUtils.clamp(a.lift, liftMin, liftMax);
    let ex: number;
    let ey: number;
    if (s.lift === 'dr4b') {
      const sinT = THREE.MathUtils.clamp((h - pivotY) / (2 * stageLen), -0.9, 0.9);
      const t = Math.asin(sinT);
      // Stage 1 from the tower pivot forward-up, stage 2 back-up from its end.
      const [s1, s2] = arms;
      s1.g.position.set(towerX, pivotY, 0);
      s1.g.rotation.z = t;
      const mx = towerX + Math.cos(t) * stageLen;
      const my = pivotY + Math.sin(t) * stageLen;
      s2.g.position.set(mx, my, 0);
      s2.g.rotation.z = Math.PI - t;
      ey = pivotY + 2 * Math.sin(t) * stageLen;
      carriage.position.set(towerX, ey, 0);
      effector.position.set(effX, ey, 0);
      bands.forEach((b, i) => {
        const z = (i === 0 ? -1 : 1) * towerZ;
        bandTo(b, new THREE.Vector3(towerX, pivotY + 4 * IN, z), new THREE.Vector3(towerX + Math.cos(t) * stageLen * 0.4, pivotY + Math.sin(t) * stageLen * 0.4, z));
      });
    } else if (s.lift === 'cascade') {
      // Each stage rises an equal share of the travel.
      // The carriage rides the last stage; stages extend once it reaches the top.
      const extend = Math.max(0, h + 2 * IN - railY - stageH);
      cascade.forEach((st, k) => (st.position.y = railY + (extend * k) / cascadeStages));
      ey = h;
      carriage.position.set(towerX, ey, 0);
      effector.position.set(effX, ey, 0);
    } else {
      const sinP = THREE.MathUtils.clamp((h - pivotY) / armLen, -0.98, 0.98);
      const p = Math.asin(sinP);
      const arm = arms[0];
      arm.g.position.set(towerX, pivotY, 0);
      arm.g.rotation.z = p;
      ex = towerX + Math.cos(p) * armLen;
      ey = pivotY + Math.sin(p) * armLen;
      effector.position.set(ex, ey, 0);
      bands.forEach((b, i) => {
        const z = (i === 0 ? -1 : 1) * towerZ;
        bandTo(b, new THREE.Vector3(towerX - 1 * IN, pivotY + 3 * IN, z), new THREE.Vector3(towerX + Math.cos(p) * armLen * 0.35, pivotY + Math.sin(p) * armLen * 0.35, z));
      });
    }
    if (sw) {
      const ang = THREE.MathUtils.clamp(a.swing, 0, 1) * THREE.MathUtils.degToRad(sw.swingDeg);
      swingG.rotation.z = ang; // up and over the top toward the front
      levelG.rotation.z = -ang; // the claw stays level as it swings
    }
    wristG.rotation.x = a.wrist;
    const open = 1 - THREE.MathUtils.clamp(a.claw, 0, 1);
    fingers.forEach((f, i) => (f.position.z = (i === 0 ? -1 : 1) * (1.0 + open * 1.4) * IN));
    for (const r of rollerMeshes) r.rotation.y += a.intake * 0.5;
    for (const w of wheels) w.rotation.z = -a.wheelSpin;
  };
  animate({ intake: 0, lift: liftMin, claw: 1, wrist: 0, wheelSpin: 0, swing: 0 });

  return { root, animate, carry, liftRange: [liftMin, liftMax], swingArm: !!sw };
}
