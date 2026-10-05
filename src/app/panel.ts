// Builds the control panel from the parameter schema and keeps it in sync with the store.
//
// Desktop shows every control in a side panel. Phones show one control at a time in
// a short card, picked from a rail of chips, so the artwork stays visible. Everywhere,
// dragging a slider turns the panel to glass: only that slider stays on screen.

import { ANCHORS, type Anchor, DEFAULT_CONFIG, GROUPS, type GroupId, RANGES, type RangeSpec } from '../engine/params';
import { LIBRARY, LIBRARY_PREVIEW, PRESETS, randomPalette, randomizeConfig } from '../engine/palettes';
import { icon } from './icons';
import type { Store } from './store';

const ANCHOR_ICON: Record<Anchor, string> = {
  bottom: 'anchorBottom',
  top: 'anchorTop',
  left: 'anchorLeft',
  right: 'anchorRight',
};

// Slightly different blob shapes so the paint dabs feel hand-placed.
const DAB_SHAPES = [
  '52% 48% 46% 54% / 55% 45% 55% 45%',
  '46% 54% 55% 45% / 48% 56% 44% 52%',
  '55% 45% 48% 52% / 44% 52% 48% 56%',
  '48% 52% 52% 48% / 56% 44% 56% 44%',
  '50% 50% 44% 56% / 52% 48% 52% 48%',
  '45% 55% 50% 50% / 50% 46% 54% 50%',
];

/** Controls that aren't sliders but get their own chip on phones. */
const EXTRA_CONTROLS: Partial<Record<GroupId, { key: string; label: string }[]>> = {
  palette: [
    { key: 'colors', label: 'Colors' },
    { key: 'palettes', label: 'Palettes' },
  ],
  composition: [{ key: 'anchor', label: 'Anchor' }],
};

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string> = {}, html = '') => {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  if (html) node.innerHTML = html;
  return node;
};

export class Panel {
  private sliders = new Map<string, { input: HTMLInputElement; out: HTMLOutputElement; spec: RangeSpec }>();
  private dabs: HTMLInputElement[] = [];
  private paperInput!: HTMLInputElement;
  private anchorButtons = new Map<Anchor, HTMLButtonElement>();
  private lockButtons = new Map<GroupId, HTMLButtonElement>();
  private app = document.getElementById('app')!;
  private inner = document.getElementById('panelInner')!;
  private chips = new Map<string, HTMLButtonElement>();
  /** Which control a phone shows; desktop ignores it. */
  private active = 'presets';
  private sheetDice!: HTMLButtonElement;
  private sheetLock!: HTMLButtonElement;
  private scrubTimer = 0;
  /** Control keys in chip-rail order — what a swipe steps through. */
  private order: string[] = [];
  private small = matchMedia('(max-width: 760px)');
  private reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  /** Completes the step in flight; run early if another swipe arrives before it lands. */
  private pendingStep: (() => void) | null = null;

  constructor(private store: Store, private thumbs: Map<string, string>) {
    this.buildMaster();
    this.buildPresets();
    this.buildGroups();
    this.buildChips();
    this.buildSheetBar();
    this.bindSwipe();
    this.focus(this.active);
    this.sync();
    store.subscribe((state, changed) => {
      if (changed.has('config')) this.sync();
      if (changed.has('locked')) this.syncLocks();
      if (changed.has('panelOpen') && state.panelOpen) this.hintSwipe();
    });
  }

  refreshThumbs(): void {
    document.querySelectorAll<HTMLImageElement>('.preset img').forEach((img) => {
      const src = this.thumbs.get(img.dataset.preset!);
      if (src) img.src = src;
    });
  }

  // ---------- building ----------

