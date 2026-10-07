import type { ScoreLine, ToastKind } from '../games/types';
import type { Alliance } from '../robot/robot';
import { CONTROL_HELP } from '../core/input';
import { DRIVE_TYPE_LABELS, type DriveType } from '../robot/drivetrain';
import { mean } from '../core/stats';

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
  private lastPanels = '';
  onRestart: () => void = () => {};

  constructor() {
    this.help.innerHTML = `<div class="ptitle">Controls</div><table>${CONTROL_HELP.map(
      (c) => `<tr><td>${c.action}</td><td><kbd>${c.keyboard}</kbd></td><td><kbd>${c.gamepad}</kbd></td></tr>`,
    ).join('')}</table>`;
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

  frame(time: string, phase: string, urgent: boolean, mine: number, other: number, speed: number): void {
    this.time.textContent = time;
    this.phase.textContent = phase;
    this.time.classList.toggle('urgent', urgent);
    this.mine.textContent = String(mine);
    this.other.textContent = String(other);
    this.speedo.textContent = `${speed.toFixed(2)} m/s · ${(speed * 3.281).toFixed(1)} ft/s`;
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
