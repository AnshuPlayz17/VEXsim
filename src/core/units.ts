/** Physics runs in SI units (meters, seconds). Game manuals are in inches. */
export const IN = 0.0254;
export const FT = 0.3048;

export const inches = (n: number): number => n * IN;

export const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

/** Wrap an angle to (-PI, PI]. */
export function wrapAngle(a: number): number {
  let r = a % (Math.PI * 2);
  if (r > Math.PI) r -= Math.PI * 2;
  if (r <= -Math.PI) r += Math.PI * 2;
  return r;
}

export function formatClock(seconds: number): string {
  const s = Math.max(0, Math.ceil(seconds - 1e-6));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}

export function formatSeconds(seconds: number, digits = 2): string {
  return `${seconds.toFixed(digits)}s`;
}
