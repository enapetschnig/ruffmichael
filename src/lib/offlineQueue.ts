// Offline-Warteschlange (Outbox) für Zeiterfassung und Datei-Uploads.
//
// Idee: Wenn kein Netz da ist (oder ein Schreibvorgang am Netz scheitert),
// legen wir die Aktion lokal in IndexedDB ab. Sobald wieder Internet da ist
// (Event "online", App-Start, oder alle 30s), arbeiten wir die Warteschlange
// automatisch ab. Blobs (Fotos/Dateien) werden direkt in IndexedDB gehalten,
// das übersteht auch einen App-Neustart / Reboot.
//
// Bewusst ohne externe Abhängigkeit: kleiner eigener IndexedDB-Wrapper.

import { supabase } from "@/integrations/supabase/client";

const DB_NAME = "ruff-offline";
const STORE = "outbox";
const DB_VERSION = 1;

export type OutboxKind =
  | "time-entries"
  | "upload"
  | "db-insert"
  | "db-update"
  | "db-delete"
  | "edge-invoke";

export interface TimeEntriesPayload {
  // exakt der Body, den die Edge Function "create-team-time-entries" erwartet
  mainEntry: Record<string, unknown>;
  teamEntries: Record<string, unknown>[];
  createWorkerLinks?: boolean;
  skipMainEntry?: boolean;
}

export interface UploadPayload {
  bucket: string;
  path: string;
  blob: Blob;
  contentType?: string;
  upsert?: boolean;
  // Optionaler Folge-Eintrag in einer Tabelle (z.B. "documents") nach erfolgreichem Upload
  followInsert?: { table: string; row: Record<string, unknown> };
}

export interface DbInsertPayload {
  table: string;
  rows: Record<string, unknown>[];
}
export interface DbUpdatePayload {
  table: string;
  match: Record<string, unknown>; // eq-Bedingungen (z.B. { id })
  patch: Record<string, unknown>;
}
export interface DbDeletePayload {
  table: string;
  match: Record<string, unknown>;
}
export interface EdgeInvokePayload {
  fn: string;
  body: unknown;
}

export type OutboxPayload =
  | TimeEntriesPayload
  | UploadPayload
  | DbInsertPayload
  | DbUpdatePayload
  | DbDeletePayload
  | EdgeInvokePayload;

export interface OutboxItem {
  id: string;
  kind: OutboxKind;
  payload: OutboxPayload;
  label: string; // menschenlesbar für die UI, z.B. "Zeiteintrag 12.07."
  createdAt: number;
  seq: number; // monotoner Tie-Breaker: garantiert Eltern-vor-Kind-Reihenfolge
  tries: number;
  lastError?: string;
}

// Monoton steigende Sequenz über die Session – bricht createdAt-Gleichstände auf,
// damit die FIFO-Reihenfolge (und damit Foreign-Key-Reihenfolge) exakt der
// Einfüge-Reihenfolge im Code entspricht.
let seqCounter = 0;

// ---- IndexedDB-Grundlagen ----

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB nicht verfügbar"));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "id" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDB().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(STORE, mode);
        const store = t.objectStore(STORE);
        const req = fn(store);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
        t.oncomplete = () => db.close();
      })
  );
}

// ---- Öffentliche Queue-API ----

const listeners = new Set<() => void>();
export function onOutboxChange(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}
function notify() {
  listeners.forEach((cb) => {
    try { cb(); } catch { /* ignore */ }
  });
}

function makeId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
  }
}

export async function enqueue(kind: OutboxKind, payload: OutboxPayload, label: string): Promise<void> {
  const item: OutboxItem = { id: makeId(), kind, payload, label, createdAt: Date.now(), seq: ++seqCounter, tries: 0 };
  await tx("readwrite", (s) => s.put(item));
  notify();
}

export async function getAll(): Promise<OutboxItem[]> {
  const items = await tx<OutboxItem[]>("readonly", (s) => s.getAll() as IDBRequest<OutboxItem[]>);
  // Reihenfolge = Einfüge-Reihenfolge: erst nach Zeit, bei Gleichstand nach seq.
  return (items || []).sort((a, b) => (a.createdAt - b.createdAt) || ((a.seq ?? 0) - (b.seq ?? 0)));
}

export async function count(): Promise<number> {
  try {
    return await tx<number>("readonly", (s) => s.count());
  } catch {
    return 0;
  }
}

async function remove(id: string): Promise<void> {
  await tx("readwrite", (s) => s.delete(id));
  notify();
}

