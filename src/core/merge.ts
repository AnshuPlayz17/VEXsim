import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/**
 * Cuts draw calls: under every node, the child meshes that never move on their own are
 * merged into one mesh per material (and shadow setting), in that node's space, so a
 * moving group (a lift stage, a wheel) still carries its merged parts with it.
 * Meshes marked `userData.dynamic` (animated themselves, or changed at runtime) are left alone.
 */
export function mergeStatic(root: THREE.Object3D): void {
  const visit = (node: THREE.Object3D) => {
    for (const c of [...node.children]) visit(c);
    // Fold groups that never move (a motor, a wheel hub, a standoff) into this node.
    for (const c of [...node.children]) {
      if (c instanceof THREE.Mesh || c.type !== 'Group' || c.userData.dynamic) continue;
      if (!c.children.every((k) => k instanceof THREE.Mesh && !k.children.length)) continue;
      c.updateMatrix();
      for (const k of [...c.children]) {
        k.updateMatrix();
        k.matrix.premultiply(c.matrix);
        k.matrix.decompose(k.position, k.quaternion, k.scale);
        c.remove(k);
        node.add(k);
      }
      node.remove(c);
    }
    const buckets = new Map<string, THREE.Mesh[]>();
    for (const c of node.children) {
      if (!(c instanceof THREE.Mesh) || c instanceof THREE.InstancedMesh || c instanceof THREE.SkinnedMesh) continue;
      if (c.children.length || c.userData.dynamic || Array.isArray(c.material) || !c.visible || c.renderOrder !== 0) continue;
      const key = `${c.material.uuid}|${c.castShadow ? 1 : 0}${c.receiveShadow ? 1 : 0}`;
      const list = buckets.get(key) ?? [];
      list.push(c);
      buckets.set(key, list);
    }
    for (const meshes of buckets.values()) {
      if (meshes.length < 2) continue;
      const geos = meshes.map((m) => {
        m.updateMatrix();
        let g = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone();
        g.applyMatrix4(m.matrix);
        for (const name of Object.keys(g.attributes)) if (name !== 'position' && name !== 'normal' && name !== 'uv') g.deleteAttribute(name);
        if (!g.getAttribute('normal')) g.computeVertexNormals();
        if (!g.getAttribute('uv')) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.getAttribute('position').count * 2), 2));
        g.clearGroups();
        g.morphAttributes = {};
        return g;
      });
      const merged = mergeGeometries(geos, false);
      for (const g of geos) if (g !== merged) g.dispose();
      if (!merged) continue;
      const first = meshes[0];
      const out = new THREE.Mesh(merged, first.material);
      out.castShadow = first.castShadow;
      out.receiveShadow = first.receiveShadow;
      out.name = 'merged';
      for (const m of meshes) node.remove(m);
      node.add(out);
    }
  };
  visit(root);
}

/** Tag an object as moving on its own (kept out of mergeStatic). */
export function dynamic<T extends THREE.Object3D>(o: T): T {
  o.userData.dynamic = true;
  return o;
}
