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
  festgeschrieben: "Erstellt",
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

// Einheiten wie in Michaels bisherigen Belegen („Std“, „Liter“, „Tage“) plus
// die üblichen Ergänzungen. Reihenfolge = Häufigkeit in seinen alten Angeboten.
export const EINHEITEN = ["Stk", "Std", "lfm", "m", "m²", "m³", "Liter", "kg", "Tage", "psch", "km", "Set"];

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

/**
 * „12,5“, „12.5“, „1.800,00“, „1 800,00“ → Zahl; leer/ungültig → null.
 *
 * Handys tippen Komma, die Anzeige liefert Tausenderpunkte zurück ins Feld —
 * beides muss wieder hereinkommen. Kommen Punkt und Komma gemeinsam vor,
 * ist das hintere das Dezimaltrennzeichen (deutsch 1.800,00 / englisch 1,800.00).
 */
export const parseZahl = (s: string | number | null | undefined): number | null => {
  if (s === null || s === undefined) return null;
  if (typeof s === "number") return Number.isFinite(s) ? s : null;
  let t = s.trim().replace(/[\s '’€]/g, "");
  if (t === "") return null;
  const komma = t.lastIndexOf(","), punkt = t.lastIndexOf(".");
  if (komma >= 0 && punkt >= 0) {
    t = komma > punkt ? t.replace(/\./g, "").replace(",", ".") : t.replace(/,/g, "");
  } else if (komma >= 0) {
    // Mehrere Kommas können nur Tausendertrenner sein (englische Schreibweise)
    t = t.split(",").length > 2 ? t.replace(/,/g, "") : t.replace(",", ".");
  } else if (punkt >= 0 && /^-?\d{1,3}(\.\d{3})+$/.test(t)) {
    t = t.replace(/\./g, "");
  }
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

/** Kundendaten, die ein neuer Beleg als Schnappschuss übernimmt. */
export type BelegKunde = {
  id: string; vorname: string | null; nachname: string; firma: string | null; strasse: string | null; ort: string | null;
  uid: string | null; reverse_charge: boolean; zahlungsziel_tage: number | null; email: string | null;
};

export const BELEG_KUNDE_FELDER = "id, vorname, nachname, firma, strasse, ort, uid, reverse_charge, zahlungsziel_tage, email";

/**
 * Legt einen Beleg-Entwurf an — eine Stelle für die Belegliste und die Wartungen,
 * damit Fälligkeit, Leistungszeitraum, Texte und Kundenschnappschuss überall gleich sind.
 */
export async function belegEntwurfAnlegen(opt: {
  typ: BelegTyp;
  kunde: BelegKunde;
  projektId?: string | null;
  betreff?: string | null;
  userId?: string | null;
}): Promise<{ beleg?: Beleg; error?: string }> {
  const { typ, kunde: k } = opt;
  const firma = await ladeFirmendaten();
  const heute = heuteISO();
  const zahlungsziel = k.zahlungsziel_tage ?? firma?.zahlungsziel_tage ?? 14;
  const rechnung = istRechnung(typ);
  const person = [k.vorname, k.nachname].filter(Boolean).join(" ").trim();
  const { data, error } = await supabase.from("belege").insert({
    typ,
    project_id: opt.projektId || null,
    customer_id: k.id,
    // Snapshot der Kundendaten
    kunde_name: k.firma?.trim() || person,
    kunde_zusatz: k.firma?.trim() ? person || null : null,
    kunde_strasse: k.strasse, kunde_plz_ort: k.ort, kunde_uid: k.uid, kunde_email: k.email,
    datum: heute,
    faellig_am: rechnung ? plusTage(heute, zahlungsziel) : null,
    gueltig_bis: typ === "angebot" ? plusTage(heute, firma?.angebot_gueltig_tage ?? 30) : null,
    // Leistungszeitraum ist Pflicht auf der Rechnung — Vorbelegung heute, „Stunden holen“ erweitert
    leistung_von: rechnung ? heute : null,
    leistung_bis: rechnung ? heute : null,
    // Reverse Charge gilt auch fürs Angebot: der Kunde soll keine USt sehen, die es nicht gibt
    reverse_charge: !!k.reverse_charge,
    ust_satz: firma?.ust_satz ?? 20,
    skonto_prozent: rechnung ? firma?.skonto_prozent ?? null : null,
    skonto_tage: rechnung ? firma?.skonto_tage ?? null : null,
    einleitung: rechnung ? firma?.rechnung_einleitung : firma?.angebot_einleitung,
    schlusstext: rechnung ? firma?.rechnung_schluss : firma?.angebot_schluss,
    betreff: opt.betreff ?? null,
    created_by: opt.userId ?? null,
  }).select().single();
  if (error || !data) return { error: error?.message ?? "Beleg konnte nicht angelegt werden" };
  return { beleg: data };
}
