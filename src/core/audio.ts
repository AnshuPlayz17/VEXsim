/** Tiny synthesized field sounds so there are no audio assets to ship. */
let ctx: AudioContext | null = null;

function tone(freq: number, dur: number, type: OscillatorType, gain: number, delay = 0): void {
  if (!ctx) return;
  const t0 = ctx.currentTime + delay;
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  g.gain.setValueAtTime(0, t0);
  g.gain.linearRampToValueAtTime(gain, t0 + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(g).connect(ctx.destination);
  osc.start(t0);
  osc.stop(t0 + dur + 0.05);
}

export function unlockAudio(): void {
  if (!ctx) {
    try {
      ctx = new AudioContext();
    } catch {
      ctx = null;
    }
  }
  void ctx?.resume();
}

export function playCue(kind: 'start' | 'end' | 'warn' | 'phase' | 'score' | 'count'): void {
  if (!ctx) return;
  switch (kind) {
    case 'start':
      tone(880, 0.5, 'square', 0.08);
      break;
    case 'end':
      tone(330, 0.9, 'sawtooth', 0.08);
      tone(220, 0.9, 'sawtooth', 0.06, 0.05);
      break;
    case 'warn':
      tone(660, 0.12, 'square', 0.06);
      break;
    case 'phase':
      tone(660, 0.2, 'triangle', 0.1);
      tone(990, 0.25, 'triangle', 0.1, 0.18);
      break;
    case 'score':
      tone(1320, 0.08, 'sine', 0.05);
      break;
    case 'count':
      tone(520, 0.12, 'sine', 0.09);
      break;
  }
}

export function audioContext(): AudioContext | null {
  return ctx;
}

/**
 * Continuous drivetrain and mechanism sound: V5 motors whine at a pitch that
 * follows wheel speed and get louder under load; the lift motor hums while it moves.
 */
export class MotorSound {
  private nodes: { osc: OscillatorNode; osc2: OscillatorNode; gain: GainNode; filt: BiquadFilterNode; lift: OscillatorNode; liftGain: GainNode } | null = null;

  start(): void {
    const c = ctx;
    if (!c || this.nodes) return;
    const osc = c.createOscillator();
    osc.type = 'sawtooth';
    const osc2 = c.createOscillator();
    osc2.type = 'square';
    const filt = c.createBiquadFilter();
    filt.type = 'lowpass';
    filt.frequency.value = 1200;
    filt.Q.value = 2;
    const gain = c.createGain();
    gain.gain.value = 0;
    osc.connect(filt);
    osc2.connect(filt);
    filt.connect(gain).connect(c.destination);
    const lift = c.createOscillator();
    lift.type = 'triangle';
    const liftGain = c.createGain();
    liftGain.gain.value = 0;
    lift.connect(liftGain).connect(c.destination);
    osc.start();
    osc2.start();
    lift.start();
    this.nodes = { osc, osc2, gain, filt, lift, liftGain };
  }

  /** speed 0..1 of free speed, load 0..1 (motor effort), lift 0..1 lift motion. */
  update(speed: number, load: number, lift: number): void {
    const c = ctx;
    const n = this.nodes;
    if (!c || !n) return;
    const t = c.currentTime;
    const f = 140 + speed * 820;
    n.osc.frequency.setTargetAtTime(f, t, 0.03);
    n.osc2.frequency.setTargetAtTime(f * 1.5, t, 0.03);
    n.filt.frequency.setTargetAtTime(600 + speed * 2200, t, 0.05);
    n.gain.gain.setTargetAtTime(Math.min(0.06, 0.004 + load * 0.03 + speed * 0.025), t, 0.04);
    n.lift.frequency.setTargetAtTime(220 + lift * 260, t, 0.05);
    n.liftGain.gain.setTargetAtTime(lift > 0.02 ? 0.025 : 0, t, 0.05);
  }

  stop(): void {
    const n = this.nodes;
    if (!n) return;
    for (const o of [n.osc, n.osc2, n.lift]) {
      try {
        o.stop();
      } catch {
        // already stopped
      }
    }
    n.gain.disconnect();
    n.liftGain.disconnect();
    this.nodes = null;
  }
}
