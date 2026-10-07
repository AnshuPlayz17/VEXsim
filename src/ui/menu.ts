import type { Settings, RobotTweaks } from '../config';
import { DEFAULT_SETTINGS, saveSettings } from '../config';
import type { GameDef, GameId, ModeId } from '../games/types';
import type { RobotConfig } from '../robot/robot';
import { DRIVE_TYPE_LABELS, type DriveType } from '../robot/drivetrain';
import { CONTROL_HELP } from '../core/input';
import { CAMERA_LABELS } from '../core/camera';
import { bestRun, clearStats, isTimedDrill, loadRuns, mean, toCsv, type RunRecord } from '../core/stats';
import type { SessionResult } from '../session';
import { escapeHtml } from './hud';

export interface UiHost {
  settings: Settings;
  games: Record<GameId, GameDef>;
  start(): void;
  resume(): void;
  restart(): void;
  endRun(): void;
  quitToMenu(): void;
}

const overlay = () => document.getElementById('overlay')!;

/** Apply the driver's tweaks on top of a preset. */
export function robotFor(game: GameDef, s: Settings): RobotConfig {
  const preset = game.presets.find((p) => p.id === s.preset[game.id]) ?? game.presets[0];
  const t: RobotTweaks = s.tweaks[preset.id] ?? {};
  return {
    ...preset,
    drive: t.drive ?? preset.drive,
    capacity: t.capacity ?? preset.capacity,
    params: {
      ...preset.params,
      maxSpeed: t.maxSpeed ?? preset.params.maxSpeed,
      maxAccel: t.maxAccel ?? preset.params.maxAccel,
      maxDecel: Math.max(preset.params.maxDecel, (t.maxAccel ?? preset.params.maxAccel) * 1.4),
      maxTurnRate: t.maxTurnRate ?? preset.params.maxTurnRate,
    },
  };
}

function fmtResult(r: RunRecord | undefined): string {
  if (!r) return '—';
  if (r.time !== null) return `${r.time.toFixed(2)}s`;
  return `${r.score ?? 0} pts`;
}

export class Ui {
  constructor(private host: UiHost) {}

  private get s(): Settings {
    return this.host.settings;
  }

  private save(): void {
    saveSettings(this.s);
  }

  hide(): void {
    overlay().innerHTML = '';
    overlay().hidden = true;
  }

  private show(html: string): HTMLElement {
    const o = overlay();
    o.hidden = false;
    o.innerHTML = html;
    o.scrollTop = 0;
    return o;
  }

  // ------------------------------------------------------------------ home
  home(): void {
    const runs = loadRuns();
    const cards = Object.values(this.host.games)
      .map((g) => {
        const best = bestRun(runs, g.id, 'match');
        return `
        <button class="game-card ${g.id}" data-game="${g.id}">
          <div class="gc-program">${g.program} · ${g.season}</div>
          <div class="gc-name">${g.name}</div>
          <div class="gc-blurb">${g.blurb}</div>
          <div class="gc-foot"><span>${g.presets.length} robots · ${g.modes.length} modes</span><span>Best match: <b>${fmtResult(best)}</b></span></div>
        </button>`;
      })
      .join('');
    const o = this.show(`
      <div class="screen home">
        <header class="brand">
          <div class="logo">VEX<span>sim</span></div>
          <div class="tag">Driver practice for VEX V5RC <b>Override</b> and FRC <b>REBUILT</b>. Real field layouts, match clocks, scoring and drivetrain physics, right in your browser.</div>
        </header>
        <div class="cards">${cards}</div>
        <nav class="links">
          <button data-nav="stats">📈 Stats &amp; history</button>
          <button data-nav="controls">🎮 Controls</button>
          <button data-nav="about">📘 Rules, sources &amp; assumptions</button>
        </nav>
        <footer class="foot">Plug in any gamepad (Xbox, PlayStation, Logitech…) or use the keyboard. Settings and personal bests are saved in this browser.</footer>
      </div>`);
    o.querySelectorAll<HTMLElement>('[data-game]').forEach((b) =>
      b.addEventListener('click', () => {
        this.s.game = b.dataset.game as GameId;
        this.save();
        this.setup();
      }),
    );
    this.bindNav(o);
  }

