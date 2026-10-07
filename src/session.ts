import * as THREE from 'three';
import { RAPIER, initPhysics } from './core/physics';
import { MatchClock, type Phase } from './core/match';
import type { Action, ControlState, Input } from './core/input';
import { CameraRig, CAMERA_LABELS } from './core/camera';
import { playCue } from './core/audio';
import { type GhostTrack, type RunRecord, bestRun, isTimedDrill, loadGhost, loadRuns, saveRun } from './core/stats';
import { Robot, type RobotConfig } from './robot/robot';
import { isHolonomic } from './robot/drivetrain';
import type { Settings } from './config';
import type { DriverStation, GameContext, GameDef, GameRuntime, Gate, MatchSummary, ModeId, ToastKind } from './games/types';
import type { Hud } from './ui/hud';

const PHYS_DT = 1 / 120;
const GHOST_RATE = 20;
const DRILL_LIMIT = 300;

export interface SessionResult {
  game: GameDef;
  mode: ModeId;
  record: RunRecord;
  summary: MatchSummary;
  isBest: boolean;
  previousBest?: RunRecord;
  track: GhostTrack;
  ghost: GhostTrack | null;
  footprints: ReturnType<GameRuntime['footprints']>;
  gates: Gate[];
}

type RunState = 'countdown' | 'running' | 'paused' | 'ended';

export class Session {
  readonly scene = new THREE.Scene();
  world!: RAPIER.World;
  robot!: Robot;
  runtime!: GameRuntime;
  rig!: CameraRig;
  clock!: MatchClock;
  private ghostRobot: Robot | null = null;
  private ghost: GhostTrack | null = null;
  private state: RunState = 'countdown';
  private countdown = 0;
  private acc = 0;
  private runTime = 0;
  private fieldOriented: boolean;
  private lastPhase: Phase | null = null;
  private track: number[] = [];
  private trackAcc = 0;
  private gates: Gate[] = [];
  private gateIdx = 0;
  private gateMeshes: THREE.Group[] = [];
  private prevPos: [number, number] = [0, 0];
  private cycles: number[] = [];
  private pieces = 0;
  private lastBurst = -1;
  private lastScoreAt = -Infinity;
  private intakeSinceBurst = true;
  private hudTimer = 0;
  private lastWarnSecond = -1;
  private ctl: ControlState | null = null;
  private resultSent = false;
  helpVisible = false;

  constructor(
    readonly game: GameDef,
    readonly mode: ModeId,
    readonly cfg: RobotConfig,
    readonly station: DriverStation,
    private settings: Settings,
    private input: Input,
    private hud: Hud,
    private onEnd: (r: SessionResult) => void,
    private onPauseChange: (paused: boolean) => void,
  ) {
    this.fieldOriented = settings.fieldOriented;
  }

  async init(): Promise<void> {
    await initPhysics();
    this.world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    this.world.timestep = PHYS_DT;
    this.buildEnvironment();

    const poses = this.game.startPoses(this.station.alliance);
    const pose = poses[Math.min(this.settings.startIndex, poses.length - 1)];
    this.robot = new Robot(this.world, this.scene, this.cfg, this.station.alliance, pose);
    this.clock = new MatchClock(this.game.phases(this.mode));

    const ctx: GameContext = {
      scene: this.scene,
      world: this.world,
      robot: this.robot,
      clock: this.clock,
      mode: this.mode,
      settings: this.settings,
      toast: (t, k) => this.toast(t, k),
      scored: (n) => this.onScored(n),
      intook: () => (this.intakeSinceBurst = true),
      beep: (k) => this.beep(k),
    };
    this.runtime = this.game.create(ctx);
    this.rig = new CameraRig(this.settings.camera, this.station, { x: this.game.fieldX, z: this.game.fieldZ });

    if (this.mode === 'gates') this.buildGates();
    if (this.settings.showGhost && this.mode !== 'free') this.spawnGhost();

    // Let pieces settle before the clock starts.
    for (let i = 0; i < 60; i++) this.world.step();
    this.countdown = this.settings.countdown ? 3 : 0;
    this.state = this.countdown > 0 ? 'countdown' : 'running';
    if (this.state === 'running') this.beep('start');
    this.prevPos = [this.robot.x, this.robot.z];
    this.hud.setTitle(`${this.game.program} ${this.game.name}`, this.game.modes.find((m) => m.id === this.mode)?.label ?? '');
    this.hud.setAlliance(this.station.alliance);
    this.toast(`${CAMERA_LABELS[this.rig.mode]} camera · press C / Y to switch`, 'info');
  }

