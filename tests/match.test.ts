import { describe, expect, it } from 'vitest';
import { MatchClock } from '../src/core/match';
import { OverrideGame } from '../src/games/override/game';
import { RebuiltGame } from '../src/games/rebuilt/game';

describe('MatchClock', () => {
  it('Override full match is 15 s auto + 1:45 driver (+2 s disabled gap)', () => {
    const c = new MatchClock(OverrideGame.phases('match'));
    expect(c.total).toBe(15 + 2 + 105);
    expect(c.phase?.id).toBe('auto');
    expect(c.isAuto).toBe(true);
    c.advance(15.5);
    expect(c.phase?.kind).toBe('break');
    expect(c.enabled).toBe(false);
    c.advance(2);
    expect(c.phase?.id).toBe('driver');
    expect(c.periodRemaining).toBeCloseTo(104.5);
    c.advance(96);
    expect(c.phase?.id).toBe('endgame');
    c.advance(100);
    expect(c.over).toBe(true);
    expect(c.enabled).toBe(false);
  });

  it('REBUILT TELEOP is 2:20 split into transition, four shifts and END GAME', () => {
    const c = new MatchClock(RebuiltGame.phases('driver'));
    expect(c.total).toBe(140);
    expect(c.phases.map((p) => p.id)).toEqual(['transition', 'shift1', 'shift2', 'shift3', 'shift4', 'endgame']);
    c.advance(10);
    expect(c.phase?.id).toBe('shift1');
    expect(c.periodRemaining).toBeCloseTo(130);
    c.advance(100);
    expect(c.phase?.id).toBe('endgame');
  });

  it('free practice is untimed', () => {
    const c = new MatchClock([]);
    expect(c.untimed).toBe(true);
    c.advance(1000);
    expect(c.over).toBe(false);
    expect(c.enabled).toBe(true);
  });
});
