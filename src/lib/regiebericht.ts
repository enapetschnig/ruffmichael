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

export async function regieberichtPdf(disturbanceId: string): Promise<{ blob?: Blob; dateiname?: string; error?: string }> {
  const { data: d, error } = await supabase.from("disturbances").select("*").eq("id", disturbanceId).single();
  if (error || !d) return { error: error?.message ?? "Regiebericht nicht gefunden" };
  const [materialien, fotos, techniker] = await Promise.all([
    supabase.from("disturbance_materials").select("*").eq("disturbance_id", disturbanceId).order("created_at"),
    supabase.from("disturbance_photos").select("id, file_path, file_name").eq("disturbance_id", disturbanceId).order("created_at"),
    technikerNamen(disturbanceId, d.user_id),
  ]);
  const { data, error: fe } = await supabase.functions.invoke("send-disturbance-report", {
    body: { nurPdf: true, disturbance: d, materials: materialien.data ?? [], photos: fotos.data ?? [], technicianNames: techniker },
  });
  if (fe || !data?.pdf) return { error: fe?.message ?? data?.error ?? "PDF konnte nicht erstellt werden" };
  const bytes = Uint8Array.from(atob(data.pdf), (c) => c.charCodeAt(0));
  const tag = String(d.datum).split("-").reverse().join(".");
  const name = String(d.kunde_name ?? "Kunde").replace(/[^\p{L}\p{N} ._-]/gu, "_").trim();
  return { blob: new Blob([bytes], { type: "application/pdf" }), dateiname: `Regiebericht ${name} ${tag}.pdf` };
}