  private buildEnvironment(): void {
    const s = this.scene;
    s.background = new THREE.Color(0x0d1117);
    s.fog = new THREE.Fog(0x0d1117, 25, 70);
    const hemi = new THREE.HemisphereLight(0xdfe8ff, 0x30343a, 1.1);
    s.add(hemi);
    const sun = new THREE.DirectionalLight(0xffffff, 2.1);
    const span = Math.max(this.game.fieldX, this.game.fieldZ);
    sun.position.set(span * 0.18, span * 1.3, span * 0.28);
    sun.castShadow = this.settings.quality === 'high';
    sun.shadow.mapSize.set(2048, 2048);
    const sc = sun.shadow.camera;
    sc.left = -span * 0.65;
    sc.right = span * 0.65;
    sc.top = span * 0.65;
    sc.bottom = -span * 0.65;
    sc.near = 0.5;
    sc.far = span * 3;
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.02;
    s.add(sun);
    // Arena floor and a few overhead lights for depth.
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(span * 6, span * 6),
      new THREE.MeshStandardMaterial({ color: 0x1b1f26, roughness: 1 }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -0.005;
    floor.receiveShadow = true;
    s.add(floor);
    const grid = new THREE.GridHelper(span * 6, 60, 0x2a313b, 0x20262e);
    grid.position.y = -0.003;
    s.add(grid);
  }

  private spawnGhost(): void {
    const g = loadGhost(this.game.id, this.mode);
    if (!g || g.data.length < 6) return;
    this.ghost = g;
    this.ghostRobot = new Robot(this.world, this.scene, this.cfg, this.station.alliance, { x: g.data[0], z: g.data[1], heading: g.data[2] }, { ghost: true });
    this.ghostRobot.mesh.visible = true;
  }

  private buildGates(): void {
    this.gates = this.game.gates();
    for (let i = 0; i < this.gates.length; i++) {
      const g = this.gates[i];
      const group = new THREE.Group();
      const mat = new THREE.MeshStandardMaterial({ color: 0x5ce1e6, emissive: 0x5ce1e6, emissiveIntensity: 0.4, transparent: true, opacity: 0.9 });
      const h = Math.max(0.5, this.cfg.height + 0.25);
      for (const s of [-1, 1]) {
        const post = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, h, 10), mat);
        post.position.set(0, h / 2, (s * g.width) / 2);
        group.add(post);
      }
      const bar = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.03, g.width), mat);
      bar.position.y = h;
      group.add(bar);
      const label = makeLabel(String(i + 1));
      label.position.set(0, h + 0.18, 0);
      group.add(label);
      group.position.set(g.x, 0, g.z);
      // Gate line direction (cos yaw, -sin yaw) is the group's local +z after rotation.
      group.rotation.y = g.yaw + Math.PI / 2;
      this.scene.add(group);
      this.gateMeshes.push(group);
    }
    this.refreshGates();
  }

  private refreshGates(): void {
    this.gateMeshes.forEach((g, i) => {
      const color = i < this.gateIdx ? 0x3a4250 : i === this.gateIdx ? 0x46f07a : 0x5ce1e6;
      g.traverse((o) => {
        if (o instanceof THREE.Mesh && o.material instanceof THREE.MeshStandardMaterial) {
          o.material.color.setHex(color);
          o.material.emissive.setHex(color);
          o.material.emissiveIntensity = i === this.gateIdx ? 0.9 : 0.25;
        }
      });
    });
  }

  private checkGate(): void {
    if (this.gateIdx >= this.gates.length) return;
    const g = this.gates[this.gateIdx];
    const dx = Math.cos(g.yaw);
    const dz = -Math.sin(g.yaw);
    const ax = g.x - (dx * g.width) / 2;
    const az = g.z - (dz * g.width) / 2;
    const bx = g.x + (dx * g.width) / 2;
    const bz = g.z + (dz * g.width) / 2;
    if (segmentsIntersect(this.prevPos[0], this.prevPos[1], this.robot.x, this.robot.z, ax, az, bx, bz)) {
      this.gateIdx++;
      this.refreshGates();
      this.beep('score');
      if (this.gateIdx >= this.gates.length) {
        this.toast(`Course complete: ${this.runTime.toFixed(2)}s`, 'good');
        this.finish(true);
      } else {
        this.toast(`Gate ${this.gateIdx}/${this.gates.length} · ${this.runTime.toFixed(2)}s`, 'good');
      }
    }
  }

  private onScored(n: number): void {
    const t = this.runTime;
    this.pieces += n;
    // Pieces scored within 1.5 s of each other count as one cycle ("burst").
    if (t - this.lastScoreAt > 1.5 && this.intakeSinceBurst) {
      if (this.lastBurst >= 0) this.cycles.push(t - this.lastBurst);
      this.lastBurst = t;
      this.intakeSinceBurst = false;
    }
    this.lastScoreAt = t;
    if (this.mode === 'sprint' && this.runtime.piecesScored() >= this.game.sprint.count) {
      this.toast(`Sprint complete: ${this.runTime.toFixed(2)}s`, 'good');
      this.finish(true);
    }
  }

  private toast(text: string, kind: ToastKind = 'info'): void {
    this.hud.toast(text, kind);
  }

  private beep(kind: 'start' | 'end' | 'warn' | 'phase' | 'score'): void {
    if (this.settings.sound) playCue(kind);
  }

  togglePause(): void {
    if (this.state === 'ended') return;
    if (this.state === 'paused') {
      this.state = this.countdown > 0 ? 'countdown' : 'running';
      this.onPauseChange(false);
    } else {
      this.state = 'paused';
      this.onPauseChange(true);
    }
  }

  get paused(): boolean {
    return this.state === 'paused';
  }

  /** Called once per animation frame. */
  frame(realDt: number): void {
    const dt = Math.min(realDt, 0.1);
    const ctl = this.input.poll(this.cfg.drive);
    this.ctl = ctl;
    for (const a of ctl.actions) this.handleAction(a);

    if (this.state === 'countdown') {
      const before = Math.ceil(this.countdown);
      this.countdown -= dt;
      const after = Math.ceil(this.countdown);
      if (after !== before && after > 0 && this.settings.sound) playCue('count');
      this.hud.countdown(after > 0 ? String(after) : null);
      if (this.countdown <= 0) {
        this.state = 'running';
        this.hud.countdown(null);
        this.beep('start');
      }
    }

    if (this.state === 'countdown' || this.state === 'running') {
      this.acc += dt;
      let steps = 0;
      while (this.acc >= PHYS_DT && steps < 10) {
        this.step(PHYS_DT, ctl);
        this.acc -= PHYS_DT;
        steps++;
      }
      if (steps === 10) this.acc = 0;
    }

    this.robot.syncVisual();
    if (this.ghostRobot) this.ghostRobot.syncVisual(1);
    this.runtime.render();
    this.rig.update(this.robot, dt);
    this.updateHud(dt);
  }

  private step(dt: number, ctl: ControlState): void {
    const running = this.state === 'running';
    if (running) {
      this.clock.advance(dt);
      this.runTime += dt;
      const ph = this.clock.phase;
      if (ph !== this.lastPhase) {
        this.runtime.onPhaseChange(this.lastPhase, ph);
        if (this.lastPhase && ph) {
          this.toast(ph.label, 'info');
          this.beep(ph.kind === 'break' ? 'end' : 'phase');
        }
        this.lastPhase = ph;
      }
    }
    const enabled = running && this.clock.enabled;
    this.robot.update(
      dt,
      { lx: ctl.lx, ly: ctl.ly, rx: ctl.rx, ry: ctl.ry, slow: ctl.slow, fieldOriented: this.fieldOriented },
      enabled,
      this.station.yaw,
      this.settings.tuning,
    );
    this.runtime.update(dt, enabled ? ctl : { ...ctl, intake: false, outtake: false, score: false, climb: false });
    this.world.step();

    if (running) {
      if (this.mode === 'gates') this.checkGate();
      this.prevPos = [this.robot.x, this.robot.z];
      this.trackAcc += dt;
      if (this.trackAcc >= 1 / GHOST_RATE) {
        this.trackAcc -= 1 / GHOST_RATE;
        this.track.push(round3(this.robot.x), round3(this.robot.z), round3(this.robot.heading));
        this.moveGhost();
      }
      if (!this.clock.untimed && this.clock.over) this.finish(true);
      if (isTimedDrill(this.mode) && this.runTime >= DRILL_LIMIT) this.finish(false);
    }
  }

  private moveGhost(): void {
    if (!this.ghost || !this.ghostRobot) return;
    const idx = Math.min(Math.floor(this.runTime * this.ghost.rate), this.ghost.data.length / 3 - 1);
    const d = this.ghost.data;
    this.ghostRobot.teleport(d[idx * 3], 0.0, d[idx * 3 + 1], d[idx * 3 + 2]);
  }

  private handleAction(a: Action): void {
    switch (a) {
      case 'pause':
        this.togglePause();
        return;
      case 'restart':
        this.hud.requestRestart();
        return;
      case 'camera':
        this.toast(`${CAMERA_LABELS[this.rig.next()]} camera`, 'info');
        return;
      case 'fieldToggle':
        if (!isHolonomic(this.cfg.drive)) {
          this.toast('Field-oriented control needs a holonomic drive', 'info');
          return;
        }
        this.fieldOriented = !this.fieldOriented;
        this.toast(this.fieldOriented ? 'Field-oriented ON' : 'Robot-oriented', 'info');
        return;
      case 'help':
        this.helpVisible = !this.helpVisible;
        this.hud.showHelp(this.helpVisible);
        return;
      case 'ghost':
        if (this.ghostRobot) {
          this.ghostRobot.mesh.visible = !this.ghostRobot.mesh.visible;
          this.toast(this.ghostRobot.mesh.visible ? 'Ghost shown' : 'Ghost hidden', 'info');
        } else {
          this.toast('No best-run ghost yet for this mode', 'info');
        }
        return;
      default:
        if (this.state === 'running' || this.state === 'countdown') this.runtime.onAction(a);
    }
  }

  private updateHud(dt: number): void {
    const clock = this.clock;
    let timeText: string;
    let phaseText: string;
    let urgent = false;
    if (isTimedDrill(this.mode)) {
      timeText = this.runTime.toFixed(1);
      phaseText = this.mode === 'gates' ? `GATE ${Math.min(this.gateIdx + 1, this.gates.length)}/${this.gates.length}` : `${this.runtime.piecesScored()}/${this.game.sprint.count} ${this.game.sprint.label}`;
    } else if (clock.untimed) {
      timeText = formatElapsed(this.runTime);
      phaseText = 'FREE PRACTICE';
    } else {
      const rem = clock.periodRemaining;
      timeText = formatClockFine(rem);
      phaseText = clock.phase?.label ?? '';
      urgent = clock.phase?.kind === 'endgame' || (rem <= 10 && clock.phase?.kind !== 'break');
      const sec = Math.ceil(clock.total - clock.elapsed);
      if (this.state === 'running' && sec <= 3 && sec > 0 && sec !== this.lastWarnSecond) {
        this.lastWarnSecond = sec;
        this.beep('warn');
      }
    }
    if (this.state === 'paused') phaseText = 'PAUSED';
    const live = this.runtime.liveScore();
    this.hud.frame(timeText, phaseText, urgent, live.mine, live.other, this.robot.speed);
    this.hudTimer -= dt;
    if (this.hudTimer <= 0) {
      this.hudTimer = 0.1;
      this.hud.panels(
        this.runtime.statusHtml(),
        this.runtime.cargoHtml(),
        live.lines,
        {
          drive: this.cfg.drive,
          fieldOriented: isHolonomic(this.cfg.drive) ? this.fieldOriented : null,
          camera: CAMERA_LABELS[this.rig.mode],
          gamepad: this.ctl?.usingGamepad ? this.ctl.gamepadName : null,
          cycles: this.cycles,
        },
      );
    }
  }

  /** End the run and report results. */
  finish(completed: boolean): void {
    if (this.resultSent) return;
    this.resultSent = true;
    this.state = 'ended';
    this.beep('end');
    const summary = this.runtime.finalize();
    const timed = isTimedDrill(this.mode);
    const record: RunRecord = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      date: Date.now(),
      game: this.game.id,
      mode: this.mode,
      robot: this.cfg.name,
      drive: this.cfg.drive,
      score: timed ? null : summary.total,
      time: timed ? (completed ? this.runTime : null) : null,
      completed,
      pieces: this.pieces,
      cycles: this.cycles.map((c) => Math.round(c * 100) / 100),
      distance: this.robot.distance,
      lines: summary.lines,
    };
    const track: GhostTrack = { rate: GHOST_RATE, robot: this.cfg.name, data: this.track };
    const previousBest = bestRun(loadRuns(), this.game.id, this.mode);
    const isBest = saveRun(record, track);
    this.onEnd({
      game: this.game,
      mode: this.mode,
      record,
      summary,
      isBest,
      previousBest,
      track,
      ghost: this.ghost,
      footprints: this.runtime.footprints(),
      gates: this.gates,
    });
  }

  dispose(): void {
    this.runtime?.dispose();
    this.scene.traverse((o) => {
      if (o instanceof THREE.Mesh || o instanceof THREE.InstancedMesh || o instanceof THREE.Line) {
        o.geometry?.dispose();
        const m = o.material as THREE.Material | THREE.Material[];
        if (Array.isArray(m)) m.forEach((x) => x.dispose());
        else m?.dispose();
      }
    });
    this.world?.free();
  }
}

