// Builds the control panel from the parameter schema and keeps it in sync with the store.

import { ANCHORS, type Anchor, DEFAULT_CONFIG, GROUPS, type GroupId, RANGES, type RangeSpec } from '../engine/params';
import { PALETTES, PRESETS, randomPalette, randomizeConfig } from '../engine/palettes';
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

  constructor(private store: Store, private thumbs: Map<string, string>) {
    this.buildMaster();
    this.buildPresets();
    this.buildGroups();
    this.sync();
    store.subscribe((_, changed) => {
      if (changed.has('config')) this.sync();
      if (changed.has('locked')) this.syncLocks();
    });
  }

  refreshThumbs(): void {
    document.querySelectorAll<HTMLImageElement>('.preset img').forEach((img) => {
      const src = this.thumbs.get(img.dataset.preset!);
      if (src) img.src = src;
    });
  }

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
  }

  /** Master controls (e.g. opacity) sit above everything, outside the randomizable groups. */
  private buildMaster(): void {
    const root = document.getElementById('master')!;
    for (const spec of RANGES.filter((r) => r.group === 'global')) root.append(this.buildSlider(spec));
  }

  private buildGroups(): void {
    const root = document.getElementById('groups')!;
    for (const group of GROUPS) {
      const section = el('section', { class: 'group', 'data-group': group.id });
      const head = el('header', { class: 'group-head' });
      head.innerHTML = `<h2><span class="numeral">${group.numeral}.</span> ${group.title}</h2>`;
      const tools = el('div', { class: 'group-tools' });
      const dice = el('button', { class: 'icon-btn small', type: 'button', title: `Randomize ${group.title.toLowerCase()} only`, 'aria-label': `Randomize ${group.title}` }, icon('dice', 16));
      dice.addEventListener('click', () => {
        const locked = new Set(GROUPS.map((g) => g.id).filter((id) => id !== group.id));
        this.store.replaceConfig(randomizeConfig(this.store.state.config, locked));
      });
      const lock = el('button', { class: 'icon-btn small lock', type: 'button', 'aria-pressed': 'false' }) as HTMLButtonElement;
      lock.addEventListener('click', () => {
        const locked = new Set(this.store.state.locked);
        if (locked.has(group.id)) locked.delete(group.id);
        else locked.add(group.id);
        this.store.set({ locked });
      });
      this.lockButtons.set(group.id, lock);
      tools.append(dice, lock);
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

  private buildPalette(): HTMLElement {
    const wrap = el('div', { class: 'palette' });
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
        const colors = [...this.store.state.config.colors];
        colors[i] = v;
        this.store.setConfig({ colors }, false);
      }));
    }
    const paperWrap = el('div', { class: 'paper-pick' });
    this.paperInput = make('Paper', DAB_SHAPES[5], (v) => this.store.setConfig({ paper: v }, false));
    paperWrap.append(this.paperInput.parentElement!, el('span', {}, 'paper'));
    dabs.append(paperWrap);
    wrap.append(dabs);

    const legend = el('div', { class: 'dab-legend' }, '<span>foreground</span><span class="arrow">⟶</span><span>horizon</span>');
    wrap.append(legend);

    const actions = el('div', { class: 'mini-actions' });
    const shuffle = el('button', { class: 'chip', type: 'button' }, `${icon('shuffle', 14)}<span>New palette</span>`);
    shuffle.addEventListener('click', () => {
      const p = randomPalette(Math.random);
      this.store.setConfig({ paper: p.paper, colors: [...p.colors] });
    });
    const reverse = el('button', { class: 'chip', type: 'button', title: 'Swap foreground and horizon pigments' }, '<span>Reverse</span>');
    reverse.addEventListener('click', () => this.store.setConfig({ colors: [...this.store.state.config.colors].reverse() }));
    actions.append(shuffle, reverse);
    wrap.append(actions);

    const library = el('div', { class: 'library' });
    for (const p of PALETTES) {
      const b = el('button', { class: 'swatch-strip', type: 'button', title: p.name, 'aria-label': `Palette ${p.name}` });
      b.style.setProperty('--paper', p.paper);
      b.innerHTML = p.colors.map((c) => `<i style="background:${c}"></i>`).join('');
      b.addEventListener('click', () => this.store.setConfig({ paper: p.paper, colors: [...p.colors] }));
      library.append(b);
    }
    wrap.append(library);
    return wrap;
  }

  private buildAnchor(): HTMLElement {
    const wrap = el('div', { class: 'ctl anchor-ctl' });
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
    const lab = el('label', { class: 'ctl', title: spec.hint });
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
    // Double-click resets to the default.
    input.addEventListener('dblclick', () => this.store.setConfig({ [spec.key]: DEFAULT_CONFIG[spec.key] }));
    lab.append(head, input);
    this.sliders.set(spec.key, { input, out, spec });
    return lab;
  }

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
    for (const [id, btn] of this.lockButtons) {
      const locked = this.store.state.locked.has(id);
      btn.setAttribute('aria-pressed', String(locked));
      btn.title = locked ? 'Locked — Randomize leaves this alone' : 'Lock against Randomize';
      btn.setAttribute('aria-label', btn.title);
      btn.innerHTML = icon(locked ? 'lock' : 'unlock', 16);
    }
  }
}
