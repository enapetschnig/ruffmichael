// Einheitliche Helfer für offline-fähige Schreibvorgänge.
//
// Muster überall gleich: online zuerst versuchen; wenn kein Netz da ist (oder
// die Anfrage netzbedingt scheitert), die Aktion in die Offline-Warteschlange
// legen und { queued: true } zurückgeben. Der aufrufende Code zeigt dann einen
// "Offline gespeichert"-Hinweis statt eines Fehlers.
//
// WICHTIG für Beziehungen (Foreign Keys): IDs IMMER clientseitig mit newId()
// erzeugen und explizit in die Zeile schreiben. Dann können abhängige Zeilen
// (z.B. Materialien eines Regieberichts) schon offline auf die Eltern-ID
// verweisen, und beim späteren Sync passt alles zusammen.

import { supabase } from "@/integrations/supabase/client";
import {
  enqueue,
  type DbInsertPayload,
  type DbUpdatePayload,
  type DbDeletePayload,
  type EdgeInvokePayload,
  type UploadPayload,
} from "@/lib/offlineQueue";

export function newId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    // Fallback (RFC4122-ähnlich)
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      const v = c === "x" ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }
}

export function isOffline(): boolean {
  return typeof navigator !== "undefined" && navigator.onLine === false;
}

function isNetworkError(msg?: string): boolean {
  return !!msg && /fetch|network|failed to fetch|load failed|timeout|ERR_INTERNET/i.test(msg);
}

export interface OfflineResult {
  queued: boolean;
  error?: string;
}

// WICHTIG bei mehrstufigen Abläufen (Eltern → Kinder): Sobald EIN Schritt in die
// Warteschlange gegangen ist, MÜSSEN alle folgenden Schritte ebenfalls direkt in
// die Warteschlange (force=true) – sonst würde ein Kind online gegen einen Eltern-
// Datensatz laufen, der erst später synchronisiert wird (FK-Verletzung / RLS /
// stiller Verlust). Muster:
//   let q = false;
//   const r1 = await saveInsert(parentTable, parent, label);      q ||= r1.queued;
//   const r2 = await saveInsert(childTable, child, label, q);     q ||= r2.queued;
//   const r3 = await saveInvoke(fn, body, label, q);              q ||= r3.queued;

// Insert einer oder mehrerer Zeilen. Zeilen sollten ihre id bereits enthalten.
export async function saveInsert(
  table: string,
  rows: Record<string, unknown> | Record<string, unknown>[],
  label: string,
  force = false
): Promise<OfflineResult> {
  const list = Array.isArray(rows) ? rows : [rows];
  const payload: DbInsertPayload = { table, rows: list };
  if (force || isOffline()) {
    await enqueue("db-insert", payload, label);
    return { queued: true };
  }
  try {
    const { error } = await supabase.from(table as never).insert(list as never);
    if (error) {
      if (isNetworkError(error.message)) {
        await enqueue("db-insert", payload, label);
        return { queued: true };
      }
      return { queued: false, error: error.message };
    }
    return { queued: false };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (isOffline() || isNetworkError(msg)) {
      await enqueue("db-insert", payload, label);
      return { queued: true };
    }
    return { queued: false, error: msg };
  }
}

export async function saveUpdate(
  table: string,
  match: Record<string, unknown>,
  patch: Record<string, unknown>,
  label: string,
  force = false
): Promise<OfflineResult> {
  const payload: DbUpdatePayload = { table, match, patch };
  const run = async () => {
    let q = supabase.from(table as never).update(patch as never);
    for (const [c, v] of Object.entries(match)) q = (q as any).eq(c, v);
    return q;
  };
  if (force || isOffline()) {
    await enqueue("db-update", payload, label);
    return { queued: true };
  }
  try {
    const { error } = await run();
    if (error) {
      if (isNetworkError(error.message)) {
        await enqueue("db-update", payload, label);
        return { queued: true };
      }
      return { queued: false, error: error.message };
    }
    return { queued: false };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (isOffline() || isNetworkError(msg)) {
      await enqueue("db-update", payload, label);
      return { queued: true };
    }
    return { queued: false, error: msg };
  }
}

export async function saveDelete(
  table: string,
  match: Record<string, unknown>,
  label: string
): Promise<OfflineResult> {
  const payload: DbDeletePayload = { table, match };
  const run = async () => {
    let q = supabase.from(table as never).delete();
    for (const [c, v] of Object.entries(match)) q = (q as any).eq(c, v);
    return q;
  };
  if (isOffline()) {
    await enqueue("db-delete", payload, label);
    return { queued: true };
  }
  try {
    const { error } = await run();
    if (error) {
      if (isNetworkError(error.message)) {
        await enqueue("db-delete", payload, label);
        return { queued: true };
      }
      return { queued: false, error: error.message };
    }
    return { queued: false };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (isOffline() || isNetworkError(msg)) {
      await enqueue("db-delete", payload, label);
      return { queued: true };
    }
    return { queued: false, error: msg };
  }
}

// Edge Function offline-fähig aufrufen (z.B. create-team-time-entries,
// generate-uebernahme-pdf, send-disturbance-report). Offline wird sie beim
// nächsten Sync ausgeführt.
export async function saveInvoke(fn: string, body: unknown, label: string, force = false): Promise<OfflineResult> {
  const payload: EdgeInvokePayload = { fn, body };
  if (force || isOffline()) {
    await enqueue("edge-invoke", payload, label);
    return { queued: true };
  }
  try {
    const { data, error } = await supabase.functions.invoke(fn, { body });
    if (error || (data && typeof data === "object" && "success" in data && !(data as any).success)) {
      const msg = error?.message || (data as any)?.error || "";
      if (isNetworkError(msg) || isOffline()) {
        await enqueue("edge-invoke", payload, label);
        return { queued: true };
      }
      return { queued: false, error: msg || `${fn} fehlgeschlagen` };
    }
    return { queued: false };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (isOffline() || isNetworkError(msg)) {
      await enqueue("edge-invoke", payload, label);
      return { queued: true };
    }
    return { queued: false, error: msg };
  }
}

// Datei/Blob offline-fähig hochladen (optional mit Folge-DB-Eintrag).
export async function saveUpload(
  up: UploadPayload,
  label: string,
  force = false
): Promise<OfflineResult> {
  if (force || isOffline()) {
    await enqueue("upload", up, label);
    return { queued: true };
  }
  try {
    const { error } = await supabase.storage
      .from(up.bucket)
      .upload(up.path, up.blob, { contentType: up.contentType, upsert: up.upsert ?? true });
    if (error && !/exists|duplicate/i.test(error.message)) {
      if (isNetworkError(error.message)) {
        await enqueue("upload", up, label);
        return { queued: true };
      }
      return { queued: false, error: error.message };
    }
    if (up.followInsert) {
      const { error: insErr } = await supabase
        .from(up.followInsert.table as never)
        .insert(up.followInsert.row as never);
      if (insErr && !/duplicate/i.test(insErr.message)) return { queued: false, error: insErr.message };
    }
    return { queued: false };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (isOffline() || isNetworkError(msg)) {
      await enqueue("upload", up, label);
      return { queued: true };
    }
    return { queued: false, error: msg };
  }
}
