import { describe, expect, it } from 'vitest';
import { hexToRgb, isHex, linearToSrgb, normalizeHex, oklchToHex, rgbToHex, srgbToLinear } from '../src/engine/color';
import { generatePalette, PALETTES, PRESETS, randomizeConfig } from '../src/engine/palettes';
import { createRng, DEFAULT_CONFIG, RANGES, sanitizeConfig } from '../src/engine/params';
import { FRAGMENT_SHADER } from '../src/engine/shader';

describe('color', () => {
  it('parses and formats hex', () => {
    expect(isHex('#fff')).toBe(true);
    expect(isHex('fff0')).toBe(false);
    expect(normalizeHex('ABC')).toBe('#aabbcc');
    expect(rgbToHex(hexToRgb('#3446c9'))).toBe('#3446c9');
  });

  it('linear <-> sRGB round-trips', () => {
    for (const v of [0, 0.002, 0.04, 0.2, 0.5, 1]) expect(linearToSrgb(srgbToLinear(v))).toBeCloseTo(v, 6);
  });

  it('keeps OKLCH colors in gamut', () => {
    const rand = createRng(11);
    for (let i = 0; i < 100; i++) {
      expect(isHex(oklchToHex(rand(), rand() * 0.4, rand() * 360))).toBe(true);
    }
  });
});

describe('palettes & presets', () => {
  it('every palette has a paper and five pigments', () => {
    for (const p of PALETTES) {
      expect(isHex(p.paper), p.name).toBe(true);
      expect(p.colors, p.name).toHaveLength(5);
      p.colors.forEach((c) => expect(isHex(c), p.name).toBe(true));
    }
  });

  it('presets are valid, uniquely named configs', () => {
    expect(new Set(PRESETS.map((p) => p.name)).size).toBe(PRESETS.length);
    for (const p of PRESETS) expect(sanitizeConfig(p.config), p.name).toEqual(p.config);
  });

  it('generated palettes are valid', () => {
    const rand = createRng(5);
    for (let i = 0; i < 50; i++) {
      const p = generatePalette(rand);
      expect(isHex(p.paper)).toBe(true);
      expect(p.colors.every(isHex)).toBe(true);
    }
  });

  it('randomizeConfig respects a palette lock', () => {
    const cfg = randomizeConfig(DEFAULT_CONFIG, new Set(['palette']), createRng(9));
    expect(cfg.colors).toEqual(DEFAULT_CONFIG.colors);
    expect(cfg.paper).toBe(DEFAULT_CONFIG.paper);
  });
});

describe('shader', () => {
  it('declares a uniform for every numeric parameter the renderer uploads', () => {
    const uploaded = RANGES.map((r) => r.key).filter((k) => k !== 'layers' && k !== 'loop');
    for (const key of uploaded) {
      const name = `u${key[0].toUpperCase()}${key.slice(1)}`;
      expect(FRAGMENT_SHADER, name).toMatch(new RegExp(`uniform[^;]*\\b${name}\\b`));
    }
  });
});
