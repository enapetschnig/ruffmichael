import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Plus, Search, FileText, Receipt, AlertCircle, Layers, FileCheck, Download } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { getSessionUser } from "@/lib/auth";
import { customerDisplayName } from "@/pages/Customers";
import { BelegExport } from "@/components/BelegExport";
import { Auswahl } from "@/components/Auswahl";
import { KundenAuswahl, type Kunde } from "@/components/kunde/KundenAuswahl";
import { projectLabel } from "@/lib/projectLabel";
import { alleZeilen } from "@/lib/alleZeilen";
import { cn } from "@/lib/utils";
import {
  TYP_LABEL, STATUS_LABEL, STATUS_VARIANT, eur, datum, heuteISO, istRechnung, istAngebot, offen,
  ladeFirmendaten, belegEntwurfAnlegen, type Beleg, type BelegTyp,
} from "@/lib/faktura";

type KundeOpt = { id: string; kundennr: string | null; vorname: string | null; nachname: string; firma: string | null; strasse: string | null; ort: string | null; uid: string | null; ist_unternehmer: boolean; reverse_charge: boolean; zahlungsziel_tage: number | null; email: string | null };
type ProjektOpt = { id: string; name: string; plz: string | null; adresse: string | null; customer_id: string | null; status: string; customers: { strasse: string | null; ort: string | null } | null };

// Belegarten als Karten statt Aufklappliste — man sieht sofort, wofür jede da ist.
const NEU_TYPEN: { typ: BelegTyp; icon: React.ReactNode; text: string }[] = [
  { typ: "angebot", icon: <FileText className="h-5 w-5" />, text: "Preisvorschlag an den Kunden — wird später mit einem Klick zur Rechnung" },
  { typ: "rechnung", icon: <Receipt className="h-5 w-5" />, text: "Abrechnung einer fertigen Leistung — Stunden und Regieberichte lassen sich holen" },
  { typ: "teilrechnung", icon: <Layers className="h-5 w-5" />, text: "Abschlag nach Baufortschritt — der Rest kommt auf die Schlussrechnung" },
  { typ: "schlussrechnung", icon: <FileCheck className="h-5 w-5" />, text: "Abschluss eines Projekts — zieht erstellte Teilrechnungen automatisch ab" },
];
const kundeName = (k: KundeOpt) => k.firma?.trim() || customerDisplayName({ vorname: k.vorname ?? "", nachname: k.nachname });

