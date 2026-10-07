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
