// Hand-drawn-feeling line icons (slightly irregular paths, round caps).

const P: Record<string, string> = {
  dice: '<rect x="3.6" y="3.4" width="16.8" height="17.1" rx="3.6" transform="rotate(-3 12 12)"/><circle cx="8.4" cy="8.6" r="1.1" fill="currentColor"/><circle cx="15.7" cy="8.2" r="1.1" fill="currentColor"/><circle cx="12" cy="12.1" r="1.1" fill="currentColor"/><circle cx="8.6" cy="15.9" r="1.1" fill="currentColor"/><circle cx="15.5" cy="15.6" r="1.1" fill="currentColor"/>',
  download: '<path d="M12.1 3.6c-.2 4.1 0 7.9-.1 11.4"/><path d="M7.4 10.9c1.7 1.6 3.1 3 4.6 4.3 1.5-1.4 3-2.8 4.5-4.4"/><path d="M4.2 16.4c-.1 1.6.2 3.3.6 3.8 4.6.3 9.6.2 14.4-.1.4-.9.6-2.3.5-3.8"/>',
  undo: '<path d="M8.6 5.4 4.4 9.3l4.3 3.8"/><path d="M4.8 9.4c5.3-.4 9.4-.2 11.5 1.6 2.6 2.3 2.4 6.7-.6 8.2-1.4.7-3.3.8-5.6.6"/>',
  redo: '<path d="m15.4 5.4 4.2 3.9-4.3 3.8"/><path d="M19.2 9.4c-5.3-.4-9.4-.2-11.5 1.6-2.6 2.3-2.4 6.7.6 8.2 1.4.7 3.3.8 5.6.6"/>',
  lock: '<rect x="5.2" y="10.6" width="13.6" height="9.6" rx="2.2" transform="rotate(-1.5 12 15)"/><path d="M8.3 10.5c-.3-3.6.9-6.1 3.7-6.2 2.9-.1 4 2.4 3.8 6.1"/>',
  unlock: '<rect x="5.2" y="10.6" width="13.6" height="9.6" rx="2.2" transform="rotate(-1.5 12 15)"/><path d="M8.3 10.5c-.3-3.6.9-6.1 3.7-6.2 2.1-.1 3.3 1.2 3.7 3.1"/>',
  monitor: '<rect x="2.8" y="4.4" width="18.4" height="12" rx="1.8" transform="rotate(-1 12 10)"/><path d="M9.2 20.2c1.9-.3 3.8-.2 5.7 0M12 16.6v3.4"/>',
  phone: '<rect x="6.8" y="2.8" width="10.4" height="18.6" rx="2.6" transform="rotate(1.5 12 12)"/><path d="M10.6 18.3c.9.1 1.9.1 2.8 0"/>',
  shuffle: '<path d="M3.6 7.4c3.6-.2 5.9.4 8.2 4.4 2.4 4.3 4.6 5 8.4 4.8"/><path d="M3.6 16.6c3.4.1 5.2-.6 6.6-2.4M13.8 9.6c1.6-1.9 3.4-2.4 6.4-2.2"/><path d="m17.8 4.8 2.6 2.6-2.6 2.5M17.8 14.1l2.6 2.5-2.6 2.6"/>',
  eye: '<path d="M2.8 12.2c2.4-4 5.6-6.2 9.3-6.2 3.6.1 6.8 2.2 9.1 6-2.3 3.9-5.5 6.1-9.2 6.1-3.6 0-6.8-2.1-9.2-5.9Z"/><circle cx="12" cy="12" r="2.8"/>',
  sliders: '<path d="M4 6.6c5.2.2 10.6-.1 16 .1M4 12.2c5.3-.1 10.6.1 16-.1M4 17.6c5.2.1 10.6-.1 16 .1"/><circle cx="9" cy="6.6" r="1.9" fill="var(--paper-card, #fff)"/><circle cx="15.4" cy="12.1" r="1.9" fill="var(--paper-card, #fff)"/><circle cx="7.4" cy="17.6" r="1.9" fill="var(--paper-card, #fff)"/>',
  expand: '<path d="M4.4 9.3c-.1-1.8 0-3.4.2-4.7 1.4-.2 3-.3 4.7-.2M14.7 4.4c1.8-.1 3.4 0 4.7.2.2 1.4.3 3 .2 4.7M19.6 14.7c.1 1.8 0 3.4-.2 4.7-1.4.2-3 .3-4.7.2M9.3 19.6c-1.8.1-3.4 0-4.7-.2-.2-1.4-.3-3-.2-4.7"/>',
  collapse: '<path d="M9.4 4.4c.1 1.8 0 3.4-.2 4.7-1.4.2-3 .3-4.8.2M19.6 9.3c-1.8.1-3.4 0-4.7-.2-.2-1.4-.3-3-.2-4.7M14.6 19.6c-.1-1.8 0-3.4.2-4.7 1.4-.2 3-.3 4.8-.2M4.4 14.7c1.8-.1 3.4 0 4.7.2.2 1.4.3 3 .2 4.7"/>',
  close: '<path d="M5.6 5.4c4.4 4.6 8.6 8.9 12.8 13.1M18.3 5.6c-4.3 4.2-8.6 8.6-12.8 12.9"/>',
  copy: '<rect x="8.4" y="8.2" width="11.6" height="12" rx="2" transform="rotate(1.2 14 14)"/><path d="M15.6 8c.1-1.5 0-2.8-.3-3.6-3.3-.2-6.8-.1-10.6.1-.3 3.6-.3 7.4 0 11.1.9.2 2.1.3 3.6.2"/>',
  check: '<path d="M4.6 12.8c1.9 1.6 3.4 3.3 4.8 5 3-4.4 6.4-8.4 10.2-11.9"/>',
  link: '<path d="M10.4 13.6c1.1 1.4 3.2 1.6 4.6.4l3.4-3.3c1.4-1.4 1.4-3.6 0-4.9-1.3-1.3-3.4-1.4-4.8-.1l-1.4 1.3"/><path d="M13.6 10.4c-1.1-1.4-3.2-1.6-4.6-.4L5.6 13.3c-1.4 1.4-1.4 3.6 0 4.9 1.3 1.3 3.4 1.4 4.8.1l1.4-1.3"/>',
  image: '<rect x="3.4" y="4.6" width="17.2" height="14.8" rx="2" transform="rotate(-1.2 12 12)"/><path d="M4 16.4c2.6-2.6 4.6-4.4 6.4-4.6 1.9-.1 3.2 2.6 5 2.6 1.4 0 2.7-1.1 4.6-2.6"/><circle cx="15.6" cy="8.8" r="1.4"/>',
  film: '<rect x="3.4" y="5" width="17.2" height="14" rx="2" transform="rotate(1 12 12)"/><path d="m10 9.2 5.2 2.9-5.2 2.8z"/>',
  code: '<path d="M8.4 7.2 3.8 12.1l4.6 4.7M15.6 7.2l4.6 4.9-4.6 4.7M13.4 5.2c-1 4.6-1.9 9.2-2.9 13.7"/>',
  braces: '<path d="M8.6 4.2c-2.6 0-2.6 1.6-2.6 3.6s-.4 3.4-2.2 4.2c1.8.8 2.2 2.2 2.2 4.2s0 3.6 2.6 3.6M15.4 4.2c2.6 0 2.6 1.6 2.6 3.6s.4 3.4 2.2 4.2c-1.8.8-2.2 2.2-2.2 4.2s0 3.6-2.6 3.6"/>',
  play: '<path d="M7.6 5.2c4.1 2.2 7.7 4.4 11 6.8-3.4 2.4-7 4.6-11 6.8-.3-4.6-.3-9.1 0-13.6Z"/>',
  anchorBottom: '<rect x="4" y="4" width="16" height="16" rx="2.4"/><path d="M4.4 14.6c2.6-1.6 5-1.8 7.6-.6s5 1 7.6-.5V18c0 1.1-.9 2-2 2H6.4c-1.1 0-2-.9-2-2z" fill="currentColor" opacity=".55"/>',
  anchorTop: '<rect x="4" y="4" width="16" height="16" rx="2.4"/><path d="M19.6 9.4c-2.6 1.6-5 1.8-7.6.6s-5-1-7.6.5V6c0-1.1.9-2 2-2h11.2c1.1 0 2 .9 2 2z" fill="currentColor" opacity=".55"/>',
  anchorLeft: '<rect x="4" y="4" width="16" height="16" rx="2.4"/><path d="M9.4 4.4c1.6 2.6 1.8 5 .6 7.6s-1 5 .5 7.6H6c-1.1 0-2-.9-2-2V6.4c0-1.1.9-2 2-2z" fill="currentColor" opacity=".55"/>',
  anchorRight: '<rect x="4" y="4" width="16" height="16" rx="2.4"/><path d="M14.6 19.6c-1.6-2.6-1.8-5-.6-7.6s1-5-.5-7.6H18c1.1 0 2 .9 2 2v11.2c0 1.1-.9 2-2 2z" fill="currentColor" opacity=".55"/>',
};

export type IconName = keyof typeof P;

export function icon(name: string, size = 18): string {
  const body = P[name] ?? '';
  return `<svg class="icon" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.55" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
}

/** Replaces every `[data-icon]` placeholder inside root with its SVG. */
export function hydrateIcons(root: ParentNode = document): void {
  root.querySelectorAll<HTMLElement>('[data-icon]').forEach((el) => {
    el.innerHTML = icon(el.dataset.icon!, Number(el.dataset.size) || 18);
  });
}
