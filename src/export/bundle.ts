// Zip packs and downloads.

import { strToU8, zipSync, type Zippable } from 'fflate';

export type PackFile = { name: string; data: Blob | string };

export async function zip(files: PackFile[]): Promise<Blob> {
  const entries: Zippable = {};
  for (const f of files) {
    if (typeof f.data === 'string') {
      entries[f.name] = [strToU8(f.data), { level: 6 }];
    } else {
      // Images and video are already compressed; storing them is faster and no bigger.
      entries[f.name] = [new Uint8Array(await f.data.arrayBuffer()), { level: 0 }];
    }
  }
  const bytes = zipSync(entries);
  return new Blob([bytes as Uint8Array<ArrayBuffer>], { type: 'application/zip' });
}

export function download(data: Blob | string, filename: string, type = 'text/plain'): void {
  const blob = typeof data === 'string' ? new Blob([data], { type }) : data;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

let runtimeCache: Promise<string> | null = null;

/** The standalone embed runtime, served next to the app at /embed/. */
export function fetchRuntime(): Promise<string> {
  runtimeCache ??= fetch(`${import.meta.env.BASE_URL}embed/pigment-drift.min.js`).then((r) => {
    if (!r.ok) throw new Error('Could not load the embed runtime (run `npm run build:embed`).');
    return r.text();
  });
  runtimeCache.catch(() => (runtimeCache = null));
  return runtimeCache;
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
