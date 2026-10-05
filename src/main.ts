import './app/styles.css';
import { luminance } from './engine/color';
import { PRESETS, randomizeConfig } from './engine/palettes';
import { createRng, encodeConfig } from './engine/params';
import { accentFor } from './app/accent';
import { hydrateIcons, icon } from './app/icons';
import { Panel } from './app/panel';
import { Screensaver } from './app/screensaver';
import { Stage } from './app/stage';
import { type Device, type Mode, Store, initialConfig } from './app/store';
import { thumbnail } from './export/render';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

const small = matchMedia('(max-width: 760px)').matches;
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

// Deep links: ?view=mobile|desktop picks the preview; ?open=export[:image|video|embed|config] opens the exporter;
// ?screensaver starts in the artwork-only view (handy for kiosks and second screens).
const query = new URLSearchParams(location.search);
const viewParam = query.get('view');

const store = new Store({
  config: initialConfig(),
  mode: reducedMotion ? 'still' : 'moving',
  phase: 0,
  device: viewParam === 'mobile' || viewParam === 'desktop' ? viewParam : small ? 'mobile' : 'desktop',
  panelOpen: !small,
  locked: new Set(),
  immersive: false,
});

// ---------- toast ----------
let toastTimer = 0;
function toast(message: string): void {
  const el = $('toast');
  el.textContent = message;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => el.classList.remove('show'), 2600);
}

// ---------- stage & timeline ----------
const phaseInput = $<HTMLInputElement>('phase');
const timeLabel = $('timeLabel');
let lastLabel = 0;
function showPhase(phase: number): void {
  const now = performance.now();
  if (now - lastLabel < 80) return; // the label doesn't need 60fps
  lastLabel = now;
  phaseInput.value = String(phase);
  phaseInput.style.setProperty('--fill', `${phase * 100}%`);
  timeLabel.textContent = `${(phase * store.state.config.loop).toFixed(1)}s`;
}
const stage = new Stage(store, showPhase);

phaseInput.addEventListener('input', () => {
  store.set({ mode: 'still', phase: Number(phaseInput.value) });
  lastLabel = 0;
  showPhase(store.state.phase);
});

// ---------- panel (preset thumbnails render after first paint) ----------
const thumbs = new Map<string, string>();
const panel = new Panel(store, thumbs);
requestIdleCallbackSafe(async () => {
  try {
    for (const p of PRESETS) {
      thumbs.set(p.name, await thumbnail(p.config));
      panel.refreshThumbs();
    }
  } catch {
    /* thumbnails are decorative */
  }
});

function requestIdleCallbackSafe(fn: () => void): void {
  if ('requestIdleCallback' in window) requestIdleCallback(fn, { timeout: 1500 });
  else setTimeout(fn, 300);
}

// ---------- top actions ----------
$('undo').innerHTML = icon('undo');
$('redo').innerHTML = icon('redo');
$('reseed').innerHTML = icon('shuffle', 16);
$('panelToggle').innerHTML = icon('sliders');
hydrateIcons();

function randomize(): void {
  store.replaceConfig(randomizeConfig(store.state.config, store.state.locked));
}
$('randomize').addEventListener('click', randomize);
$('undo').addEventListener('click', () => store.undo());
$('redo').addEventListener('click', () => store.redo());
$('reseed').addEventListener('click', () => {
  store.setConfig({ seed: Math.floor(createRng(Date.now())() * 1_000_000) });
});
$('panelToggle').addEventListener('click', () => store.set({ panelOpen: !store.state.panelOpen }));
$('panelDone').addEventListener('click', () => store.set({ panelOpen: false }));

const screensaver = new Screensaver(store, $('app'), $('dock'));
$('screensaver').addEventListener('click', () => screensaver.toggle());

// The export code (video encoder, zip) loads on first use to keep startup light.
let exporter: Promise<import('./app/exportDialog').ExportDialog> | null = null;
function openExport(tab?: string): void {
  exporter ??= import('./app/exportDialog').then((m) => new m.ExportDialog(store, toast));
  exporter.then((e) => e.open(tab as Parameters<typeof e.open>[0])).catch(() => {
    exporter = null;
    toast('Couldn’t load the exporter — check your connection and try again.');
  });
}
$('openExport').addEventListener('click', () => openExport());

// The paint studio picks up the piece you're looking at.
const paintLink = $<HTMLAnchorElement>('openPaint');
const paintHref = () => `/paint/#from=${encodeConfig(store.state.config)}`;
for (const ev of ['pointerenter', 'focus', 'pointerdown', 'click']) paintLink.addEventListener(ev, () => (paintLink.href = paintHref()));

