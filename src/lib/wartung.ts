// Wartungen (Terminwartung / Wartungsintervalle) — gemeinsame Logik für die
// Wartungsseite und den Hinweis ganz oben am Dashboard.
import { addMonths, differenceInCalendarDays, format, parseISO } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import { BELEG_KUNDE_FELDER, belegEntwurfAnlegen, heuteISO, type BelegKunde } from "@/lib/faktura";

export type Wartung = Database["public"]["Tables"]["wartungen"]["Row"];

/** Wartung mit Kunde und Projekt, wie sie Liste und Dashboard brauchen. */
export type WartungMitBezug = Wartung & {
  customers: { id: string; vorname: string | null; nachname: string; firma: string | null; email: string | null; ort: string | null } | null;
  projects: { id: string; name: string } | null;
};

export const WARTUNG_SELECT = "*, customers(id, vorname, nachname, firma, email, ort), projects(id, name)";

export const VORLAUF_OPTIONEN: { tage: number; label: string }[] = [
  { tage: 0, label: "am Fälligkeitstag" },
  { tage: 3, label: "3 Tage vorher" },
  { tage: 7, label: "1 Woche vorher" },
  { tage: 14, label: "2 Wochen vorher" },
  { tage: 21, label: "3 Wochen vorher" },
  { tage: 30, label: "1 Monat vorher" },
  { tage: 60, label: "2 Monate vorher" },
];

export const INTERVALL_OPTIONEN: { monate: number | null; label: string }[] = [
  { monate: null, label: "einmalig" },
  { monate: 1, label: "jeden Monat" },
  { monate: 3, label: "alle 3 Monate" },
  { monate: 6, label: "halbjährlich" },
  { monate: 12, label: "jährlich" },
  { monate: 24, label: "alle 2 Jahre" },
  { monate: 36, label: "alle 3 Jahre" },
  { monate: 60, label: "alle 5 Jahre" },
];

export const intervallText = (monate: number | null) =>
  INTERVALL_OPTIONEN.find((o) => o.monate === monate)?.label ?? `alle ${monate} Monate`;

export const vorlaufText = (tage: number) =>
  VORLAUF_OPTIONEN.find((o) => o.tage === tage)?.label ?? `${tage} Tage vorher`;

export const datumAT = (iso: string | null | undefined) => (iso ? format(parseISO(iso), "dd.MM.yyyy") : "");

export type Stufe = "ueberfaellig" | "faellig" | "geplant" | "erledigt";

/** Wo steht die Wartung heute? „faellig“ = innerhalb der eingestellten Vorwarnzeit. */
export const stufe = (w: Pick<Wartung, "status" | "faellig_am" | "vorlauf_tage">, heute = heuteISO()): Stufe => {
  if (w.status === "erledigt") return "erledigt";
  const tage = differenceInCalendarDays(parseISO(w.faellig_am), parseISO(heute));
  if (tage < 0) return "ueberfaellig";
  if (tage <= w.vorlauf_tage) return "faellig";
  return "geplant";
};

export const restText = (faelligAm: string, heute = heuteISO()) => {
  const tage = differenceInCalendarDays(parseISO(faelligAm), parseISO(heute));
  if (tage < -1) return `seit ${-tage} Tagen überfällig`;
  if (tage === -1) return "seit gestern überfällig";
  if (tage === 0) return "heute fällig";
  if (tage === 1) return "morgen fällig";
  return `in ${tage} Tagen fällig`;
};

/** Farben je Stufe — rot überfällig, orange bald fällig, grün geplant, grau erledigt. */
export const STUFE_FARBE: Record<Stufe, { rand: string; badge: string; text: string }> = {
  ueberfaellig: { rand: "border-l-red-600", badge: "bg-red-600 text-white hover:bg-red-600", text: "Überfällig" },
  faellig: { rand: "border-l-orange-500", badge: "bg-orange-500 text-white hover:bg-orange-500", text: "Bald fällig" },
  geplant: { rand: "border-l-green-600", badge: "bg-green-600 text-white hover:bg-green-600", text: "Geplant" },
  erledigt: { rand: "border-l-muted-foreground/40", badge: "bg-muted text-muted-foreground hover:bg-muted", text: "Erledigt" },
};

export const kundeText = (k: WartungMitBezug["customers"]) =>
  k ? k.firma?.trim() || [k.vorname, k.nachname].filter(Boolean).join(" ").trim() : "";

/** Anrede für die Mail: „Herr/Frau“ kennt die App nicht — darum der volle Name. */
const anrede = (k: WartungMitBezug["customers"]) =>
  k ? (k.firma?.trim() ? "Damen und Herren" : [k.vorname, k.nachname].filter(Boolean).join(" ").trim()) : "Damen und Herren";

export const STANDARD_VORLAGE =
  "Betreff: Wartung {wartung} – Terminvereinbarung\n\nSehr geehrte/r {kunde},\n\ndie nächste {wartung} ist am {faellig} fällig.\n" +
  "Bitte teilen Sie uns mit, wann ein Termin für Sie passt – wir kümmern uns um den Rest.\n\nMit freundlichen Grüßen\nMichael Ruff\nRuff Michael GmbH";

