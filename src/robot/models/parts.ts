import * as THREE from 'three';
import { IN } from '../../core/units';

/**
 * Small library of robot parts (VEX and FRC) built from primitives, so robot
 * models read like the real thing without shipping any CAD files.
 * Conventions: robot-local +X is forward, +Y up, +Z to the robot's right.
 */

export interface ModelCtx {
  ghost: boolean;
  /** Materials are cached per color so a robot shares them across parts. */
  mats: Map<string, THREE.Material>;
}

export function makeCtx(ghost: boolean): ModelCtx {
  return { ghost, mats: new Map() };
}

export function mat(
  ctx: ModelCtx,
  color: number,
  o: { metal?: number; rough?: number; opacity?: number; emissive?: number; map?: THREE.Texture; side?: THREE.Side } = {},
): THREE.Material {
  const key = `${color}|${o.metal ?? 0.2}|${o.rough ?? 0.6}|${o.opacity ?? 1}|${o.emissive ?? 0}|${o.map?.uuid ?? ''}|${o.side ?? 0}`;
  let m = ctx.mats.get(key);
  if (!m) {
    const opacity = ctx.ghost ? Math.min(0.3, o.opacity ?? 1) : (o.opacity ?? 1);
    m = new THREE.MeshStandardMaterial({
      color,
      metalness: o.metal ?? 0.2,
      roughness: o.rough ?? 0.6,
      transparent: opacity < 1,
      opacity,
      depthWrite: opacity >= 1,
      emissive: o.emissive ?? 0,
      map: o.map ?? null,
      side: o.side ?? THREE.FrontSide,
    });
    ctx.mats.set(key, m);
  }
  return m;
}

export function mesh(ctx: ModelCtx, geo: THREE.BufferGeometry, m: THREE.Material, parent: THREE.Object3D, x = 0, y = 0, z = 0): THREE.Mesh {
  const me = new THREE.Mesh(geo, m);
  me.position.set(x, y, z);
  me.castShadow = !ctx.ghost;
  me.receiveShadow = !ctx.ghost;
  parent.add(me);
  return me;
}

/** Scale a BoxGeometry's UVs so a texture tiles at a fixed world size. */
export function tileUV(geo: THREE.BoxGeometry, w: number, h: number, d: number, tile: number): THREE.BoxGeometry {
  const uv = geo.attributes.uv as THREE.BufferAttribute;
  // Face order: +x, -x, +y, -y, +z, -z (4 vertices each).
  const dims: [number, number][] = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
  for (let f = 0; f < 6; f++) {
    for (let v = 0; v < 4; v++) {
      const i = f * 4 + v;
      uv.setXY(i, (uv.getX(i) * dims[f][0]) / tile, (uv.getY(i) * dims[f][1]) / tile);
    }
  }
  uv.needsUpdate = true;
  return geo;
}

let holeTex: THREE.Texture | null = null;
/** VEX metal: square holes on a 0.5" pitch. */
export function vexHoleTexture(): THREE.Texture {
  if (holeTex) return holeTex;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, 64, 64);
  g.fillStyle = '#2a2d31';
  g.fillRect(20, 20, 24, 24);
  holeTex = new THREE.CanvasTexture(c);
  holeTex.wrapS = holeTex.wrapT = THREE.RepeatWrapping;
  holeTex.colorSpace = THREE.SRGBColorSpace;
  holeTex.anisotropy = 4;
  return holeTex;
}

/** A VEX C-channel (1x2x1 by default) along X, holes facing out. */
export function cChannel(ctx: ModelCtx, parent: THREE.Object3D, len: number, x: number, y: number, z: number, o: { color?: number; along?: 'x' | 'y' | 'z'; w?: number; h?: number } = {}): THREE.Group {
  const g = new THREE.Group();
  const w = o.w ?? 1 * IN; // web width
  const h = o.h ?? 0.5 * IN; // flange height
  const t = 0.0016;
  const m = mat(ctx, o.color ?? 0xc9ced4, { metal: 0.75, rough: 0.35, map: vexHoleTexture() });
  const web = tileUV(new THREE.BoxGeometry(len, t, w), len, t, w, 0.5 * IN);
  mesh(ctx, web, m, g, 0, 0, 0);
  for (const s of [-1, 1]) {
    const fl = tileUV(new THREE.BoxGeometry(len, h, t), len, h, t, 0.5 * IN);
    mesh(ctx, fl, m, g, 0, h / 2, (s * w) / 2);
  }
  if (o.along === 'y') g.rotation.z = Math.PI / 2;
  if (o.along === 'z') g.rotation.y = Math.PI / 2;
  g.position.set(x, y, z);
  parent.add(g);
  return g;
}

