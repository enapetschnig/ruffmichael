// Postfach, Eingangsrechnungen und Kalender — gemeinsame Typen und Helfer.
//
// Die Daten kommen über die Edge Function „outlook" aus Microsoft 365
// (Postfach office@ruffinstallateur.at). In Outlook wird dabei nichts
// verändert: gelesen wird nur, geschrieben wird ausschließlich beim
// Verschicken einer neuen Mail.

import { supabase } from "@/integrations/supabase/client";

export type MailKategorie =
  | "eingangsrechnung" | "mahnung" | "angebot" | "bestellung" | "lieferschein"
  | "kundenanfrage" | "behoerde" | "werbung" | "sonstiges";

export type Mail = {
  id: string;
  graph_id: string;
  ordner: string;
  richtung: string;
  von_name: string | null;
  von_adresse: string | null;
  an_adressen: { name?: string; adresse?: string }[];
  cc_adressen: { name?: string; adresse?: string }[];
  betreff: string | null;
  vorschau: string | null;
  koerper_text: string | null;
  koerper_html: string | null;
  empfangen_am: string;
  gelesen: boolean;
  wichtig: boolean;
  hat_anhang: boolean;
  kategorie: MailKategorie;
  kategorie_quelle: string | null;
  kategorie_sicherheit: number | null;
  kategorie_grund: string | null;
  kunde_id: string | null;
  project_id: string | null;
  erledigt: boolean;
  notiz: string | null;
  web_link: string | null;
};

export type MailAnhang = {
  id: string;
  mail_id: string;
  name: string;
  mime: string | null;
  groesse: number | null;
  pfad: string | null;
  ist_beleg: boolean;
};

export type ErStatus = "offen" | "geprueft" | "bezahlt" | "abgelehnt";

export type Eingangsrechnung = {
  id: string;
  mail_id: string | null;
  anhang_id: string | null;
  lieferant: string;
  lieferant_uid: string | null;
  nummer: string | null;
  datum: string | null;
  faellig_am: string | null;
  netto: number | null;
  ust: number | null;
  brutto: number | null;
  waehrung: string;
  iban: string | null;
  verwendungszweck: string | null;
  skonto_prozent: number | null;
  skonto_bis: string | null;
  status: ErStatus;
  bezahlt_am: string | null;
  project_id: string | null;
  pdf_pfad: string | null;
  quelle: string;
  erkannt_von: string | null;
  sicherheit: number | null;
  notiz: string | null;
  created_at: string;
};

export type Termin = {
  id: string;
  subject?: string;
  bodyPreview?: string;
  start?: { dateTime: string; timeZone?: string };
  end?: { dateTime: string; timeZone?: string };
  isAllDay?: boolean;
  location?: { displayName?: string };
  organizer?: { emailAddress?: { name?: string; address?: string } };
  attendees?: { emailAddress?: { name?: string; address?: string }; status?: { response?: string } }[];
  categories?: string[];
  showAs?: string;
  webLink?: string;
  type?: string;
};

export const KATEGORIE_LABEL: Record<MailKategorie, string> = {
  eingangsrechnung: "Eingangsrechnung",
  mahnung: "Mahnung",
  angebot: "Angebot erhalten",
  bestellung: "Bestellung",
  lieferschein: "Lieferung",
  kundenanfrage: "Kundenanfrage",
  behoerde: "Behörde & Kammer",
  werbung: "Werbung",
  sonstiges: "Sonstiges",
};