function round3(v: number): number {
  return Math.round(v * 1000) / 1000;
}

function formatClockFine(s: number): string {
  if (s < 10) return Math.max(0, s).toFixed(1);
  const t = Math.ceil(s);
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
}

function formatElapsed(s: number): string {
  const t = Math.floor(s);
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
}

function segmentsIntersect(
  ax: number, az: number, bx: number, bz: number,
  cx: number, cz: number, dx: number, dz: number,
): boolean {
  const cross = (ux: number, uz: number, vx: number, vz: number) => ux * vz - uz * vx;
  const d1 = cross(dx - cx, dz - cz, ax - cx, az - cz);
  const d2 = cross(dx - cx, dz - cz, bx - cx, bz - cz);
  const d3 = cross(bx - ax, bz - az, cx - ax, cz - az);
  const d4 = cross(bx - ax, bz - az, dx - ax, dz - az);
  return d1 * d2 < 0 && d3 * d4 < 0;
}

function makeLabel(text: string): THREE.Sprite {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 64;
  const g = c.getContext('2d')!;
  g.fillStyle = 'rgba(10,14,20,0.8)';
  g.beginPath();
  g.arc(32, 32, 28, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#fff';
  g.font = 'bold 34px system-ui, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, 32, 34);
  const tex = new THREE.CanvasTexture(c);
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false }));
  sprite.scale.set(0.22, 0.22, 0.22);
  return sprite;
}

export { segmentsIntersect };