async function update(item: OutboxItem): Promise<void> {
  await tx("readwrite", (s) => s.put(item));
  notify();
}

// ---- Sync-Engine ----

let processing = false;

async function executeItem(item: OutboxItem): Promise<void> {
  if (item.kind === "time-entries") {
    const body = item.payload as TimeEntriesPayload;
    const { data, error } = await supabase.functions.invoke("create-team-time-entries", { body });
    if (error) throw new Error(error.message || "Zeiteintrag fehlgeschlagen");
    if (!data?.success) throw new Error(data?.error || "Zeiteintrag fehlgeschlagen");
    return;
  }
  if (item.kind === "upload") {
    const up = item.payload as UploadPayload;
    const { error } = await supabase.storage
      .from(up.bucket)
      .upload(up.path, up.blob, { contentType: up.contentType, upsert: up.upsert ?? true });
    // Datei liegt schon → als erledigt betrachten (idempotent)
    if (error && !/exists|duplicate/i.test(error.message)) throw error;
    // Optionaler Folge-Eintrag (z.B. documents-Zeile fürs Foto)
    if (up.followInsert) {
      const { error: insErr } = await supabase.from(up.followInsert.table as never).insert(up.followInsert.row as never);
      if (insErr && !/duplicate/i.test(insErr.message)) throw insErr;
    }
    return;
  }
  if (item.kind === "db-insert") {
    const p = item.payload as DbInsertPayload;
    const { error } = await supabase.from(p.table as never).insert(p.rows as never);
    // Bereits vorhanden (z.B. Wiederholung nach Absturz) → als erledigt werten
    if (error && !/duplicate key|already exists/i.test(error.message)) throw error;
    return;
  }
  if (item.kind === "db-update") {
    const p = item.payload as DbUpdatePayload;
    let q = supabase.from(p.table as never).update(p.patch as never);
    for (const [col, val] of Object.entries(p.match)) q = (q as any).eq(col, val);
    const { error } = await q;
    if (error) throw error;
    return;
  }
  if (item.kind === "db-delete") {
    const p = item.payload as DbDeletePayload;
    let q = supabase.from(p.table as never).delete();
    for (const [col, val] of Object.entries(p.match)) q = (q as any).eq(col, val);
    const { error } = await q;
    if (error) throw error;
    return;
  }
  if (item.kind === "edge-invoke") {
    const p = item.payload as EdgeInvokePayload;
    const { data, error } = await supabase.functions.invoke(p.fn, { body: p.body });
    if (error) throw new Error(error.message || `${p.fn} fehlgeschlagen`);
    if (data && typeof data === "object" && "success" in data && !(data as any).success) {
      throw new Error((data as any).error || `${p.fn} fehlgeschlagen`);
    }
    return;
  }
}

// Arbeitet die Warteschlange ab. Gibt zurück, wie viele erfolgreich waren.
export async function processOutbox(): Promise<{ done: number; remaining: number }> {
  if (processing) return { done: 0, remaining: await count() };
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    return { done: 0, remaining: await count() };
  }
  // Nur mit gültiger Session synchronisieren (Edge Function braucht Auth)
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return { done: 0, remaining: await count() };

  processing = true;
  let done = 0;
  try {
    const items = await getAll();
    for (const item of items) {
      try {
        await executeItem(item);
        await remove(item.id);
        done++;
      } catch (err) {
        // Netz weg? Abbrechen und später erneut versuchen.
        if (typeof navigator !== "undefined" && navigator.onLine === false) break;
        const msg = err instanceof Error ? err.message : String(err);
        // Bei Netzwerkfehlern nicht als endgültigen Fehler werten
        if (/fetch|network|Failed to fetch|load failed/i.test(msg)) break;
        await update({ ...item, tries: item.tries + 1, lastError: msg });
        // andere Einträge trotzdem weiter versuchen
      }
    }
  } finally {
    processing = false;
  }
  return { done, remaining: await count() };
}

// Automatik: bei "online" und periodisch synchronisieren. Einmal global starten.
let started = false;
export function startAutoSync() {
  if (started || typeof window === "undefined") return;
  started = true;
  const kick = () => { void processOutbox(); };
  window.addEventListener("online", kick);
  // beim Start (falls schon online + Einträge in der Queue)
  kick();
  // regelmäßig nachfassen (z.B. flackerndes Netz auf der Baustelle)
  window.setInterval(() => {
    if (navigator.onLine) kick();
  }, 30000);
}
