import '../app/styles.css';
import './paint.css';
import { accentFor } from '../app/accent';
import { hydrateIcons } from '../app/icons';
import { luminance } from '../engine/color';
import { LIBRARY, PALETTES, PRESETS, type Palette, generatePalette, randomizeConfig } from '../engine/palettes';
import { DEFAULT_CONFIG, type DriftConfig, decodeConfig, encodeConfig } from '../engine/params';
import { BrushInput, type Tool } from './brush';
import { PaintEngine, type SheetMeta } from './engine';
import { PAN_INK, PAN_NAMES, SIZES, type Settings, defaultSettings, lookOf, sanitizeSettings } from './settings';
import { loadSheet, saveSheet } from './storage';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const app = $('app');
const canvas = $<HTMLCanvasElement>('canvas');

const coarse = matchMedia('(pointer: coarse)').matches;
const smallQuery = matchMedia('(max-width: 760px)');
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

// ---------------------------------------------------------------- settings

const SETTINGS_KEY = 'pd-paint-settings';

function loadSettings(): Settings {
  try {
    return sanitizeSettings(JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? 'null'), defaultSettings(reducedMotion));
  } catch {
    return defaultSettings(reducedMotion);
  }
}

const settings = loadSettings();

function saveSettings(): void {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    /* storage blocked: settings just won't persist */
  }
}

const look = () => lookOf(settings);

// ---------------------------------------------------------------- toast

let toastTimer = 0;
function toast(message: string, ms = 2800): void {
  const el = $('toast');
  el.textContent = message;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => el.classList.remove('show'), ms);
}

// ---------------------------------------------------------------- engine

hydrateIcons();

let engine: PaintEngine;
try {
  engine = new PaintEngine(canvas, { coarse });
} catch {
  $('fallback').hidden = false;
  $('dock').hidden = true;
  throw new Error('Paint studio unavailable');
}

const BUDGET = coarse ? 1.6e6 : 3.2e6;
function layout(): void {
  const w = canvas.clientWidth || innerWidth;
  const h = canvas.clientHeight || innerHeight;
  const pr = Math.max(0.5, Math.min(devicePixelRatio || 1, Math.sqrt(BUDGET / (w * h))));
  engine.setView(w, h, Math.round(w * pr), Math.round(h * pr));
  requestRender();
}

/** A sheet big enough that resizing the window (or turning a phone) stays on paper. */
function freshMeta(): SheetMeta {
  const w = canvas.clientWidth || innerWidth;
  const h = canvas.clientHeight || innerHeight;
  const sw = screen.width || w;
  const sh = screen.height || h;
  const side = Math.max(w, h, sw, sh);
  return {
    width: Math.ceil(coarse ? side : Math.max(w, sw)),
    height: Math.ceil(coarse ? side : Math.max(h, sh)),
    unit: Math.min(900, Math.max(420, Math.min(w, h))),
    seed: [Math.random() * 240 - 120, Math.random() * 240 - 120],
  };
}

// Breathing time only advances while the painting breathes, so pausing never makes it jump.
let breathT = 0;
/** Dev-only virtual clock (scripted demos); null = real time. */
let virtual: number | null = null;
const clock = () => virtual ?? performance.now();

const input = new BrushInput(
  () => ({
    tool: settings.tool,
    ink: PAN_INK[settings.pan],
    radius: settings.radius,
  }),
  (x, y) => engine.toField(x, y, breathT),
  () => engine.k,
  clock,
);

// ---------------------------------------------------------------- loop

let scheduled = false;
let needsRender = true;
let last = performance.now();
let lastDraw = 0;
let sheetDirty = false;
let saveTimer = 0;

function requestRender(): void {
  needsRender = true;
  schedule();
}

function schedule(): void {
  if (scheduled || document.hidden) return;
  scheduled = true;
  requestAnimationFrame(frame);
}

function frame(now: number): void {
  scheduled = false;
  if (engine.isContextLost || virtual !== null) return;
  if (advance(now)) schedule();
}

