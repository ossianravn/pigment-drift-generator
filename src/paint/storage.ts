// Keeps the current painting in IndexedDB so a reload (or a phone dropping the
// tab in the background) never loses it. Nothing leaves the device.

import type { SavedSheet } from './engine';

const DB = 'pigment-drift-paint';
const STORE = 'sheets';
const KEY = 'current';

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  try {
    return await new Promise<T>((resolve, reject) => {
      const t = db.transaction(STORE, mode);
      const req = fn(t.objectStore(STORE));
      t.oncomplete = () => resolve(req.result);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error);
    });
  } finally {
    db.close();
  }
}

/** The saved sheet, or null. Gives up after `timeoutMs`: some browsers occasionally never answer. */
export async function loadSheet(timeoutMs = 2500): Promise<SavedSheet | null> {
  const read = tx('readonly', (s) => s.get(KEY) as IDBRequest<SavedSheet | undefined>)
    .then((v) => (v && v.data instanceof Uint8Array ? v : null))
    .catch(() => null);
  const timeout = new Promise<null>((r) => setTimeout(() => r(null), timeoutMs));
  return Promise.race([read, timeout]);
}

export async function saveSheet(sheet: SavedSheet): Promise<void> {
  try {
    await tx('readwrite', (s) => s.put(sheet, KEY));
  } catch {
    /* private mode or storage full: painting still works, it just won't persist */
  }
}
