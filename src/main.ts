import './style.css';
import * as THREE from 'three';
import { loadSettings, type Settings } from './config';
import { Input } from './core/input';
import { unlockAudio } from './core/audio';
import { isTimedDrill } from './core/stats';
import { Session, type SessionResult } from './session';
import { Hud } from './ui/hud';
import { Ui, robotFor, type UiHost } from './ui/menu';
import { OverrideGame } from './games/override/game';
import { RebuiltGame } from './games/rebuilt/game';
import type { GameDef, GameId } from './games/types';

class App implements UiHost {
  settings: Settings = loadSettings();
  games: Record<GameId, GameDef> = { override: OverrideGame, rebuilt: RebuiltGame };
  private renderer: THREE.WebGLRenderer;
  private input = new Input();
  private hud = new Hud();
  private ui = new Ui(this);
  private session: Session | null = null;
  private showingResults = false;
  private starting = false;
  private last = performance.now();

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
    window.addEventListener('gamepadconnected', (e) => this.hud.toast(`Gamepad connected: ${e.gamepad.id.slice(0, 40)}`, 'good'));
    this.ui.home();
    requestAnimationFrame((t) => this.loop(t));
  }

  private resize(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const ratio = this.settings.quality === 'high' ? Math.min(window.devicePixelRatio, 2) : 1;
    this.renderer.setPixelRatio(ratio);
    this.renderer.setSize(w, h);
    this.session?.rig.resize(w, h);
  }

  private loop(t: number): void {
    const dt = (t - this.last) / 1000;
    this.last = t;
    const s = this.session;
    if (s) {
      s.frame(dt);
      this.renderer.render(s.scene, s.rig.camera);
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
      this.renderer.shadowMap.enabled = this.settings.quality === 'high';
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
      this.session = session;
      (window as unknown as { __vexsim: Session }).__vexsim = session;
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
