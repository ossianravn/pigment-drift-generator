import { describe, expect, it } from 'vitest';
import {
  createRng,
  decodeConfig,
  DEFAULT_CONFIG,
  encodeConfig,
  type GroupId,
  GROUPS,
  parseConfigText,
  RANGES,
  randomizeRanges,
  sanitizeConfig,
} from '../src/engine/params';

describe('schema', () => {
  it('defaults sit inside every range', () => {
    for (const spec of RANGES) {
      const v = DEFAULT_CONFIG[spec.key];
      expect(v, spec.key).toBeGreaterThanOrEqual(spec.min);
      expect(v, spec.key).toBeLessThanOrEqual(spec.max);
      if (!spec.random) continue;
      expect(spec.random[0], spec.key).toBeGreaterThanOrEqual(spec.min);
      expect(spec.random[1], spec.key).toBeLessThanOrEqual(spec.max);
    }
  });

  it('every range belongs to a known group or the global controls', () => {
    const ids = new Set<string>([...GROUPS.map((g) => g.id), 'global']);
    for (const spec of RANGES) expect(ids.has(spec.group), spec.key).toBe(true);
  });

  it('older configs without opacity open at full strength', () => {
    const { opacity: _omit, ...legacy } = DEFAULT_CONFIG;
    expect(sanitizeConfig({ ...legacy, opacity: undefined }).opacity).toBe(1);
  });
});

describe('sanitizeConfig', () => {
  it('returns defaults for garbage', () => {
    expect(sanitizeConfig(null)).toEqual(DEFAULT_CONFIG);
    expect(sanitizeConfig('nope')).toEqual(DEFAULT_CONFIG);
    expect(sanitizeConfig({ coverage: 'lots', anchor: 'middle', paper: 'blue' })).toEqual(DEFAULT_CONFIG);
  });

  it('clamps and snaps numbers', () => {
    const cfg = sanitizeConfig({ coverage: 99, layers: 3.7, loop: -4, hueDrift: 0.123456 });
    expect(cfg.coverage).toBe(1.25);
    expect(cfg.layers).toBe(4);
    expect(cfg.loop).toBe(6);
    expect(cfg.hueDrift).toBe(0.12);
  });

  it('normalizes colors and pads short palettes', () => {
    const cfg = sanitizeConfig({ paper: '#ABC', colors: ['#112233', 'nope', '#445566'] });
    expect(cfg.paper).toBe('#aabbcc');
    expect(cfg.colors).toEqual(['#112233', '#445566', '#445566', '#445566', '#445566']);
  });

  it('drops unknown keys and keeps the version', () => {
    const cfg = sanitizeConfig({ evil: '<script>', v: 99 }) as unknown as Record<string, unknown>;
    expect(cfg.evil).toBeUndefined();
    expect(cfg.v).toBe(1);
  });
});

describe('share links', () => {
  it('round-trips a config through encode/decode', () => {
    const cfg = sanitizeConfig({ ...DEFAULT_CONFIG, seed: 999, anchor: 'top', colors: ['#000000', '#111111', '#222222', '#333333', '#ffffff'] });
    expect(decodeConfig(encodeConfig(cfg))).toEqual(cfg);
  });

  it('rejects broken tokens', () => {
    expect(decodeConfig('!!!')).toBeNull();
  });

  it('parses pasted links and JSON', () => {
    const cfg = sanitizeConfig({ ...DEFAULT_CONFIG, seed: 42 });
    expect(parseConfigText(`https://example.com/#c=${encodeConfig(cfg)}`)).toEqual(cfg);
    expect(parseConfigText(JSON.stringify(cfg))).toEqual(cfg);
    expect(parseConfigText('[1,2]')).toBeNull();
    expect(parseConfigText('')).toBeNull();
    expect(parseConfigText('hello')).toBeNull();
  });
});

describe('randomizeRanges', () => {
  it('is deterministic for a seeded rng', () => {
    const a = randomizeRanges(DEFAULT_CONFIG, new Set(), createRng(7));
    const b = randomizeRanges(DEFAULT_CONFIG, new Set(), createRng(7));
    expect(a).toEqual(b);
  });

  it('stays inside the ranges', () => {
    const rng = createRng(1);
    for (let i = 0; i < 200; i++) {
      const cfg = randomizeRanges(DEFAULT_CONFIG, new Set(), rng);
      expect(sanitizeConfig(cfg)).toEqual(cfg);
    }
  });

  it('leaves locked groups untouched', () => {
    const locked = new Set<GroupId>(['composition', 'texture']);
    const cfg = randomizeRanges(DEFAULT_CONFIG, locked, createRng(3));
    for (const spec of RANGES.filter((r) => r.group !== 'global' && locked.has(r.group))) {
      expect(cfg[spec.key], spec.key).toBe(DEFAULT_CONFIG[spec.key]);
    }
    expect(cfg.seed).toBe(DEFAULT_CONFIG.seed);
    expect(cfg.anchor).toBe(DEFAULT_CONFIG.anchor);
  });

  it('never changes opacity: it is a preference, not part of the look', () => {
    const faded = { ...DEFAULT_CONFIG, opacity: 0.35 };
    const rng = createRng(4);
    for (let i = 0; i < 50; i++) expect(randomizeRanges(faded, new Set(), rng).opacity).toBe(0.35);
  });
});