/** One frame of work. Returns whether another frame is needed. */
function advance(now: number): boolean {
  const dt = Math.min(0.05, Math.max(0, (now - last) / 1000));
  last = now;
  // The sheet loads asynchronously; start() asks for a frame once it's there.
  if (!engine.ready) return false;
  const breathing = settings.drift > 0;
  if (breathing) breathT += dt;

  const { segs, drops } = input.frame(now, dt);
  const stepped = engine.step(dt, now, segs, drops);
  if (stepped) markDirty();

  const interacting = stepped || input.isBusy || engine.isTweening(now);
  // Just breathing? 30fps is plenty and kinder to batteries.
  if (interacting || needsRender || (breathing && now - lastDraw > 31)) {
    engine.render(breathT);
    lastDraw = now;
    needsRender = false;
  }
  return interacting || breathing || engine.isBusy(now);
}

function markDirty(): void {
  sheetDirty = true;
  clearTimeout(saveTimer);
  saveTimer = window.setTimeout(persist, 1500);
}

/** Saves right away (leaving the page); resolves once stored, or after a short wait at most. */
async function flush(): Promise<void> {
  clearTimeout(saveTimer);
  if (!sheetDirty || !engine.ready || engine.isContextLost) return;
  sheetDirty = false;
  try {
    await Promise.race([saveSheet(engine.save()), new Promise((r) => setTimeout(r, 800))]);
  } catch {
    /* see persist() */
  }
}

function persist(): void {
  if (!sheetDirty || !engine.ready || engine.isContextLost) return;
  if (input.isBusy || engine.isBusy(performance.now())) {
    saveTimer = window.setTimeout(persist, 1000);
    return;
  }
  sheetDirty = false;
  try {
    void saveSheet(engine.save());
  } catch {
    /* a lost context can't be read back; the previous save stays */
  }
}

document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    void flush();
  } else {
    last = performance.now();
    requestRender();
  }
});

// ---------------------------------------------------------------- pointers

let paintingTimer = 0;
function setPainting(on: boolean): void {
  clearTimeout(paintingTimer);
  if (on) app.dataset.painting = 'true';
  else paintingTimer = window.setTimeout(() => (app.dataset.painting = 'false'), 380);
}

const pos = (e: PointerEvent) => {
  const r = canvas.getBoundingClientRect();
  return [e.clientX - r.left, e.clientY - r.top] as const;
};

canvas.addEventListener('pointerdown', (e) => {
  if (!engine.ready || (e.pointerType === 'mouse' && e.button !== 0)) return;
  if (smallQuery.matches && app.dataset.sheet === 'open') {
    openSheet(false);
    return;
  }
  e.preventDefault();
  try {
    canvas.setPointerCapture(e.pointerId);
  } catch {
    /* pointer already gone */
  }
  if (!input.isDown) engine.checkpoint();
  const [x, y] = pos(e);
  input.down(e, x, y);
  hideHint();
  setPainting(true);
  syncHistory();
  ring.classList.add('is-down');
  schedule();
});

canvas.addEventListener('pointermove', (e) => {
  const [x, y] = pos(e);
  if (e.pointerType !== 'touch') moveRing(x, y);
  input.move(e, x, y);
  if (input.isDown) schedule();
});

const release = (e: PointerEvent) => {
  if (e.type === 'pointercancel') input.cancel(e);
  else input.up(e);
  if (!input.isDown) {
    setPainting(false);
    ring.classList.remove('is-down');
  }
  schedule();
};
canvas.addEventListener('pointerup', release);
canvas.addEventListener('pointercancel', release);
canvas.addEventListener('lostpointercapture', (e) => {
  if (input.isDown) release(e);
});
canvas.addEventListener('contextmenu', (e) => e.preventDefault());
canvas.addEventListener('pointerleave', (e) => {
  if (e.pointerType !== 'touch') ring.hidden = true;
});

// Mouse wheel sizes the brush.
canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  setRadius(settings.radius * Math.exp(-e.deltaY * 0.0015));
  const [x, y] = [e.offsetX, e.offsetY];
  moveRing(x, y);
}, { passive: false });

// ---------------------------------------------------------------- brush ring (mouse & pen)

const ring = $('ring');
ring.hidden = true;
function moveRing(x: number, y: number): void {
  ring.hidden = false;
  ring.style.transform = `translate(${x}px, ${y}px)`;
}
function syncRing(): void {
  ring.style.setProperty('--r', `${settings.radius}px`);
  const c = settings.tool === 'pigment' ? settings.palette.colors[settings.pan] : 'var(--ink)';
  ring.style.setProperty('--c', c);
  ring.dataset.tool = settings.tool;
}

