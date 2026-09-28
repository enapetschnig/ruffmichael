import { useCallback, useEffect, useState } from "react";
import { ClipboardList, Loader2, Plus, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import { getSessionUser } from "@/lib/auth";
import { heuteISO } from "@/lib/faktura";
import { cn } from "@/lib/utils";

export type Restarbeit = Database["public"]["Tables"]["restarbeiten"]["Row"];

const datumAT = (iso: string | null) => (iso ? iso.split("-").reverse().join(".") : "");

/** Zusammenfassung für Knopf und Projektliste: offen, davon überfällig. */
export const restStand = (liste: Pick<Restarbeit, "erledigt" | "faellig_am">[] | null | undefined, heute = heuteISO()) => {
  const offen = (liste ?? []).filter((r) => !r.erledigt);
  return { offen: offen.length, ueberfaellig: offen.filter((r) => r.faellig_am && r.faellig_am < heute).length };
};

/**
 * Farbe: rot = etwas überfällig, orange = offen, grün = alles erledigt.
 * Als style statt Tailwind-Klasse — das KingBill-Knopfdesign überschreibt Hintergrundklassen.
 */
export const restFarbe = (s: { offen: number; ueberfaellig: number }): React.CSSProperties => {
  const farbe = s.ueberfaellig > 0 ? "#dc2626" : s.offen > 0 ? "#f97316" : "#16a34a";
  return { background: farbe, borderColor: farbe, color: "#fff" };
};

export const restText = (s: { offen: number; ueberfaellig: number }) =>
  s.offen === 0 ? "Keine Restarbeiten offen"
    : `${s.offen} Restarbeit${s.offen === 1 ? "" : "en"} offen${s.ueberfaellig ? ` · ${s.ueberfaellig} überfällig` : ""}`;

/** Kleines farbiges Schild für die Projektliste (nur wenn es welche gibt). */
export function RestarbeitenSchild({ liste }: { liste: Pick<Restarbeit, "erledigt" | "faellig_am">[] | null | undefined }) {
  const s = restStand(liste);
  if (!s.offen) return null;
  return (
    <Badge className="gap-1 shrink-0" style={restFarbe(s)} title={restText(s)}>
      <ClipboardList className="h-3 w-3" />
      {s.offen} Restarbeit{s.offen === 1 ? "" : "en"}{s.ueberfaellig ? " !" : ""}
    </Badge>
  );
}

/**
 * Knopf „Restarbeiten“ im Projekt — farbig mit Zähler — und die Liste dazu:
 * was, bis wann, wer; abhaken, löschen (nur Admin).
 */
export function RestarbeitenKnopf({ projectId, isAdmin }: { projectId: string; isAdmin: boolean }) {
  const { toast } = useToast();
  const [liste, setListe] = useState<Restarbeit[]>([]);
  const [offen, setOffen] = useState(false);
  const [neu, setNeu] = useState({ beschreibung: "", faellig_am: "", zustaendig: "" });
  const [speichert, setSpeichert] = useState(false);

  const laden = useCallback(async () => {
    const { data } = await supabase.from("restarbeiten").select("*").eq("project_id", projectId)
      .order("erledigt").order("faellig_am", { nullsFirst: false }).order("created_at");
    setListe(data ?? []);
  }, [projectId]);

  useEffect(() => { laden(); }, [laden]);

  const anlegen = async () => {
    if (speichert) return;
    if (!neu.beschreibung.trim()) return toast({ variant: "destructive", title: "Was ist noch zu tun?", description: "Bitte die Restarbeit kurz beschreiben." });
    setSpeichert(true);
    const user = await getSessionUser();
    const { error } = await supabase.from("restarbeiten").insert({
      project_id: projectId,
      beschreibung: neu.beschreibung.trim(),
      faellig_am: neu.faellig_am || null,
      zustaendig: neu.zustaendig.trim() || null,
      created_by: user?.id ?? null,
    });
    setSpeichert(false);
    if (error) return toast({ variant: "destructive", title: "Nicht gespeichert", description: error.message });
    setNeu({ beschreibung: "", faellig_am: "", zustaendig: "" });
    laden();
  };

  const abhaken = async (r: Restarbeit, erledigt: boolean) => {
    const user = await getSessionUser();
    setListe((l) => l.map((x) => (x.id === r.id ? { ...x, erledigt } : x)));
    const { error } = await supabase.from("restarbeiten").update({
      erledigt,
      erledigt_am: erledigt ? new Date().toISOString() : null,
      erledigt_von: erledigt ? user?.id ?? null : null,
    }).eq("id", r.id);
    if (error) toast({ variant: "destructive", title: "Nicht gespeichert", description: error.message });
    laden();
  };

  const entfernen = async (r: Restarbeit) => {
    if (!confirm(`Restarbeit „${r.beschreibung}“ löschen?`)) return;
    const { error } = await supabase.from("restarbeiten").delete().eq("id", r.id);
    if (error) return toast({ variant: "destructive", title: "Nicht gelöscht", description: error.message });
    laden();
  };

  const s = restStand(liste);
  const heute = heuteISO();

  return (
    <>
      <Button
        className="gap-2 font-semibold"
        style={s.offen ? { ...restFarbe(s), backgroundImage: "none" } : undefined}
        variant="outline"
        onClick={() => setOffen(true)}
      >
        <ClipboardList className="h-4 w-4" />
        Restarbeiten{s.offen ? ` (${s.offen} offen)` : ""}
      </Button>

      <Dialog open={offen} onOpenChange={setOffen}>
        <DialogContent className="max-w-[calc(100vw-1.5rem)] sm:max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><ClipboardList className="h-5 w-5" /> Restarbeiten</DialogTitle>
            <DialogDescription>{restText(s)}</DialogDescription>
          </DialogHeader>

          <div className="rounded-md border p-3 space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="rest-beschreibung">Was ist noch zu tun?</Label>
              <Input id="rest-beschreibung" value={neu.beschreibung} onChange={(e) => setNeu({ ...neu, beschreibung: e.target.value })}
                onKeyDown={(e) => e.key === "Enter" && anlegen()} placeholder="z. B. Silikonfuge Dusche nachziehen" />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1.5">
                <Label htmlFor="rest-faellig">Bis wann</Label>
                <Input id="rest-faellig" type="date" value={neu.faellig_am} onChange={(e) => setNeu({ ...neu, faellig_am: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="rest-wer">Wer</Label>
                <Input id="rest-wer" value={neu.zustaendig} onChange={(e) => setNeu({ ...neu, zustaendig: e.target.value })} placeholder="optional" />
              </div>
            </div>
            <Button className="w-full gap-1.5" onClick={anlegen} disabled={speichert}>
              {speichert ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
              Restarbeit hinzufügen
            </Button>
          </div>

          <div className="space-y-2">
            {liste.length === 0 && <p className="text-sm text-muted-foreground text-center py-3">Noch keine Restarbeiten eingetragen.</p>}
            {liste.map((r) => {
              const ueber = !r.erledigt && !!r.faellig_am && r.faellig_am < heute;
              return (
                <div key={r.id} className={cn("flex items-start gap-3 rounded-md border border-l-4 p-3",
                  r.erledigt ? "border-l-green-600 opacity-60" : ueber ? "border-l-red-600" : "border-l-orange-500")}>
                  <Checkbox checked={r.erledigt} onCheckedChange={(v) => abhaken(r, v === true)} className="mt-1" aria-label="Erledigt" />
                  <div className="min-w-0 flex-1">
                    <p className={cn("break-words", r.erledigt && "line-through")}>{r.beschreibung}</p>
                    <p className={cn("text-xs", ueber ? "text-red-600 font-medium" : "text-muted-foreground")}>
                      {[r.faellig_am ? `bis ${datumAT(r.faellig_am)}${ueber ? " – überfällig" : ""}` : null, r.zustaendig].filter(Boolean).join(" · ") || "ohne Termin"}
                    </p>
                  </div>
                  {isAdmin && (
                    <Button size="icon" variant="ghost" className="h-8 w-8 shrink-0" aria-label="Restarbeit löschen" onClick={() => entfernen(r)}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              );
            })}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