/** Farbton der Kategorie-Plakette — Rechnungen und Mahnungen stechen heraus. */
export const KATEGORIE_KLASSE: Record<MailKategorie, string> = {
  eingangsrechnung: "border-amber-400 bg-amber-50 text-amber-900 dark:bg-amber-950/40 dark:text-amber-200",
  mahnung: "border-red-400 bg-red-50 text-red-900 dark:bg-red-950/40 dark:text-red-200",
  angebot: "border-blue-300 bg-blue-50 text-blue-900 dark:bg-blue-950/40 dark:text-blue-200",
  bestellung: "border-blue-300 bg-blue-50 text-blue-900 dark:bg-blue-950/40 dark:text-blue-200",
  lieferschein: "border-slate-300 bg-slate-50 text-slate-800 dark:bg-slate-900/60 dark:text-slate-200",
  kundenanfrage: "border-green-400 bg-green-50 text-green-900 dark:bg-green-950/40 dark:text-green-200",
  behoerde: "border-purple-300 bg-purple-50 text-purple-900 dark:bg-purple-950/40 dark:text-purple-200",
  werbung: "border-slate-200 bg-slate-50 text-slate-500 dark:bg-slate-900/40 dark:text-slate-400",
  sonstiges: "border-slate-200 bg-transparent text-muted-foreground",
};

export const ER_STATUS_LABEL: Record<ErStatus, string> = {
  offen: "Zu prüfen",
  geprueft: "Geprüft",
  bezahlt: "Bezahlt",
  abgelehnt: "Abgelehnt",
};

export const ER_STATUS_KLASSE: Record<ErStatus, string> = {
  offen: "border-amber-400 bg-amber-50 text-amber-900 dark:bg-amber-950/40 dark:text-amber-200",
  geprueft: "border-blue-400 bg-blue-50 text-blue-900 dark:bg-blue-950/40 dark:text-blue-200",
  bezahlt: "border-green-500 bg-green-50 text-green-900 dark:bg-green-950/40 dark:text-green-200",
  abgelehnt: "border-slate-300 bg-slate-50 text-slate-600 dark:bg-slate-900/50 dark:text-slate-300",
};

/** Ruft die Outlook-Funktion auf und wirft mit klarem Text, wenn etwas fehlt. */
export async function outlook<T = Record<string, unknown>>(aktion: string, rumpf: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await supabase.functions.invoke("outlook", { body: { aktion, ...rumpf } });
  if (error) {
    // Der Fehlertext der Funktion steckt im Antwortkörper, nicht in error.message
    let text = error.message;
    const antwort = (error as { context?: { json?: () => Promise<{ error?: string }> } }).context;
    try { const j = await antwort?.json?.(); if (j?.error) text = j.error; } catch { /* Antwort war kein JSON */ }
    throw new Error(text);
  }
  if ((data as { error?: string })?.error) throw new Error((data as { error: string }).error);
  return data as T;
}

/** Zeitlich begrenzte Adresse für einen Anhang (Anzeigen/Herunterladen). */
export async function anhangUrl(pfad: string, minuten = 30): Promise<string | null> {
  const { data } = await supabase.storage.from("mail-anhaenge").createSignedUrl(pfad, minuten * 60);
  return data?.signedUrl ?? null;
}

export const adressenText = (liste: { name?: string; adresse?: string }[] | null | undefined) =>
  (liste ?? []).map((a) => a.name || a.adresse || "").filter(Boolean).join(", ");

export const absender = (m: Mail) => m.von_name?.trim() || m.von_adresse || "Unbekannt";

/** „Heute 14:32“, „Gestern“, „Mo 08.09.“ oder „08.09.2025“ — wie im Mailprogramm. */
export function mailZeit(iso: string): string {
  const d = new Date(iso);
  const jetzt = new Date();
  const tag = (x: Date) => `${x.getFullYear()}-${x.getMonth()}-${x.getDate()}`;
  const gestern = new Date(jetzt.getTime() - 86400000);
  if (tag(d) === tag(jetzt)) return d.toLocaleTimeString("de-AT", { hour: "2-digit", minute: "2-digit" });
  if (tag(d) === tag(gestern)) return "Gestern";
  if (d.getFullYear() === jetzt.getFullYear()) return d.toLocaleDateString("de-AT", { day: "2-digit", month: "2-digit" });
  return d.toLocaleDateString("de-AT", { day: "2-digit", month: "2-digit", year: "numeric" });
}

export const dateiGroesse = (bytes: number | null | undefined) => {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} kB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
};
