export type GalleryItem = {
  id: string;
  prompt: string;
  model: string;
  size: string;
  n: number;
  images: string[];
  cost_usd?: number;
  error?: { message: string };
  created_at: number;
  source: "session" | "cache";
};

const DB_NAME = "cm-image-studio";
const DB_VERSION = 1;
const STORE = "gallery";

export const MAX_CACHED_ITEMS = 12;

export function evictCacheItems<T extends { id: string; created_at: number }>(
  items: readonly T[],
  max = MAX_CACHED_ITEMS,
): T[] {
  return [...items]
    .sort((a, b) => b.created_at - a.created_at || a.id.localeCompare(b.id))
    .slice(0, Math.max(0, max));
}

const memoryFallback = new Map<string, GalleryItem>();
let idbBroken = false;
let cachedDb: IDBDatabase | null = null;

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB open failed"));
    request.onblocked = () => reject(new Error("IndexedDB open blocked"));
  });
}

async function getDb(): Promise<IDBDatabase | null> {
  if (cachedDb) return cachedDb;
  if (idbBroken) return null;
  if (typeof indexedDB === "undefined") {
    idbBroken = true;
    return null;
  }
  try {
    cachedDb = await openDatabase();
    return cachedDb;
  } catch {
    idbBroken = true;
    return null;
  }
}

function readAll(db: IDBDatabase): Promise<GalleryItem[]> {
  return new Promise((resolve, reject) => {
    const request = db.transaction(STORE, "readonly").objectStore(STORE).getAll();
    request.onsuccess = () => resolve((request.result as GalleryItem[]) ?? []);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB read failed"));
  });
}

function writeDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("IndexedDB write failed"));
    tx.onabort = () => reject(tx.error ?? new Error("IndexedDB write aborted"));
  });
}

export async function loadCachedGallery(): Promise<GalleryItem[]> {
  const db = await getDb();
  if (!db) return evictCacheItems([...memoryFallback.values()], memoryFallback.size);
  try {
    return evictCacheItems(await readAll(db));
  } catch {
    return [];
  }
}

export async function persistGalleryItem(item: GalleryItem): Promise<void> {
  memoryFallback.set(item.id, item);

  const db = await getDb();
  if (!db) {
    const keep = new Set(evictCacheItems([...memoryFallback.values()]).map((e) => e.id));
    for (const key of [...memoryFallback.keys()]) {
      if (!keep.has(key)) memoryFallback.delete(key);
    }
    return;
  }

  try {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(item);
    await writeDone(tx);

    const all = await readAll(db);
    const keep = new Set(evictCacheItems(all).map((e) => e.id));
    if (all.length > keep.size) {
      const prune = db.transaction(STORE, "readwrite");
      const store = prune.objectStore(STORE);
      for (const entry of all) {
        if (!keep.has(entry.id)) store.delete(entry.id);
      }
      await writeDone(prune);
    }
  } catch {
    // write already mirrored into memoryFallback above
  }
}

export async function removeCachedGalleryItem(id: string): Promise<void> {
  memoryFallback.delete(id);
  const db = await getDb();
  if (!db) return;
  try {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).delete(id);
    await writeDone(tx);
  } catch {
    // best effort
  }
}

export async function clearGalleryCache(): Promise<void> {
  memoryFallback.clear();
  const db = await getDb();
  if (!db) return;
  try {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).clear();
    await writeDone(tx);
  } catch {
    // best effort
  }
}
