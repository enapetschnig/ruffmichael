// Zentrale, offline-fähige Standard-Abfragen (siehe offlineStore.ts).
//
// Wichtig: Mehrere Seiten teilen sich hier bewusst DIESELBEN Cache-Schlüssel.
// warmOfflineCache() füllt sie beim App-Start einmal — dadurch sind Projekte,
// Kunden und Status auch auf Seiten offline verfügbar, die auf diesem Gerät
// noch nie geöffnet wurden (z.B. Projektauswahl in der Zeiterfassung).

import { supabase } from "@/integrations/supabase/client";
import { cachedSelect, type CachedResult } from "@/lib/offlineStore";

export type CachedProject = {
  id: string;
  name: string;
  status: string;
  plz: string | null;
  adresse: string | null;
  beschreibung: string | null;
  customers: { vorname: string | null; nachname: string | null; strasse: string | null; ort: string | null } | null;
};

export type CachedCustomer = {
  id: string;
  vorname: string | null;
  nachname: string;
  strasse: string | null;
  plz: string | null;
  ort: string | null;
  telefon: string | null;
  email: string | null;
  notizen: string | null;
  created_by: string | null;
};

export type CachedStatus = { id: string; name: string; color: string; sort_order: number };

// Aktive Projekte (Projektauswahl in Zeiterfassung, Dialogen, Zeichnung, Sprache)
export const fetchActiveProjectsCached = (): Promise<CachedResult<CachedProject[]>> =>
  cachedSelect("projects:aktiv", () =>
    supabase
      .from("projects")
      .select("id, name, status, plz, adresse, beschreibung, customers(vorname, nachname, strasse, ort)")
      .eq("status", "aktiv")
      .order("name") as unknown as PromiseLike<{ data: CachedProject[] | null; error: { message: string } | null }>,
  );

// Alle Projekte (Auswertungen, Nachträge-Filter)
export const fetchAllProjectsCached = (): Promise<CachedResult<CachedProject[]>> =>
  cachedSelect("projects:alle", () =>
    supabase
      .from("projects")
      .select("id, name, status, plz, adresse, beschreibung, customers(vorname, nachname, strasse, ort)")
      .order("name") as unknown as PromiseLike<{ data: CachedProject[] | null; error: { message: string } | null }>,
  );

// Kundenliste
export const fetchCustomersCached = (): Promise<CachedResult<CachedCustomer[]>> =>
  cachedSelect("customers:alle", () =>
    supabase
      .from("customers")
      .select("*")
      .order("nachname")
      .order("vorname") as unknown as PromiseLike<{ data: CachedCustomer[] | null; error: { message: string } | null }>,
  );

// Ampel-Status
export const fetchStatusesCached = (): Promise<CachedResult<CachedStatus[]>> =>
  cachedSelect("statuses", () =>
    supabase
      .from("project_statuses")
      .select("id, name, color, sort_order")
      .order("sort_order") as unknown as PromiseLike<{ data: CachedStatus[] | null; error: { message: string } | null }>,
  );

// Erstaufnahme-Checkliste
export const fetchChecklistCached = (): Promise<CachedResult<{ id: string; text: string }[]>> =>
  cachedSelect("checklist:aktiv", () =>
    supabase
      .from("erstaufnahme_checklist_items")
      .select("id, text")
      .eq("is_active", true)
      .order("sort_order", { ascending: true }) as unknown as PromiseLike<{ data: { id: string; text: string }[] | null; error: { message: string } | null }>,
  );

// Beim App-Start (online) einmal alles vorwärmen — Feuer-und-vergessen.
export function warmOfflineCache(): void {
  if (typeof navigator !== "undefined" && navigator.onLine === false) return;
  void fetchActiveProjectsCached();
  void fetchAllProjectsCached();
  void fetchCustomersCached();
  void fetchStatusesCached();
  void fetchChecklistCached();
}