  private buildPresets(): void {
    const row = document.getElementById('presets')!;
    for (const preset of PRESETS) {
      const btn = el('button', { class: 'preset', type: 'button', title: `Start from “${preset.name}”` });
      const img = el('img', { alt: '', 'data-preset': preset.name, width: '96', height: '60' }) as HTMLImageElement;
      const src = this.thumbs.get(preset.name);
      if (src) img.src = src;
      btn.append(img, el('span', {}, preset.name));
      // Presets change the look; loop length and opacity are your preferences, so they stay.
      btn.addEventListener('click', () => {
        const { loop, opacity } = this.store.state.config;
        this.store.replaceConfig({ ...preset.config, loop, opacity });
      });
      row.append(btn);
    }
    // A mouse wheel scrolls the row sideways; at either end it hands back to the panel.
    row.addEventListener('wheel', (e) => {
      if (Math.abs(e.deltaY) <= Math.abs(e.deltaX) || row.scrollWidth <= row.clientWidth) return;
      const atStart = row.scrollLeft <= 0 && e.deltaY < 0;
      const atEnd = row.scrollLeft + row.clientWidth >= row.scrollWidth - 1 && e.deltaY > 0;
      if (atStart || atEnd) return;
      row.scrollLeft += e.deltaY;
      e.preventDefault();
    }, { passive: false });
  }

  /** Master controls (e.g. opacity) sit above everything, outside the randomizable groups. */
  private buildMaster(): void {
    const root = document.getElementById('master')!;
    for (const spec of RANGES.filter((r) => r.group === 'global')) root.append(this.buildSlider(spec));
  }

  private buildGroups(): void {
    const root = document.getElementById('groups')!;
    for (const group of GROUPS) {
      const section = el('section', { class: 'group panel-section', 'data-group': group.id });
      const head = el('header', { class: 'group-head' });
      head.innerHTML = `<h2><span class="numeral">${group.numeral}.</span> ${group.title}</h2>`;
      const tools = el('div', { class: 'group-tools' });
      const lock = this.lockButton(group.id);
      this.lockButtons.set(group.id, lock);
      tools.append(this.diceButton(() => group.id, group.title), lock);
      head.append(tools);
      section.append(head);

      const body = el('div', { class: 'group-body' });
      if (group.id === 'palette') body.append(this.buildPalette());
      if (group.id === 'composition') body.append(this.buildAnchor());
      for (const spec of RANGES.filter((r) => r.group === group.id)) body.append(this.buildSlider(spec));
      section.append(body);
      root.append(section, el('div', { class: 'rule', 'aria-hidden': 'true' }, '<svg viewBox="0 0 300 6" preserveAspectRatio="none"><path d="M1 3.4 C 60 1.8, 120 4.6, 180 3 S 260 2.2, 299 3.6"/></svg>'));
    }
    this.syncLocks();
  }

  private diceButton(group: () => GroupId | null, title?: string): HTMLButtonElement {
    const b = el('button', { class: 'icon-btn small', type: 'button' }, icon('dice', 16)) as HTMLButtonElement;
    if (title) {
      b.title = `Randomize ${title.toLowerCase()} only`;
      b.setAttribute('aria-label', `Randomize ${title}`);
    }
    b.addEventListener('click', () => {
      const id = group();
      if (!id) return;
      const locked = new Set(GROUPS.map((g) => g.id).filter((g) => g !== id));
      this.store.replaceConfig(randomizeConfig(this.store.state.config, locked));
    });
    return b;
  }

  private lockButton(group: GroupId | (() => GroupId | null)): HTMLButtonElement {
    const b = el('button', { class: 'icon-btn small lock', type: 'button', 'aria-pressed': 'false' }) as HTMLButtonElement;
    b.addEventListener('click', () => {
      const id = typeof group === 'function' ? group() : group;
      if (!id) return;
      const locked = new Set(this.store.state.locked);
      if (locked.has(id)) locked.delete(id);
      else locked.add(id);
      this.store.set({ locked });
    });
    return b;
  }