  private bindNav(o: HTMLElement): void {
    o.querySelectorAll<HTMLElement>('[data-nav]').forEach((b) =>
      b.addEventListener('click', () => {
        const n = b.dataset.nav;
        if (n === 'stats') this.stats();
        else if (n === 'controls') this.controls();
        else if (n === 'about') this.about();
        else if (n === 'home') this.home();
        else if (n === 'setup') this.setup();
      }),
    );
  }

  // ----------------------------------------------------------------- setup
  setup(): void {
    const g = this.host.games[this.s.game];
    const s = this.s;
    const mode = s.mode[g.id];
    const preset = g.presets.find((p) => p.id === s.preset[g.id]) ?? g.presets[0];
    const cfg = robotFor(g, s);
    const stationList = g.stations;
    if (!stationList.some((st) => st.id === s.station[g.id])) s.station[g.id] = stationList[0].id;
    const station = stationList.find((st) => st.id === s.station[g.id])!;
    const poses = g.startPoses(station.alliance);
    if (s.startIndex >= poses.length) s.startIndex = 0;
    const runs = loadRuns();
    const best = bestRun(runs, g.id, mode);
    const frc = g.id === 'rebuilt';

    const modes = g.modes
      .map(
        (m) => `
        <label class="opt ${m.id === mode ? 'on' : ''}">
          <input type="radio" name="mode" value="${m.id}" ${m.id === mode ? 'checked' : ''}>
          <div><b>${m.label}</b><small>${m.description}</small><small class="pb">Best: ${fmtResult(bestRun(runs, g.id, m.id))}</small></div>
        </label>`,
      )
      .join('');
    const robots = g.presets
      .map(
        (p) => `
        <label class="opt ${p.id === preset.id ? 'on' : ''}">
          <input type="radio" name="preset" value="${p.id}" ${p.id === preset.id ? 'checked' : ''}>
          <div><b>${p.name}</b><small>${p.description}</small>
          <small class="spec">${(p.length / 0.0254).toFixed(1)}″ × ${(p.width / 0.0254).toFixed(1)}″ × ${(p.height / 0.0254).toFixed(1)}″ tall · ${(p.params.maxSpeed * 3.281).toFixed(1)} ft/s · holds ${p.capacity}</small>
          ${p.id === preset.id && p.stats ? `<small class="statline">${Object.entries(p.stats).map(([k, v]) => `<span><i>${k}</i> ${v}</span>`).join('')}</small>` : ''}
          ${p.id === preset.id && p.source ? `<small class="src">${p.source}</small>` : ''}</div>
        </label>`,
      )
      .join('');
    const driveOpts = (Object.keys(DRIVE_TYPE_LABELS) as DriveType[])
      .map((d) => `<option value="${d}" ${d === cfg.drive ? 'selected' : ''}>${DRIVE_TYPE_LABELS[d]}</option>`)
      .join('');
    const slider = (id: string, label: string, min: number, max: number, step: number, val: number, unit = '') => `
      <label class="slider"><span>${label}</span><input type="range" id="${id}" min="${min}" max="${max}" step="${step}" value="${val}"><output>${val}${unit}</output></label>`;
    const check = (id: keyof Settings, label: string) =>
      `<label class="check"><input type="checkbox" data-bool="${id}" ${s[id] ? 'checked' : ''}> ${label}</label>`;

    const o = this.show(`
      <div class="screen setup">
        <header class="bar">
          <button class="ghost-btn" data-nav="home">← Games</button>
          <div class="crumb">${g.program} <b>${g.name}</b> <span>${g.season}</span></div>
          <button class="ghost-btn" data-nav="controls">Controls</button>
        </header>
        <div class="cols">
          <section>
            <h3>Mode</h3>
            <div class="opts">${modes}</div>
          </section>
          <section>
            <h3>Robot</h3>
            <div class="opts">${robots}</div>
            <h4>Tune this robot</h4>
            <label class="sel"><span>Drivetrain</span><select id="drive">${driveOpts}</select></label>
            ${slider('maxSpeed', 'Top speed', 0.8, frc ? 6 : 3.2, 0.05, cfg.params.maxSpeed, ' m/s')}
            ${slider('maxAccel', 'Acceleration', 2, frc ? 16 : 10, 0.25, cfg.params.maxAccel, ' m/s²')}
            ${slider('maxTurnRate', 'Turn rate', 2, 14, 0.25, cfg.params.maxTurnRate, ' rad/s')}
            ${slider('capacity', frc ? 'Hopper capacity' : 'Pieces held', 1, frc ? 80 : 6, 1, cfg.capacity)}
            <button class="link" id="reset-robot">Reset to preset</button>
          </section>
          <section>
            <h3>Driver station</h3>
            <label class="sel"><span>Station</span><select id="station">${stationList
              .map((st) => `<option value="${st.id}" ${st.id === station.id ? 'selected' : ''}>${st.label}</option>`)
              .join('')}</select></label>
            <label class="sel"><span>Start position</span><select id="start">${poses
              .map((p, i) => `<option value="${i}" ${i === s.startIndex ? 'selected' : ''}>${p.label}</option>`)
              .join('')}</select></label>
            <label class="sel"><span>Camera</span><select id="camera">${Object.entries(CAMERA_LABELS)
              .map(([k, v]) => `<option value="${k}" ${k === s.camera ? 'selected' : ''}>${v}</option>`)
              .join('')}</select></label>
            ${
              frc
                ? `<h4>REBUILT options</h4>
            <label class="sel"><span>Aim assist</span><select id="aim">
              <option value="full" ${s.aimAssist === 'full' ? 'selected' : ''}>Full: turret + shoot-on-the-move</option>
              <option value="distance" ${s.aimAssist === 'distance' ? 'selected' : ''}>Speed only: you aim the robot</option>
              <option value="manual" ${s.aimAssist === 'manual' ? 'selected' : ''}>Manual: fixed hood, [ ] sets speed</option>
            </select></label>
            <label class="sel"><span>AUTO winner</span><select id="autowin">
              <option value="byScore" ${s.autoWinner === 'byScore' ? 'selected' : ''}>Compare my AUTO FUEL vs opponent</option>
              <option value="me" ${s.autoWinner === 'me' ? 'selected' : ''}>I win AUTO (HUB off in shifts 1 & 3)</option>
              <option value="opponent" ${s.autoWinner === 'opponent' ? 'selected' : ''}>Opponent wins (HUB off in 2 & 4)</option>
            </select></label>
            ${slider('oppAuto', 'Opponent AUTO FUEL', 0, 40, 1, s.opponentAutoFuel)}
            ${check('showTrajectory', 'Show shot trajectory')}`
                : ''
            }
            <h4>Driver feel</h4>
            ${slider('deadzone', 'Stick deadzone', 0, 0.3, 0.01, s.tuning.deadzone)}
            ${slider('expo', 'Drive expo (curve)', 0, 1, 0.05, s.tuning.expo)}
            ${slider('turnExpo', 'Turn expo', 0, 1, 0.05, s.tuning.turnExpo)}
            ${slider('slowScale', 'Precision-mode speed', 0.1, 1, 0.05, s.tuning.slowScale)}
            <div class="checks">
              ${check('fieldOriented', 'Field-oriented (holonomic)')}
              ${check('showGhost', 'Race my best-run ghost')}
              ${check('countdown', '3-2-1 countdown')}
              ${check('sound', 'Sound cues')}
            </div>
            <label class="sel"><span>Graphics</span><select id="quality">
              <option value="high" ${s.quality === 'high' ? 'selected' : ''}>High (shadows)</option>
              <option value="low" ${s.quality === 'low' ? 'selected' : ''}>Fast (no shadows)</option>
            </select></label>
          </section>
        </div>
        <footer class="startbar">
          <div class="pbline">Personal best for this mode: <b>${fmtResult(best)}</b></div>
          <button class="primary" id="go">START ▶</button>
        </footer>
      </div>`);
    this.bindNav(o);

    o.querySelectorAll<HTMLInputElement>('input[name=mode]').forEach((r) =>
      r.addEventListener('change', () => {
        s.mode[g.id] = r.value as ModeId;
        this.save();
        this.setup();
      }),
    );
    o.querySelectorAll<HTMLInputElement>('input[name=preset]').forEach((r) =>
      r.addEventListener('change', () => {
        s.preset[g.id] = r.value;
        this.save();
        this.setup();
      }),
    );
    const tweak = (): RobotTweaks => (s.tweaks[preset.id] ??= {});
    const bindRange = (id: string, apply: (v: number) => void) => {
      const el = o.querySelector<HTMLInputElement>(`#${id}`);
      if (!el) return;
      el.addEventListener('input', () => {
        const v = parseFloat(el.value);
        const out = el.nextElementSibling as HTMLOutputElement;
        const unit = out.textContent?.replace(/^[\d.]+/, '') ?? '';
        out.textContent = `${v}${unit}`;
        apply(v);
        this.save();
      });
    };
    bindRange('maxSpeed', (v) => (tweak().maxSpeed = v));
    bindRange('maxAccel', (v) => (tweak().maxAccel = v));
    bindRange('maxTurnRate', (v) => (tweak().maxTurnRate = v));
    bindRange('capacity', (v) => (tweak().capacity = v));
    bindRange('oppAuto', (v) => (s.opponentAutoFuel = v));
    bindRange('deadzone', (v) => (s.tuning.deadzone = v));
    bindRange('expo', (v) => (s.tuning.expo = v));
    bindRange('turnExpo', (v) => (s.tuning.turnExpo = v));
    bindRange('slowScale', (v) => (s.tuning.slowScale = v));
    const bindSel = (id: string, apply: (v: string) => void, rerender = false) => {
      const el = o.querySelector<HTMLSelectElement>(`#${id}`);
      el?.addEventListener('change', () => {
        apply(el.value);
        this.save();
        if (rerender) this.setup();
      });
    };
    bindSel('drive', (v) => (tweak().drive = v as DriveType));
    bindSel('station', (v) => (s.station[g.id] = v), true);
    bindSel('start', (v) => (s.startIndex = parseInt(v, 10)));
    bindSel('camera', (v) => (s.camera = v as Settings['camera']));
    bindSel('aim', (v) => (s.aimAssist = v as Settings['aimAssist']));
    bindSel('autowin', (v) => (s.autoWinner = v as Settings['autoWinner']));
    bindSel('quality', (v) => (s.quality = v as Settings['quality']));
    o.querySelectorAll<HTMLInputElement>('[data-bool]').forEach((el) =>
      el.addEventListener('change', () => {
        (s as unknown as Record<string, boolean>)[el.dataset.bool!] = el.checked;
        this.save();
      }),
    );
    o.querySelector('#reset-robot')?.addEventListener('click', () => {
      delete s.tweaks[preset.id];
      this.save();
      this.setup();
    });
    o.querySelector('#go')?.addEventListener('click', () => this.host.start());
  }

