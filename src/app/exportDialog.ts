// "Take it home": export the current piece as a still, a seamless video loop,
// a live embed, or a config/link — each with copy-paste code and a zip pack.

import { type DriftConfig, parseConfigText } from '../engine/params';
import { download, fetchRuntime, formatBytes, type PackFile, zip } from '../export/bundle';
import { canvasToBlob, renderToCanvas } from '../export/render';
import { configJson, embedSnippet, examplePage, imageSnippet, readme, videoSnippet } from '../export/snippets';
import { encodeLoop, MIME, pickCodec, type VideoContainer, type VideoQuality, webCodecsAvailable } from '../export/video';
import { hydrateIcons, icon } from './icons';
import type { Store } from './store';

type Tab = 'image' | 'video' | 'embed' | 'config';

interface SizeOption {
  id: string;
  label: string;
  cssW: number;
  cssH: number;
  density: number;
}

const DESKTOP_SIZES: SizeOption[] = [
  { id: 'd2x', label: '1440 × 900 @2x  ·  2880 × 1800 px', cssW: 1440, cssH: 900, density: 2 },
  { id: 'fhd', label: '1920 × 1080 @1x  ·  Full HD', cssW: 1920, cssH: 1080, density: 1 },
  { id: '4k', label: '1920 × 1080 @2x  ·  3840 × 2160 px', cssW: 1920, cssH: 1080, density: 2 },
  { id: 'qhd', label: '2560 × 1440 @1x', cssW: 2560, cssH: 1440, density: 1 },
];

const MOBILE_SIZES: SizeOption[] = [
  { id: 'm3x', label: '390 × 844 @3x  ·  1170 × 2532 px', cssW: 390, cssH: 844, density: 3 },
  { id: 'm2x', label: '390 × 844 @2x  ·  780 × 1688 px', cssW: 390, cssH: 844, density: 2 },
  { id: 'none', label: 'No mobile version', cssW: 0, cssH: 0, density: 0 },
];

