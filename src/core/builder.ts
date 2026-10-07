import * as THREE from 'three';
import { ConvexGeometry } from 'three/addons/geometries/ConvexGeometry.js';
import { RAPIER, FIELD_GROUPS, OVERHEAD_GROUPS } from './physics';

export type ColliderKind = 'field' | 'overhead' | false;

export interface BoxOpts {
  center: [number, number, number];
  size: [number, number, number];
  color?: number;
  material?: THREE.Material;
  yaw?: number;
  collider?: ColliderKind;
  shadow?: boolean;
  friction?: number;
  restitution?: number;
}

/** Builds visual meshes and their matching static colliders in one call. */
export class FieldBuilder {
  private mats = new Map<string, THREE.Material>();
  readonly group = new THREE.Group();

  constructor(public world: RAPIER.World, scene: THREE.Scene) {
    scene.add(this.group);
  }

  mat(color: number, opts: { opacity?: number; metal?: number; rough?: number; emissive?: number } = {}): THREE.Material {
    const key = `${color}-${opts.opacity ?? 1}-${opts.metal ?? 0}-${opts.rough ?? 0.7}-${opts.emissive ?? 0}`;
    let m = this.mats.get(key);
    if (!m) {
      m = new THREE.MeshStandardMaterial({
        color,
        roughness: opts.rough ?? 0.7,
        metalness: opts.metal ?? 0,
        transparent: (opts.opacity ?? 1) < 1,
        opacity: opts.opacity ?? 1,
        depthWrite: (opts.opacity ?? 1) >= 1,
        emissive: opts.emissive ?? 0x000000,
      });
      this.mats.set(key, m);
    }
    return m;
  }

  private colliderGroups(kind: ColliderKind): number {
    return kind === 'overhead' ? OVERHEAD_GROUPS : FIELD_GROUPS;
  }

  box(o: BoxOpts): THREE.Mesh {
    const [w, h, d] = o.size;
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), o.material ?? this.mat(o.color ?? 0x888888));
    mesh.position.set(...o.center);
    mesh.rotation.y = o.yaw ?? 0;
    const shadow = o.shadow ?? true;
    mesh.castShadow = shadow;
    mesh.receiveShadow = true;
    this.group.add(mesh);
    if (o.collider !== false) {
      const desc = RAPIER.ColliderDesc.cuboid(w / 2, h / 2, d / 2)
        .setTranslation(...o.center)
        .setRotation(yawQuat(o.yaw ?? 0))
        .setCollisionGroups(this.colliderGroups(o.collider ?? 'field'))
        .setFriction(o.friction ?? 0.6)
        .setRestitution(o.restitution ?? 0.1);
      this.world.createCollider(desc);
    }
    return mesh;
  }

  cylinder(o: {
    center: [number, number, number];
    radius: number;
    height: number;
    color?: number;
    material?: THREE.Material;
    collider?: ColliderKind;
    segments?: number;
  }): THREE.Mesh {
    const mesh = new THREE.Mesh(
      new THREE.CylinderGeometry(o.radius, o.radius, o.height, o.segments ?? 28),
      o.material ?? this.mat(o.color ?? 0x888888),
    );
    mesh.position.set(...o.center);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    this.group.add(mesh);
    if (o.collider !== false) {
      this.world.createCollider(
        RAPIER.ColliderDesc.cylinder(o.height / 2, o.radius)
          .setTranslation(...o.center)
          .setCollisionGroups(this.colliderGroups(o.collider ?? 'field')),
      );
    }
    return mesh;
  }

  /** Convex solid from a point cloud (ramps, bumps). */
  convex(points: [number, number, number][], color: number, collider: ColliderKind = 'field'): THREE.Mesh {
    const vecs = points.map((p) => new THREE.Vector3(...p));
    const geo = new ConvexGeometry(vecs);
    const mesh = new THREE.Mesh(geo, this.mat(color));
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    this.group.add(mesh);
    if (collider !== false) {
      const desc = RAPIER.ColliderDesc.convexHull(new Float32Array(points.flat()));
      if (desc) this.world.createCollider(desc.setCollisionGroups(this.colliderGroups(collider)).setFriction(0.9));
    }
    return mesh;
  }

  /** Static collider only (no mesh). */
  solid(center: [number, number, number], size: [number, number, number], kind: ColliderKind = 'field'): void {
    this.world.createCollider(
      RAPIER.ColliderDesc.cuboid(size[0] / 2, size[1] / 2, size[2] / 2)
        .setTranslation(...center)
        .setCollisionGroups(this.colliderGroups(kind)),
    );
  }

  /** Flat textured plane lying on the floor (markings, tape lines). */
  decal(texture: THREE.Texture, width: number, depth: number, y = 0.001): THREE.Mesh {
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(width, depth),
      new THREE.MeshStandardMaterial({ map: texture, roughness: 0.95 }),
    );
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.y = y;
    mesh.receiveShadow = true;
    this.group.add(mesh);
    return mesh;
  }

  /** Floor collider (thick slab under y = 0). */
  floor(width: number, depth: number): void {
    this.world.createCollider(
      RAPIER.ColliderDesc.cuboid(width / 2 + 2, 0.25, depth / 2 + 2)
        .setTranslation(0, -0.25, 0)
        .setCollisionGroups(FIELD_GROUPS)
        .setFriction(0.8),
    );
  }

  /** Floor tape line. */
  line(x1: number, z1: number, x2: number, z2: number, width: number, color: number, y = 0.002): THREE.Mesh {
    const len = Math.hypot(x2 - x1, z2 - z1);
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(len, width), this.mat(color, { rough: 0.9 }));
    mesh.rotation.x = -Math.PI / 2;
    mesh.rotation.z = -Math.atan2(z2 - z1, x2 - x1);
    mesh.position.set((x1 + x2) / 2, y, (z1 + z2) / 2);
    mesh.receiveShadow = true;
    this.group.add(mesh);
    return mesh;
  }
}

export function yawQuat(yaw: number): { x: number; y: number; z: number; w: number } {
  return { x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) };
}

/** Canvas texture helper. */
export function canvasTexture(
  w: number,
  h: number,
  draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void,
): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d')!;
  draw(ctx, w, h);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}
