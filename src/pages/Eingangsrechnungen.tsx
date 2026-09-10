import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  Receipt, Search, Loader2, Plus, FileText, Check, AlertTriangle, Mail as MailIcon,
  Trash2, FolderKanban, Calendar, Sparkles,
} from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { getSessionUser } from "@/lib/auth";
import { projectLabel } from "@/lib/projectLabel";
import { eur, datum, heuteISO, parseZahl, zahl } from "@/lib/faktura";
import { anhangUrl, ER_STATUS_KLASSE, ER_STATUS_LABEL, type Eingangsrechnung, type ErStatus } from "@/lib/postfach";
import { cn } from "@/lib/utils";

type ProjektOpt = { id: string; name: string; plz: string | null; adresse: string | null; status: string };

const leer = () => ({
  lieferant: "", nummer: "", datum: heuteISO(), faellig_am: "", netto: "", ust: "", brutto: "",
  iban: "", verwendungszweck: "", skonto_prozent: "", skonto_bis: "", notiz: "", project_id: "",
});
type Formular = ReturnType<typeof leer>;

const ANSICHTEN: { key: string; label: string; passt: (r: Eingangsrechnung) => boolean }[] = [
  { key: "offen", label: "Zu prüfen", passt: (r) => r.status === "offen" },
  { key: "zahlen", label: "Zu zahlen", passt: (r) => r.status === "offen" || r.status === "geprueft" },
  { key: "bezahlt", label: "Bezahlt", passt: (r) => r.status === "bezahlt" },
  { key: "alle", label: "Alle", passt: () => true },
];

/**
 * Eingangsrechnungen — was der Betrieb selbst zu zahlen hat.
 *
 * Die meisten kommen automatisch aus dem Postfach: Beträge, Nummer und
 * Fälligkeit werden beim Abholen aus Mail und PDF gelesen. Weil das nie
 * hundertprozentig ist, steht jede neue Rechnung zuerst auf „Zu prüfen“ —
 * erst die Freigabe macht sie zur geprüften Zahlung.
 */