  private buildPalette(): HTMLElement {
    const wrap = el('div', { class: 'palette' });
    const colors = el('div', { class: 'palette-colors', 'data-key': 'colors' });
    const dabs = el('div', { class: 'dabs' });
    const make = (label: string, shape: string, onInput: (v: string) => void) => {
      const lab = el('label', { class: 'dab', title: label });
      lab.style.borderRadius = shape;
      const input = el('input', { type: 'color', 'aria-label': label }) as HTMLInputElement;
      input.addEventListener('input', () => onInput(input.value));
      input.addEventListener('change', () => this.store.commit());
      lab.append(input);
      dabs.append(lab);
      return input;
    };
    for (let i = 0; i < 5; i++) {
      const label = i === 0 ? 'Foreground pigment' : i === 4 ? 'Horizon pigment' : `Pigment ${i + 1}`;
      this.dabs.push(make(label, DAB_SHAPES[i], (v) => {
        const next = [...this.store.state.config.colors];
        next[i] = v;
        this.store.setConfig({ colors: next }, false);
      }));
    }
    const paperWrap = el('div', { class: 'paper-pick' });
    this.paperInput = make('Paper', DAB_SHAPES[5], (v) => this.store.setConfig({ paper: v }, false));
    paperWrap.append(this.paperInput.parentElement!, el('span', {}, 'paper'));
    dabs.append(paperWrap);
    colors.append(dabs);
    colors.append(el('div', { class: 'dab-legend' }, '<span>foreground</span><span class="arrow">⟶</span><span>horizon</span>'));

    const actions = el('div', { class: 'mini-actions' });
    const shuffle = el('button', { class: 'chip', type: 'button' }, `${icon('shuffle', 14)}<span>New palette</span>`);
    shuffle.addEventListener('click', () => {
      const p = randomPalette(Math.random);
      this.store.setConfig({ paper: p.paper, colors: [...p.colors] });
    });
    const reverse = el('button', { class: 'chip', type: 'button', title: 'Swap foreground and horizon pigments' }, '<span>Reverse</span>');
    reverse.addEventListener('click', () => this.store.setConfig({ colors: [...this.store.state.config.colors].reverse() }));
    actions.append(shuffle, reverse);
    colors.append(actions);

    // Desktop shows a varied first few with "More palettes"; phones scroll through them all.
    const libraryWrap = el('div', { class: 'library-wrap', 'data-key': 'palettes' });
    const library = el('div', { class: 'library' });
    LIBRARY.forEach((p, i) => {
      const b = el('button', { class: `swatch-strip${i >= LIBRARY_PREVIEW ? ' extra' : ''}`, type: 'button', title: p.name, 'aria-label': `Palette ${p.name}` });
      b.style.setProperty('--paper', p.paper);
      b.innerHTML = p.colors.map((c) => `<i style="background:${c}"></i>`).join('');
      b.addEventListener('click', () => this.store.setConfig({ paper: p.paper, colors: [...p.colors] }));
      library.append(b);
    });
    const more = el('button', { class: 'chip library-more', type: 'button', 'aria-expanded': 'false' }) as HTMLButtonElement;
    const extra = LIBRARY.length - LIBRARY_PREVIEW;
    const label = (open: boolean) => (more.innerHTML = open ? '<span>Fewer palettes</span>' : `<span>More palettes</span><small>${extra}</small>`);
    label(false);
    more.addEventListener('click', () => {
      const open = !library.classList.contains('is-open');
      library.classList.toggle('is-open', open);
      more.setAttribute('aria-expanded', String(open));
      label(open);
    });
    libraryWrap.append(library, more);
    wrap.append(colors, libraryWrap);
    return wrap;
  }

  private buildAnchor(): HTMLElement {
    const wrap = el('div', { class: 'ctl anchor-ctl', 'data-key': 'anchor' });
    wrap.append(el('span', { class: 'ctl-name' }, 'Anchored to'));
    const seg = el('div', { class: 'anchor-seg', role: 'radiogroup', 'aria-label': 'Anchored edge' });
    for (const a of ANCHORS) {
      const b = el('button', { type: 'button', role: 'radio', title: `Pigment rises from the ${a}`, 'aria-label': a }, icon(ANCHOR_ICON[a], 20)) as HTMLButtonElement;
      b.addEventListener('click', () => this.store.setConfig({ anchor: a }));
      this.anchorButtons.set(a, b);
      seg.append(b);
    }
    wrap.append(seg);
    return wrap;
  }