/** Plain bar (square tube, flat bar, standoff-like). */
export function bar(ctx: ModelCtx, parent: THREE.Object3D, size: [number, number, number], pos: [number, number, number], color: number, o: { metal?: number; rough?: number; opacity?: number } = {}): THREE.Mesh {
  return mesh(ctx, new THREE.BoxGeometry(...size), mat(ctx, color, { metal: o.metal ?? 0.6, rough: o.rough ?? 0.4, opacity: o.opacity }), parent, ...pos);
}

/** Standoff between two points (VEX). */
export function standoff(ctx: ModelCtx, parent: THREE.Object3D, a: THREE.Vector3, b: THREE.Vector3, r = 0.003): THREE.Mesh {
  const len = a.distanceTo(b);
  const m = mesh(ctx, new THREE.CylinderGeometry(r, r, len, 6), mat(ctx, 0xb0b5bb, { metal: 0.8, rough: 0.3 }), parent);
  m.position.copy(a).add(b).multiplyScalar(0.5);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
  return m;
}

const CARTRIDGE = { red: 0xd23b2f, green: 0x3aa655, blue: 0x2f6fd6 } as const;
/** V5 Smart Motor (11W): black body with a colored gear-cartridge cap. Shaft along Z. */
export function v5Motor(ctx: ModelCtx, parent: THREE.Object3D, x: number, y: number, z: number, cart: keyof typeof CARTRIDGE = 'blue', faceZ = 1): THREE.Group {
  const g = new THREE.Group();
  mesh(ctx, new THREE.BoxGeometry(2.3 * IN, 2.3 * IN, 1.6 * IN), mat(ctx, 0x1a1b1e, { rough: 0.7 }), g, 0, 0, 0);
  const cap = mesh(ctx, new THREE.CylinderGeometry(0.8 * IN, 0.8 * IN, 0.25 * IN, 18), mat(ctx, CARTRIDGE[cart], { rough: 0.5 }), g, 0, 0, faceZ * 0.9 * IN);
  cap.rotation.x = Math.PI / 2;
  // red status LED
  mesh(ctx, new THREE.BoxGeometry(0.2 * IN, 0.1 * IN, 0.1 * IN), mat(ctx, 0xff3030, { emissive: 0xff2020 }), g, 0.9 * IN, 1.15 * IN, 0);
  g.position.set(x, y, z);
  parent.add(g);
  return g;
}

/** V5 Robot Brain with its touchscreen facing up. */
export function v5Brain(ctx: ModelCtx, parent: THREE.Object3D, x: number, y: number, z: number): THREE.Group {
  const g = new THREE.Group();
  mesh(ctx, new THREE.BoxGeometry(4.4 * IN, 1.1 * IN, 3.2 * IN), mat(ctx, 0x16171a, { rough: 0.5 }), g);
  mesh(ctx, new THREE.BoxGeometry(3.4 * IN, 0.02 * IN, 2.2 * IN), mat(ctx, 0x0b2a4a, { emissive: 0x0a3a6a, rough: 0.2 }), g, -0.3 * IN, 0.56 * IN, 0);
  mesh(ctx, new THREE.BoxGeometry(0.5 * IN, 0.05 * IN, 0.5 * IN), mat(ctx, 0xc0c0c0, { metal: 0.6 }), g, 1.7 * IN, 0.56 * IN, 1 * IN);
  g.position.set(x, y, z);
  parent.add(g);
  return g;
}

export function v5Battery(ctx: ModelCtx, parent: THREE.Object3D, x: number, y: number, z: number): void {
  mesh(ctx, new THREE.BoxGeometry(5.3 * IN, 1.7 * IN, 2.5 * IN), mat(ctx, 0x2b2e33, { rough: 0.7 }), parent, x, y, z);
  mesh(ctx, new THREE.BoxGeometry(3 * IN, 0.02 * IN, 1.6 * IN), mat(ctx, 0xd8d8d8, { rough: 0.8 }), parent, x, y + 0.86 * IN, z);
}