// ---------------------------------------------------------------- dock

const pansRoot = $('pans');
const pans = PAN_NAMES.map((name, i) => {
  const b = document.createElement('button');
  b.className = 'pan';
  b.type = 'button';
  b.setAttribute('role', 'radio');
  b.dataset.pan = String(i);
  b.title = `${name} pigment (${i + 1})`;
  b.setAttribute('aria-label', `${name} pigment`);
  b.innerHTML = '<i></i>';
  b.addEventListener('click', () => pickTool('pigment', i));
  pansRoot.append(b);
  return b;
});
const toolButtons = [...document.querySelectorAll<HTMLButtonElement>('.tool[data-tool]')];
toolButtons.forEach((b) => b.addEventListener('click', () => pickTool(b.dataset.tool as Tool)));

function pickTool(tool: Tool, pan = settings.pan): void {
  settings.tool = tool;
  settings.pan = pan;
  saveSettings();
  syncTools();
}

function syncTools(): void {
  pans.forEach((b, i) => {
    b.style.setProperty('--c', settings.palette.colors[i]);
    b.setAttribute('aria-checked', String(settings.tool === 'pigment' && settings.pan === i));
  });
  toolButtons.forEach((b) => b.setAttribute('aria-checked', String(settings.tool === b.dataset.tool)));
  app.dataset.tool = settings.tool;
  syncRing();
}

const sizeBtn = $('size');
function setRadius(r: number): void {
  settings.radius = Math.round(Math.min(120, Math.max(4, r)) * 10) / 10;
  sizeBtn.style.setProperty('--dot', `${Math.round(5 + Math.sqrt(settings.radius) * 2.2)}px`);
  sizeBtn.title = `Brush size: ${Math.round(settings.radius * 2)}px ([ and ])`;
  saveSettings();
  syncRing();
}
sizeBtn.addEventListener('click', () => {
  const next = SIZES.find((s) => s > settings.radius + 0.5) ?? SIZES[0];
  setRadius(next);
});

// ---------------------------------------------------------------- top bar

const undoBtn = $<HTMLButtonElement>('undo');
const redoBtn = $<HTMLButtonElement>('redo');
function syncHistory(): void {
  undoBtn.disabled = !engine.canUndo;
  redoBtn.disabled = !engine.canRedo;
}
function undo(): void {
  if (engine.undo()) {
    markDirty();
    requestRender();
  }
  syncHistory();
}
function redo(): void {
  if (engine.redo()) {
    markDirty();
    requestRender();
  }
  syncHistory();
}
undoBtn.addEventListener('click', undo);
redoBtn.addEventListener('click', redo);
$('save').addEventListener('click', () => void saveImage());

const sheetToggle = $('sheetToggle');
function openSheet(open: boolean): void {
  app.dataset.sheet = open ? 'open' : 'closed';
  sheetToggle.setAttribute('aria-expanded', String(open));
}
sheetToggle.addEventListener('click', () => openSheet(app.dataset.sheet !== 'open'));
$('sheetDone').addEventListener('click', () => openSheet(false));

// The generator gets your palette back (and the piece you started from, if any).
function generatorHref(): string {
  const base = (settings.piece && decodeConfig(settings.piece)) || DEFAULT_CONFIG;
  const cfg: DriftConfig = { ...base, paper: settings.palette.paper, colors: [...settings.palette.colors] };
  return `/#c=${encodeConfig(cfg)}`;
}
for (const id of ['toGenerator', 'backLink', 'brand']) {
  const a = $<HTMLAnchorElement>(id);
  const update = () => (a.href = generatorHref());
  a.addEventListener('pointerenter', update);
  a.addEventListener('focus', update);
  a.addEventListener('pointerdown', update);
  a.addEventListener('click', (e) => {
    update();
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0 || !sheetDirty) return;
    // Make sure the painting is stored before this page goes away.
    e.preventDefault();
    void flush().then(() => location.assign(a.href));
  });
}

// ---------------------------------------------------------------- sheet panel: palettes

