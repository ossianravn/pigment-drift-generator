// Turns pointers (mouse, pen, any number of fingers) into drops and strokes.
//
//   tap        a drop that blooms and pushes the washes around it into rings
//   hold       the drop keeps growing for as long as you hold
//   drag       a brush stroke (pigment), a stir (water) or a blot (lift)

import { Kind, type Drop, type Segment } from './engine';

export type Tool = 'pigment' | 'water' | 'lift';

export interface BrushState {
  tool: Tool;
  /** Pigment amount the selected pan lays down (0 = bare paper). */
  ink: number;
  /** Which of the painting's inks (0..2) it is. */
  slot: number;
  /** Radius in CSS px. */
  radius: number;
}

interface Growing {
  x: number; y: number;
  /** Current radius, the radius it is easing toward, and the tap size (texels). */
  r: number; target: number; base: number;
  /** Radius the sheet has already been pushed to. */
  shown: number;
  ink: number; kind: Kind; slot: number;
  held: boolean;
}

interface Active {
  id: number;
  tool: Tool;
  ink: number;
  slot: number;
  radius: number;
  mode: 'pending' | 'drop' | 'stroke';
  downAt: number;
  downX: number; downY: number;
  /** CSS points received since the last frame. */
  pts: { x: number; y: number; p: number }[];
  lastX: number; lastY: number; lastP: number;
  vx: number; vy: number;
  drop: Growing | null;
  /** Lifted, but its last points still need to reach the paper on the next frame. */
  ended: boolean;
}

/** Segments the shader takes per frame (shared by all fingers). */
const SEG_BUDGET = 16;
/** How long a still press waits before it becomes a drop (a drag can still start before then). */
const HOLD_MS = 110;
const MOVE_PX = 6;

export class BrushInput {
  private active = new Map<number, Active>();
  private drops: Growing[] = [];

  constructor(
    private readonly brush: () => BrushState,
    private readonly toField: (x: number, y: number) => [number, number],
    private readonly texelsPerPx: () => number,
    private readonly clock: () => number = () => performance.now(),
  ) {}

  get isDown(): boolean {
    for (const a of this.active.values()) if (!a.ended) return true;
    return false;
  }

  get isBusy(): boolean {
    return this.active.size > 0 || this.drops.length > 0;
  }

  down(e: PointerEvent, x: number, y: number): void {
    const b = this.brush();
    this.active.set(e.pointerId, {
      id: e.pointerId,
      tool: b.tool,
      ink: b.ink,
      slot: b.slot,
      radius: b.radius,
      mode: 'pending',
      downAt: this.clock(),
      downX: x, downY: y,
      pts: [],
      lastX: x, lastY: y, lastP: pressureOf(e),
      vx: 0, vy: 0,
      drop: null,
      ended: false,
    });
  }

  move(e: PointerEvent, x: number, y: number): void {
    const a = this.active.get(e.pointerId);
    if (!a) return;
    const events = typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : [];
    const rect = (e.target as Element | null)?.getBoundingClientRect?.();
    if (events.length > 1 && rect) {
      for (const c of events) a.pts.push({ x: c.clientX - rect.left, y: c.clientY - rect.top, p: pressureOf(c) });
    } else {
      a.pts.push({ x, y, p: pressureOf(e) });
    }
    if (a.mode !== 'stroke' && Math.hypot(x - a.downX, y - a.downY) > MOVE_PX) {
      if (a.drop) a.drop.held = false;
      a.mode = 'stroke';
    }
  }

  up(e: PointerEvent): void {
    const a = this.active.get(e.pointerId);
    if (!a) return;
    if (a.mode === 'pending') this.startDrop(a);
    if (a.drop) a.drop.held = false;
    // Points that arrived since the last frame still belong on the paper.
    if (a.mode === 'stroke' && a.pts.length) a.ended = true;
    else this.active.delete(e.pointerId);
  }

  cancel(e: PointerEvent): void {
    const a = this.active.get(e.pointerId);
    if (a?.drop) a.drop.held = false;
    this.active.delete(e.pointerId);
  }

