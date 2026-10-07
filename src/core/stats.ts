import type { GameId, ModeId, ScoreLine } from '../games/types';

export interface RunRecord {
  id: string;
  date: number;
  game: GameId;
  mode: ModeId;
  robot: string;
  drive: string;
  /** Points scored (score modes). */
  score: number | null;
  /** Completion time in seconds (timed drills). */
  time: number | null;
  completed: boolean;
  pieces: number;
  cycles: number[];
  distance: number;
  lines: ScoreLine[];
}

/** Robot pose samples at a fixed rate, for ghosts and path maps. */
export interface GhostTrack {
  rate: number;
  robot: string;
  /** Flattened [x, z, heading, ...]. */
  data: number[];
}

const RUNS_KEY = 'vexsim.runs.v1';
const GHOST_KEY = (k: string) => `vexsim.ghost.v1.${k}`;
const MAX_RUNS = 300;

export const isTimedDrill = (mode: ModeId): boolean => mode === 'gates' || mode === 'sprint';
export const runKey = (game: GameId, mode: ModeId): string => `${game}:${mode}`;

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Quota exceeded or storage disabled; stats are best-effort.
  }
}

export function loadRuns(): RunRecord[] {
  return read<RunRecord[]>(RUNS_KEY, []);
}

/** Is `a` a better result than `b` for this mode? */
export function better(a: RunRecord, b: RunRecord | undefined): boolean {
  if (!a.completed && isTimedDrill(a.mode)) return false;
  if (!isTimedDrill(a.mode) && (a.score ?? 0) <= 0) return false;
  if (!b) return true;
  if (isTimedDrill(a.mode)) return (a.time ?? Infinity) < (b.time ?? Infinity);
  return (a.score ?? -Infinity) > (b.score ?? -Infinity);
}

export function bestRun(runs: RunRecord[], game: GameId, mode: ModeId): RunRecord | undefined {
  let best: RunRecord | undefined;
  for (const r of runs) {
    if (r.game !== game || r.mode !== mode) continue;
    if (isTimedDrill(mode) && !r.completed) continue;
    if (better(r, best)) best = r;
  }
  return best;
}

/** Save a run; returns whether it set a new personal best. */
export function saveRun(run: RunRecord, ghost: GhostTrack | null): boolean {
  const runs = loadRuns();
  const prevBest = bestRun(runs, run.game, run.mode);
  const isBest = run.mode !== 'free' && better(run, prevBest);
  runs.push(run);
  while (runs.length > MAX_RUNS) runs.shift();
  write(RUNS_KEY, runs);
  if (isBest && ghost) write(GHOST_KEY(runKey(run.game, run.mode)), ghost);
  return isBest;
}

export function loadGhost(game: GameId, mode: ModeId): GhostTrack | null {
  return read<GhostTrack | null>(GHOST_KEY(runKey(game, mode)), null);
}

export function clearStats(): void {
  try {
    for (const k of Object.keys(localStorage)) if (k.startsWith('vexsim.runs') || k.startsWith('vexsim.ghost')) localStorage.removeItem(k);
  } catch {
    // ignore
  }
}

export function toCsv(runs: RunRecord[]): string {
  const head = ['date', 'game', 'mode', 'robot', 'drive', 'score', 'time_s', 'completed', 'pieces', 'avg_cycle_s', 'distance_m'];
  const rows = runs.map((r) => [
    new Date(r.date).toISOString(),
    r.game,
    r.mode,
    r.robot,
    r.drive,
    r.score ?? '',
    r.time?.toFixed(2) ?? '',
    r.completed,
    r.pieces,
    r.cycles.length ? (r.cycles.reduce((a, b) => a + b, 0) / r.cycles.length).toFixed(2) : '',
    r.distance.toFixed(1),
  ]);
  return [head, ...rows].map((r) => r.join(',')).join('\n');
}

export function mean(xs: number[]): number {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}