// ---------- segmented controls ----------
function bindSeg(id: string, attr: string, onPick: (v: string) => void): HTMLButtonElement[] {
  const buttons = [...$(id).querySelectorAll<HTMLButtonElement>('button')];
  buttons.forEach((b) => b.addEventListener('click', () => onPick(b.dataset[attr]!)));
  return buttons;
}
const modeButtons = bindSeg('modeSeg', 'mode', (m) => store.set({ mode: m as Mode }));
$('playToggle').addEventListener('click', () => store.set({ mode: store.state.mode === 'moving' ? 'still' : 'moving' }));
const deviceButtons = bindSeg('deviceSeg', 'device', (d) => store.set({ device: d as Device }));

// ---------- reflect state in chrome ----------
const app = $('app');
function syncChrome(): void {
  const { config, mode, device, panelOpen, immersive } = store.state;
  modeButtons.forEach((b) => b.setAttribute('aria-checked', String(b.dataset.mode === mode)));
  const play = $('playToggle');
  const playLabel = mode === 'moving' ? 'Pause (Space)' : 'Play (Space)';
  if (play.title !== playLabel) {
    play.title = playLabel;
    play.setAttribute('aria-label', mode === 'moving' ? 'Pause' : 'Play');
    play.innerHTML = icon(mode === 'moving' ? 'pause' : 'play');
  }
  deviceButtons.forEach((b) => b.setAttribute('aria-checked', String(b.dataset.device === device)));
  app.dataset.panel = panelOpen ? 'open' : 'closed';
  app.dataset.mode = mode;
  app.dataset.immersive = String(immersive);
  const ss = $('screensaver');
  ss.setAttribute('aria-pressed', String(immersive));
  ss.title = immersive ? 'Back to the editor (Esc)' : 'Screensaver: fullscreen, artwork only (F)';
  ss.setAttribute('aria-label', immersive ? 'Exit screensaver' : 'Screensaver');
  ss.innerHTML = immersive ? `${icon('collapse')}<span>Exit</span>` : icon('expand');
  $('seedLabel').textContent = String(config.seed).padStart(4, '0');
  ($('undo') as HTMLButtonElement).disabled = !store.canUndo;
  ($('redo') as HTMLButtonElement).disabled = !store.canRedo;

  // When the page is dark (e.g. Night Ink), chrome over the canvas switches to light ink.
  const dark = luminance(config.paper) < 0.18;
  app.dataset.tone = dark ? 'dark' : 'light';
  app.style.setProperty('--accent', accentFor(config.colors, dark));
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', config.paper);
}

store.subscribe((state, changed) => {
  syncChrome();
  if (changed.has('phase') || changed.has('config')) {
    lastLabel = 0;
    showPhase(state.phase);
  }
});
syncChrome();
showPhase(0);

// ---------- keyboard ----------
addEventListener('keydown', (e) => {
  const target = e.target instanceof Element ? e.target : document.body;
  if (target.closest('input[type="text"], textarea, select, dialog[open]')) return;
  const mod = e.ctrlKey || e.metaKey;
  if (mod && e.key.toLowerCase() === 'z') {
    e.preventDefault();
    if (e.shiftKey) store.redo();
    else store.undo();
  } else if (mod && e.key.toLowerCase() === 'y') {
    e.preventDefault();
    store.redo();
  } else if (mod || e.altKey) {
    return;
  } else if (e.key === 'r' || e.key === 'R') {
    randomize();
  } else if (e.key === 's' || e.key === 'S') {
    $('reseed').click();
  } else if (e.key === 'h' || e.key === 'H') {
    store.set({ panelOpen: !store.state.panelOpen });
  } else if (e.key === ' ' && !target.closest('button, input')) {
    e.preventDefault();
    store.set({ mode: store.state.mode === 'moving' ? 'still' : 'moving' });
  } else if (e.key === 'e' || e.key === 'E') {
    openExport();
  } else if (e.key === 'p' || e.key === 'P') {
    location.href = paintHref();
  } else if (e.key === 'f' || e.key === 'F') {
    screensaver.toggle();
  } else if (e.key === 'Escape' && store.state.immersive) {
    screensaver.exit();
  }
});

// Close the panel sheet on small screens when tapping the artwork.
$('stage').addEventListener('click', () => {
  if (matchMedia('(max-width: 760px)').matches && store.state.panelOpen) store.set({ panelOpen: false });
});

// Crossing the phone breakpoint (rotating a tablet, resizing a window) resets the view.
matchMedia('(max-width: 760px)').addEventListener('change', (e) => {
  store.set({ device: e.matches ? 'mobile' : 'desktop', panelOpen: !e.matches });
});

if (query.has('screensaver')) screensaver.enter({ fullscreen: false });

const openParam = query.get('open');
if (openParam?.startsWith('export')) openExport(openParam.split(':')[1]);

// Re-layout once fonts settle (the dock height can change).
document.fonts?.ready.then(() => stage.layout());