  /** Everything the pointers did since the last frame, in field texels. */
  frame(now: number, dt: number): { segs: Segment[]; drops: Drop[] } {
    const segs: Segment[] = [];
    const k = this.texelsPerPx();
    let strokes = 0;
    for (const a of this.active.values()) if (a.mode === 'stroke') strokes++;
    const perStroke = Math.max(2, Math.floor(SEG_BUDGET / Math.max(1, strokes)));

    for (const a of this.active.values()) {
      if (a.mode === 'pending' && now - a.downAt > HOLD_MS) {
        if (a.tool === 'lift') a.mode = 'stroke';
        else this.startDrop(a);
      }
      if (a.mode !== 'stroke') {
        a.pts.length = 0;
        continue;
      }
      // Decimate to the per-frame segment budget (a slow frame can bring a long
      // stretch of stroke at once), always keeping the latest point.
      const pts = a.pts.splice(0);
      let length = 0;
      for (let i = 0, x = a.lastX, y = a.lastY; i < pts.length; x = pts[i].x, y = pts[i].y, i++) length += Math.hypot(pts[i].x - x, pts[i].y - y);
      const minGap = Math.max(1.5, a.radius * 0.22, length / (perStroke - 1));
      const kept: typeof pts = [];
      let px = a.lastX;
      let py = a.lastY;
      for (let i = 0; i < pts.length; i++) {
        const p = pts[i];
        if (i === pts.length - 1 || Math.hypot(p.x - px, p.y - py) >= minGap) {
          kept.push(p);
          px = p.x;
          py = p.y;
        }
      }
      const endX = kept.length ? kept[kept.length - 1].x : a.lastX;
      const endY = kept.length ? kept[kept.length - 1].y : a.lastY;
      const blend = 1 - Math.exp(-dt * 18);
      a.vx += ((endX - a.lastX) / Math.max(dt, 1e-3) - a.vx) * blend;
      a.vy += ((endY - a.lastY) / Math.max(dt, 1e-3) - a.vy) * blend;

      const style = strokeStyle(a.tool);
      if (!kept.length) {
        // Resting the brush: pigment soaks in slowly, a blot keeps lifting.
        if (a.tool !== 'water') kept.push({ x: a.lastX, y: a.lastY, p: a.lastP });
        else continue;
      }
      let fromX = a.lastX;
      let fromY = a.lastY;
      const moving = Math.hypot(endX - a.lastX, endY - a.lastY) > 0.25;
      for (const p of kept) {
        const radius = a.radius * pressureScale(p.p) * k;
        const [ax, ay] = this.toField(fromX, fromY);
        const [bx, by] = this.toField(p.x, p.y);
        segs.push({
          ax, ay, bx, by,
          radius,
          target: a.ink,
          strength: (moving ? style.strength : style.dwell) * (0.55 + 0.9 * p.p),
          kind: style.kind,
          slot: a.slot,
          fx: a.vx * k, fy: -a.vy * k,
          coupling: moving ? style.coupling : 0,
        });
        fromX = p.x;
        fromY = p.y;
        a.lastP = p.p;
      }
      a.lastX = endX;
      a.lastY = endY;
    }
    for (const [id, a] of this.active) if (a.ended) this.active.delete(id);

    // Drops grow toward their size; held drops keep growing (constant flow of ink).
    const out: Drop[] = [];
    const ease = 1 - Math.exp(-dt * 11);
    for (const d of this.drops) {
      if (d.held) d.target = Math.min(Math.sqrt(d.target * d.target + d.base * d.base * 1.4 * dt), 260 * k);
      d.r += (d.target - d.r) * ease;
      // Every push resamples the sheet, so push in steps of at least ~half a texel.
      const settling = !d.held && d.target - d.r < 0.2;
      if (d.r - d.shown > 0.5 || (settling && d.r > d.shown)) {
        out.push({ x: d.x, y: d.y, r0: d.shown, r1: d.r, ink: d.ink, kind: d.kind, slot: d.slot });
        d.shown = d.r;
      }
    }
    this.drops = this.drops.filter((d) => d.held || d.target - d.r > 0.2 || d.r > d.shown);

    // Respect the shader's budgets: newest strokes win.
    return { segs: segs.slice(-SEG_BUDGET), drops: out.slice(-4) };
  }

  private startDrop(a: Active): void {
    a.mode = 'drop';
    const k = this.texelsPerPx();
    const [x, y] = this.toField(a.downX, a.downY);
    const base = a.radius * k * 1.15;
    const drop: Growing = {
      x, y, r: 0, target: base, base, shown: 0,
      ink: a.ink,
      slot: a.slot,
      kind: a.tool === 'water' ? Kind.Water : Kind.Paint,
      held: this.active.has(a.id),
    };
    a.drop = drop;
    this.drops.push(drop);
  }
}

function strokeStyle(tool: Tool): { kind: Kind; strength: number; dwell: number; coupling: number } {
  switch (tool) {
    case 'water': return { kind: Kind.Water, strength: 0, dwell: 0, coupling: 0.7 };
    case 'lift': return { kind: Kind.Lift, strength: 0.28, dwell: 0.07, coupling: 0.05 };
    default: return { kind: Kind.Paint, strength: 0.62, dwell: 0.06, coupling: 0.06 };
  }
}

/** Pens report real pressure; mice and fingers report 0.5 (or 0) while pressed. */
function pressureOf(e: PointerEvent): number {
  return e.pointerType === 'pen' ? Math.max(0.05, e.pressure) : 0.5;
}

function pressureScale(p: number): number {
  return 0.45 + 1.1 * p;
}