const library = $('library');
const strips = LIBRARY.map((p) => {
  const b = document.createElement('button');
  b.className = 'swatch-strip';
  b.type = 'button';
  b.title = p.name;
  b.setAttribute('aria-label', `Palette ${p.name}`);
  b.style.setProperty('--paper', p.paper);
  b.innerHTML = p.colors.map((c) => `<i style="background:${c}"></i>`).join('');
  b.addEventListener('click', () => setPalette({ ...p, colors: [...p.colors] }));
  library.append(b);
  return { b, p };
});
$('surprise').addEventListener('click', () => setPalette(generatePalette(Math.random)));

function setPalette(p: Palette, animate = true): void {
  settings.palette = p;
  saveSettings();
  engine.setLook(look(), animate);
  syncPalette();
  requestRender();
}

function syncPalette(): void {
  const p = settings.palette;
  for (const s of strips) s.b.setAttribute('aria-pressed', String(s.p.paper === p.paper && s.p.colors.join() === p.colors.join()));
  const dark = luminance(p.paper) < 0.18;
  app.dataset.tone = dark ? 'dark' : 'light';
  app.style.setProperty('--accent', accentFor(p.colors, dark));
  document.body.style.background = p.paper;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', p.paper);
  syncTools();
}

// ---------------------------------------------------------------- sheet panel: sliders

type SliderKey = 'layers' | 'bleed' | 'drift' | 'texture' | 'edges';
const pct = (v: number) => `${Math.round(v * 100)}`;
const SLIDERS: { key: SliderKey; label: string; hint: string; min: number; max: number; step: number; fmt: (v: number) => string }[] = [
  { key: 'layers', label: 'Washes', hint: 'How many stacked washes the pigment dries into', min: 2, max: 7, step: 1, fmt: (v) => `${v}` },
  { key: 'bleed', label: 'Bleed', hint: 'How far wet pigment creeps into the paper', min: 0, max: 1, step: 0.01, fmt: pct },
  { key: 'drift', label: 'Drift', hint: 'How much the painting breathes once it has dried', min: 0, max: 1, step: 0.01, fmt: pct },
  { key: 'edges', label: 'Edges', hint: 'Darker rims where each wash dried', min: 0, max: 1, step: 0.01, fmt: pct },
  { key: 'texture', label: 'Paper', hint: 'Grain, granulation and brush relief', min: 0, max: 1, step: 0.01, fmt: pct },
];
const sliderEls = new Map<SliderKey, { input: HTMLInputElement; out: HTMLOutputElement; fmt: (v: number) => string; min: number; max: number }>();
const slidersRoot = $('sliders');
for (const spec of SLIDERS) {
  const lab = document.createElement('label');
  lab.className = 'ctl';
  lab.title = spec.hint;
  lab.innerHTML = `<span class="ctl-head"><span class="ctl-name">${spec.label}</span><output></output></span>`;
  const input = document.createElement('input');
  input.type = 'range';
  input.min = String(spec.min);
  input.max = String(spec.max);
  input.step = String(spec.step);
  input.setAttribute('aria-label', spec.label);
  input.addEventListener('input', () => {
    settings[spec.key] = Number(input.value);
    engine.setLook(look());
    syncSliders();
    requestRender();
  });
  input.addEventListener('change', saveSettings);
  input.addEventListener('pointerdown', () => startScrub(lab));
  lab.append(input);
  slidersRoot.append(lab);
  sliderEls.set(spec.key, { input, out: lab.querySelector('output')!, fmt: spec.fmt, min: spec.min, max: spec.max });
}

function syncSliders(): void {
  for (const [key, s] of sliderEls) {
    const v = settings[key];
    if (Number(s.input.value) !== v) s.input.value = String(v);
    s.out.textContent = s.fmt(v);
    s.input.style.setProperty('--fill', `${((v - s.min) / (s.max - s.min)) * 100}%`);
  }
}

// Dragging a slider fades the rest of the chrome so you can see the painting change.
function startScrub(ctl: HTMLElement): void {
  ctl.classList.add('is-scrubbing');
  app.dataset.scrub = 'true';
  const end = () => {
    ctl.classList.remove('is-scrubbing');
    app.dataset.scrub = 'false';
    removeEventListener('pointerup', end);
    removeEventListener('pointercancel', end);
  };
  addEventListener('pointerup', end);
  addEventListener('pointercancel', end);
}

