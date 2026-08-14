// Lokale "Last-Known-Good"-Datenablage (IndexedDB) für Lesedaten.
//
// Problem: Der Service-Worker-HTTP-Cache greift nur, wenn GENAU dieselbe
// Abfrage auf GENAU diesem Gerät schon einmal online lief — und wartet offline
// erst 5 Sekunden auf das Netz. Ergebnis: Ohne Empfang fehlen Projekte/Listen
// oder erscheinen quälend langsam.
//
// Lösung: Jede erfolgreiche Abfrage schreibt ihr Ergebnis hierher; ohne Netz
// (oder bei Netzfehler) wird SOFORT der letzte bekannte Stand geliefert.
// Zusammen mit warmOfflineCache() (App-Start) sind die Kerndaten damit auch
// auf Geräten verfügbar, die eine Seite noch nie offen hatten.

const DB_NAME = "ruff-offline-data";
const STORE = "cache";
const DB_VERSION = 1;

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB nicht verfügbar"));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) {
        req.result.createObjectStore(STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

type CacheEntry = { data: unknown; savedAt: number };

export async function readCache<T>(key: string): Promise<{ data: T; savedAt: number } | null> {
  try {
    const db = await openDB();
    return await new Promise((resolve) => {
      const tx = db.transaction(STORE, "readonly");
      const req = tx.objectStore(STORE).get(key);
      req.onsuccess = () => {
        const entry = req.result as CacheEntry | undefined;
        resolve(entry ? { data: entry.data as T, savedAt: entry.savedAt } : null);
      };
      req.onerror = () => resolve(null);
      tx.oncomplete = () => db.close();
    });
  } catch {
    return null;
  }
}

export async function writeCache(key: string, data: unknown): Promise<void> {
  try {
    const db = await openDB();
    await new Promise<void>((resolve) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put({ data, savedAt: Date.now() } as CacheEntry, key);
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = () => resolve();
    });
  } catch {
    /* Cache ist Komfort — nie einen Fehler nach außen werfen */
  }
}

export type CachedResult<T> = {
  data: T | null;
  error: { message: string } | null;
  // true = Daten kamen aus der lokalen Ablage (letzter bekannter Stand)
  fromCache: boolean;
  savedAt: number | null;
};

// Führt eine Supabase-Abfrage "offline-sicher" aus:
// - offline: sofort letzter bekannter Stand (kein Netz-Timeout-Warten)
// - online + Erfolg: Ergebnis liefern UND lokal ablegen
// - online + Fehler (z.B. Funkloch trotz navigator.onLine): letzter Stand
export async function cachedSelect<T>(
  key: string,
  run: () => PromiseLike<{ data: T | null; error: { message: string } | null }>,
): Promise<CachedResult<T>> {
  const offline = typeof navigator !== "undefined" && navigator.onLine === false;

  if (offline) {
    const cached = await readCache<T>(key);
    if (cached) return { data: cached.data, error: null, fromCache: true, savedAt: cached.savedAt };
    // kein lokaler Stand: ein Versuch über den (ggf. SW-)Cache
    try {
      const { data, error } = await run();
      if (!error && data !== null) void writeCache(key, data);
      return { data, error, fromCache: false, savedAt: null };
    } catch (e) {
      return { data: null, error: { message: e instanceof Error ? e.message : String(e) }, fromCache: false, savedAt: null };
    }
  }

  try {
    const { data, error } = await run();
    if (!error && data !== null) {
      void writeCache(key, data);
      return { data, error: null, fromCache: false, savedAt: null };
    }
    const cached = await readCache<T>(key);
    if (cached) return { data: cached.data, error: null, fromCache: true, savedAt: cached.savedAt };
    return { data, error, fromCache: false, savedAt: null };
  } catch (e) {
    const cached = await readCache<T>(key);
    if (cached) return { data: cached.data, error: null, fromCache: true, savedAt: cached.savedAt };
    return { data: null, error: { message: e instanceof Error ? e.message : String(e) }, fromCache: false, savedAt: null };
  }
}
