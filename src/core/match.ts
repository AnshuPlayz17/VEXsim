/**
 * Match clock: an ordered list of phases. Pure logic so it is unit-testable.
 */
export type PhaseKind = 'auto' | 'break' | 'teleop' | 'endgame';

export interface Phase {
  id: string;
  label: string;
  kind: PhaseKind;
  /** Seconds. */
  duration: number;
  /** Phases sharing a period are shown as one countdown (e.g. FRC TELEOP shifts). */
  period: string;
}

export class MatchClock {
  elapsed = 0;
  constructor(public readonly phases: Phase[], public readonly countUp = false) {}

  get total(): number {
    return this.phases.reduce((s, p) => s + p.duration, 0);
  }

  /** Untimed (free practice) when there are no phases. */
  get untimed(): boolean {
    return this.phases.length === 0;
  }

  get over(): boolean {
    return !this.untimed && this.elapsed >= this.total;
  }

  advance(dt: number): void {
    this.elapsed += dt;
    if (!this.untimed) this.elapsed = Math.min(this.elapsed, this.total);
  }

  get phaseIndex(): number {
    let t = 0;
    for (let i = 0; i < this.phases.length; i++) {
      t += this.phases[i].duration;
      if (this.elapsed < t) return i;
    }
    return this.phases.length - 1;
  }

  get phase(): Phase | null {
    return this.untimed ? null : this.phases[this.phaseIndex];
  }

  /** Seconds left in the current phase. */
  get phaseRemaining(): number {
    if (this.untimed) return Infinity;
    let t = 0;
    for (let i = 0; i <= this.phaseIndex; i++) t += this.phases[i].duration;
    return Math.max(0, t - this.elapsed);
  }

  /** Seconds left in the current period (what the field display shows). */
  get periodRemaining(): number {
    const ph = this.phase;
    if (!ph) return Infinity;
    let t = 0;
    let lastEnd = 0;
    for (const p of this.phases) {
      t += p.duration;
      if (p.period === ph.period) lastEnd = t;
    }
    return Math.max(0, lastEnd - this.elapsed);
  }

  /** Is the robot allowed to move? */
  get enabled(): boolean {
    if (this.untimed) return true;
    if (this.over) return false;
    return this.phase!.kind !== 'break';
  }

  get isAuto(): boolean {
    return this.phase?.kind === 'auto';
  }
}