// ---------------------------------------------------------------- new sheets

function adoptPiece(cfg: DriftConfig): void {
  const match = PALETTES.find((p) => p.paper === cfg.paper && p.colors.join() === cfg.colors.join());
  settings.palette = { name: match?.name ?? 'From the generator', paper: cfg.paper, colors: [...cfg.colors] };
  settings.layers = Math.round(cfg.layers);
  settings.edges = cfg.edge;
  settings.hueDrift = cfg.hueDrift;
  settings.mist = cfg.mist;
  settings.feather = cfg.feather;
  settings.density = cfg.density;
  settings.texture = Math.round(Math.min(1, ((cfg.granulation + cfg.grain + cfg.brush) / 3) * 1.1) * 100) / 100;
  saveSettings();
  engine.setLook(look(), true);
  syncAll();
}

function newDrift(): void {
  const palette = settings.palette;
  const cfg = randomizeConfig({ ...DEFAULT_CONFIG, paper: palette.paper, colors: [...palette.colors] }, new Set(['palette']));
  engine.compose(cfg);
  afterNewSheet();
}

function afterNewSheet(): void {
  syncHistory();
  markDirty();
  schedule();
  if (smallQuery.matches) openSheet(false);
}

$('newBlank').addEventListener('click', () => {
  engine.clear();
  afterNewSheet();
});
$('newDrift').addEventListener('click', newDrift);
$('newPiece').addEventListener('click', () => {
  const cfg = settings.piece && decodeConfig(settings.piece);
  if (!cfg) return;
  adoptPiece(cfg);
  engine.compose(cfg);
  afterNewSheet();
});

// ---------------------------------------------------------------- saving an image

