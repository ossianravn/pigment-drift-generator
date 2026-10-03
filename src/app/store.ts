// App state: the current config plus view state, with undo/redo and URL sync.

import { decodeConfig, DEFAULT_CONFIG, type DriftConfig, encodeConfig, type GroupId } from '../engine/params';

export type Device = 'desktop' | 'mobile';
export type Mode = 'still' | 'moving';

export interface AppState {
  config: DriftConfig;
  mode: Mode;
  /** Loop phase 0..1 — the "moment" used for stills. */
  phase: number;
  device: Device;
  panelOpen: boolean;
  locked: Set<GroupId>;
}

type Listener = (state: AppState, changed: Set<keyof AppState>) => void;

const HISTORY_LIMIT = 100;

export class Store {
  state: AppState;
  private listeners = new Set<Listener>();
  private past: DriftConfig[] = [];
  private future: DriftConfig[] = [];
  /** Config as of the last history commit (a slider drag commits once, on release). */
  private committed: DriftConfig;
  private urlTimer = 0;

  constructor(initial: AppState) {
    this.state = initial;
    this.committed = initial.config;
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  set(patch: Partial<AppState>): void {
    const changed = new Set(Object.keys(patch) as (keyof AppState)[]);
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((fn) => fn(this.state, changed));
  }

  /** Live config change. Pass commit=true for discrete edits; drags call commit() on release. */
  setConfig(patch: Partial<DriftConfig>, commit = true): void {
    this.set({ config: { ...this.state.config, ...patch } });
    if (commit) this.commit();
    this.scheduleUrlSync();
  }

  replaceConfig(config: DriftConfig): void {
    this.set({ config });
    this.commit();
    this.scheduleUrlSync();
  }

  commit(): void {
    const cur = this.state.config;
    if (JSON.stringify(cur) === JSON.stringify(this.committed)) return;
    this.past.push(this.committed);
    if (this.past.length > HISTORY_LIMIT) this.past.shift();
    this.future = [];
    this.committed = cur;
  }

  get canUndo(): boolean {
    return this.past.length > 0;
  }

  get canRedo(): boolean {
    return this.future.length > 0;
  }

  undo(): void {
    const prev = this.past.pop();
    if (!prev) return;
    this.future.push(this.state.config);
    this.committed = prev;
    this.set({ config: prev });
    this.scheduleUrlSync();
  }

  redo(): void {
    const next = this.future.pop();
    if (!next) return;
    this.past.push(this.state.config);
    this.committed = next;
    this.set({ config: next });
    this.scheduleUrlSync();
  }

  shareUrl(): string {
    const url = new URL(location.href);
    url.hash = `c=${encodeConfig(this.state.config)}`;
    return url.toString();
  }

  private scheduleUrlSync(): void {
    clearTimeout(this.urlTimer);
    this.urlTimer = window.setTimeout(() => {
      history.replaceState(null, '', `#c=${encodeConfig(this.state.config)}`);
    }, 350);
  }
}

export function configFromLocation(): DriftConfig | null {
  const m = /[#&]c=([\w-]+)/.exec(location.hash);
  return m ? decodeConfig(m[1]) : null;
}

export function initialConfig(): DriftConfig {
  return configFromLocation() ?? DEFAULT_CONFIG;
}
