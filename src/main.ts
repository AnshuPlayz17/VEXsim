import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import './style.css';
import * as THREE from 'three';
import { loadSettings, type Settings } from './config';
import { Input } from './core/input';
import { environmentMap } from './core/venue';
import { unlockAudio } from './core/audio';
import { isTimedDrill } from './core/stats';
import { Session, type SessionResult } from './session';
import { Hud } from './ui/hud';
import { Ui, robotFor, type UiHost } from './ui/menu';
import { OverrideGame } from './games/override/game';
import type { GameDef, GameId } from './games/types';

class App implements UiHost {
  settings: Settings = loadSettings();
  games: Record<GameId, GameDef> = { override: OverrideGame };
  private renderer: THREE.WebGLRenderer;
  private input = new Input();
  private hud = new Hud();
  private ui = new Ui(this);
  private session: Session | null = null;
  private showingResults = false;
  private starting = false;
  private last = performance.now();
  /** Ultra quality: ambient occlusion (contact shadows under pieces, in Goal corners). */
  private composer: EffectComposer | null = null;

  constructor() {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    document.getElementById('viewport')!.appendChild(this.renderer.domElement);
    window.addEventListener('resize', () => this.resize());
    this.resize();
    this.hud.onRestart = () => this.restart();
    window.addEventListener('keydown', (e) => {
      if (this.showingResults && e.code === 'Enter') {
        e.preventDefault();
        this.restart();
      }
    });
    window.addEventListener('gamepadconnected', (e) => this.hud.toast(/vex|2888/i.test(e.gamepad.id) ? 'VEX V5 Controller connected' : `Gamepad connected: ${e.gamepad.id.slice(0, 40)}`, 'good'));
    this.ui.home();
    requestAnimationFrame((t) => this.loop(t));
  }

  private resize(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const q = this.settings.quality;
    const ratio = q === 'ultra' ? Math.min(window.devicePixelRatio, 2) : q === 'high' ? Math.min(window.devicePixelRatio, 1.5) : 1;
    this.renderer.setPixelRatio(ratio);
    this.renderer.setSize(w, h);
    this.session?.rig.resize(w, h);
    this.composer?.setSize(w, h);
  }

  private buildComposer(s: Session): void {
    this.composer?.dispose();
    this.composer = null;
    if (this.settings.quality !== 'ultra') return;
    const w = window.innerWidth;
    const h = window.innerHeight;
    const size = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    const target = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: 4 });
    const c = new EffectComposer(this.renderer, target);
    c.addPass(new RenderPass(s.scene, s.rig.camera));
    const ao = new GTAOPass(s.scene, s.rig.camera, w, h);
    ao.updateGtaoMaterial({ radius: 0.08, distanceExponent: 1, thickness: 1, scale: 1, samples: 12 });
    ao.blendIntensity = 0.85;
    c.addPass(ao);
    c.addPass(new OutputPass());
    c.setSize(w, h);
    this.composer = c;
  }

  private loop(t: number): void {
    const dt = (t - this.last) / 1000;
    this.last = t;
    const s = this.session;
    if (s) {
      s.frame(dt);
      if (this.composer) this.composer.render(dt);
      else this.renderer.render(s.scene, s.rig.camera);
    }
    requestAnimationFrame((tt) => this.loop(tt));
  }

  async start(): Promise<void> {
    if (this.starting) return;
    this.starting = true;
    unlockAudio();
    this.showingResults = false;
    this.disposeSession();
    this.ui.hide();
    const loading = document.getElementById('loading')!;
    loading.hidden = false;
    try {
      const game = this.games[this.settings.game];
      const mode = this.settings.mode[game.id];
      const station = game.stations.find((st) => st.id === this.settings.station[game.id]) ?? game.stations[0];
      const cfg = robotFor(game, this.settings);
      this.renderer.shadowMap.enabled = this.settings.quality !== 'low';
      this.resize();
      const session = new Session(
        game,
        mode,
        cfg,
        station,
        this.settings,
        this.input,
        this.hud,
        (r) => this.onEnd(r),
        (p) => (p ? this.ui.pause() : this.ui.hide()),
      );
      await session.init();
      session.rig.resize(window.innerWidth, window.innerHeight);
      session.scene.environment = environmentMap(this.renderer);
      session.scene.environmentIntensity = 0.55;
      this.session = session;
      this.buildComposer(session);
      (window as unknown as { __vexsim: Session }).__vexsim = session;
      (window as unknown as { __vexrenderer: THREE.WebGLRenderer }).__vexrenderer = this.renderer;
      this.hud.show(true);
      this.hud.showHelp(false);
    } catch (err) {
      console.error(err);
      alert(`Could not start the simulator: ${(err as Error).message}`);
      this.ui.setup();
    } finally {
      loading.hidden = true;
      this.starting = false;
    }
  }

  resume(): void {
    if (this.session?.paused) this.session.togglePause();
  }

  restart(): void {
    void this.start();
  }

  endRun(): void {
    const s = this.session;
    if (!s) return;
    this.ui.hide();
    s.finish(!isTimedDrill(s.mode));
  }

  quitToMenu(): void {
    this.showingResults = false;
    this.disposeSession();
    this.hud.show(false);
    this.ui.setup();
  }

  private onEnd(r: SessionResult): void {
    // Leave the final field state on screen behind the results.
    this.showingResults = true;
    setTimeout(() => {
      if (this.session && this.showingResults) {
        this.hud.show(false);
        this.ui.results(r);
      }
    }, 900);
  }

  private disposeSession(): void {
    if (this.session) {
      this.session.dispose();
      this.session = null;
    }
  }
}

function boot(): void {
  try {
    const c = document.createElement('canvas');
    if (!c.getContext('webgl2') && !c.getContext('webgl')) throw new Error('no webgl');
  } catch {
    document.getElementById('overlay')!.innerHTML =
      '<div class="modal"><h2>WebGL unavailable</h2><p>VEXsim needs a browser with WebGL enabled (Chrome, Edge, Firefox or Safari).</p></div>';
    return;
  }
  new App();
}

boot();