async function saveImage(): Promise<void> {
  if (!engine.ready) return;
  const scale = Math.min(2, Math.max(1.5, devicePixelRatio || 1));
  const { width, height, pixels } = engine.capture(scale, breathT);
  const c = document.createElement('canvas');
  c.width = width;
  c.height = height;
  c.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(pixels.buffer as ArrayBuffer), width, height), 0, 0);
  const blob = await new Promise<Blob | null>((r) => c.toBlob(r, 'image/png'));
  if (!blob) {
    toast('Couldn’t make the image — try again.');
    return;
  }
  const d = new Date();
  const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}-${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}`;
  const name = `pigment-drift-painting-${stamp}.png`;
  const file = new File([blob], name, { type: 'image/png' });
  // Phones: the share sheet is the natural way to put it in Photos.
  if (coarse && navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: 'Pigment Drift painting' });
      return;
    } catch (err) {
      if ((err as Error).name === 'AbortError') return;
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  toast(`Saved ${width}×${height} PNG`);
}

// ---------------------------------------------------------------- hint

const HINT_KEY = 'pd-paint-hint';
const hint = $('hint');
function hideHint(): void {
  if (hint.hidden) return;
  hint.classList.add('is-gone');
  setTimeout(() => (hint.hidden = true), 600);
  try {
    localStorage.setItem(HINT_KEY, '1');
  } catch {
    /* fine */
  }
}

// ---------------------------------------------------------------- keyboard

addEventListener('keydown', (e) => {
  const target = e.target instanceof Element ? e.target : document.body;
  if (target.closest('input[type="text"], textarea, select')) return;
  const mod = e.ctrlKey || e.metaKey;
  const key = e.key.toLowerCase();
  if (mod && key === 'z') {
    e.preventDefault();
    if (e.shiftKey) redo();
    else undo();
  } else if (mod && key === 'y') {
    e.preventDefault();
    redo();
  } else if (mod && key === 's') {
    e.preventDefault();
    void saveImage();
  } else if (mod || e.altKey) {
    return;
  } else if (/^[1-5]$/.test(e.key)) {
    pickTool('pigment', Number(e.key) - 1);
  } else if (key === 'w') {
    pickTool('water');
  } else if (key === 'b') {
    pickTool('lift');
  } else if (e.key === '[') {
    setRadius(settings.radius / 1.25);
  } else if (e.key === ']') {
    setRadius(settings.radius * 1.25);
  } else if (key === 'p') {
    openSheet(app.dataset.sheet !== 'open');
  } else if (key === 'h') {
    app.dataset.zen = app.dataset.zen === 'true' ? 'false' : 'true';
  } else if (e.key === 'Escape') {
    if (app.dataset.sheet === 'open') openSheet(false);
    else app.dataset.zen = 'false';
  }
});

// ---------------------------------------------------------------- start

function syncAll(): void {
  syncPalette();
  syncSliders();
  syncHistory();
  setRadius(settings.radius);
  $('newPiece').hidden = !settings.piece;
}

function startFromPiece(piece: { token: string; cfg: DriftConfig }, replacing: boolean): void {
  settings.piece = piece.token;
  adoptPiece(piece.cfg);
  engine.compose(piece.cfg);
  afterNewSheet();
  if (replacing) toast('Started from your generator piece. Undo brings back your last painting.', 4200);
}

// A piece link opened while the studio is already open.
addEventListener('hashchange', () => {
  const piece = takePieceFromUrl();
  if (piece && engine.ready) startFromPiece(piece, true);
});

/** "#from=<token>" is how the generator hands over the piece you were looking at. */
function takePieceFromUrl(): { token: string; cfg: DriftConfig } | null {
  const m = /[#&]from=([\w-]+)/.exec(location.hash);
  if (!m) return null;
  history.replaceState(null, '', location.pathname + location.search);
  const cfg = decodeConfig(m[1]);
  return cfg ? { token: m[1], cfg } : null;
}

async function start(): Promise<void> {
  layout();
  engine.setLook(look());
  syncAll();
  const piece = takePieceFromUrl();
  const fresh = new URLSearchParams(location.search).has('blank');
  const saved = fresh ? null : await loadSheet();
  const restored = !!saved && engine.load(saved);
  if (!restored) engine.newSheet(freshMeta());
  layout();

  if (piece && piece.token !== settings.piece) {
    startFromPiece(piece, restored);
  } else if (!restored && !fresh) {
    const first = PRESETS[0].config;
    engine.compose({ ...first, paper: settings.palette.paper, colors: [...settings.palette.colors] });
  }
  syncAll();
  let seen = false;
  try {
    seen = localStorage.getItem(HINT_KEY) === '1';
  } catch {
    /* show it */
  }
  hint.hidden = seen;
  // ?open=paper opens the palette sheet (handy for links and screenshots).
  if (new URLSearchParams(location.search).get('open') === 'paper') openSheet(true);
  requestRender();
}

new ResizeObserver(() => layout()).observe(canvas);
smallQuery.addEventListener('change', () => openSheet(false));

canvas.addEventListener('webglcontextlost', (e) => {
  e.preventDefault();
  toast('The graphics card took a break — restoring your painting…', 4000);
});
canvas.addEventListener('webglcontextrestored', () => location.reload());

void start();

if (import.meta.env.DEV) {
  const tick = (ms: number) => {
    virtual ??= performance.now();
    last = virtual;
    const steps = Math.max(1, Math.round(ms / (1000 / 60)));
    for (let i = 0; i < steps; i++) {
      virtual += ms / steps;
      advance(virtual);
    }
  };
  const snap = async (name: string, scale = 1) => {
    const { width, height, pixels } = engine.capture(scale, breathT);
    const c = document.createElement('canvas');
    c.width = width;
    c.height = height;
    c.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(pixels.buffer as ArrayBuffer), width, height), 0, 0);
    // The local lab server stores it under .ref/out; otherwise you get the data URL back.
    const url = c.toDataURL('image/png');
    const res = await fetch(`/__save?name=${encodeURIComponent(name)}`, { method: 'POST', body: url }).catch(() => null);
    return res?.ok ? `${width}x${height}` : url;
  };
  const demo = async (name: string) => {
    const m = await import('./demo');
    m.runDemo(name, {
      input,
      set: (tool, pan, radius) => {
        pickTool(tool, pan);
        setRadius(radius);
      },
      tick,
      checkpoint: () => engine.checkpoint(),
    });
  };
  Object.assign(window, { __paint: { engine, input, settings, tick, snap, demo, setPalette, look } });
  if (new URLSearchParams(location.search).has('live')) void import('./demo').then((m) => m.runLive(canvas));
}
