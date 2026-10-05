import { describe, expect, it } from 'vitest';
import { BrushInput, type BrushState } from '../src/paint/brush';
import { Kind } from '../src/paint/engine';
import { breathe, fbm, gnoise } from '../src/paint/noise';
import { PAN_INK, defaultSettings, lookOf, sanitizeSettings } from '../src/paint/settings';

const ev = (pointerId: number) => ({ pointerId, pointerType: 'touch', pressure: 0.5, target: null }) as unknown as PointerEvent;

/** A brush on a 1:1 sheet (1 texel per CSS px, y flipped like the real mapping) with a hand-driven clock. */
function rig(state: Partial<BrushState> = {}) {
  let now = 0;
  const brush: BrushState = { tool: 'pigment', ink: 0.8, radius: 20, ...state };
  const input = new BrushInput(() => brush, (x, y) => [x, 1000 - y], () => 1, () => now);
  const frame = (ms = 1000 / 60) => {
    now += ms;
    return input.frame(now, ms / 1000);
  };
  return { input, frame, brush };
}

describe('brush input', () => {
  it('turns a tap into a drop that blooms to the brush size and stops', () => {
    const { input, frame } = rig();
    input.down(ev(1), 100, 100);
    frame();
    input.up(ev(1));
    const radii: number[] = [];
    for (let i = 0; i < 90; i++) for (const d of frame().drops) radii.push(d.r1);
    expect(radii.length).toBeGreaterThan(3);
    expect(radii.every((r, i) => i === 0 || r > radii[i - 1])).toBe(true);
    expect(radii.at(-1)).toBeCloseTo(20 * 1.15, 0);
    expect(input.isBusy).toBe(false);
  });

  it('places drops where the finger is, in field coordinates', () => {
    const { input, frame } = rig({ ink: PAN_INK[0] });
    input.down(ev(1), 300, 200);
    input.up(ev(1));
    const d = frame().drops[0];
    expect([d.x, d.y]).toEqual([300, 800]);
    expect(d.ink).toBe(PAN_INK[0]);
    expect(d.kind).toBe(Kind.Paint);
  });

  it('keeps a held drop growing for as long as it is held', () => {
    const { input, frame } = rig();
    input.down(ev(1), 100, 100);
    let last = 0;
    for (let i = 0; i < 120; i++) for (const d of frame().drops) last = d.r1;
    expect(last).toBeGreaterThan(20 * 1.15 * 1.4);
    input.up(ev(1));
  });

  it('turns a drag into stroke segments with the pan ink', () => {
    const { input, frame } = rig({ ink: 0.54 });
    input.down(ev(1), 100, 100);
    const segs = [];
    for (let i = 1; i <= 10; i++) {
      input.move(ev(1), 100 + i * 12, 100);
      segs.push(...frame().segs);
    }
    input.up(ev(1));
    expect(segs.length).toBeGreaterThanOrEqual(9);
    expect(segs.every((s) => s.kind === Kind.Paint && s.target === 0.54 && s.radius === 20)).toBe(true);
    // Consecutive segments join up into one continuous stroke.
    for (let i = 1; i < segs.length; i++) expect([segs[i].ax, segs[i].ay]).toEqual([segs[i - 1].bx, segs[i - 1].by]);
    expect(frame().drops).toEqual([]);
  });

  it('stirs the water with the water tool and lays no pigment', () => {
    const { input, frame } = rig({ tool: 'water' });
    input.down(ev(1), 100, 100);
    const segs = [];
    for (let i = 1; i <= 6; i++) {
      input.move(ev(1), 100 + i * 15, 100);
      segs.push(...frame().segs);
    }
    expect(segs.every((s) => s.kind === Kind.Water && s.strength === 0)).toBe(true);
    // Moving right on screen pulls the water right.
    expect(segs.at(-1)!.fx).toBeGreaterThan(100);
    expect(segs.at(-1)!.coupling).toBeGreaterThan(0.5);
  });

  it('blots in place when the lift tool is held still', () => {
    const { input, frame } = rig({ tool: 'lift' });
    input.down(ev(1), 50, 50);
    const out = Array.from({ length: 20 }, () => frame());
    expect(out.flatMap((o) => o.drops)).toEqual([]);
    const segs = out.flatMap((o) => o.segs);
    expect(segs.length).toBeGreaterThan(5);
    expect(segs.every((s) => s.kind === Kind.Lift && s.ax === s.bx && s.ay === s.by)).toBe(true);
  });

  it('keeps the end of a stroke that lifts before the next frame', () => {
    const { input, frame } = rig();
    input.down(ev(1), 100, 100);
    for (let i = 1; i <= 5; i++) input.move(ev(1), 100 + i * 20, 100);
    input.up(ev(1));
    expect(input.isDown).toBe(false);
    const segs = frame().segs;
    expect(segs.length).toBeGreaterThan(0);
    expect([segs.at(-1)!.bx, segs.at(-1)!.by]).toEqual([200, 900]);
    expect(input.isBusy).toBe(false);
  });

  it('fits a long stretch from one slow frame into the budget, start to end', () => {
    const { input, frame } = rig({ radius: 6 });
    input.down(ev(1), 0, 500);
    for (let i = 1; i <= 300; i++) input.move(ev(1), i * 3, 500);
    const segs = frame().segs;
    expect(segs.length).toBeLessThanOrEqual(16);
    expect([segs[0].ax, segs.at(-1)!.bx]).toEqual([0, 900]);
  });

  it('handles several fingers at once', () => {
    const { input, frame } = rig();
    input.down(ev(1), 100, 100);
    input.down(ev(2), 400, 100);
    input.up(ev(1));
    input.up(ev(2));
    const drops = frame().drops;
    expect(drops.map((d) => d.x).sort((a, b) => a - b)).toEqual([100, 400]);
  });
});