  // --------------------------------------------------------------- pause
  pause(): void {
    const free = this.s.mode[this.s.game] === 'free';
    const o = this.show(`
      <div class="modal">
        <h2>Paused</h2>
        <button class="primary" id="p-resume">Resume</button>
        <button id="p-restart">Restart</button>
        <button id="p-end">${free ? 'End session and see stats' : 'End run now'}</button>
        <button id="p-quit">Quit to setup</button>
        <details><summary>Controls</summary>${this.controlsTable()}</details>
      </div>`);
    o.querySelector('#p-resume')!.addEventListener('click', () => this.host.resume());
    o.querySelector('#p-restart')!.addEventListener('click', () => this.host.restart());
    o.querySelector('#p-end')!.addEventListener('click', () => this.host.endRun());
    o.querySelector('#p-quit')!.addEventListener('click', () => this.host.quitToMenu());
  }

  // ------------------------------------------------------------- results
  results(r: SessionResult): void {
    const rec = r.record;
    const timed = isTimedDrill(r.mode);
    const headline = timed
      ? rec.completed
        ? `${rec.time!.toFixed(2)}<small>s</small>`
        : 'DNF'
      : `${rec.score}<small> pts</small>`;
    const prev = r.previousBest;
    let compare = 'First run in this mode. This is your benchmark.';
    if (prev) {
      if (timed && prev.time !== null && rec.time !== null) {
        const d = rec.time - prev.time;
        compare = `${d <= 0 ? '▲' : '▼'} ${Math.abs(d).toFixed(2)}s vs previous best (${prev.time.toFixed(2)}s)`;
      } else if (!timed && prev.score !== null && rec.score !== null) {
        const d = rec.score - prev.score;
        compare = `${d >= 0 ? '▲' : '▼'} ${Math.abs(d)} pts vs previous best (${prev.score})`;
      }
    }
    const cyc = rec.cycles;
    const modeLabel = r.game.modes.find((m) => m.id === r.mode)?.label ?? r.mode;
    const o = this.show(`
      <div class="screen results">
        <div class="res-head">
          <div>
            <div class="crumb">${r.game.program} <b>${r.game.name}</b> · ${modeLabel}</div>
            <div class="big">${headline}</div>
            ${r.isBest ? '<div class="pb-badge">★ NEW PERSONAL BEST</div>' : ''}
            <div class="compare">${compare}</div>
          </div>
          <div class="res-actions">
            <button class="primary" id="r-retry">Retry ⟲ <small>(Enter)</small></button>
            <button id="r-setup">Change setup</button>
            <button id="r-home">Home</button>
          </div>
        </div>
        <div class="res-grid">
          <section>
            <h3>Breakdown</h3>
            ${r.summary.lines.map((l) => `<div class="row"><span class="lbl">${l.label}</span><b>${l.value}</b></div>`).join('')}
            ${r.summary.notes.map((n) => `<p class="note">${n}</p>`).join('')}
          </section>
          <section>
            <h3>Driving</h3>
            <div class="row"><span class="lbl">Scoring cycles</span><b>${cyc.length}</b></div>
            <div class="row"><span class="lbl">Average cycle</span><b>${cyc.length ? mean(cyc).toFixed(2) + 's' : '—'}</b></div>
            <div class="row"><span class="lbl">Fastest cycle</span><b>${cyc.length ? Math.min(...cyc).toFixed(2) + 's' : '—'}</b></div>
            <div class="row"><span class="lbl">Pieces scored</span><b>${rec.pieces}</b></div>
            <div class="row"><span class="lbl">Distance driven</span><b>${rec.distance.toFixed(1)} m</b></div>
            <div class="row"><span class="lbl">Robot</span><b>${escapeHtml(rec.robot)}</b></div>
            ${cyc.length > 1 ? `<canvas id="cyc-chart" width="420" height="110"></canvas>` : ''}
          </section>
          <section class="map-sec">
            <h3>Your path <span class="legend"><i class="me"></i>this run ${r.ghost ? '<i class="gh"></i>best-run ghost' : ''}</span></h3>
            <canvas id="path-map" width="560" height="560"></canvas>
          </section>
        </div>
      </div>`);
    o.querySelector('#r-retry')!.addEventListener('click', () => this.host.restart());
    o.querySelector('#r-setup')!.addEventListener('click', () => this.host.quitToMenu());
    o.querySelector('#r-home')!.addEventListener('click', () => {
      this.host.quitToMenu();
      this.home();
    });
    drawPathMap(o.querySelector<HTMLCanvasElement>('#path-map')!, r);
    const cc = o.querySelector<HTMLCanvasElement>('#cyc-chart');
    if (cc) drawBars(cc, cyc, 's');
  }