export default function Eingangsrechnungen() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [params, setParams] = useSearchParams();

  const [liste, setListe] = useState<Eingangsrechnung[]>([]);
  const [projekte, setProjekte] = useState<ProjektOpt[]>([]);
  const [laden, setLaden] = useState(true);
  const [ansicht, setAnsicht] = useState("zahlen");
  const [suche, setSuche] = useState("");
  const [offenId, setOffenId] = useState<string | null>(params.get("offen"));
  const [form, setForm] = useState<Formular>(leer());
  const [neuOpen, setNeuOpen] = useState(false);
  const [speichert, setSpeichert] = useState(false);
  const [loeschId, setLoeschId] = useState<string | null>(null);
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);

  const laden_ = useCallback(async () => {
    const [{ data: r, error }, { data: p }] = await Promise.all([
      supabase.from("eingangsrechnungen").select("*").order("datum", { ascending: false }).limit(2000),
      supabase.from("projects").select("id, name, plz, adresse, status").order("name"),
    ]);
    if (error) toast({ variant: "destructive", title: "Nicht geladen", description: error.message });
    setListe((r ?? []) as unknown as Eingangsrechnung[]);
    setProjekte((p ?? []) as ProjektOpt[]);
    setLaden(false);
  }, [toast]);

  useEffect(() => { laden_(); }, [laden_]);

  const offen = liste.find((r) => r.id === offenId) ?? null;

  // Formular mit der geöffneten Rechnung füllen
  useEffect(() => {
    if (!offen) { setPdfUrl(null); return; }
    setForm({
      lieferant: offen.lieferant ?? "", nummer: offen.nummer ?? "", datum: offen.datum ?? "",
      faellig_am: offen.faellig_am ?? "", netto: offen.netto != null ? zahl(offen.netto) : "",
      ust: offen.ust != null ? zahl(offen.ust) : "", brutto: offen.brutto != null ? zahl(offen.brutto) : "",
      iban: offen.iban ?? "", verwendungszweck: offen.verwendungszweck ?? "",
      skonto_prozent: offen.skonto_prozent != null ? zahl(offen.skonto_prozent) : "",
      skonto_bis: offen.skonto_bis ?? "", notiz: offen.notiz ?? "", project_id: offen.project_id ?? "",
    });
    if (offen.pdf_pfad) anhangUrl(offen.pdf_pfad, 60).then(setPdfUrl);
    else setPdfUrl(null);
  }, [offen]);

  const gefiltert = useMemo(() => {
    const a = ANSICHTEN.find((x) => x.key === ansicht) ?? ANSICHTEN[3];
    const s = suche.trim().toLowerCase();
    return liste
      .filter((r) => a.passt(r) && (!s || [r.lieferant, r.nummer, r.verwendungszweck].some((t) => (t ?? "").toLowerCase().includes(s))))
      .sort((x, y) => {
        // Zu Zahlendes nach Fälligkeit, alles andere nach Datum
        if (ansicht === "zahlen") return (x.faellig_am ?? "9999").localeCompare(y.faellig_am ?? "9999");
        return (y.datum ?? "").localeCompare(x.datum ?? "");
      });
  }, [liste, ansicht, suche]);

  const summen = useMemo(() => {
    const zuZahlen = liste.filter((r) => r.status === "offen" || r.status === "geprueft");
    const heute = heuteISO();
    return {
      zuPruefen: liste.filter((r) => r.status === "offen").length,
      offenBetrag: zuZahlen.reduce((s, r) => s + Number(r.brutto ?? 0), 0),
      faellig: zuZahlen.filter((r) => r.faellig_am && r.faellig_am <= heute),
      monat: liste.filter((r) => (r.datum ?? "").slice(0, 7) === heute.slice(0, 7)).reduce((s, r) => s + Number(r.brutto ?? 0), 0),
    };
  }, [liste]);

  const speichern = async () => {
    if (!form.lieferant.trim()) return toast({ variant: "destructive", title: "Lieferant fehlt" });
    setSpeichert(true);
    const werte = {
      lieferant: form.lieferant.trim(),
      nummer: form.nummer.trim() || null,
      datum: form.datum || null,
      faellig_am: form.faellig_am || null,
      netto: parseZahl(form.netto), ust: parseZahl(form.ust), brutto: parseZahl(form.brutto),
      iban: form.iban.replace(/\s+/g, "") || null,
      verwendungszweck: form.verwendungszweck.trim() || null,
      skonto_prozent: parseZahl(form.skonto_prozent), skonto_bis: form.skonto_bis || null,
      notiz: form.notiz.trim() || null,
      project_id: form.project_id || null,
    };
    if (offen) {
      const { error } = await supabase.from("eingangsrechnungen").update(werte).eq("id", offen.id);
      setSpeichert(false);
      if (error) return toast({ variant: "destructive", title: "Nicht gespeichert", description: error.message });
      toast({ title: "Gespeichert" });
    } else {
      const user = await getSessionUser();
      const { error } = await supabase.from("eingangsrechnungen").insert({ ...werte, quelle: "manuell", erkannt_von: "manuell", created_by: user?.id ?? null });
      setSpeichert(false);
      if (error) return toast({ variant: "destructive", title: "Nicht angelegt", description: error.message });
      setNeuOpen(false);
      toast({ title: "Eingangsrechnung angelegt" });
    }
    await laden_();
  };

  const status = async (r: Eingangsrechnung, neu: ErStatus) => {
    const werte: Record<string, unknown> = { status: neu };
    if (neu === "bezahlt" && !r.bezahlt_am) werte.bezahlt_am = heuteISO();
    if (neu !== "bezahlt") werte.bezahlt_am = null;
    setListe((l) => l.map((x) => (x.id === r.id ? { ...x, ...werte } as Eingangsrechnung : x)));
    const { error } = await supabase.from("eingangsrechnungen").update(werte).eq("id", r.id);
    if (error) { toast({ variant: "destructive", title: "Nicht gespeichert", description: error.message }); laden_(); }
    else if (neu === "bezahlt") toast({ title: "Als bezahlt vermerkt", description: `${r.lieferant}${r.brutto ? ` · ${eur(Number(r.brutto))}` : ""}` });
  };

  const loeschen = async () => {
    if (!loeschId) return;
    const { error } = await supabase.from("eingangsrechnungen").delete().eq("id", loeschId);
    setLoeschId(null);
    if (error) return toast({ variant: "destructive", title: "Nicht gelöscht", description: error.message });
    if (offenId === loeschId) setOffenId(null);
    toast({ title: "Eingangsrechnung gelöscht", description: "Die Mail bleibt im Postfach erhalten." });
    laden_();
  };

  const heute = heuteISO();
  const istUeberfaellig = (r: Eingangsrechnung) => !!r.faellig_am && r.faellig_am < heute && r.status !== "bezahlt" && r.status !== "abgelehnt";
  const projektName = (id: string | null) => { const p = projekte.find((x) => x.id === id); return p ? projectLabel(p as never) : ""; };
  const unvollstaendig = (r: Eingangsrechnung) => !r.brutto || !r.nummer || !r.faellig_am;

  const felder = (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
      <div className="space-y-1.5 sm:col-span-2">
        <Label htmlFor="er-lieferant">Lieferant</Label>
        <Input id="er-lieferant" value={form.lieferant} onChange={(e) => setForm({ ...form, lieferant: e.target.value })} />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="er-nummer">Rechnungsnummer</Label>
        <Input id="er-nummer" value={form.nummer} onChange={(e) => setForm({ ...form, nummer: e.target.value })} />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="er-datum">Rechnungsdatum</Label>
        <Input id="er-datum" type="date" value={form.datum} onChange={(e) => setForm({ ...form, datum: e.target.value })} />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="er-netto">Netto €</Label>
        <Input id="er-netto" inputMode="decimal" value={form.netto} onChange={(e) => setForm({ ...form, netto: e.target.value })} placeholder="0,00" />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="er-ust">USt €</Label>
        <Input id="er-ust" inputMode="decimal" value={form.ust} onChange={(e) => setForm({ ...form, ust: e.target.value })} placeholder="0,00" />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="er-brutto">Brutto € <span className="text-muted-foreground font-normal">— das ist der Zahlbetrag</span></Label>
        <Input id="er-brutto" inputMode="decimal" value={form.brutto} onChange={(e) => setForm({ ...form, brutto: e.target.value })} placeholder="0,00" className="font-medium" />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="er-faellig">Zahlbar bis</Label>
        <Input id="er-faellig" type="date" value={form.faellig_am} onChange={(e) => setForm({ ...form, faellig_am: e.target.value })} />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="er-skonto">Skonto %</Label>
        <Input id="er-skonto" inputMode="decimal" value={form.skonto_prozent} onChange={(e) => setForm({ ...form, skonto_prozent: e.target.value })} placeholder="z. B. 3" />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="er-skontobis">Skonto bis</Label>
        <Input id="er-skontobis" type="date" value={form.skonto_bis} onChange={(e) => setForm({ ...form, skonto_bis: e.target.value })} />
      </div>
      <div className="space-y-1.5 sm:col-span-2">
        <Label htmlFor="er-iban">IBAN</Label>
        <Input id="er-iban" value={form.iban} onChange={(e) => setForm({ ...form, iban: e.target.value })} placeholder="AT.." />
      </div>
      <div className="space-y-1.5 sm:col-span-2">
        <Label htmlFor="er-zweck">Verwendungszweck</Label>
        <Input id="er-zweck" value={form.verwendungszweck} onChange={(e) => setForm({ ...form, verwendungszweck: e.target.value })} />
      </div>
      <div className="space-y-1.5 sm:col-span-2">
        <Label>Projekt <span className="text-muted-foreground font-normal">— für die Nachkalkulation</span></Label>
        <Select value={form.project_id || "keins"} onValueChange={(v) => setForm({ ...form, project_id: v === "keins" ? "" : v })}>
          <SelectTrigger><SelectValue placeholder="Keinem Projekt" /></SelectTrigger>
          <SelectContent className="max-h-64">
            <SelectItem value="keins">Keinem Projekt</SelectItem>
            {projekte.map((p) => <SelectItem key={p.id} value={p.id}>{projectLabel(p as never)}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-1.5 sm:col-span-2">
        <Label htmlFor="er-notiz">Notiz</Label>
        <Textarea id="er-notiz" rows={2} value={form.notiz} onChange={(e) => setForm({ ...form, notiz: e.target.value })} />
      </div>
    </div>
  );

  return (
    <div className="kb-page min-h-screen">
      <PageHeader
        title="Eingangsrechnungen"
        backPath="/"
        rightActions={
          <>
            <Button size="sm" variant="outline" className="gap-1.5" onClick={() => navigate("/postfach?filter=rechnungen")}>
              <MailIcon className="h-4 w-4" /><span className="hidden sm:inline">Postfach</span>
            </Button>
            <Button size="sm" className="gap-1.5" onClick={() => { setOffenId(null); setForm(leer()); setNeuOpen(true); }}>
              <Plus className="h-4 w-4" /><span className="hidden sm:inline">Neu</span>
            </Button>
          </>
        }
      />
      <main className="container mx-auto px-3 sm:px-4 lg:px-6 py-4 space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Card><CardContent className="p-4">
            <div className="text-xs uppercase tracking-wide text-muted-foreground">Noch zu zahlen</div>
            <div className="text-2xl font-bold tabular-nums">{eur(summen.offenBetrag)}</div>
          </CardContent></Card>
          <Card className={summen.faellig.length ? "border-red-300" : undefined}><CardContent className="p-4">
            <div className="text-xs uppercase tracking-wide text-muted-foreground">Überfällig</div>
            <div className={cn("text-2xl font-bold tabular-nums", summen.faellig.length && "text-red-600 dark:text-red-400")}>
              {summen.faellig.length}
            </div>
          </CardContent></Card>
          <Card><CardContent className="p-4">
            <div className="text-xs uppercase tracking-wide text-muted-foreground">Zu prüfen</div>
            <div className="text-2xl font-bold tabular-nums">{summen.zuPruefen}</div>
          </CardContent></Card>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input value={suche} onChange={(e) => setSuche(e.target.value)} placeholder="Lieferant, Nummer…" className="pl-8" />
          </div>
          <div className="flex flex-wrap gap-1.5">
            {ANSICHTEN.map((a) => (
              <button key={a.key} type="button" onClick={() => setAnsicht(a.key)}
                className={cn("rounded-md border px-2.5 py-1.5 text-sm transition-colors", ansicht === a.key ? "border-primary bg-primary/10 font-medium" : "hover:bg-accent/50")}>
                {a.label} <span className="text-xs text-muted-foreground tabular-nums">{liste.filter(a.passt).length}</span>
              </button>
            ))}
          </div>
        </div>

        {laden && <div className="p-8 text-center text-sm text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin mx-auto mb-2" />Wird geladen…</div>}
        {!laden && gefiltert.length === 0 && (
          <div className="rounded-md border p-8 text-center text-sm text-muted-foreground">
            <Receipt className="h-8 w-8 mx-auto mb-2 opacity-40" />
            {liste.length === 0 ? "Noch keine Eingangsrechnungen — sie kommen automatisch aus dem Postfach." : "In dieser Ansicht ist nichts."}
          </div>
        )}

        <div className="space-y-2">
          {gefiltert.map((r) => (
            <div key={r.id} className={cn("rounded-md border p-3", istUeberfaellig(r) && "border-red-300 bg-red-50/50 dark:bg-red-950/20")}>
              <div className="flex flex-wrap items-start gap-2">
                <button type="button" className="flex-1 min-w-0 text-left" onClick={() => setOffenId(r.id)}>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium truncate">{r.lieferant}</span>
                    {r.nummer && <span className="text-sm text-muted-foreground">Nr. {r.nummer}</span>}
                    <Badge variant="outline" className={cn("text-[11px] font-normal", ER_STATUS_KLASSE[r.status])}>{ER_STATUS_LABEL[r.status]}</Badge>
                    {r.erkannt_von === "ki" && (
                      <Badge variant="outline" className="text-[11px] font-normal gap-1 text-muted-foreground"><Sparkles className="h-3 w-3" />automatisch gelesen</Badge>
                    )}
                    {unvollstaendig(r) && r.status === "offen" && (
                      <Badge variant="outline" className="text-[11px] font-normal gap-1 border-amber-400 text-amber-700 dark:text-amber-300"><AlertTriangle className="h-3 w-3" />ergänzen</Badge>
                    )}
                  </div>
                  <div className="text-xs text-muted-foreground mt-0.5 flex flex-wrap gap-x-3">
                    <span>Datum {datum(r.datum)}</span>
                    {r.faellig_am && <span className={cn(istUeberfaellig(r) && "font-medium text-red-600 dark:text-red-400")}>zahlbar bis {datum(r.faellig_am)}</span>}
                    {r.skonto_prozent ? <span>{zahl(r.skonto_prozent)} % Skonto bis {datum(r.skonto_bis)}</span> : null}
                    {r.project_id && <span className="inline-flex items-center gap-1"><FolderKanban className="h-3 w-3" />{projektName(r.project_id)}</span>}
                    {r.bezahlt_am && <span>bezahlt {datum(r.bezahlt_am)}</span>}
                  </div>
                </button>
                <div className="text-right shrink-0">
                  <div className="text-lg font-bold tabular-nums">{r.brutto != null ? eur(Number(r.brutto)) : "—"}</div>
                  {r.netto != null && <div className="text-xs text-muted-foreground tabular-nums">netto {eur(Number(r.netto))}</div>}
                </div>
              </div>
              <div className="flex flex-wrap gap-1.5 mt-2">
                {r.status === "offen" && <Button size="sm" variant="outline" className="gap-1.5" onClick={() => status(r, "geprueft")}><Check className="h-3.5 w-3.5" />Geprüft</Button>}
                {r.status !== "bezahlt" && <Button size="sm" variant="outline" className="gap-1.5" onClick={() => status(r, "bezahlt")}><Check className="h-3.5 w-3.5" />Bezahlt</Button>}
                {r.status === "bezahlt" && <Button size="sm" variant="ghost" onClick={() => status(r, "geprueft")}>Doch nicht bezahlt</Button>}
                <Button size="sm" variant="ghost" onClick={() => setOffenId(r.id)}>Bearbeiten</Button>
                {r.mail_id && <Button size="sm" variant="ghost" className="gap-1.5" onClick={() => navigate(`/postfach?mail=${r.mail_id}`)}><MailIcon className="h-3.5 w-3.5" />Mail</Button>}
              </div>
            </div>
          ))}
        </div>
      </main>

      {/* Bearbeiten */}
      <Dialog open={!!offen} onOpenChange={(o) => { if (!o) { setOffenId(null); setParams({}); } }}>
        <DialogContent className="max-w-[calc(100vw-1rem)] sm:max-w-3xl max-h-[92dvh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Eingangsrechnung prüfen</DialogTitle>
            <DialogDescription>
              {offen?.erkannt_von === "ki"
                ? "Die Werte wurden automatisch aus Mail und PDF gelesen — bitte gegen das Original prüfen."
                : "Angaben zur Rechnung."}
            </DialogDescription>
          </DialogHeader>
          <div className={cn("grid gap-4", pdfUrl && "lg:grid-cols-[minmax(0,1fr)_minmax(0,420px)]")}>
            <div className="space-y-4">
              {felder}
              <div className="flex flex-wrap gap-2">
                <Button onClick={speichern} disabled={speichert} className="gap-2">
                  {speichert ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}Speichern
                </Button>
                {offen?.status === "offen" && (
                  <Button variant="outline" onClick={async () => { await speichern(); if (offen) status(offen, "geprueft"); }}>Speichern und freigeben</Button>
                )}
                <Button variant="ghost" className="gap-1.5 text-destructive" onClick={() => setLoeschId(offen?.id ?? null)}>
                  <Trash2 className="h-4 w-4" />Löschen
                </Button>
              </div>
            </div>
            {pdfUrl && (
              <div className="space-y-2">
                <div className="text-xs font-medium text-muted-foreground">Rechnung als PDF</div>
                <iframe src={pdfUrl} title="Rechnung" className="w-full h-[60vh] rounded-md border bg-white" />
                <Button variant="outline" size="sm" className="w-full gap-1.5" onClick={() => window.open(pdfUrl, "_blank", "noopener")}>
                  <FileText className="h-4 w-4" />In neuem Fenster öffnen
                </Button>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Neu */}
      <Dialog open={neuOpen} onOpenChange={setNeuOpen}>
        <DialogContent className="max-w-[calc(100vw-1rem)] sm:max-w-xl max-h-[92dvh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Eingangsrechnung erfassen</DialogTitle>
            <DialogDescription>Für Rechnungen, die nicht per Mail gekommen sind — etwa auf Papier.</DialogDescription>
          </DialogHeader>
          {felder}
          <DialogFooter>
            <Button variant="outline" onClick={() => setNeuOpen(false)}>Abbrechen</Button>
            <Button onClick={speichern} disabled={speichert} className="gap-2">
              {speichert ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}Anlegen
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!loeschId} onOpenChange={(o) => !o && setLoeschId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Eingangsrechnung löschen?</AlertDialogTitle>
            <AlertDialogDescription>
              Nur der Eintrag hier verschwindet. Die Mail und das PDF bleiben im Postfach erhalten.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Abbrechen</AlertDialogCancel>
            <AlertDialogAction onClick={loeschen}>Löschen</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