describe('studio settings', () => {
  const base = defaultSettings();

  it('falls back to defaults for missing or broken storage', () => {
    expect(sanitizeSettings(null, base)).toEqual(base);
    expect(sanitizeSettings('nope', base)).toEqual(base);
    const s = sanitizeSettings({ bleed: 'lots', layers: 99, pan: -3, radius: 1e6, tool: 'hammer' }, base);
    expect(s.bleed).toBe(base.bleed);
    expect(s.layers).toBe(7);
    expect(s.pan).toBe(0);
    expect(s.radius).toBe(120);
    expect(s.tool).toBe('pigment');
  });

  it('keeps a valid palette and drops an invalid one', () => {
    const palette = { name: 'Mine', paper: '#ffffff', colors: ['#000000', '#111111', '#222222', '#333333', '#444444'] };
    expect(sanitizeSettings({ palette }, base).palette).toEqual(palette);
    expect(sanitizeSettings({ palette: { ...palette, colors: ['#000'] } }, base).palette).toEqual(base.palette);
  });

  it('only accepts share-token-shaped piece references', () => {
    expect(sanitizeSettings({ piece: 'eyJ2IjoxfQ' }, base).piece).toBe('eyJ2IjoxfQ');
    expect(sanitizeSettings({ piece: '<script>' }, base).piece).toBeNull();
  });

  it('starts still for people who prefer reduced motion', () => {
    expect(defaultSettings(true).drift).toBe(0);
    expect(defaultSettings(false).drift).toBeGreaterThan(0);
  });

  it('orders the pans from deepest to palest', () => {
    expect([...PAN_INK].sort((a, b) => b - a)).toEqual(PAN_INK);
    expect(lookOf(base).colors).toEqual(base.palette.colors);
  });
});

describe('breathing noise (CPU twin of the shader)', () => {
  it('is zero on lattice points and smooth in between', () => {
    expect(gnoise(3, -7)).toBe(0);
    expect(Math.abs(gnoise(3.5, 1.25) - gnoise(3.501, 1.25))).toBeLessThan(0.01);
    expect(Math.abs(fbm(0.3, 0.7, 3))).toBeLessThan(1);
  });

  it('does nothing when drift is off and stays small when on', () => {
    expect(breathe(120, 340, 700, [12, -40], 0, 5)).toEqual([0, 0]);
    for (let t = 0; t < 30; t += 3) {
      const [x, y] = breathe(120 + t * 50, 340, 700, [12, -40], 1, t);
      expect(Math.hypot(x, y)).toBeLessThan(700 * 0.03);
    }
  });
});