/** Omni wheel (VEX or FRC): hub + rollers around the rim. Axle along Z. Returns spinning group. */
export function omniWheel(ctx: ModelCtx, parent: THREE.Object3D, dia: number, width: number, x: number, y: number, z: number, o: { hub?: number; roller?: number; rollers?: number } = {}): THREE.Group {
  const g = new THREE.Group();
  const r = dia / 2;
  const hub = mesh(ctx, new THREE.CylinderGeometry(r * 0.78, r * 0.78, width * 0.8, 20), mat(ctx, o.hub ?? 0x3a3d42, { rough: 0.5, metal: 0.3 }), g);
  hub.rotation.x = Math.PI / 2;
  const n = o.rollers ?? 12;
  const rollGeo = new THREE.CylinderGeometry(r * 0.17, r * 0.17, (2 * Math.PI * r) / n * 0.85, 8);
  const rm = mat(ctx, o.roller ?? 0x18191b, { rough: 0.9 });
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const roller = mesh(ctx, rollGeo, rm, g, Math.cos(a) * r * 0.86, Math.sin(a) * r * 0.86, ((i % 2) - 0.5) * width * 0.3);
    roller.rotation.z = a;
  }
  g.position.set(x, y, z);
  parent.add(g);
  return g;
}

/** Plain traction wheel. Axle along Z. */
export function tractionWheel(ctx: ModelCtx, parent: THREE.Object3D, dia: number, width: number, x: number, y: number, z: number, tread = 0x1a1a1a): THREE.Group {
  const g = new THREE.Group();
  const t = mesh(ctx, new THREE.CylinderGeometry(dia / 2, dia / 2, width, 22), mat(ctx, tread, { rough: 0.95 }), g);
  t.rotation.x = Math.PI / 2;
  const hub = mesh(ctx, new THREE.CylinderGeometry(dia * 0.3, dia * 0.3, width * 1.05, 14), mat(ctx, 0x8a9096, { metal: 0.6 }), g);
  hub.rotation.x = Math.PI / 2;
  g.position.set(x, y, z);
  parent.add(g);
  return g;
}

/** Flex wheel / roller across Z (VEX intakes). Returns the spinning mesh. */
export function roller(ctx: ModelCtx, parent: THREE.Object3D, dia: number, len: number, x: number, y: number, z: number, color = 0x2fae4f): THREE.Mesh {
  const geo = new THREE.CylinderGeometry(dia / 2, dia / 2, len, 14, 1);
  const r = mesh(ctx, geo, mat(ctx, color, { rough: 0.85 }), parent, x, y, z);
  r.rotation.x = Math.PI / 2;
  return r;
}

/** Canvas texture with team number text (FRC bumpers). */
export function numberTexture(text: string, bg: string, fg: string): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 96;
  const g = c.getContext('2d')!;
  g.fillStyle = bg;
  g.fillRect(0, 0, 512, 96);
  // subtle fabric weave
  for (let i = 0; i < 1600; i++) {
    g.fillStyle = `rgba(0,0,0,${Math.random() * 0.08})`;
    g.fillRect(Math.random() * 512, Math.random() * 96, 2, 2);
  }
  g.fillStyle = fg;
  g.font = 'bold 66px Arial, Helvetica, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, 256, 52);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** Netting (hopper covers). */
let netTex: THREE.Texture | null = null;
export function netTexture(): THREE.Texture {
  if (netTex) return netTex;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  g.clearRect(0, 0, 64, 64);
  g.strokeStyle = 'rgba(20,20,20,0.95)';
  g.lineWidth = 3;
  g.beginPath();
  g.moveTo(0, 0); g.lineTo(64, 64);
  g.moveTo(64, 0); g.lineTo(0, 64);
  g.stroke();
  netTex = new THREE.CanvasTexture(c);
  netTex.wrapS = netTex.wrapT = THREE.RepeatWrapping;
  netTex.repeat.set(8, 8);
  return netTex;
}

export function disposeGroup(root: THREE.Object3D): void {
  root.traverse((o) => {
    if (o instanceof THREE.Mesh) o.geometry.dispose();
  });
}