  private buildSlider(spec: RangeSpec): HTMLElement {
    const lab = el('label', { class: 'ctl', title: spec.hint, 'data-key': spec.key });
    const head = el('span', { class: 'ctl-head' });
    head.append(el('span', { class: 'ctl-name' }, spec.label));
    const out = el('output') as HTMLOutputElement;
    head.append(out);
    const input = el('input', {
      type: 'range',
      min: String(spec.min),
      max: String(spec.max),
      step: String(spec.step),
      'aria-label': spec.label,
    }) as HTMLInputElement;
    input.addEventListener('input', () => this.store.setConfig({ [spec.key]: Number(input.value) }, false));
    input.addEventListener('change', () => this.store.commit());
    input.addEventListener('pointerdown', () => this.startScrub(lab));
    // Double-click resets to the default.
    input.addEventListener('dblclick', () => this.store.setConfig({ [spec.key]: DEFAULT_CONFIG[spec.key] }));
    lab.append(head, input);
    this.sliders.set(spec.key, { input, out, spec });
    return lab;
  }

  /** The phone rail: every control as a chip, grouped by section numerals. */
  private buildChips(): void {
    const rail = document.getElementById('chips')!;
    const add = (key: string, label: string) => {
      const b = el('button', { type: 'button', 'data-target': key, 'aria-pressed': 'false' }, label) as HTMLButtonElement;
      b.addEventListener('click', () => this.focus(key));
      this.chips.set(key, b);
      this.order.push(key);
      rail.append(b);
    };
    add('presets', 'Presets');
    for (const spec of RANGES.filter((r) => r.group === 'global')) add(spec.key, spec.label);
    for (const group of GROUPS) {
      rail.append(el('span', { class: 'chip-sep', title: group.title, 'aria-hidden': 'true' }, `${group.numeral}.`));
      for (const extra of EXTRA_CONTROLS[group.id] ?? []) add(extra.key, extra.label);
      for (const spec of RANGES.filter((r) => r.group === group.id)) {
        add(spec.key, group.id === 'current' && spec.key === 'river' ? 'Current' : spec.label);
      }
    }
  }

