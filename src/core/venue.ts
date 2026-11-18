import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

/**
 * The room around the field: a tournament gym with a hardwood floor, alliance
 * stations, a field-control table, bleachers, overhead lights and a live
 * scoreboard screen. Visual only (no physics).
 */
export interface Scoreboard {
  update(o: { time: string; phase: string; red: number; blue: number; title: string }): void;
}

let envCache: THREE.Texture | null = null;
/** Image-based lighting so metal, plastic and polycarbonate reflect the room. */
export function environmentMap(renderer: THREE.WebGLRenderer): THREE.Texture {
  if (envCache) return envCache;
  const pmrem = new THREE.PMREMGenerator(renderer);
  envCache = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  pmrem.dispose();
  return envCache;
}

function canvasTex(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void, repeat?: [number, number]): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d')!);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  if (repeat) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(...repeat);
  }
  return t;
}

export function buildVenue(scene: THREE.Scene, fieldHalf: number, quality: 'high' | 'low'): Scoreboard {
  const root = new THREE.Group();
  scene.add(root);
  scene.background = new THREE.Color(0x15171c);
  scene.fog = new THREE.Fog(0x15171c, 18, 42);

  // Hardwood gym floor with court lines.
  const wood = canvasTex(1024, 1024, (g) => {
    for (let i = 0; i < 32; i++) {
      const base = 95 + Math.random() * 22;
      g.fillStyle = `rgb(${base + 38},${base + 10},${base - 30})`;
      g.fillRect(0, i * 32, 1024, 32);
      g.fillStyle = 'rgba(60,30,10,0.35)';
      g.fillRect(0, i * 32, 1024, 1.5);
      for (let k = 0; k < 6; k++) {
        const x = Math.random() * 1024;
        g.fillRect(x, i * 32, 1.5, 32);
      }
      for (let k = 0; k < 120; k++) {
        g.fillStyle = `rgba(90,50,20,${Math.random() * 0.15})`;
        g.fillRect(Math.random() * 1024, i * 32 + Math.random() * 32, 30 + Math.random() * 80, 1);
      }
    }
  }, [6, 6]);
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(40, 40),
    new THREE.MeshStandardMaterial({ map: wood, roughness: 0.55, metalness: 0 }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -0.006;
  floor.receiveShadow = true;
  root.add(floor);
  const lineMat = new THREE.MeshBasicMaterial({ color: 0x1d4fa0 });
  for (const z of [-7.5, 7.5]) {
    const l = new THREE.Mesh(new THREE.PlaneGeometry(26, 0.06), lineMat);
    l.rotation.x = -Math.PI / 2;
    l.position.set(0, -0.004, z);
    root.add(l);
  }

  // Field is raised on the gym floor by its foam tiles; a black skirt hides the edge.
  const skirt = new THREE.Mesh(
    new THREE.BoxGeometry(fieldHalf * 2 + 0.12, 0.012, fieldHalf * 2 + 0.12),
    new THREE.MeshStandardMaterial({ color: 0x111215, roughness: 0.9 }),
  );
  skirt.position.y = -0.006;
  root.add(skirt);

  // Alliance stations: colored mats behind the red (−X) and blue (+X) walls.
  for (const [sx, color] of [[-1, 0x6e1a16], [1, 0x172f6b]] as const) {
    const mat = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.01, fieldHalf * 2), new THREE.MeshStandardMaterial({ color, roughness: 0.85 }));
    mat.position.set(sx * (fieldHalf + 0.75), -0.001, 0);
    mat.receiveShadow = true;
    root.add(mat);
    const tape = new THREE.Mesh(new THREE.PlaneGeometry(0.05, fieldHalf * 2), new THREE.MeshBasicMaterial({ color: 0xffffff }));
    tape.rotation.x = -Math.PI / 2;
    tape.position.set(sx * (fieldHalf + 1.38), 0.006, 0);
    root.add(tape);
  }

  // Field-control table at the South side with a laptop and the field controller.
  const table = new THREE.Group();
  const tableMat = new THREE.MeshStandardMaterial({ color: 0x2c2f35, roughness: 0.6 });
  const top = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.04, 0.75), new THREE.MeshStandardMaterial({ color: 0xe9e6df, roughness: 0.7 }));
  top.position.y = 0.74;
  table.add(top);
  for (const [x, z] of [[-0.85, -0.33], [0.85, -0.33], [-0.85, 0.33], [0.85, 0.33]]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.74, 0.04), tableMat);
    leg.position.set(x, 0.37, z);
    table.add(leg);
  }
  const laptop = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.02, 0.24), new THREE.MeshStandardMaterial({ color: 0x8a8f96, metalness: 0.6, roughness: 0.3 }));
  laptop.position.set(-0.3, 0.77, 0);
  table.add(laptop);
  const screen = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.22, 0.01), new THREE.MeshStandardMaterial({ color: 0x0a1a33, emissive: 0x153b6e, emissiveIntensity: 0.8 }));
  screen.position.set(-0.3, 0.88, -0.12);
  screen.rotation.x = -0.25;
  table.add(screen);
  table.position.set(0, 0, fieldHalf + 1.7);
  table.traverse((o) => {
    if (o instanceof THREE.Mesh) o.castShadow = o.receiveShadow = true;
  });
  root.add(table);

  // Bleachers along the North side.
  const bleach = new THREE.MeshStandardMaterial({ color: 0x5b6068, metalness: 0.5, roughness: 0.45 });
  for (let i = 0; i < 6; i++) {
    const row = new THREE.Mesh(new THREE.BoxGeometry(16, 0.42, 0.75), bleach);
    row.position.set(0, 0.21 + i * 0.42, -(fieldHalf + 3.6 + i * 0.75));
    row.receiveShadow = true;
    root.add(row);
  }
  // Back walls of the gym, with team banners.
  const wallMat = new THREE.MeshStandardMaterial({ color: 0x2a2d33, roughness: 0.9 });
  const wallN = new THREE.Mesh(new THREE.PlaneGeometry(40, 10), wallMat);
  wallN.position.set(0, 5, -16);
  root.add(wallN);
  for (const [x, z, ry] of [[-16, 0, Math.PI / 2], [16, 0, -Math.PI / 2]] as const) {
    const w = new THREE.Mesh(new THREE.PlaneGeometry(40, 10), wallMat);
    w.position.set(x, 5, z);
    w.rotation.y = ry;
    root.add(w);
  }
  const bannerColors = ['#b3261e', '#1f45a8', '#f2c518', '#2e9b55', '#7b4fd6', '#e8862a'];
  for (let i = 0; i < 10; i++) {
    const tex = canvasTex(128, 256, (g) => {
      g.fillStyle = bannerColors[i % bannerColors.length];
      g.fillRect(0, 0, 128, 256);
      g.fillStyle = 'rgba(255,255,255,0.9)';
      g.font = 'bold 34px Arial';
      g.textAlign = 'center';
      g.fillText(String(1000 + ((i * 7919) % 89000)), 64, 120);
      g.font = 'bold 20px Arial';
      g.fillText(['A', 'B', 'C', 'X', 'Y', 'Z', 'D', 'E', 'F', 'G'][i], 64, 150);
    });
    const b = new THREE.Mesh(new THREE.PlaneGeometry(1, 2), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.9, side: THREE.DoubleSide }));
    b.position.set(-11.25 + i * 2.5, 6.5, -15.9);
    root.add(b);
  }

  // Overhead light fixtures (emissive panels) and the lights they cast.
  const fixtureMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff6e6, emissiveIntensity: 2.2 });
  for (const x of [-4, 0, 4]) for (const z of [-4, 0, 4]) {
    const f = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.08, 0.5), fixtureMat);
    f.position.set(x, 8, z);
    root.add(f);
  }
  const hemi = new THREE.HemisphereLight(0xfff4e6, 0x3a2a1a, 0.55);
  scene.add(hemi);
  const key = new THREE.DirectionalLight(0xfff6ea, 2.4);
  key.position.set(1.2, 9, 2.0);
  key.castShadow = quality === 'high';
  key.shadow.mapSize.set(2048, 2048);
  const sc = key.shadow.camera;
  sc.left = sc.bottom = -fieldHalf - 1.5;
  sc.right = sc.top = fieldHalf + 1.5;
  sc.near = 1;
  sc.far = 20;
  key.shadow.bias = -0.0003;
  key.shadow.normalBias = 0.015;
  key.shadow.radius = 3;
  scene.add(key);
  const fill = new THREE.DirectionalLight(0xdfe8ff, 0.6);
  fill.position.set(-5, 6, -4);
  scene.add(fill);

  // Live scoreboard screen above the bleachers, like the audience display at events.
  const c = document.createElement('canvas');
  c.width = 1024;
  c.height = 512;
  const g = c.getContext('2d')!;
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const board = new THREE.Mesh(new THREE.PlaneGeometry(6, 3), new THREE.MeshBasicMaterial({ map: tex, toneMapped: false }));
  board.position.set(0, 5.2, -15.8);
  root.add(board);
  const frame = new THREE.Mesh(new THREE.BoxGeometry(6.2, 3.2, 0.1), new THREE.MeshStandardMaterial({ color: 0x0b0c0e }));
  frame.position.set(0, 5.2, -15.9);
  root.add(frame);

  let last = '';
  return {
    update({ time, phase, red, blue, title }) {
      const key = `${time}|${phase}|${red}|${blue}|${title}`;
      if (key === last) return;
      last = key;
      g.fillStyle = '#0c0f15';
      g.fillRect(0, 0, 1024, 512);
      g.fillStyle = '#c62828';
      g.fillRect(0, 140, 400, 372);
      g.fillStyle = '#1f45a8';
      g.fillRect(624, 140, 400, 372);
      g.fillStyle = '#ffffff';
      g.textAlign = 'center';
      g.font = 'bold 44px Arial';
      g.fillText(title, 512, 70);
      g.font = 'bold 32px Arial';
      g.fillStyle = '#f2c518';
      g.fillText(phase, 512, 118);
      g.fillStyle = '#ffffff';
      g.font = 'bold 170px Arial';
      g.fillText(String(red), 200, 390);
      g.fillText(String(blue), 824, 390);
      g.font = 'bold 120px Arial';
      g.fillText(time, 512, 360);
      tex.needsUpdate = true;
    },
  };
}
