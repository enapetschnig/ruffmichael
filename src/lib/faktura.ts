// Gemeinsame Typen, Beschriftungen und Helfer für Angebote & Rechnungen.
// WICHTIG: Alles hier ist nur für Administratoren gedacht — Mitarbeiter sehen
// nie Preise. Die Datenbank erzwingt das per RLS, die Oberfläche zeigt die
// Seiten gar nicht erst an.

import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";

export type Beleg = Database["public"]["Tables"]["belege"]["Row"];
export type BelegInsert = Database["public"]["Tables"]["belege"]["Insert"];
export type BelegPosition = Database["public"]["Tables"]["beleg_positionen"]["Row"];
export type BelegPositionInsert = Database["public"]["Tables"]["beleg_positionen"]["Insert"];
export type Zahlung = Database["public"]["Tables"]["beleg_zahlungen"]["Row"];
export type Firmendaten = Database["public"]["Tables"]["faktura_firmendaten"]["Row"];
export type Stundensatz = Database["public"]["Tables"]["faktura_stundensaetze"]["Row"];
export type Nummernkreis = Database["public"]["Tables"]["faktura_nummernkreise"]["Row"];

export type BelegTyp = Beleg["typ"];
export type BelegStatus = Beleg["status"];

export const TYP_LABEL: Record<BelegTyp, string> = {
  angebot: "Angebot",
  auftragsbestaetigung: "Auftragsbestätigung",
  rechnung: "Rechnung",
  teilrechnung: "Teilrechnung",
  schlussrechnung: "Schlussrechnung",
  gutschrift: "Gutschrift",
};

// Wie Michael seine Dateien benennt („Unverbindliches Angebot 2026-1111.pdf“).
export const TYP_DATEINAME: Record<BelegTyp, string> = {
  angebot: "Unverbindliches Angebot",
  auftragsbestaetigung: "Auftragsbestätigung",
  rechnung: "Rechnung",
  teilrechnung: "Teilrechnung",
  schlussrechnung: "Schlussrechnung",
  gutschrift: "Gutschrift",
};

export const STATUS_LABEL: Record<BelegStatus, string> = {
  entwurf: "Entwurf",
  festgeschrieben: "Festgeschrieben",
  gesendet: "Gesendet",
  angenommen: "Angenommen",
  abgelehnt: "Abgelehnt",
  teilbezahlt: "Teilweise bezahlt",
  bezahlt: "Bezahlt",
  storniert: "Storniert",
};

export const STATUS_VARIANT: Record<BelegStatus, "default" | "secondary" | "destructive" | "outline"> = {
  entwurf: "outline",
  festgeschrieben: "secondary",
  gesendet: "default",
  angenommen: "default",
  abgelehnt: "destructive",
  teilbezahlt: "secondary",
  bezahlt: "default",
  storniert: "destructive",
};

export const istRechnung = (typ: BelegTyp) =>
  typ === "rechnung" || typ === "teilrechnung" || typ === "schlussrechnung";

export const istAngebot = (typ: BelegTyp) => typ === "angebot" || typ === "auftragsbestaetigung";

export const EINHEITEN = ["Stk", "h", "m", "m²", "lfm", "psch", "Tag", "km", "kg", "l", "Set"];

const eurFmt = new Intl.NumberFormat("de-AT", { style: "currency", currency: "EUR" });
export const eur = (n: number | string | null | undefined): string => eurFmt.format(Number(n ?? 0));

const zahlFmt = new Intl.NumberFormat("de-AT", { minimumFractionDigits: 0, maximumFractionDigits: 3 });
export const zahl = (n: number | string | null | undefined): string => zahlFmt.format(Number(n ?? 0));

export const datum = (iso: string | null | undefined): string => {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString("de-AT", { day: "2-digit", month: "2-digit", year: "numeric" });
};

// Lokales Datum (Wien), nicht UTC — sonst bekommt ein Beleg um 00:30 das Vordatum.
export const heuteISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

/** „12,5" oder „12.5" → 12.5; leer/ungültig → null. Handys tippen Komma. */
export const parseZahl = (s: string | number | null | undefined): number | null => {
  if (s === null || s === undefined) return null;
  const t = String(s).trim().replace(/\s/g, "").replace(",", ".");
  if (t === "") return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
};

export const plusTage = (isoDatum: string, tage: number): string => {
  const d = new Date(isoDatum);
  d.setDate(d.getDate() + tage);
  return d.toISOString().slice(0, 10);
};

/** Belegnummer oder ein klarer Entwurfs-Hinweis. */
export const belegTitel = (b: Pick<Beleg, "typ" | "nummer">) =>
  b.nummer ? `${TYP_LABEL[b.typ]} ${b.nummer}` : `${TYP_LABEL[b.typ]} (Entwurf)`;

/** Offener Restbetrag einer Rechnung. */
export const offen = (b: Pick<Beleg, "brutto" | "bezahlt" | "status" | "typ">) =>
  istRechnung(b.typ) && b.status !== "storniert" && b.status !== "entwurf"
    ? Math.max(0, Number(b.brutto) - Number(b.bezahlt))
    : 0;

export async function ladeFirmendaten(): Promise<Firmendaten | null> {
  const { data } = await supabase.from("faktura_firmendaten").select("*").eq("einzig", true).maybeSingle();
  return data ?? null;
}

export async function ladeStundensaetze(): Promise<Stundensatz[]> {
  const { data } = await supabase.from("faktura_stundensaetze").select("*").order("sort_order");
  return data ?? [];
}

/** Erzeugt (oder aktualisiert) das PDF eines Belegs. Festgeschriebene Belege
 *  werden im Projektordner „Anbote“ abgelegt (→ OneDrive); Entwürfe kommen nur
 *  als Vorschau zurück. */
export async function belegPdf(belegId: string): Promise<{ url?: string; pfad?: string; base64?: string; error?: string }> {
  const { data, error } = await supabase.functions.invoke("beleg-pdf", { body: { belegId } });
  if (error) return { error: error.message };
  return data ?? { error: "Keine Antwort" };
}