/** Liste aller Angebote und Rechnungen (nur Admin). */
const Belege = () => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [params, setParams] = useSearchParams();
  const [belege, setBelege] = useState<Beleg[]>([]);
  const [loading, setLoading] = useState(true);
  const tab = params.get("tab");
  const filter = tab === "angebote" || tab === "rechnungen" || tab === "offen" || tab === "entwuerfe" ? tab : "alle";
  const setFilter = (value: string) => {
    const next = new URLSearchParams(params);
    if (value === "alle") next.delete("tab");
    else next.set("tab", value);
    setParams(next, { replace: true });
  };
  const [suche, setSuche] = useState("");
  const [neuOpen, setNeuOpen] = useState(false);
  const [kunden, setKunden] = useState<KundeOpt[]>([]);
  const [projekte, setProjekte] = useState<ProjektOpt[]>([]);
  const [neu, setNeu] = useState<{ typ: BelegTyp; kunde: string; projekt: string }>({ typ: "angebot", kunde: params.get("kunde") ?? "", projekt: params.get("projekt") ?? "" });
  const [anlegen, setAnlegen] = useState(false);
  // Neuen Kunden direkt aus dem Beleg-Dialog anlegen (wenn er noch nicht existiert)
  // Gewählter Kunde als ganzer Datensatz — auch ein gerade neu angelegter, der noch nicht in „kunden“ steht
  const [gewaehlterKunde, setGewaehlterKunde] = useState<Kunde | null>(null);
  const [exportOpen, setExportOpen] = useState(false);
  // Aus der Projektübersicht / Kundenliste kommend: nur die passenden Belege
  const projektFilter = params.get("projekt");
  const kundeFilter = params.get("kunde");
  // Firmendaten unvollständig → Hinweis, bevor die erste Rechnung rausgeht
  const [firmaFehlt, setFirmaFehlt] = useState<string[]>([]);

  useEffect(() => {
    (async () => {
      const user = await getSessionUser();
      if (!user) return navigate("/auth");
      const { data: rolle, error: rolleFehler } = await supabase.from("user_roles").select("role").eq("user_id", user.id).eq("role", "administrator").maybeSingle();
      // Ohne Netz keine falsche Diagnose: Belege brauchen eine Verbindung (kein Offline-Cache, Preise)
      if (rolleFehler || (typeof navigator !== "undefined" && !navigator.onLine)) {
        toast({ title: "Nur mit Internet", description: "Angebote & Rechnungen brauchen eine Internetverbindung." });
        return navigate("/");
      }
      if (!rolle) { toast({ variant: "destructive", title: "Kein Zugriff", description: "Angebote und Rechnungen sind nur für Administratoren." }); return navigate("/"); }
      await laden();
      const [k, p] = await Promise.all([
        alleZeilen<KundeOpt>((von, bis) => supabase.from("customers").select("id, kundennr, vorname, nachname, firma, strasse, ort, uid, ist_unternehmer, reverse_charge, zahlungsziel_tage, email").order("nachname").order("id").range(von, bis)),
        supabase.from("projects").select("id, name, plz, adresse, customer_id, status, customers(strasse, ort)").order("name"),
      ]);
      setKunden((k.data as KundeOpt[]) ?? []);
      setProjekte((p.data as unknown as ProjektOpt[]) ?? []);
      const f = await ladeFirmendaten();
      const fehlt: string[] = [];
      if (!f?.uid) fehlt.push("UID");
      if (!f?.iban) fehlt.push("IBAN");
      if (!f?.strasse || !f?.plz_ort) fehlt.push("Adresse");
      setFirmaFehlt(fehlt);
      if (params.get("neu")) setNeuOpen(true);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const laden = async () => {
    setLoading(true);
    // Seitenweise laden — PostgREST liefert höchstens 1000 Zeilen je Anfrage, und Michael hat viele Belege
    const alle: Beleg[] = [];
    for (let von = 0; ; von += 1000) {
      // Ohne id als zweites Kriterium überlappen sich die Seiten bei gleichem Zeitstempel (KingBill-Import) → doppelte Zeilen.
      // Die langen Texte (Einleitung, Schlusstext, Notizen) braucht die Liste nicht — spart bei 6.600 Belegen Sekunden.
      const { data, error } = await supabase.from("belege")
        .select("id, typ, status, nummer, jahr, laufnummer, project_id, customer_id, vorgaenger_id, kunde_name, kunde_zusatz, kunde_strasse, kunde_plz_ort, kunde_uid, kunde_email, datum, leistung_von, leistung_bis, faellig_am, gueltig_bis, betreff, reverse_charge, ust_satz, skonto_prozent, skonto_tage, netto, ust, brutto, bezahlt, pdf_pfad, festgeschrieben_am, gesendet_am, storniert_durch, created_by, created_at, updated_at, kreis")
        .order("datum", { ascending: false }).order("created_at", { ascending: false }).order("id").range(von, von + 999);
      if (error) { toast({ variant: "destructive", title: "Belege nicht geladen", description: error.message }); break; }
      alle.push(...((data ?? []) as unknown as Beleg[]));
      if (!data || data.length < 1000) break;
    }
    setBelege(alle);
    setLoading(false);
  };

  // Projekt gewählt → Kunde des Projekts vorschlagen (nur wenn noch keiner gewählt)
  useEffect(() => {
    if (!neu.projekt || neu.kunde) return;
    const p = projekte.find((x) => x.id === neu.projekt);
    if (p?.customer_id) setNeu((n) => ({ ...n, kunde: p.customer_id! }));
  }, [neu.projekt, neu.kunde, projekte]);
  const projektKundeWeicht = useMemo(() => {
    const p = projekte.find((x) => x.id === neu.projekt);
    return !!(p?.customer_id && neu.kunde && p.customer_id !== neu.kunde);
  }, [neu.projekt, neu.kunde, projekte]);

  // Basis = nach Projekt/Kunde gefiltert (für Kennzahlen UND Liste)
  const basis = useMemo(() => belege.filter((b) =>
    (!projektFilter || b.project_id === projektFilter) && (!kundeFilter || b.customer_id === kundeFilter)
  ), [belege, projektFilter, kundeFilter]);

  const gefiltert = useMemo(() => {
    const q = suche.trim().toLowerCase();
    return basis.filter((b) => {
      if (filter === "angebote" && !istAngebot(b.typ)) return false;
      if (filter === "rechnungen" && !istRechnung(b.typ) && b.typ !== "gutschrift") return false;
      if (filter === "offen" && offen(b) <= 0) return false;
      if (filter === "entwuerfe" && b.status !== "entwurf") return false;
      if (!q) return true;
      return [b.nummer, b.kunde_name, b.betreff, TYP_LABEL[b.typ]].filter(Boolean).some((v) => String(v).toLowerCase().includes(q));
    // Nach Nummer sortiert (neueste zuerst), Entwürfe ohne Nummer ganz oben — wie in KingBill
    }).sort((a, b) => {
      if (!a.nummer !== !b.nummer) return a.nummer ? 1 : -1;
      if (!a.nummer) return (b.created_at ?? "").localeCompare(a.created_at ?? "");
      return (b.jahr ?? 0) - (a.jahr ?? 0) || (b.laufnummer ?? 0) - (a.laufnummer ?? 0) || String(b.nummer).localeCompare(String(a.nummer));
    });
  }, [basis, filter, suche]);

  const offenSumme = basis.reduce((s, b) => s + offen(b), 0);
  const entwuerfe = basis.filter((b) => b.status === "entwurf").length;
  const monat = heuteISO().slice(0, 7);
  const umsatzMonat = basis.filter((b) => istRechnung(b.typ) && b.status !== "entwurf" && b.status !== "storniert" && b.datum.startsWith(monat)).reduce((s, b) => s + Number(b.netto), 0);
  const gefiltertHinweis = projektFilter || kundeFilter ? " (gefiltert)" : "";

  const belegAnlegen = async () => {
    const k = (gewaehlterKunde?.id === neu.kunde ? gewaehlterKunde : null) ?? kunden.find((x) => x.id === neu.kunde);
    if (!k) return toast({ variant: "destructive", title: "Kunde fehlt", description: "Bitte einen Kunden wählen." });
    if (anlegen) return;
    setAnlegen(true);
    const user = await getSessionUser();
    const { beleg: data, error } = await belegEntwurfAnlegen({
      typ: neu.typ,
      kunde: k,
      projektId: neu.projekt || null,
      betreff: neu.projekt ? projectLabel(projekte.find((p) => p.id === neu.projekt) as never) : null,
      userId: user?.id ?? null,
    });
    if (error || !data) { setAnlegen(false); return toast({ variant: "destructive", title: "Fehler", description: error }); }

    // Schlussrechnung: festgeschriebene Teilrechnungen desselben Projekts automatisch abziehen
    if (neu.typ === "schlussrechnung" && neu.projekt) {
      const { data: teile } = await supabase.from("belege").select("id, nummer, datum, netto")
        .eq("project_id", neu.projekt).eq("typ", "teilrechnung").not("status", "in", "(entwurf,storniert)").order("datum");
      if (teile?.length) {
        await supabase.from("beleg_positionen").insert(teile.map((t, i) => ({
          beleg_id: data.id, pos: 900 + i, text: `abzüglich Teilrechnung ${t.nummer} vom ${datum(t.datum)}`,
          menge: 1, einheit: "psch", einzelpreis: -Number(t.netto), quelle_typ: "teilrechnung", quelle_ids: [t.id],
        })));
      }
    }
    setAnlegen(false);
    setNeuOpen(false);
    navigate(`/belege/${data.id}`);
  };

  const filterKunde = kundeFilter ? kunden.find((x) => x.id === kundeFilter) : null;

  return (
    <div className="kb-page min-h-screen">
      <PageHeader title="Angebote & Rechnungen" backPath="/" />
      <main className="container mx-auto px-3 sm:px-4 lg:px-6 py-4 sm:py-6 space-y-4">
        {firmaFehlt.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 rounded-md border border-amber-300 bg-amber-50 dark:bg-amber-950/30 p-3 text-sm">
            <AlertCircle className="h-4 w-4 shrink-0 text-amber-600" />
            <span className="flex-1 min-w-0">Firmendaten unvollständig ({firmaFehlt.join(", ")}) — Pflichtangaben auf jeder Rechnung.</span>
            <Button size="sm" variant="outline" onClick={() => navigate("/admin")}>Jetzt eintragen</Button>
          </div>
        )}
        {projektFilter && (
          <div className="flex flex-wrap items-center gap-2 rounded-md border bg-muted/40 p-3 text-sm">
            <span className="flex-1 min-w-0">Nur Belege des Projekts <b>{projectLabel((projekte.find((p) => p.id === projektFilter) ?? { name: "…" }) as never)}</b></span>
            <Button size="sm" variant="ghost" onClick={() => navigate("/belege")}>Alle Belege</Button>
          </div>
        )}
        {kundeFilter && (
          <div className="flex flex-wrap items-center gap-2 rounded-md border bg-muted/40 p-3 text-sm">
            <span className="flex-1 min-w-0">Nur Belege von <b>{filterKunde ? kundeName(filterKunde) : "…"}</b></span>
            <Button size="sm" variant="ghost" onClick={() => navigate("/belege")}>Alle Belege</Button>
          </div>
        )}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Card><CardContent className="p-4"><div className="text-xs uppercase tracking-wide text-muted-foreground">Offene Forderungen{gefiltertHinweis}</div><div className="text-2xl font-bold tabular-nums">{eur(offenSumme)}</div></CardContent></Card>
          <Card><CardContent className="p-4"><div className="text-xs uppercase tracking-wide text-muted-foreground">Umsatz netto {new Date().toLocaleDateString("de-AT", { month: "long" })}{gefiltertHinweis}</div><div className="text-2xl font-bold tabular-nums">{eur(umsatzMonat)}</div></CardContent></Card>
          <Card><CardContent className="p-4"><div className="text-xs uppercase tracking-wide text-muted-foreground">Entwürfe{gefiltertHinweis}</div><div className="text-2xl font-bold tabular-nums">{entwuerfe}</div></CardContent></Card>
        </div>

        <div className="flex flex-col sm:flex-row gap-2 sm:items-center">
          <div className="relative flex-1 min-w-0">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input className="pl-9" placeholder="Nummer, Kunde, Betreff…" value={suche} onChange={(e) => setSuche(e.target.value)} />
          </div>
          <div className="flex gap-2 shrink-0">
            <Button variant="outline" onClick={() => setExportOpen(true)} className="gap-2 h-11 sm:h-10" title="Belege eines Monats exportieren">
              <Download className="h-4 w-4" />Export
            </Button>
            <Button onClick={() => setNeuOpen(true)} className="gap-2 h-11 sm:h-10"><Plus className="h-4 w-4" />Neuer Beleg</Button>
          </div>
        </div>
        <Tabs value={filter} onValueChange={(v) => setFilter(v as typeof filter)}>
          <TabsList className="flex w-full flex-wrap justify-start">
            <TabsTrigger value="alle" className="text-xs sm:text-sm px-2">Alle</TabsTrigger>
            <TabsTrigger value="angebote" className="text-xs sm:text-sm px-2">Angebote</TabsTrigger>
            <TabsTrigger value="rechnungen" className="text-xs sm:text-sm px-2">Rechnungen</TabsTrigger>
            <TabsTrigger value="offen" className="text-xs sm:text-sm px-2">Offen</TabsTrigger>
            <TabsTrigger value="entwuerfe" className="text-xs sm:text-sm px-2">Entwürfe</TabsTrigger>
          </TabsList>
        </Tabs>

        {loading ? (
          <p className="text-center text-muted-foreground py-10">Lade…</p>
        ) : gefiltert.length === 0 ? (
          <Card><CardContent className="py-10 text-center text-muted-foreground">
            <Receipt className="h-10 w-10 mx-auto mb-2 opacity-40" />
            {basis.length === 0 ? "Noch keine Belege. Mit „Neuer Beleg“ das erste Angebot oder die erste Rechnung anlegen." : "Nichts gefunden."}
          </CardContent></Card>
        ) : (
          <div className="space-y-2">
            {gefiltert.map((b) => {
              const rest = offen(b);
              const ueberfaellig = rest > 0 && b.faellig_am && b.faellig_am < heuteISO();
              const istRe = istRechnung(b.typ) || b.typ === "gutschrift";
              return (
                <Card key={b.id} className="cursor-pointer hover:shadow-md transition-shadow" onClick={() => navigate(`/belege/${b.id}`)}>
                  <CardContent className="p-3 sm:p-4 flex items-center gap-3">
                    <div className={`h-10 w-10 rounded-lg flex items-center justify-center shrink-0 ${istRe ? "bg-primary/10 text-primary" : "bg-accent/10 text-accent"}`}>
                      {istRe ? <Receipt className="h-5 w-5" /> : <FileText className="h-5 w-5" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <span className="font-semibold truncate">{TYP_LABEL[b.typ]} {b.nummer ?? <span className="text-muted-foreground font-normal">(Entwurf)</span>}</span>
                        <Badge variant={STATUS_VARIANT[b.status]} className="text-[11px]">{STATUS_LABEL[b.status]}</Badge>
                        {ueberfaellig && <Badge variant="destructive" className="text-[11px] gap-1"><AlertCircle className="h-3 w-3" />überfällig</Badge>}
                      </div>
                      <div className="text-sm text-muted-foreground truncate">{b.kunde_name}{b.betreff ? ` · ${b.betreff}` : ""}</div>
                      <div className="text-xs text-muted-foreground">{datum(b.datum)}{b.faellig_am && istRechnung(b.typ) ? ` · fällig ${datum(b.faellig_am)}` : ""}</div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="font-semibold tabular-nums">{eur(b.brutto)}</div>
                      {rest > 0 && rest < Number(b.brutto) && <div className="text-xs text-muted-foreground tabular-nums">offen {eur(rest)}</div>}
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </main>

      <Dialog open={neuOpen} onOpenChange={setNeuOpen}>
        <DialogContent className="max-w-[calc(100vw-1rem)] sm:max-w-xl max-h-[90dvh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Neuer Beleg</DialogTitle>
            <DialogDescription>Kundendaten werden in den Beleg übernommen. Die Nummer wird erst vergeben, wenn du danach „Angebot erstellen“ bzw. „Rechnung erstellen“ drückst.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>Was soll es werden?</Label>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2" role="radiogroup" aria-label="Belegart">
                {NEU_TYPEN.map((t) => {
                  const aktiv = neu.typ === t.typ;
                  return (
                    <button
                      key={t.typ}
                      type="button"
                      role="radio"
                      aria-checked={aktiv}
                      onClick={() => setNeu({ ...neu, typ: t.typ })}
                      className={cn(
                        "rounded-lg border p-3 text-left transition-colors flex gap-3 items-start",
                        aktiv ? "border-primary bg-primary/5 ring-1 ring-primary" : "hover:bg-accent/40",
                      )}
                    >
                      <span className={cn("mt-0.5 h-9 w-9 rounded-md flex items-center justify-center shrink-0", aktiv ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground")}>{t.icon}</span>
                      <span className="min-w-0">
                        <span className="block font-medium text-sm">{TYP_LABEL[t.typ]}</span>
                        <span className="block text-xs text-muted-foreground leading-snug">{t.text}</span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Projekt (optional)</Label>
              <Auswahl wert={neu.projekt} optionen={projekte} label={(p) => projectLabel(p as never)} suchtext={(p) => `${p.name} ${p.plz ?? ""} ${p.adresse ?? ""}`} platzhalter="Kein Projekt" leer="— ohne Projekt —" onChange={(id) => setNeu({ ...neu, projekt: id })} />
              {!neu.projekt && <p className="text-xs text-muted-foreground">Ohne Projekt bleibt das PDF nur in der App (kein OneDrive-Ordner, keine Stunden zum Holen).</p>}
            </div>
            <div className="space-y-1.5">
              <Label>Kunde *</Label>
              <KundenAuswahl
                wert={neu.kunde}
                zeigeRechnungsdaten
                pflicht
                onChange={(k) => { setGewaehlterKunde(k); setNeu({ ...neu, kunde: k?.id ?? "" }); }}
              />
              {projektKundeWeicht && <p className="text-xs text-amber-700 dark:text-amber-400">Achtung: Das Projekt gehört einem anderen Kunden.</p>}
              {neu.kunde && (gewaehlterKunde?.id === neu.kunde ? gewaehlterKunde : kunden.find((k) => k.id === neu.kunde))?.reverse_charge && <p className="text-xs text-muted-foreground">Reverse Charge ist bei diesem Kunden hinterlegt — der Beleg wird ohne USt erstellt.</p>}
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setNeuOpen(false)}>Abbrechen</Button>
              <Button onClick={belegAnlegen} disabled={anlegen || !neu.kunde}>Anlegen</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Monatsexport für die Buchhaltung */}
      <BelegExport open={exportOpen} onOpenChange={setExportOpen} belege={belege}
        hinweis={projektFilter || kundeFilter ? "Der Projekt-/Kundenfilter der Liste gilt hier nicht — exportiert werden alle Belege des gewählten Zeitraums." : undefined} />

      {/* Neuer Kunde — direkt aus dem Beleg heraus, damit man nicht erst in die Kundenverwaltung muss */}
    </div>
  );
};

export default Belege;