  private buildSheetBar(): void {
    const tools = document.getElementById('sheetTools')!;
    const activeGroup = () => this.activeGroup();
    this.sheetDice = this.diceButton(activeGroup);
    this.sheetLock = this.lockButton(activeGroup);
    tools.append(this.sheetDice, this.sheetLock);

    // Hold to peek: the card steps aside while the button is held.
    const peek = document.getElementById('peek')!;
    peek.innerHTML = icon('eye', 18);
    peek.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      peek.setPointerCapture(e.pointerId);
      this.app.dataset.peek = 'true';
    });
    const unpeek = () => (this.app.dataset.peek = 'false');
    peek.addEventListener('pointerup', unpeek);
    peek.addEventListener('pointercancel', unpeek);
    peek.addEventListener('lostpointercapture', unpeek);
    this.syncLocks();
  }

  // ---------- phone focus ----------

  private activeGroup(): GroupId | null {
    const host = this.inner.querySelector<HTMLElement>(`[data-key="${this.active}"]`)?.closest<HTMLElement>('[data-group]');
    return (host?.dataset.group as GroupId | undefined) ?? null;
  }

  /** Shows one control on phones (desktop CSS ignores this) and highlights its chip. */
  focus(key: string): void {
    const target = this.inner.querySelector<HTMLElement>(`[data-key="${key}"]`);
    if (!target) return;
    this.active = key;
    this.inner.querySelectorAll<HTMLElement>('[data-key]').forEach((n) => n.classList.toggle('is-active', n === target));
    this.inner.querySelectorAll<HTMLElement>('.panel-section').forEach((s) => s.classList.toggle('has-active', s.contains(target)));
    for (const [k, chip] of this.chips) chip.setAttribute('aria-pressed', String(k === key));
    this.chips.get(key)?.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' });

    const groupId = this.activeGroup();
    const group = GROUPS.find((g) => g.id === groupId);
    document.getElementById('sheetTitle')!.innerHTML = group
      ? `<span class="numeral">${group.numeral}.</span> ${group.title}`
      : 'Adjust';
    document.getElementById('sheetTools')!.hidden = !group;
    if (group) {
      this.sheetDice.title = `Randomize ${group.title.toLowerCase()} only`;
      this.sheetDice.setAttribute('aria-label', this.sheetDice.title);
    }
    this.syncLocks();
  }

  // ---------- swipe between controls (phones) ----------

  private activeEl(): HTMLElement | null {
    return this.inner.querySelector<HTMLElement>(`[data-key="${this.active}"]`);
  }

  /**
   * Swiping sideways on the card steps to the previous/next control. Gestures that start
   * on sliders, colour dabs or rows that already scroll sideways are left to them.
   */
  private bindSwipe(): void {
    const card = document.getElementById('panel')!;
    let start: { x: number; y: number; t: number; id: number } | null = null;
    let swiping = false;

    const follow = (dx: number) => {
      const el = this.activeEl();
      if (!el) return;
      el.style.transform = `translateX(${dx * 0.55}px)`;
      el.style.opacity = String(1 - Math.min(0.6, Math.abs(dx) / 320));
    };

    card.addEventListener('pointerdown', (e) => {
      if (!this.small.matches || !e.isPrimary || e.button !== 0) return;
      if ((e.target as Element).closest('input, .preset-row, .library, .chips, .dabs, .peek')) return;
      start = { x: e.clientX, y: e.clientY, t: performance.now(), id: e.pointerId };
      swiping = false;
    });

    card.addEventListener('pointermove', (e) => {
      if (!start || e.pointerId !== start.id) return;
      const dx = e.clientX - start.x;
      const dy = e.clientY - start.y;
      if (!swiping) {
        // Only clearly horizontal movement becomes a swipe; small jitters stay taps.
        if (Math.abs(dx) < 10 || Math.abs(dx) < Math.abs(dy) * 1.3) return;
        swiping = true;
        // Capturing on the card also means the release can't "click" a button underneath.
        card.setPointerCapture(e.pointerId);
      }
      follow(dx);
    });

    const finish = (e: PointerEvent, cancelled = false) => {
      if (!start || e.pointerId !== start.id) return;
      const dx = e.clientX - start.x;
      const speed = Math.abs(dx) / Math.max(1, performance.now() - start.t);
      const wasSwiping = swiping;
      start = null;
      swiping = false;
      if (!wasSwiping) return;
      const committed = !cancelled && (Math.abs(dx) > 64 || (speed > 0.45 && Math.abs(dx) > 24));
      this.step(committed ? (dx < 0 ? 1 : -1) : 0);
    };
    card.addEventListener('pointerup', (e) => finish(e));
    card.addEventListener('pointercancel', (e) => finish(e, true));
  }

  /** Moves the phone card by one control (dir ±1), or settles it back in place (0). */
  private step(dir: number): void {
    // A quick second swipe starts from the control the first one was heading to.
    const pending = this.pendingStep;
    this.pendingStep = null;
    pending?.();
    const el = this.activeEl();
    const from = { transform: el?.style.transform || 'none', opacity: el?.style.opacity || '1' };
    const settle = (node: HTMLElement | null) => {
      if (!node) return;
      node.style.transform = '';
      node.style.opacity = '';
    };
    const next = dir ? this.order[this.order.indexOf(this.active) + dir] : undefined;

    if (!next) {
      // Nothing that way (or not far enough): spring back.
      settle(el);
      if (el && !this.reducedMotion.matches) {
        el.animate([from, { transform: 'none', opacity: 1 }], { duration: 240, easing: 'cubic-bezier(.2, .9, .3, 1.2)' });
      }
      return;
    }

    navigator.vibrate?.(6);
    if (!el || this.reducedMotion.matches) {
      settle(el);
      this.focus(next);
      return;
    }
    const out = el.animate([from, { transform: `translateX(${-dir * 56}px)`, opacity: 0 }], { duration: 110, easing: 'ease-in' });
    const complete = () => {
      out.cancel();
      settle(el);
      this.focus(next);
      this.activeEl()?.animate(
        [{ transform: `translateX(${dir * 56}px)`, opacity: 0 }, { transform: 'none', opacity: 1 }],
        { duration: 220, easing: 'cubic-bezier(.2, .8, .2, 1)' },
      );
    };
    this.pendingStep = complete;
    out.onfinish = () => {
      if (this.pendingStep !== complete) return;
      this.pendingStep = null;
      complete();
    };
  }

  /** The first time the card opens on a phone, nudge the control so the swipe is discoverable. */
  hintSwipe(): void {
    if (!this.small.matches || this.reducedMotion.matches) return;
    try {
      if (localStorage.getItem('pd-swipe-hint')) return;
      localStorage.setItem('pd-swipe-hint', '1');
    } catch {
      return; // no storage: skip the hint rather than repeat it every time
    }
    window.setTimeout(() => {
      this.activeEl()?.animate(
        [{ transform: 'none' }, { transform: 'translateX(-18px)' }, { transform: 'translateX(4px)' }, { transform: 'none' }],
        { duration: 900, easing: 'ease-in-out', delay: 250 },
      );
    }, 450);
  }

  // ---------- glass while dragging ----------

  /** While a slider is dragged, everything but that slider fades so the artwork shows. */
  private startScrub(ctl: HTMLElement): void {
    clearTimeout(this.scrubTimer);
    this.endScrub();
    ctl.classList.add('is-scrubbing');
    for (let node: HTMLElement = ctl; node !== this.inner && node.parentElement; node = node.parentElement) {
      for (const sibling of node.parentElement.children) if (sibling !== node) sibling.classList.add('ghosted');
    }
    this.app.dataset.scrub = 'true';
    const release = () => {
      removeEventListener('pointerup', release);
      removeEventListener('pointercancel', release);
      this.scrubTimer = window.setTimeout(() => this.endScrub(), 260);
    };
    addEventListener('pointerup', release);
    addEventListener('pointercancel', release);
  }

  private endScrub(): void {
    this.app.dataset.scrub = 'false';
    this.inner.querySelectorAll('.ghosted').forEach((n) => n.classList.remove('ghosted'));
    this.inner.querySelectorAll('.is-scrubbing').forEach((n) => n.classList.remove('is-scrubbing'));
  }

  // ---------- sync ----------

  private sync(): void {
    const cfg = this.store.state.config;
    for (const { input, out, spec } of this.sliders.values()) {
      const v = cfg[spec.key];
      if (Number(input.value) !== v) input.value = String(v);
      input.style.setProperty('--fill', `${((v - spec.min) / (spec.max - spec.min)) * 100}%`);
      out.textContent = spec.format ? spec.format(v) : String(v);
    }
    cfg.colors.forEach((c, i) => {
      const input = this.dabs[i];
      if (input.value !== c) input.value = c;
      input.parentElement!.style.background = c;
    });
    this.paperInput.value = cfg.paper;
    this.paperInput.parentElement!.style.background = cfg.paper;
    for (const [a, b] of this.anchorButtons) b.setAttribute('aria-checked', String(cfg.anchor === a));
    document.querySelector('[data-group="current"]')?.classList.toggle('is-off', cfg.river === 0);
  }

  private syncLocks(): void {
    const paint = (btn: HTMLButtonElement, locked: boolean) => {
      btn.setAttribute('aria-pressed', String(locked));
      btn.title = locked ? 'Locked — Randomize leaves this alone' : 'Lock against Randomize';
      btn.setAttribute('aria-label', btn.title);
      btn.innerHTML = icon(locked ? 'lock' : 'unlock', 16);
    };
    for (const [id, btn] of this.lockButtons) paint(btn, this.store.state.locked.has(id));
    const group = this.sheetLock ? this.activeGroup() : null;
    if (this.sheetLock && group) paint(this.sheetLock, this.store.state.locked.has(group));
  }
}