export async function ladeVorlage(): Promise<string> {
  const { data } = await supabase.from("app_settings").select("value").eq("key", "wartung_mail_vorlage").maybeSingle();
  return data?.value || STANDARD_VORLAGE;
}

export async function speichereVorlage(text: string) {
  return supabase.from("app_settings").upsert({ key: "wartung_mail_vorlage", value: text, updated_at: new Date().toISOString() });
}

/** Vorlage mit den Daten der Wartung füllen. Erste Zeile „Betreff: …“ wird zum Betreff. */
export const mailAusVorlage = (vorlage: string, w: WartungMitBezug) => {
  const felder: Record<string, string> = {
    kunde: anrede(w.customers),
    wartung: w.bezeichnung,
    faellig: datumAT(w.faellig_am),
    projekt: w.projects?.name ?? "",
  };
  const fuellen = (t: string) => t.replace(/\{(\w+)\}/g, (ganz, k: string) => (k in felder ? felder[k] : ganz));
  const zeilen = fuellen(vorlage).split("\n");
  let betreff = `Wartung ${w.bezeichnung}`;
  if (/^betreff:/i.test(zeilen[0] ?? "")) {
    betreff = zeilen.shift()!.replace(/^betreff:\s*/i, "").trim() || betreff;
    while (zeilen.length && !zeilen[0].trim()) zeilen.shift();
  }
  return { an: w.customers?.email ?? "", betreff, text: zeilen.join("\n") };
};

/** Nächster Termin: ab dem alten Fälligkeitstag gerechnet, damit der Rhythmus nicht wandert. */
export const naechsterTermin = (w: Pick<Wartung, "faellig_am" | "intervall_monate">) =>
  w.intervall_monate ? format(addMonths(parseISO(w.faellig_am), w.intervall_monate), "yyyy-MM-dd") : null;

/**
 * Wartung abschließen. Mit Intervall wird die nächste gleich angelegt
 * (Datum frei wählbar, Vorschlag = alter Termin + Intervall).
 */
export async function wartungAbschliessen(
  w: Wartung,
  opt: { erledigtAm: string; naechsteAm: string | null; userId: string | null },
): Promise<{ error?: string; naechsteId?: string }> {
  const { error } = await supabase.from("wartungen")
    .update({ status: "erledigt", erledigt_am: opt.erledigtAm, erledigt_von: opt.userId })
    .eq("id", w.id).eq("status", "offen");
  if (error) return { error: error.message };
  if (!opt.naechsteAm) return {};
  const { data, error: e2 } = await supabase.from("wartungen").insert({
    customer_id: w.customer_id,
    project_id: w.project_id,
    bezeichnung: w.bezeichnung,
    faellig_am: opt.naechsteAm,
    vorlauf_tage: w.vorlauf_tage,
    intervall_monate: w.intervall_monate,
    preis: w.preis,
    notiz: w.notiz,
    vorgaenger_id: w.id,
    created_by: opt.userId,
  }).select("id").single();
  if (e2) return { error: `Erledigt — aber die nächste Wartung wurde nicht angelegt: ${e2.message}` };
  return { naechsteId: data?.id };
}

/** Rechnungsentwurf aus der Wartung: Kunde, Projekt und eine Position „Wartung …“. */
export async function wartungRechnung(w: Wartung, userId: string | null): Promise<{ belegId?: string; error?: string }> {
  if (w.beleg_id) return { belegId: w.beleg_id };
  if (!w.customer_id) return { error: "Für eine Rechnung braucht die Wartung einen Kunden. Bitte zuerst einen Kunden eintragen." };
  const { data: kunde, error: ke } = await supabase.from("customers").select(BELEG_KUNDE_FELDER).eq("id", w.customer_id).single();
  if (ke || !kunde) return { error: ke?.message ?? "Kunde nicht gefunden" };
  const { beleg, error } = await belegEntwurfAnlegen({
    typ: "rechnung",
    kunde: kunde as unknown as BelegKunde,
    projektId: w.project_id,
    betreff: `Wartung ${w.bezeichnung}`,
    userId,
  });
  if (error || !beleg) return { error };
  const tag = w.erledigt_am ?? heuteISO();
  await supabase.from("belege").update({ leistung_von: tag, leistung_bis: tag }).eq("id", beleg.id);
  const { error: pe } = await supabase.from("beleg_positionen").insert({
    beleg_id: beleg.id,
    pos: 1,
    text: `Wartung: ${w.bezeichnung}`,
    beschreibung: `Durchgeführt am ${datumAT(tag)}`,
    menge: 1,
    einheit: "psch",
    einzelpreis: Number(w.preis ?? 0),
    quelle_typ: "wartung",
    quelle_ids: [w.id],
  });
  if (pe) return { belegId: beleg.id, error: `Rechnung angelegt, Position fehlt: ${pe.message}` };
  await supabase.from("wartungen").update({ beleg_id: beleg.id }).eq("id", w.id);
  return { belegId: beleg.id };
}
