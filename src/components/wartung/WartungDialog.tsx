import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Auswahl } from "@/components/Auswahl";
import { KundenAuswahl } from "@/components/kunde/KundenAuswahl";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { getSessionUser } from "@/lib/auth";
import { parseZahl } from "@/lib/faktura";
import { INTERVALL_OPTIONEN, VORLAUF_OPTIONEN, type Wartung } from "@/lib/wartung";

export type KundeWahl = { id: string; vorname: string | null; nachname: string; firma: string | null; ort: string | null };
export type ProjektWahl = { id: string; name: string; customer_id: string | null };

const leer = { customer_id: "", project_id: "", bezeichnung: "", faellig_am: "", vorlauf_tage: "14", intervall: "12", preis: "", notiz: "" };

/** Wartung anlegen oder ändern: welche Wartung, wann fällig, wie früh erinnern, wie oft. */
export function WartungDialog({ open, onOpenChange, wartung, kunden, projekte, vorgabe, onGespeichert }: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  wartung: Wartung | null;
  kunden: KundeWahl[];
  projekte: ProjektWahl[];
  /** Vorbelegung beim Anlegen, z. B. aus einem Projekt heraus */
  vorgabe?: { customer_id?: string | null; project_id?: string | null; bezeichnung?: string; faellig_am?: string; notiz?: string; kundeSuche?: string };
  onGespeichert: () => void;
}) {
  const { toast } = useToast();
  const [f, setF] = useState(leer);
  const [speichert, setSpeichert] = useState(false);

  useEffect(() => {
    if (!open) return;
    setF(wartung ? {
      customer_id: wartung.customer_id ?? "",
      project_id: wartung.project_id ?? "",
      bezeichnung: wartung.bezeichnung,
      faellig_am: wartung.faellig_am,
      vorlauf_tage: String(wartung.vorlauf_tage),
      intervall: wartung.intervall_monate ? String(wartung.intervall_monate) : "einmalig",
      preis: wartung.preis != null ? String(wartung.preis).replace(".", ",") : "",
      notiz: wartung.notiz ?? "",
    } : {
      ...leer,
      customer_id: vorgabe?.customer_id ?? "",
      project_id: vorgabe?.project_id ?? "",
      bezeichnung: vorgabe?.bezeichnung ?? "",
      faellig_am: vorgabe?.faellig_am ?? "",
      notiz: vorgabe?.notiz ?? "",
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, wartung]);

  // Projekt gewählt → Kunde des Projekts übernehmen (wenn noch keiner gewählt)
  const projektWaehlen = (id: string) => {
    const p = projekte.find((x) => x.id === id);
    setF((alt) => ({ ...alt, project_id: id, customer_id: alt.customer_id || p?.customer_id || "" }));
  };

  const speichern = async () => {
    if (speichert) return;
    if (!f.bezeichnung.trim()) return toast({ variant: "destructive", title: "Welche Wartung?", description: "Bitte eintragen, welche Wartung das ist (z. B. Heizungswartung Gastherme)." });
    if (!f.faellig_am) return toast({ variant: "destructive", title: "Datum fehlt", description: "Bitte eintragen, wann die Wartung fällig ist." });
    const preis = f.preis.trim() ? parseZahl(f.preis) : null;
    if (f.preis.trim() && preis == null) return toast({ variant: "destructive", title: "Preis stimmt nicht", description: "Bitte eine Zahl eingeben, z. B. 180 oder 180,50." });
    setSpeichert(true);
    const daten = {
      customer_id: f.customer_id || null,
      project_id: f.project_id || null,
      bezeichnung: f.bezeichnung.trim(),
      faellig_am: f.faellig_am,
      vorlauf_tage: Number(f.vorlauf_tage),
      intervall_monate: f.intervall === "einmalig" ? null : Number(f.intervall),
      preis,
      notiz: f.notiz.trim() || null,
    };
    const user = await getSessionUser();
    const { error } = wartung
      ? await supabase.from("wartungen").update(daten).eq("id", wartung.id)
      : await supabase.from("wartungen").insert({ ...daten, created_by: user?.id ?? null });
    setSpeichert(false);
    if (error) return toast({ variant: "destructive", title: "Nicht gespeichert", description: error.message });
    toast({ title: wartung ? "Wartung geändert" : "Wartung angelegt" });
    onOpenChange(false);
    onGespeichert();
  };

  const projekteZumKunden = f.customer_id ? projekte.filter((p) => !p.customer_id || p.customer_id === f.customer_id || p.id === f.project_id) : projekte;

  return (
    <Dialog open={open} onOpenChange={(o) => !speichert && onOpenChange(o)}>
      <DialogContent className="max-w-[calc(100vw-1.5rem)] sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{wartung ? "Wartung ändern" : "Neue Wartung"}</DialogTitle>
          <DialogDescription>Rechtzeitig vor dem Termin erscheint die Wartung ganz oben am Dashboard.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="wartung-bezeichnung">Welche Wartung? *</Label>
            <Input id="wartung-bezeichnung" value={f.bezeichnung} onChange={(e) => setF({ ...f, bezeichnung: e.target.value })} placeholder="z. B. Heizungswartung Gastherme" />
          </div>
          <div className="space-y-1.5">
            <Label>Kunde</Label>
            <KundenAuswahl key={open ? "offen" : "zu"} startSuche={f.customer_id ? undefined : vorgabe?.kundeSuche} wert={f.customer_id} onChange={(k) => setF((alt) => ({ ...alt, customer_id: k?.id ?? "" }))} />
          </div>
          <div className="space-y-1.5">
            <Label>Projekt <span className="text-muted-foreground font-normal">(optional)</span></Label>
            <Auswahl
              wert={f.project_id}
              optionen={projekteZumKunden}
              label={(p) => p.name}
              suchtext={(p) => p.name}
              platzhalter="Projekt wählen …"
              leer="— kein Projekt —"
              onChange={projektWaehlen}
            />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="wartung-faellig">Fällig am *</Label>
              <Input id="wartung-faellig" type="date" value={f.faellig_am} onChange={(e) => setF({ ...f, faellig_am: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label>Erinnern</Label>
              <Select value={f.vorlauf_tage} onValueChange={(v) => setF({ ...f, vorlauf_tage: v })}>
                <SelectTrigger aria-label="Erinnern"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {VORLAUF_OPTIONEN.map((o) => <SelectItem key={o.tage} value={String(o.tage)}>{o.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Wiederholen</Label>
              <Select value={f.intervall} onValueChange={(v) => setF({ ...f, intervall: v })}>
                <SelectTrigger aria-label="Wiederholen"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {INTERVALL_OPTIONEN.map((o) => <SelectItem key={o.label} value={o.monate ? String(o.monate) : "einmalig"}>{o.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="wartung-preis">Preis netto € <span className="text-muted-foreground font-normal">(für die Rechnung)</span></Label>
              <Input id="wartung-preis" inputMode="decimal" value={f.preis} onChange={(e) => setF({ ...f, preis: e.target.value })} placeholder="z. B. 180" />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="wartung-notiz">Notiz</Label>
            <Textarea id="wartung-notiz" value={f.notiz} onChange={(e) => setF({ ...f, notiz: e.target.value })} rows={2} placeholder="z. B. Gerätetyp, Zugang, Ansprechperson" />
          </div>
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={speichert}>Abbrechen</Button>
          <Button onClick={speichern} disabled={speichert} className="gap-1.5">
            {speichert && <Loader2 className="h-4 w-4 animate-spin" />}
            Speichern
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
