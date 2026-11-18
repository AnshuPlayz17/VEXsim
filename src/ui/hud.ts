import type { ScoreLine, ToastKind } from '../games/types';
import type { Alliance } from '../robot/robot';
import { CONTROL_HELP } from '../core/input';
import { DRIVE_TYPE_LABELS, type DriveType } from '../robot/drivetrain';
import { mean } from '../core/stats';
import { CAMERA_LABELS, CAMERA_ORDER } from '../core/camera';
import type { CameraMode } from '../config';

export type Device = 'keyboard' | 'gamepad' | 'v5';

/** The few controls a driver needs mid-match, per input device. */
const QUICK: { what: string; keyboard: string; gamepad: string; v5: string }[] = [
  { what: 'Drive', keyboard: 'W A S D', gamepad: 'Sticks', v5: 'Joysticks' },
  { what: 'Intake', keyboard: 'Space', gamepad: 'RT', v5: 'R1' },
  { what: 'Place on Goal', keyboard: 'F', gamepad: 'RB', v5: 'L1' },
  { what: 'Drop', keyboard: 'V', gamepad: 'LT', v5: 'R2' },
  { what: 'Flip Cup', keyboard: 'R', gamepad: 'A', v5: 'A' },
  { what: 'Match Load', keyboard: 'B', gamepad: 'B', v5: 'B' },
  { what: 'Precision', keyboard: 'Shift', gamepad: 'LB', v5: 'L2' },
  { what: 'Camera', keyboard: 'C', gamepad: 'Y', v5: 'Y' },
  { what: 'Pause', keyboard: 'Esc', gamepad: 'Start', v5: 'Right' },
];

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

export interface HudMeta {
  drive: DriveType;
  fieldOriented: boolean | null;
  camera: string;
  gamepad: string | null;
  cycles: number[];
}

/** In-match heads-up display. All DOM, rendered over the WebGL canvas. */
export class Hud {
  private root = $('hud');
  private time = $('hud-time');
  private phase = $('hud-phase');
  private mine = $('score-mine');
  private other = $('score-other');
  private status = $('hud-status');
  private cargo = $('hud-cargo');
  private meta = $('hud-meta');
  private breakdown = $('hud-breakdown');
  private speedo = $('speedo');
  private toasts = $('toasts');
  private count = $('countdown');
  private help = $('help');
  private camBar = $('camera-bar');
  private quick = $('quick-controls');
  private device: Device | null = null;
  onCamera: (m: CameraMode) => void = () => {};
  private lastPanels = '';
  onRestart: () => void = () => {};

  constructor() {
    this.camBar.innerHTML = CAMERA_ORDER.map((m) => `<button data-cam="${m}">${CAMERA_LABELS[m]}</button>`).join('');
    this.camBar.querySelectorAll<HTMLButtonElement>('[data-cam]').forEach((b) =>
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        this.onCamera(b.dataset.cam as CameraMode);
        b.blur();
      }),
    );
    this.help.innerHTML = `<div class="ptitle">Controls</div><table>${CONTROL_HELP.map(
      (c) => `<tr><td>${c.action}</td><td><kbd>${c.keyboard}</kbd></td><td><kbd>${c.gamepad}</kbd></td></tr>`,
    ).join('')}</table>`;
  }

  setCamera(m: CameraMode): void {
    this.camBar.querySelectorAll<HTMLElement>('[data-cam]').forEach((b) => b.classList.toggle('on', b.dataset.cam === m));
    this.camBar.dataset.hint = m === 'follow' ? 'Drag to orbit · scroll to zoom · double-click to reset' : '';
  }

  /** Bottom legend, relabelled for whatever the driver is using. */
  setDevice(d: Device): void {
    if (d === this.device) return;
    this.device = d;
    const name = d === 'v5' ? 'V5 Controller' : d === 'gamepad' ? 'Gamepad' : 'Keyboard';
    this.quick.innerHTML = `<span class="qc-dev">${name}</span>${QUICK.map((q) => `<span><kbd>${q[d]}</kbd>${q.what}</span>`).join('')}<span class="qc-more"><kbd>H</kbd>all controls</span>`;
  }

  show(v: boolean): void {
    this.root.hidden = !v;
    if (!v) this.toasts.innerHTML = '';
  }

  setTitle(title: string, mode: string): void {
    $('hud-title').textContent = `${title} · ${mode}`;
  }

  setAlliance(a: Alliance): void {
    this.root.dataset.alliance = a;
  }

  frame(time: string, phase: string, urgent: boolean, mine: number, other: number, speed: number, power?: { volts: number; charge: number; temp: number }): void {
    this.time.textContent = time;
    this.phase.textContent = phase;
    this.time.classList.toggle('urgent', urgent);
    this.mine.textContent = String(mine);
    this.other.textContent = String(other);
    const pw = power ? ` · 🔋 ${power.volts.toFixed(1)} V ${Math.round(power.charge * 100)}% · motors ${Math.round(power.temp)}°C${power.temp >= 55 ? ' ⚠ HOT' : ''}` : '';
    this.speedo.textContent = `${speed.toFixed(2)} m/s · ${(speed * 3.281).toFixed(1)} ft/s${pw}`;
    this.speedo.classList.toggle('hot', !!power && power.temp >= 55);
  }

  panels(status: string, cargo: string, lines: ScoreLine[], meta: HudMeta): void {
    const avg = meta.cycles.length ? `${mean(meta.cycles).toFixed(1)}s avg cycle (${meta.cycles.length})` : 'no cycles yet';
    const metaHtml = `
      <div class="row"><span class="lbl">Drive</span>${DRIVE_TYPE_LABELS[meta.drive].split(' (')[0]}${meta.fieldOriented === null ? '' : meta.fieldOriented ? ' · field-oriented' : ' · robot-oriented'}</div>
      <div class="row"><span class="lbl">Camera</span>${meta.camera}</div>
      <div class="row"><span class="lbl">Cycles</span>${avg}</div>
      <div class="row"><span class="lbl">Input</span>${meta.gamepad ? `🎮 ${escapeHtml(meta.gamepad.slice(0, 28))}` : '⌨ keyboard'}</div>`;
    const bd = lines.map((l) => `<div class="row"><span class="lbl">${l.label}</span><b>${l.value}</b></div>`).join('');
    const key = status + cargo + metaHtml + bd;
    if (key === this.lastPanels) return;
    this.lastPanels = key;
    this.status.innerHTML = status;
    this.cargo.innerHTML = cargo;
    this.meta.innerHTML = metaHtml;
    this.breakdown.innerHTML = `<div class="ptitle">Score</div>${bd}`;
  }

  toast(text: string, kind: ToastKind): void {
    const el = document.createElement('div');
    el.className = `toast ${kind}`;
    el.textContent = text;
    this.toasts.prepend(el);
    while (this.toasts.children.length > 4) this.toasts.lastElementChild?.remove();
    setTimeout(() => el.classList.add('out'), 1900);
    setTimeout(() => el.remove(), 2400);
  }

  countdown(text: string | null): void {
    this.count.hidden = text === null;
    if (text !== null && this.count.textContent !== text) {
      this.count.textContent = text;
      this.count.classList.remove('pop');
      void this.count.offsetWidth;
      this.count.classList.add('pop');
    }
  }

  showHelp(v: boolean): void {
    this.help.hidden = !v;
  }

  requestRestart(): void {
    this.onRestart();
  }
}

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}
