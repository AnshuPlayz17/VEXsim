import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import type { RobotConfig } from '../robot/robot';

/** Renders small 3D portraits of robots for the setup screen (cached). */
let renderer: THREE.WebGLRenderer | null = null;
let env: THREE.Texture | null = null;
const cache = new Map<string, string>();

export function robotThumb(cfg: RobotConfig, alliance: 'red' | 'blue'): string {
  const key = `${cfg.id}:${alliance}`;
  const hit = cache.get(key);
  if (hit) return hit;
  try {
    if (!renderer) {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
      renderer.setSize(320, 220);
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      const pm = new THREE.PMREMGenerator(renderer);
      env = pm.fromScene(new RoomEnvironment(), 0.04).texture;
      pm.dispose();
    }
    const scene = new THREE.Scene();
    scene.environment = env;
    scene.add(new THREE.HemisphereLight(0xffffff, 0x404040, 0.8));
    const sun = new THREE.DirectionalLight(0xffffff, 1.6);
    sun.position.set(2, 4, 3);
    scene.add(sun);
    const model = cfg.model(alliance, false);
    const range = model.liftRange ?? [0.05, 0.5];
    model.animate({ intake: 0, lift: range[0] + (range[1] - range[0]) * 0.35, claw: 1, wrist: 0, wheelSpin: 0, swing: 0 }, 0);
    scene.add(model.root);
    const box = new THREE.Box3().setFromObject(model.root);
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3()).length();
    const cam = new THREE.PerspectiveCamera(32, 320 / 220, 0.01, 20);
    cam.position.set(center.x + size * 1.05, center.y + size * 0.65, center.z + size * 1.15);
    cam.lookAt(center);
    renderer.render(scene, cam);
    const url = renderer.domElement.toDataURL('image/png');
    cache.set(key, url);
    model.root.traverse((o) => {
      if (o instanceof THREE.Mesh) o.geometry.dispose();
    });
    return url;
  } catch {
    return '';
  }
}
