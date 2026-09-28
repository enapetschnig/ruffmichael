import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { FileText, Pencil, Plus, Search, Trash2, Wrench } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { getSessionUser } from "@/lib/auth";
import { alleZeilen } from "@/lib/alleZeilen";
import { eur, heuteISO } from "@/lib/faktura";
import { WartungAktionen } from "@/components/wartung/WartungAktionen";
import { WartungDialog, type KundeWahl, type ProjektWahl } from "@/components/wartung/WartungDialog";
import {
  STANDARD_VORLAGE, STUFE_FARBE, WARTUNG_SELECT, datumAT, intervallText, kundeText, ladeVorlage, restText,
  speichereVorlage, stufe, vorlaufText, type WartungMitBezug,
} from "@/lib/wartung";

type Filter = "anstehend" | "alle" | "erledigt";

/** Wartungen & Wartungsintervalle (nur Administratoren). */
const Wartungen = () => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [params] = useSearchParams();
  const [liste, setListe] = useState<WartungMitBezug[]>([]);
  const [laedt, setLaedt] = useState(true);
  const [filter, setFilter] = useState<Filter>("anstehend");
  const [suche, setSuche] = useState("");
  const [kunden, setKunden] = useState<KundeWahl[]>([]);
  const [projekte, setProjekte] = useState<ProjektWahl[]>([]);
  const [dialog, setDialog] = useState<{ wartung: WartungMitBezug | null } | null>(null);
  const [loeschen, setLoeschen] = useState<WartungMitBezug | null>(null);
  const [vorlageOffen, setVorlageOffen] = useState(false);
  const [vorlage, setVorlage] = useState("");

  const laden = useCallback(async () => {
    const { data, error } = await supabase.from("wartungen").select(WARTUNG_SELECT).order("faellig_am");
    if (error) toast({ variant: "destructive", title: "Wartungen nicht geladen", description: error.message });
    setListe((data ?? []) as unknown as WartungMitBezug[]);
    setLaedt(false);
  }, [toast]);

  useEffect(() => {
    (async () => {
      const user = await getSessionUser();
      if (!user) return navigate("/auth");
      const { data: rolle } = await supabase.from("user_roles").select("role").eq("user_id", user.id).eq("role", "administrator").maybeSingle();
      if (!rolle) { toast({ variant: "destructive", title: "Kein Zugriff", description: "Wartungen sind nur für Administratoren." }); return navigate("/"); }
      await laden();
      const [k, p] = await Promise.all([
        alleZeilen<KundeWahl>((von, bis) => supabase.from("customers").select("id, vorname, nachname, firma, ort").order("nachname").order("id").range(von, bis)),
        supabase.from("projects").select("id, name, customer_id").order("name"),
      ]);
      setKunden(k.data ?? []);
      setProjekte((p.data ?? []) as ProjektWahl[]);
      // Aus einem Projekt kommend: gleich „Neue Wartung“ öffnen
      if (params.get("neu")) setDialog({ wartung: null });
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const heute = heuteISO();
  const gefiltert = useMemo(() => {
    const q = suche.trim().toLowerCase();
    return liste
      .filter((w) => filter === "alle" || (filter === "erledigt" ? w.status === "erledigt" : w.status === "offen"))
      .filter((w) => !q || [w.bezeichnung, kundeText(w.customers), w.projects?.name, w.notiz].filter(Boolean).some((t) => String(t).toLowerCase().includes(q)))
      .sort((a, b) => filter === "erledigt"
        ? (b.erledigt_am ?? "").localeCompare(a.erledigt_am ?? "")
        : a.faellig_am.localeCompare(b.faellig_am));
  }, [liste, filter, suche]);

  const zahl = (f: Filter) => f === "alle" ? liste.length : liste.filter((w) => (f === "erledigt" ? w.status === "erledigt" : w.status === "offen")).length;

  const loeschenBestaetigt = async () => {
    if (!loeschen) return;
    const { error } = await supabase.from("wartungen").delete().eq("id", loeschen.id);
    setLoeschen(null);
    if (error) return toast({ variant: "destructive", title: "Nicht gelöscht", description: error.message });
    toast({ title: "Wartung gelöscht" });
    laden();
  };

  const vorlageOeffnen = async () => {
    setVorlage(await ladeVorlage());
    setVorlageOffen(true);
  };
  const vorlageSpeichern = async () => {
    const { error } = await speichereVorlage(vorlage.trim() || STANDARD_VORLAGE);
    if (error) return toast({ variant: "destructive", title: "Nicht gespeichert", description: error.message });
    toast({ title: "Vorlage gespeichert" });
    setVorlageOffen(false);
  };

  return (
    <div className="kb-page min-h-screen">
      <PageHeader title="Wartungen" backPath="/">
        <Button variant="outline" size="sm" className="gap-1" onClick={vorlageOeffnen}>
          <FileText className="h-4 w-4" />
          <span className="hidden sm:inline">Mail-Vorlage</span>
        </Button>
      </PageHeader>
      <main className="container mx-auto px-3 sm:px-4 lg:px-6 py-4 sm:py-6 space-y-4 max-w-4xl">
        <div className="flex flex-col sm:flex-row gap-2">
          <div className="relative flex-1 min-w-0">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input className="pl-9" placeholder="Suchen: Wartung, Kunde, Projekt …" value={suche} onChange={(e) => setSuche(e.target.value)} />
          </div>
          <Button className="gap-1.5 shrink-0" onClick={() => setDialog({ wartung: null })}>
            <Plus className="h-4 w-4" /> Neue Wartung
          </Button>
        </div>

        <Tabs value={filter} onValueChange={(v) => setFilter(v as Filter)}>
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="anstehend">Anstehend ({zahl("anstehend")})</TabsTrigger>
            <TabsTrigger value="erledigt">Erledigt ({zahl("erledigt")})</TabsTrigger>
            <TabsTrigger value="alle">Alle ({zahl("alle")})</TabsTrigger>
          </TabsList>
        </Tabs>

        {laedt ? (
          <p className="text-muted-foreground text-center py-8">Lädt …</p>
        ) : gefiltert.length === 0 ? (
          <Card>
            <CardContent className="py-10 text-center text-muted-foreground space-y-2">
              <Wrench className="h-10 w-10 mx-auto opacity-40" />
              <p>{liste.length === 0 ? "Noch keine Wartungen eingetragen." : "Keine Wartungen in dieser Ansicht."}</p>
              {liste.length === 0 && <p className="text-sm">Mit „Neue Wartung“ eintragen, wann sie fällig ist und wie früh erinnert werden soll.</p>}
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-2">
            {gefiltert.map((w) => {
              const s = stufe(w, heute);
              return (
                <Card key={w.id} className={`border-l-4 ${STUFE_FARBE[s].rand}`}>
                  <CardContent className="p-3 sm:p-4 space-y-2">
                    <div className="flex flex-col-reverse sm:flex-row items-start gap-1 sm:gap-2">
                      <div className="min-w-0 flex-1">
                        <p className="font-semibold break-words">{w.bezeichnung}</p>
                        <p className="text-sm text-muted-foreground break-words">
                          {[kundeText(w.customers), w.projects?.name].filter(Boolean).join(" · ") || "ohne Kunde"}
                        </p>
                      </div>
                      <div className="sm:text-right shrink-0 flex sm:block items-center gap-2">
                        <Badge className={STUFE_FARBE[s].badge}>
                          {s === "erledigt" ? `Erledigt ${datumAT(w.erledigt_am)}` : s === "geplant" ? STUFE_FARBE[s].text : restText(w.faellig_am, heute)}
                        </Badge>
                        <p className="text-xs text-muted-foreground sm:mt-1">fällig {datumAT(w.faellig_am)}</p>
                      </div>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {intervallText(w.intervall_monate)} · Erinnerung {vorlaufText(w.vorlauf_tage)}
                      {w.preis != null ? ` · ${eur(w.preis)} netto` : ""}
                      {w.mail_gesendet_am ? ` · Mail geschickt ${datumAT(w.mail_gesendet_am.slice(0, 10))}` : ""}
                    </p>
                    {w.notiz && <p className="text-sm break-words whitespace-pre-wrap">{w.notiz}</p>}
                    <div className="flex flex-wrap items-center gap-2">
                      <div className="flex-1 min-w-0"><WartungAktionen w={w} onGeaendert={laden} kompakt /></div>
                      <Button size="sm" variant="ghost" className="gap-1" onClick={() => setDialog({ wartung: w })}>
                        <Pencil className="h-4 w-4" /> Ändern
                      </Button>
                      <Button size="sm" variant="ghost" aria-label="Wartung löschen" onClick={() => setLoeschen(w)}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </main>

      <WartungDialog
        open={!!dialog}
        onOpenChange={(o) => !o && setDialog(null)}
        wartung={dialog?.wartung ?? null}
        kunden={kunden}
        projekte={projekte}
        vorgabe={{ project_id: params.get("projekt"), customer_id: params.get("kunde") }}
        onGespeichert={laden}
      />

      <AlertDialog open={!!loeschen} onOpenChange={(o) => !o && setLoeschen(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Wartung löschen?</AlertDialogTitle>
            <AlertDialogDescription>
              „{loeschen?.bezeichnung}“ wird entfernt. Eine schon erstellte Rechnung bleibt erhalten.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Abbrechen</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={loeschenBestaetigt}>Löschen</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={vorlageOffen} onOpenChange={setVorlageOffen}>
        <DialogContent className="max-w-[calc(100vw-1.5rem)] sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Mail-Vorlage für Wartungen</DialogTitle>
            <DialogDescription>
              Platzhalter: {"{kunde}"}, {"{wartung}"}, {"{faellig}"}, {"{projekt}"}. Die erste Zeile „Betreff: …“ wird zum Betreff.
              Vor dem Senden lässt sich jede Mail noch ändern.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="wartung-vorlage" className="sr-only">Vorlage</Label>
            <Textarea id="wartung-vorlage" value={vorlage} onChange={(e) => setVorlage(e.target.value)} rows={12} />
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setVorlage(STANDARD_VORLAGE)}>Standard</Button>
            <Button onClick={vorlageSpeichern}>Speichern</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default Wartungen;
