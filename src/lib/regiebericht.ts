// Regiebericht als PDF — zum Drucken/Teilen, auch wenn der Kunde noch nicht
// unterschrieben hat (dann mit leerer Unterschriftslinie). Nutzt dieselbe PDF-Erzeugung
// wie der Versand (Edge Function send-disturbance-report, Modus nurPdf — verschickt nichts).
import { supabase } from "@/integrations/supabase/client";

/** Namen der Techniker, Haupttechniker zuerst — gleiche Reihenfolge wie im versendeten Bericht. */
export async function technikerNamen(disturbanceId: string, ersatzUserId?: string | null): Promise<string[]> {
  const { data: workers } = await supabase
    .from("disturbance_workers")
    .select("user_id, is_main")
    .eq("disturbance_id", disturbanceId)
    .order("is_main", { ascending: false });
  const ids = (workers ?? []).map((w) => w.user_id);
  if (!ids.length && ersatzUserId) ids.push(ersatzUserId);
  if (!ids.length) return ["Techniker"];
  const { data: profile } = await supabase.from("profiles").select("id, vorname, nachname").in("id", ids);
  const namen = ids
    .map((id) => profile?.find((p) => p.id === id))
    .filter(Boolean)
    .map((p) => `${p!.vorname} ${p!.nachname}`.trim())
    .filter(Boolean);
  return namen.length ? namen : ["Techniker"];
}

/** Daten für die PDF-Erzeugung/den Versand — dieselben wie beim Unterschreiben. */
async function berichtDaten(disturbanceId: string) {
  const { data: d, error } = await supabase.from("disturbances").select("*").eq("id", disturbanceId).single();
  if (error || !d) return { error: error?.message ?? "Arbeitsbestätigung nicht gefunden" } as const;
  const [materialien, fotos, techniker] = await Promise.all([
    supabase.from("disturbance_materials").select("*").eq("disturbance_id", disturbanceId).order("created_at"),
    supabase.from("disturbance_photos").select("id, file_path, file_name").eq("disturbance_id", disturbanceId).order("created_at"),
    technikerNamen(disturbanceId, d.user_id),
  ]);
  return { d, body: { disturbance: d, materials: materialien.data ?? [], photos: fotos.data ?? [], technicianNames: techniker } } as const;
}

/**
 * Unterschriebenen Bericht (erneut) per Mail schicken — über Michaels Outlook-Postfach.
 * Für Berichte, deren Versand früher gescheitert ist (Status blieb „offen“).
 */
export async function regieberichtSenden(disturbanceId: string): Promise<{ an?: string[]; error?: string }> {
  const r = await berichtDaten(disturbanceId);
  if ("error" in r) return { error: r.error };
  if (!r.d.unterschrift_kunde) return { error: "Der Bericht ist noch nicht unterschrieben." };
  const { data, error } = await supabase.functions.invoke("send-disturbance-report", { body: r.body });
  if (error || !data?.success) {
    let text = error?.message ?? data?.error ?? "Versand fehlgeschlagen";
    try { const j = await (error as { context?: { json?: () => Promise<{ error?: string }> } })?.context?.json?.(); if (j?.error) text = j.error; } catch { /* kein JSON */ }
    return { error: text };
  }
  return { an: data.emailResponse?.an };
}

export async function regieberichtPdf(disturbanceId: string): Promise<{ blob?: Blob; dateiname?: string; error?: string }> {
  const r = await berichtDaten(disturbanceId);
  if ("error" in r) return { error: r.error };
  const d = r.d;
  const { data, error: fe } = await supabase.functions.invoke("send-disturbance-report", { body: { ...r.body, nurPdf: true } });
  if (fe || !data?.pdf) return { error: fe?.message ?? data?.error ?? "PDF konnte nicht erstellt werden" };
  const bytes = Uint8Array.from(atob(data.pdf), (c) => c.charCodeAt(0));
  const tag = String(d.datum).split("-").reverse().join(".");
  const name = String(d.kunde_name ?? "Kunde").replace(/[^\p{L}\p{N} ._-]/gu, "_").trim();
  return { blob: new Blob([bytes], { type: "application/pdf" }), dateiname: `Arbeitsbestaetigung ${name} ${tag}.pdf` };
}
