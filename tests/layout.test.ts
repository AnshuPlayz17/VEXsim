import { describe, expect, it } from 'vitest';
import { OVERRIDE_FIELD as F, startingLayout } from '../src/games/override/game';

const IN = 0.0254;
const key = (c: [string, string]) => [...c].sort().join('/');

describe('Override starting layout (Appendix A, Head-to-Head)', () => {
  const { pins, cups } = startingLayout();

  it('has the manual’s on-field counts', () => {
    const count = (k: string) => pins.filter((p) => key(p.colors) === k).length;
    expect(count('red/yellow')).toBe(8);
    expect(count('blue/yellow')).toBe(8);
    expect(count('yellow/yellow')).toBe(17);
    expect(count('blue/red')).toBe(4);
    expect(cups).toHaveLength(36);
    expect(cups.filter((c) => c.opaqueUp)).toHaveLength(24);
    expect(cups.filter((c) => !c.opaqueUp)).toHaveLength(12);
  });

  it('is symmetric under a half turn with red and blue swapped', () => {
    const swap = (c: string) => (c === 'red' ? 'blue' : c === 'blue' ? 'red' : c);
    for (const p of pins) {
      const twin = pins.find((q) => Math.abs(q.x + p.x) < 1e-6 && Math.abs(q.z + p.z) < 1e-6 && q.pose === p.pose && q.colors[0] === swap(p.colors[0]) && q.colors[1] === swap(p.colors[1]));
      expect(twin, `${p.pose} pin at ${(p.x / IN).toFixed(1)}, ${(p.z / IN).toFixed(1)}`).toBeTruthy();
    }
  });

  it('keeps everything inside the walls and the starting robots clear of it', () => {
    for (const e of [...pins, ...cups]) {
      expect(Math.abs(e.x)).toBeLessThan(F.half);
      expect(Math.abs(e.z)).toBeLessThan(F.half);
    }
    const half = 9 * IN; // 18" robot
    for (const a of ['red', 'blue'] as const) {
      for (const s of F.startPoses(a)) {
        expect(Math.abs(s.x) + half).toBeLessThanOrEqual(F.half);
        const clear = (x: number, z: number, r: number) => Math.abs(x - s.x) > half + r || Math.abs(z - s.z) > half + r;
        for (const c of cups) expect(clear(c.x, c.z, F.cup.topRadius)).toBe(true);
        for (const p of pins) expect(clear(p.x, p.z, p.pose === 'lying' ? F.pin.length / 2 : F.pin.radius)).toBe(true);
        for (const g of F.goals) expect(clear(g.x, g.z, F.goalRadiusBottom)).toBe(true);
      }
    }
  });
});