const FORMATS = [
  { id: 'image/webp', ext: 'webp', label: 'WebP — small, sharp (recommended)', quality: 0.9 },
  { id: 'image/jpeg', ext: 'jpg', label: 'JPEG — universal', quality: 0.9 },
  { id: 'image/png', ext: 'png', label: 'PNG — lossless, large', quality: undefined },
];

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export class ExportDialog {
  private dialog: HTMLDialogElement;
  private tab: Tab = 'image';
  private busy = false;
  private abort: AbortController | null = null;
  private opts = {
    desktop: 'd2x',
    mobile: 'm3x',
    format: 'image/webp',
    container: 'mp4' as VideoContainer,
    vquality: 'balanced' as VideoQuality,
    fps: 30,
    vmobile: true,
    animate: true,
    efps: 30,
    equality: 0.75,
    hotlink: false,
  };

  constructor(private store: Store, private toast: (msg: string) => void) {
    this.dialog = document.getElementById('exportDialog') as HTMLDialogElement;
    this.dialog.addEventListener('click', (e) => {
      if (e.target === this.dialog && !this.busy) this.dialog.close();
    });
    this.dialog.addEventListener('cancel', (e) => {
      if (this.busy) e.preventDefault();
    });
  }

  get config(): DriftConfig {
    return this.store.state.config;
  }

  open(tab?: Tab): void {
    if (tab) this.tab = tab;
    this.render();
    this.dialog.showModal();
  }

  private render(): void {
    const tabs: { id: Tab; icon: string; title: string; sub: string }[] = [
      { id: 'image', icon: 'image', title: 'Still image', sub: 'WebP · JPEG · PNG' },
      { id: 'video', icon: 'film', title: 'Video loop', sub: `MP4 · WebM · ${this.config.loop}s seamless` },
      { id: 'embed', icon: 'code', title: 'Live embed', sub: 'WebGL · one small script' },
      { id: 'config', icon: 'braces', title: 'Config & link', sub: 'JSON · share · import' },
    ];
    this.dialog.innerHTML = `
      <div class="sheet">
        <header class="sheet-head">
          <div>
            <h2 id="exportTitle">Take it <em>home</em></h2>
            <p>Export No. ${this.config.seed} for your site. Every pack comes with the code and a README.</p>
          </div>
          <button class="icon-btn sketch" data-close aria-label="Close">${icon('close')}</button>
        </header>
        <div class="sheet-body">
          <nav class="ex-tabs" role="tablist" aria-label="Export type">
            ${tabs.map((t) => `
              <button role="tab" data-tab="${t.id}" aria-selected="${t.id === this.tab}">
                ${icon(t.icon, 22)}
                <span><strong>${t.title}</strong><small>${t.sub}</small></span>
              </button>`).join('')}
          </nav>
          <div class="ex-panel" role="tabpanel">${this.panelHtml()}</div>
        </div>
      </div>`;
    hydrateIcons(this.dialog);
    this.bind();
  }

  private panelHtml(): string {
    switch (this.tab) {
      case 'image': return this.imagePanel();
      case 'video': return this.videoPanel();
      case 'embed': return this.embedPanel();
      default: return this.configPanel();
    }
  }

  // ---------- panels ----------

  private select(name: string, value: string, options: { id: string; label: string }[], label: string): string {
    return `<label class="field"><span>${label}</span><select data-opt="${name}">${options
      .map((o) => `<option value="${o.id}"${o.id === value ? ' selected' : ''}>${esc(o.label)}</option>`)
      .join('')}</select></label>`;
  }

  private code(blocks: { label: string; code: string }[]): string {
    return `<div class="code" data-code>
      <div class="code-tabs">${blocks.map((b, i) => `<button type="button" data-code-tab="${i}" aria-selected="${i === 0}">${b.label}</button>`).join('')}
        <button type="button" class="copy" data-copy>${icon('copy', 15)}<span>Copy</span></button>
      </div>
      ${blocks.map((b, i) => `<pre${i ? ' hidden' : ''}><code>${esc(b.code)}</code></pre>`).join('')}
    </div>`;
  }

  private imageFiles() {
    const fmt = FORMATS.find((f) => f.id === this.opts.format)!;
    return {
      desktop: `pigment-drift-desktop.${fmt.ext}`,
      mobile: this.opts.mobile === 'none' ? undefined : `pigment-drift-mobile.${fmt.ext}`,
    };
  }

  private imagePanel(): string {
    const snip = imageSnippet(this.config, this.imageFiles());
    return `
      <div class="ex-intro">
        <h3>A still, as a file</h3>
        <p>Lightest option: no script, works everywhere. The moment captured is the one on the timeline.</p>
      </div>
      <div class="previews" data-previews></div>
      <div class="fields">
        ${this.select('desktop', this.opts.desktop, DESKTOP_SIZES, 'Desktop')}
        ${this.select('mobile', this.opts.mobile, MOBILE_SIZES, 'Mobile')}
        ${this.select('format', this.opts.format, FORMATS, 'Format')}
      </div>
      <div class="actions">
        <button class="btn btn-ink sketch" data-act="image-pack">${icon('download')}<span>Download pack (.zip)</span></button>
        <button class="btn sketch" data-act="image-desktop">Desktop image</button>
        ${this.opts.mobile !== 'none' ? '<button class="btn sketch" data-act="image-mobile">Mobile image</button>' : ''}
      </div>
      <div class="progress" data-progress hidden><i></i><span></span></div>
      <ol class="steps">
        <li>Put the image files next to your page.</li>
        <li>Paste the HTML as the first thing inside <code>&lt;body&gt;</code>, and the CSS into your stylesheet.</li>
      </ol>
      ${this.code([{ label: 'HTML', code: snip.html }, { label: 'CSS', code: snip.css }])}`;
  }

  private videoFiles() {
    const ext = this.opts.container;
    return {
      desktop: `pigment-drift-desktop.${ext}`,
      mobile: this.opts.vmobile ? `pigment-drift-mobile.${ext}` : undefined,
      type: MIME[this.opts.container],
      posterDesktop: 'pigment-drift-desktop.webp',
      posterMobile: this.opts.vmobile ? 'pigment-drift-mobile.webp' : undefined,
    };
  }

  private videoPanel(): string {
    const snip = videoSnippet(this.config, this.videoFiles());
    const supported = webCodecsAvailable();
    const motionless = this.config.motion + this.config.flow === 0;
    return `
      <div class="ex-intro">
        <h3>A seamless loop</h3>
        <p>Rendered frame by frame in your browser — the last frame flows straight into the first. No script needed on your site; plays everywhere video does.</p>
      </div>
      ${supported ? '' : '<p class="warn">This browser doesn’t support WebCodecs video encoding. Use a recent Chrome, Edge, Safari or Firefox — or use the Live embed instead.</p>'}
      ${motionless ? '<p class="warn">Drift and Flow are both at 0, so the video would be still. Raise them under <em>v. Motion</em>.</p>' : ''}
      <div class="fields">
        ${this.select('container', this.opts.container, [
          { id: 'mp4', label: 'MP4 · H.264 (plays everywhere)' },
          { id: 'webm', label: 'WebM · VP9' },
        ], 'Format')}
        ${this.select('vquality', this.opts.vquality, [
          { id: 'light', label: 'Light — about 2 MB per 16s at 1080p' },
          { id: 'balanced', label: 'Balanced — about 4.5 MB per 16s (recommended)' },
          { id: 'high', label: 'High — about 9 MB per 16s, crisp grain' },
        ], 'Quality')}
        ${this.select('fps', String(this.opts.fps), [
          { id: '24', label: '24 fps — filmic, smaller' },
          { id: '30', label: '30 fps — smooth' },
        ], 'Frame rate')}
        <label class="field check"><input type="checkbox" data-opt="vmobile"${this.opts.vmobile ? ' checked' : ''}><span>Also render a portrait mobile version (1080 × 1920)</span></label>
      </div>
      <p class="note">Desktop renders at 1920 × 1080. Loop length is ${this.config.loop}s (change it under <em>v. Motion</em>).</p>
      <div class="actions">
        <button class="btn btn-ink sketch" data-act="video-pack"${supported ? '' : ' disabled'}>${icon('film')}<span>Render video pack (.zip)</span></button>
        <button class="btn sketch" data-act="video-desktop"${supported ? '' : ' disabled'}>Desktop video only</button>
      </div>
      <div class="progress" data-progress hidden><i></i><span></span><button class="link" data-act="cancel">Cancel</button></div>
      <ol class="steps">
        <li>Put the video and poster files next to your page.</li>
        <li>Paste the HTML as the first thing inside <code>&lt;body&gt;</code>, and the CSS into your stylesheet. Visitors who prefer reduced motion get the still.</li>
      </ol>
      ${this.code([{ label: 'HTML', code: snip.html }, { label: 'CSS', code: snip.css }])}`;
  }

  private scriptSrc(): string {
    return this.opts.hotlink ? `${location.origin}${import.meta.env.BASE_URL}embed/pigment-drift.min.js` : 'pigment-drift.min.js';
  }

  private embedSnippet() {
    return embedSnippet(this.config, {
      scriptSrc: this.scriptSrc(),
      poster: 'pigment-drift-poster.webp',
      still: !this.opts.animate,
      fps: this.opts.efps,
      quality: this.opts.equality,
    });
  }

  private embedPanel(): string {
    const snip = this.embedSnippet();
    return `
      <div class="ex-intro">
        <h3>Live, in the browser</h3>
        <p>The real thing: rendered on the GPU at any size, crisp on every screen. <span data-runtime-size>One small script</span>, no dependencies. Pauses when off-screen or in a background tab, honours reduced motion, and shows a poster image if WebGL isn’t available.</p>
      </div>
      <div class="fields">
        <label class="field check"><input type="checkbox" data-opt="animate"${this.opts.animate ? ' checked' : ''}><span>Animate (off = render a still, once)</span></label>
        ${this.select('efps', String(this.opts.efps), [
          { id: '24', label: '24 fps — gentlest on batteries' },
          { id: '30', label: '30 fps (recommended)' },
          { id: '60', label: '60 fps' },
        ], 'Frame rate')}
        ${this.select('equality', String(this.opts.equality), [
          { id: '0.5', label: 'Soft — fastest' },
          { id: '0.75', label: 'Balanced (recommended)' },
          { id: '1', label: 'Full resolution' },
        ], 'Render quality')}
        ${this.select('hotlink', String(this.opts.hotlink), [
          { id: 'false', label: 'Self-host the script (included in the pack)' },
          { id: 'true', label: `Load it from ${location.host}` },
        ], 'Script')}
      </div>
      <div class="actions">
        <button class="btn btn-ink sketch" data-act="embed-pack">${icon('download')}<span>Download embed pack (.zip)</span></button>
        <button class="btn sketch" data-act="embed-script">pigment-drift.min.js</button>
      </div>
      <div class="progress" data-progress hidden><i></i><span></span></div>
      <ol class="steps">
        <li>${this.opts.hotlink ? 'Nothing to upload — the script loads from this site.' : 'Upload <code>pigment-drift.min.js</code> and the poster next to your page.'}</li>
        <li>Paste the HTML as the first thing inside <code>&lt;body&gt;</code>, and the CSS into your stylesheet. The config lives in the element, so you can tweak it by hand.</li>
      </ol>
      ${this.code([
        { label: 'HTML', code: snip.html },
        { label: 'CSS', code: snip.css },
        { label: 'React', code: snip.react },
        { label: 'JS API', code: snip.js },
      ])}`;
  }

  private configPanel(): string {
    return `
      <div class="ex-intro">
        <h3>Config & link</h3>
        <p>Everything about this piece fits in a few hundred bytes. Share the link, keep the JSON, or paste one back in.</p>
      </div>
      <label class="field"><span>Share link</span>
        <div class="inline"><input type="text" readonly value="${esc(this.store.shareUrl())}" data-select><button class="btn sketch" data-act="copy-link">${icon('link', 16)}<span>Copy</span></button></div>
      </label>
      ${this.code([{ label: 'config.json', code: configJson(this.config, true) }])}
      <div class="actions">
        <button class="btn sketch" data-act="config-download">${icon('download')}<span>Download config.json</span></button>
      </div>
      <label class="field"><span>Import a config or link</span>
        <textarea rows="3" placeholder='{"seed": 4127, ...}  or  https://…#c=…' data-import></textarea>
      </label>
      <div class="actions"><button class="btn sketch" data-act="import">Apply</button></div>`;
  }

  // ---------- behaviour ----------

  private bind(): void {
    const d = this.dialog;
    d.querySelector('[data-close]')?.addEventListener('click', () => !this.busy && d.close());
    d.querySelectorAll<HTMLButtonElement>('[data-tab]').forEach((b) =>
      b.addEventListener('click', () => {
        if (this.busy) return;
        this.tab = b.dataset.tab as Tab;
        this.render();
      }),
    );
    d.querySelectorAll<HTMLSelectElement | HTMLInputElement>('[data-opt]').forEach((input) =>
      input.addEventListener('change', () => {
        const key = input.dataset.opt as keyof typeof this.opts;
        const raw = input instanceof HTMLInputElement && input.type === 'checkbox' ? input.checked : input.value;
        const current = this.opts[key];
        (this.opts as Record<string, unknown>)[key] =
          typeof current === 'number' ? Number(raw) : typeof current === 'boolean' && typeof raw === 'string' ? raw === 'true' : raw;
        this.render();
      }),
    );
    d.querySelectorAll<HTMLElement>('[data-code]').forEach((box) => {
      const pres = box.querySelectorAll('pre');
      const tabs = box.querySelectorAll<HTMLButtonElement>('[data-code-tab]');
      tabs.forEach((t) =>
        t.addEventListener('click', () => {
          tabs.forEach((o) => o.setAttribute('aria-selected', String(o === t)));
          pres.forEach((p, i) => (p.hidden = String(i) !== t.dataset.codeTab));
        }),
      );
      box.querySelector('[data-copy]')?.addEventListener('click', () => {
        const visible = [...pres].find((p) => !p.hidden);
        if (visible) this.copy(visible.textContent ?? '', 'Copied to clipboard');
      });
    });
    d.querySelectorAll<HTMLInputElement>('[data-select]').forEach((i) => i.addEventListener('focus', () => i.select()));
    d.querySelectorAll<HTMLButtonElement>('[data-act]').forEach((b) => b.addEventListener('click', () => this.act(b.dataset.act!)));

    if (this.tab === 'image') this.renderPreviews();
    if (this.tab === 'embed') {
      fetchRuntime()
        .then((src) => {
          const el = d.querySelector('[data-runtime-size]');
          if (el) el.textContent = `One ${formatBytes(src.length)} script (~${formatBytes(Math.round(src.length * 0.36))} gzipped)`;
        })
        .catch(() => {});
    }
  }

  private async renderPreviews(): Promise<void> {
    const box = this.dialog.querySelector('[data-previews]');
    if (!box) return;
    const phase = this.store.state.phase;
    const desk = await renderToCanvas(this.config, { width: 384, height: 240, pixelRatio: 0.5, phase });
    const mob = await renderToCanvas(this.config, { width: 111, height: 240, pixelRatio: 0.5, phase });
    desk.className = 'pv-desktop';
    mob.className = 'pv-mobile';
    box.replaceChildren(desk, mob);
  }

  private async copy(text: string, msg: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(text);
      this.toast(msg);
    } catch {
      this.toast('Couldn’t reach the clipboard — select the text and copy it manually.');
    }
  }

  private progress(fraction: number | null, label = ''): void {
    const bar = this.dialog.querySelector<HTMLElement>('[data-progress]');
    if (!bar) return;
    bar.hidden = fraction === null;
    bar.querySelector('i')!.style.setProperty('--p', `${Math.round((fraction ?? 0) * 100)}%`);
    bar.querySelector('span')!.textContent = label;
  }

  private setBusy(busy: boolean): void {
    this.busy = busy;
    this.dialog.classList.toggle('is-busy', busy);
    this.dialog.querySelectorAll<HTMLButtonElement>('.actions button, [data-tab], [data-close]').forEach((b) => (b.disabled = busy));
  }

  private async run(task: () => Promise<void>): Promise<void> {
    if (this.busy) return;
    this.setBusy(true);
    try {
      await task();
    } catch (err) {
      if ((err as DOMException)?.name !== 'AbortError') {
        console.error(err);
        this.toast((err as Error).message || 'Export failed');
      } else {
        this.toast('Export cancelled');
      }
    } finally {
      this.setBusy(false);
      this.progress(null);
      this.abort = null;
    }
  }

  private async still(size: SizeOption, format = this.opts.format): Promise<Blob> {
    const fmt = FORMATS.find((f) => f.id === format)!;
    const canvas = await renderToCanvas(this.config, {
      width: size.cssW * size.density,
      height: size.cssH * size.density,
      pixelRatio: size.density,
      phase: this.store.state.phase,
    });
    return canvasToBlob(canvas, fmt.id, fmt.quality);
  }

  private get seedTag(): string {
    return `pigment-drift-${this.config.seed}`;
  }

  private async act(action: string): Promise<void> {
    const desktop = DESKTOP_SIZES.find((s) => s.id === this.opts.desktop)!;
    const mobile = MOBILE_SIZES.find((s) => s.id === this.opts.mobile)!;
    const fmt = FORMATS.find((f) => f.id === this.opts.format)!;
    const cfg = this.config;

    switch (action) {
      case 'cancel':
        this.abort?.abort();
        return;
      case 'copy-link':
        return this.copy(this.store.shareUrl(), 'Link copied');
      case 'config-download':
        return download(configJson(cfg, true), `${this.seedTag}.json`, 'application/json');
      case 'import': {
        const text = (this.dialog.querySelector('[data-import]') as HTMLTextAreaElement).value.trim();
        const imported = parseConfigText(text);
        if (!imported) return this.toast('That doesn’t look like a Pigment Drift config or link.');
        this.store.replaceConfig(imported);
        this.toast('Config applied');
        return this.render();
      }
      case 'image-desktop':
        return this.run(async () => {
          this.progress(0.3, 'Painting…');
          download(await this.still(desktop), `${this.seedTag}-desktop.${fmt.ext}`);
        });
      case 'image-mobile':
        return this.run(async () => {
          this.progress(0.3, 'Painting…');
          download(await this.still(mobile), `${this.seedTag}-mobile.${fmt.ext}`);
        });
      case 'image-pack':
        return this.run(async () => {
          const files = this.imageFiles();
          const pack: PackFile[] = [];
          this.progress(0.15, 'Painting the desktop version…');
          pack.push({ name: files.desktop, data: await this.still(desktop) });
          if (files.mobile) {
            this.progress(0.55, 'Painting the mobile version…');
            pack.push({ name: files.mobile, data: await this.still(mobile) });
          }
          const snip = imageSnippet(cfg, files);
          this.addDocs(pack, 'image', snip);
          this.progress(0.9, 'Packing…');
          download(await zip(pack), `${this.seedTag}-image.zip`);
        });
      case 'video-desktop':
      case 'video-pack':
        return this.run(() => this.videoExport(action === 'video-pack'));
      case 'embed-script':
        return this.run(async () => download(await fetchRuntime(), 'pigment-drift.min.js', 'text/javascript'));
      case 'embed-pack':
        return this.run(async () => {
          this.progress(0.2, 'Painting the poster…');
          const poster = await this.still({ id: 'poster', label: '', cssW: 1440, cssH: 900, density: 1 }, 'image/webp');
          this.progress(0.6, 'Fetching the runtime…');
          const runtime = await fetchRuntime();
          const snip = this.embedSnippet();
          const pack: PackFile[] = [
            { name: 'pigment-drift-poster.webp', data: poster },
            { name: 'config.json', data: configJson(cfg, true) },
          ];
          if (!this.opts.hotlink) pack.push({ name: 'pigment-drift.min.js', data: runtime });
          this.addDocs(pack, 'embed', snip, [
            'Attributes: `still`, `phase` (0–1), `fps`, `quality` (0.25–1 render scale), `max-dpr`, `poster`.',
            'The element pauses when scrolled out of view or in a background tab, and draws a single still frame for visitors who prefer reduced motion.',
          ]);
          this.progress(0.9, 'Packing…');
          download(await zip(pack), `${this.seedTag}-embed.zip`);
        });
    }
  }

  private addDocs(pack: PackFile[], kind: 'image' | 'video' | 'embed', snip: { html: string; css: string }, notes: string[] = []): void {
    const names = [...pack.map((f) => f.name), 'example.html', 'README.md'];
    pack.push({ name: 'example.html', data: examplePage(`Pigment Drift · No. ${this.config.seed}`, this.config, snip) });
    pack.push({ name: 'README.md', data: readme({ kind, cfg: this.config, files: names, snippet: snip, shareUrl: this.store.shareUrl(), notes }) });
  }

  private async videoExport(pack: boolean): Promise<void> {
    const cfg = this.config;
    const { container, vquality, fps } = this.opts;
    const withMobile = pack && this.opts.vmobile;
    const jobs = [
      { name: 'desktop', width: 1920, height: 1080, cssWidth: 1440 },
      ...(withMobile ? [{ name: 'mobile', width: 1080, height: 1920, cssWidth: 390 }] : []),
    ];
    for (const job of jobs) {
      if (!(await pickCodec(container, job.width, job.height))) {
        throw new Error(`This browser can’t encode ${container.toUpperCase()} at ${job.width}×${job.height}. Try the other format.`);
      }
    }
    this.abort = new AbortController();
    const files: PackFile[] = [];
    for (const [i, job] of jobs.entries()) {
      const blob = await encodeLoop(
        cfg,
        { width: job.width, height: job.height, cssWidth: job.cssWidth, fps, container, quality: vquality },
        (f) => this.progress((i + f) / jobs.length * 0.92, `Rendering ${job.name} loop… ${Math.round(f * 100)}%`),
        this.abort.signal,
      );
      files.push({ name: `pigment-drift-${job.name}.${container}`, data: blob });
    }
    if (!pack) {
      download(files[0].data as Blob, `${this.seedTag}-desktop.${container}`);
      this.toast(`Video ready · ${formatBytes((files[0].data as Blob).size)}`);
      return;
    }
    this.progress(0.94, 'Painting posters…');
    files.push({ name: 'pigment-drift-desktop.webp', data: await this.still(DESKTOP_SIZES[1], 'image/webp') });
    if (withMobile) files.push({ name: 'pigment-drift-mobile.webp', data: await this.still(MOBILE_SIZES[1], 'image/webp') });
    this.addDocs(files, 'video', videoSnippet(cfg, this.videoFiles()), [
      'Keep the `muted` and `playsinline` attributes — browsers only autoplay muted video, and iOS needs `playsinline`.',
      'Want a smaller file? Re-export with the Light quality, 24 fps or WebM.',
    ]);
    this.progress(0.98, 'Packing…');
    const blob = await zip(files);
    download(blob, `${this.seedTag}-video.zip`);
    this.toast(`Video pack ready · ${formatBytes(blob.size)}`);
  }
}