  // --------------------------------------------------------------- stats
  stats(): void {
    const runs = loadRuns().slice().reverse();
    const games = Object.values(this.host.games);
    const bests = games
      .map(
        (g) => `
        <div class="best-card ${g.id}"><h4>${g.program} ${g.name}</h4>
        ${g.modes
          .filter((m) => m.id !== 'free')
          .map((m) => `<div class="row"><span class="lbl">${m.label}</span><b>${fmtResult(bestRun(runs, g.id, m.id))}</b></div>`)
          .join('')}
        </div>`,
      )
      .join('');
    const rows = runs
      .slice(0, 60)
      .map((r) => {
        const g = this.host.games[r.game];
        const m = g?.modes.find((x) => x.id === r.mode)?.label ?? r.mode;
        return `<tr><td>${new Date(r.date).toLocaleString()}</td><td>${g?.name ?? r.game}</td><td>${m}</td><td>${escapeHtml(r.robot)}</td><td><b>${fmtResult(r)}</b></td><td>${r.cycles.length ? mean(r.cycles).toFixed(1) + 's' : '—'}</td></tr>`;
      })
      .join('');
    const o = this.show(`
      <div class="screen stats">
        <header class="bar"><button class="ghost-btn" data-nav="home">← Home</button><div class="crumb"><b>Stats &amp; history</b></div><span></span></header>
        <div class="bests">${bests}</div>
        <section class="trend"><h3>Recent match scores</h3><canvas id="trend" width="900" height="160"></canvas></section>
        <section>
          <h3>Run history <span class="hint">(${runs.length} saved in this browser)</span></h3>
          ${runs.length ? `<div class="tablewrap"><table class="runs"><thead><tr><th>When</th><th>Game</th><th>Mode</th><th>Robot</th><th>Result</th><th>Avg cycle</th></tr></thead><tbody>${rows}</tbody></table></div>` : '<p class="note">No runs yet. Go drive!</p>'}
          <div class="row-btns"><button id="csv">Export CSV</button><button id="clear" class="danger">Clear all stats</button></div>
        </section>
      </div>`);
    this.bindNav(o);
    const matchScores = runs.filter((r) => r.mode === 'match' && r.score !== null).slice(0, 30).reverse();
    drawBars(o.querySelector<HTMLCanvasElement>('#trend')!, matchScores.map((r) => r.score!), ' pts', matchScores.map((r) => (r.game === 'override' ? '#e0a83b' : '#5ca8ff')));
    o.querySelector('#csv')!.addEventListener('click', () => {
      const blob = new Blob([toCsv(loadRuns())], { type: 'text/csv' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'vexsim-runs.csv';
      a.click();
      URL.revokeObjectURL(a.href);
    });
    o.querySelector('#clear')!.addEventListener('click', () => {
      if (confirm('Delete all saved runs and ghosts?')) {
        clearStats();
        this.stats();
      }
    });
  }

  private controlsTable(): string {
    return `<table class="controls">${CONTROL_HELP.map(
      (c) => `<tr><td>${c.action}</td><td><kbd>${c.keyboard}</kbd></td><td><kbd>${c.gamepad}</kbd></td></tr>`,
    ).join('')}</table>`;
  }

  controls(): void {
    const o = this.show(`
      <div class="screen doc">
        <header class="bar"><button class="ghost-btn" data-nav="home">← Home</button><div class="crumb"><b>Controls</b></div><button class="ghost-btn" data-nav="setup">Setup →</button></header>
        <section>
          ${this.controlsTable()}
          <h3>Drive styles</h3>
          <ul>
            <li><b>Tank</b>: left stick Y drives the left side, right stick Y the right side (keyboard: W/S and ↑/↓).</li>
            <li><b>Arcade</b>: one stick. Y is throttle, X is turn.</li>
            <li><b>Split arcade</b>: left stick throttle, right stick turn. The most common VEX setup.</li>
            <li><b>Swerve / X-drive</b>: left stick translates, right stick X rotates. Field-oriented is on by default and is relative to <i>your driver station</i>, so push the stick away from you and the robot moves away from you whichever way it faces.</li>
          </ul>
          <h3>Tips</h3>
          <ul>
            <li>Practice from the <b>Driver station</b> camera. It's what you'll see at competition. Use the chase cam to learn a route, then switch back.</li>
            <li>Hold <kbd>Shift</kbd> / <kbd>LB</kbd> for precision mode when lining up on a goal or the TOWER.</li>
            <li>Turn on <b>Race my best-run ghost</b>: a translucent copy of your best run drives alongside you.</li>
            <li>The VEX V5 controller can't talk to a browser. Use any USB/Bluetooth gamepad with the same stick layout.</li>
          </ul>
        </section>
      </div>`);
    this.bindNav(o);
  }

  about(): void {
    const sections = Object.values(this.host.games)
      .map((g) => `<h3>${g.program} ${g.name} (${g.season})</h3>${g.notes.map((n) => `<p>${n}</p>`).join('')}`)
      .join('');
    const o = this.show(`
      <div class="screen doc">
        <header class="bar"><button class="ghost-btn" data-nav="home">← Home</button><div class="crumb"><b>Rules, sources &amp; assumptions</b></div><span></span></header>
        <section>
          <p>VEXsim is a driver-practice tool. It models the parts of each game that matter to a driver (field geometry, game-piece handling, timing and scoring) and simplifies robot mechanisms to buttons. Always check the official game manual for rulings.</p>
          ${sections}
          <h3>Physics</h3>
          <p>Robots are kinematic bodies driven by an acceleration-limited drivetrain model (tank/arcade wheels can't slide sideways; holonomic drives share a wheel-speed budget between translation and rotation), moved through the field with Rapier's character controller so they climb BUMPS and collide with TRENCH arms based on robot height. Game pieces are full rigid bodies.</p>
          <button class="ghost-btn" id="reset-settings">Reset all settings to defaults</button>
        </section>
      </div>`);
    this.bindNav(o);
    o.querySelector('#reset-settings')!.addEventListener('click', () => {
      Object.assign(this.host.settings, structuredClone(DEFAULT_SETTINGS));
      this.save();
      this.home();
    });
  }
}

function drawBars(c: HTMLCanvasElement, values: number[], unit: string, colors?: string[]): void {
  const g = c.getContext('2d')!;
  const w = c.width;
  const h = c.height;
  g.clearRect(0, 0, w, h);
  if (!values.length) {
    g.fillStyle = '#8a94a6';
    g.font = '14px system-ui';
    g.fillText('Play some matches to see a trend.', 12, h / 2);
    return;
  }
  const max = Math.max(...values, 1);
  const bw = Math.min(40, (w - 20) / values.length);
  values.forEach((v, i) => {
    const bh = (v / max) * (h - 30);
    g.fillStyle = colors?.[i] ?? '#5ca8ff';
    g.fillRect(10 + i * bw, h - 18 - bh, bw - 4, bh);
  });
  g.fillStyle = '#c8d0dc';
  g.font = '12px system-ui';
  g.fillText(`max ${max.toFixed(unit === 's' ? 1 : 0)}${unit}`, 10, 12);
}

function drawPathMap(c: HTMLCanvasElement, r: SessionResult): void {
  const g = c.getContext('2d')!;
  const fx = r.game.fieldX;
  const fz = r.game.fieldZ;
  // Field X runs across the canvas, Z down it; keep aspect ratio.
  const pad = 14;
  const scale = Math.min((c.width - pad * 2) / fx, (c.height - pad * 2) / fz);
  const W = fx * scale;
  const H = fz * scale;
  c.height = H + pad * 2;
  const ox = (c.width - W) / 2;
  const oz = pad;
  const X = (x: number) => ox + (x + fx / 2) * scale;
  const Z = (z: number) => oz + (z + fz / 2) * scale;
  g.fillStyle = '#2a2e35';
  g.fillRect(ox, oz, W, H);
  g.strokeStyle = '#9aa3ad';
  g.lineWidth = 2;
  g.strokeRect(ox, oz, W, H);
  // Alliance walls: red at -X, blue at +X.
  g.lineWidth = 5;
  g.strokeStyle = '#d92b2b';
  g.beginPath();
  g.moveTo(ox, oz);
  g.lineTo(ox, oz + H);
  g.stroke();
  g.strokeStyle = '#1f5fd6';
  g.beginPath();
  g.moveTo(ox + W, oz);
  g.lineTo(ox + W, oz + H);
  g.stroke();
  for (const f of r.footprints) {
    g.fillStyle = f.color;
    const x = X(f.x);
    const z = Z(f.z);
    const w = f.w * scale;
    const d = f.d * scale;
    if (f.shape === 'circle') {
      g.beginPath();
      g.arc(x, z, w / 2, 0, Math.PI * 2);
      g.fill();
    } else if (f.shape === 'diamond') {
      g.beginPath();
      g.moveTo(x - w / 2, z);
      g.lineTo(x, z - d / 2);
      g.lineTo(x + w / 2, z);
      g.lineTo(x, z + d / 2);
      g.closePath();
      g.fill();
    } else {
      g.fillRect(x - w / 2, z - d / 2, w, d);
    }
  }
  for (const gate of r.gates) {
    const dx = (Math.cos(gate.yaw) * gate.width) / 2;
    const dz = (-Math.sin(gate.yaw) * gate.width) / 2;
    g.strokeStyle = '#5ce1e6';
    g.lineWidth = 3;
    g.beginPath();
    g.moveTo(X(gate.x - dx), Z(gate.z - dz));
    g.lineTo(X(gate.x + dx), Z(gate.z + dz));
    g.stroke();
  }
  const path = (data: number[], color: string, width: number) => {
    if (data.length < 6) return;
    g.strokeStyle = color;
    g.lineWidth = width;
    g.lineJoin = 'round';
    g.beginPath();
    g.moveTo(X(data[0]), Z(data[1]));
    for (let i = 3; i < data.length; i += 3) g.lineTo(X(data[i]), Z(data[i + 1]));
    g.stroke();
  };
  if (r.ghost) path(r.ghost.data, 'rgba(200,200,255,0.45)', 2);
  path(r.track.data, '#ffe14d', 2.5);
  const d = r.track.data;
  if (d.length >= 3) {
    g.fillStyle = '#46f07a';
    g.beginPath();
    g.arc(X(d[0]), Z(d[1]), 5, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#ff5a5a';
    g.beginPath();
    g.arc(X(d[d.length - 3]), Z(d[d.length - 2]), 5, 0, Math.PI * 2);
    g.fill();
  }
}
