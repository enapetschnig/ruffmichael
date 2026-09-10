import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  Mail as MailIcon, Search, RefreshCw, Loader2, Paperclip, Receipt, Check, FolderKanban,
  ExternalLink, Reply, PenSquare, Star, Inbox, ArrowLeft, BookUser, Download,
} from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { MailSenden, type MailEntwurf } from "@/components/MailSenden";
import { projectLabel } from "@/lib/projectLabel";
import { cn } from "@/lib/utils";
import {
  KATEGORIE_LABEL, KATEGORIE_KLASSE, absender, adressenText, anhangUrl, dateiGroesse, mailZeit, outlook,
  type Mail, type MailAnhang, type MailKategorie,
} from "@/lib/postfach";

type ProjektOpt = { id: string; name: string; plz: string | null; adresse: string | null; status: string };

const FILTER: { key: string; label: string; passt: (m: Mail) => boolean }[] = [
  { key: "alle", label: "Alle", passt: () => true },
  { key: "posteingang", label: "Posteingang", passt: (m) => m.richtung === "eingang" && !m.erledigt },
  { key: "rechnungen", label: "Rechnungen", passt: (m) => m.kategorie === "eingangsrechnung" || m.kategorie === "mahnung" },
  { key: "kunden", label: "Kunden", passt: (m) => m.kategorie === "kundenanfrage" || !!m.kunde_id },
  { key: "anhang", label: "Mit Anhang", passt: (m) => m.hat_anhang },
  { key: "erledigt", label: "Erledigt", passt: (m) => m.erledigt },
];

/**
 * Firmenpostfach in der App.
 *
 * Die Mails kommen aus Outlook (Microsoft 365) und werden beim Holen
 * eingeordnet — was nach Lieferantenrechnung aussieht, landet zusätzlich unter
 * „Eingangsrechnungen". In Outlook selbst wird nichts verändert; „erledigt"
 * und die Zuordnung zu Projekt und Kunde führt die App für sich.
 */
export default function Postfach() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [params, setParams] = useSearchParams();
  const projektFilter = params.get("projekt");

  const [mails, setMails] = useState<Mail[]>([]);
  const [projekte, setProjekte] = useState<ProjektOpt[]>([]);
  const [laden, setLaden] = useState(true);
  const [holen, setHolen] = useState(false);
  const [filter, setFilter] = useState(projektFilter ? "alle" : "posteingang");
  const [suche, setSuche] = useState("");
  const [offenId, setOffenId] = useState<string | null>(null);
  const [anhaenge, setAnhaenge] = useState<MailAnhang[]>([]);
  const [schreiben, setSchreiben] = useState<MailEntwurf | null>(null);
  const [letzterLauf, setLetzterLauf] = useState<string | null>(null);

  const laden_ = useCallback(async () => {
    const [{ data: m, error }, { data: p }, { data: z }] = await Promise.all([
      supabase.from("mails").select("*").order("empfangen_am", { ascending: false }).limit(1000),
      supabase.from("projects").select("id, name, plz, adresse, status").order("name"),
      supabase.from("mail_sync_state").select("letzter_lauf").eq("id", "postfach").maybeSingle(),
    ]);
    if (error) toast({ variant: "destructive", title: "Postfach nicht geladen", description: error.message });
    setMails((m ?? []) as unknown as Mail[]);
    setProjekte((p ?? []) as ProjektOpt[]);
    setLetzterLauf(z?.letzter_lauf ?? null);
    setLaden(false);
  }, [toast]);

  useEffect(() => { laden_(); }, [laden_]);

  const abholen = async () => {
    setHolen(true);
    try {
      const r = await outlook<{ neu: number; rechnungen: number; offen: boolean }>("sync", { zeit: 100 });
      await laden_();
      toast({
        title: r.neu > 0 ? `${r.neu} neue Mail${r.neu === 1 ? "" : "s"}` : "Keine neuen Mails",
        description: [
          r.rechnungen > 0 ? `${r.rechnungen} davon als Eingangsrechnung erkannt` : "",
          r.offen ? "Es sind noch weitere offen — gleich nochmal holen." : "",
        ].filter(Boolean).join(" · ") || undefined,
      });
    } catch (e) {
      toast({ variant: "destructive", title: "Postfach nicht erreichbar", description: e instanceof Error ? e.message : String(e) });
    } finally {
      setHolen(false);
    }
  };

  const gefiltert = useMemo(() => {
    const f = FILTER.find((x) => x.key === filter) ?? FILTER[0];
    const s = suche.trim().toLowerCase();
    return mails.filter((m) => {
      if (projektFilter && m.project_id !== projektFilter) return false;
      if (!f.passt(m)) return false;
      if (!s) return true;
      return [m.betreff, m.von_name, m.von_adresse, m.vorschau, adressenText(m.an_adressen)]
        .some((t) => (t ?? "").toLowerCase().includes(s));
    });
  }, [mails, filter, suche, projektFilter]);

  const offen = mails.find((m) => m.id === offenId) ?? null;

  useEffect(() => {
    if (!offenId) { setAnhaenge([]); return; }
    supabase.from("mail_anhaenge").select("*").eq("mail_id", offenId).order("name")
      .then(({ data }) => setAnhaenge((data ?? []) as MailAnhang[]));
  }, [offenId]);

  const aendern = async (id: string, werte: Partial<Mail>) => {
    setMails((l) => l.map((m) => (m.id === id ? { ...m, ...werte } as Mail : m)));
    const { error } = await supabase.from("mails").update(werte as never).eq("id", id);
    if (error) { toast({ variant: "destructive", title: "Nicht gespeichert", description: error.message }); laden_(); }
  };

  const anhangOeffnen = async (a: MailAnhang) => {
    if (!a.pfad) return toast({ title: "Nur in Outlook", description: "Diese Datei wurde nicht mitgespeichert — sie liegt weiterhin in der Mail." });
    const url = await anhangUrl(a.pfad);
    if (url) window.open(url, "_blank", "noopener");
    else toast({ variant: "destructive", title: "Anhang nicht abrufbar" });
  };

  const alsRechnung = async (m: Mail) => {
    const pdf = anhaenge.find((a) => /\.pdf$/i.test(a.name) && a.pfad);
    const { data, error } = await supabase.from("eingangsrechnungen").insert({
      mail_id: m.id,
      anhang_id: pdf?.id ?? null,
      lieferant: absender(m).slice(0, 200),
      datum: m.empfangen_am.slice(0, 10),
      pdf_pfad: pdf?.pfad ?? null,
      quelle: "mail",
      erkannt_von: "manuell",
      project_id: m.project_id,
    }).select("id").single();
    if (error) return toast({ variant: "destructive", title: "Nicht übernommen", description: error.message.includes("duplicate") ? "Zu dieser Mail gibt es schon eine Eingangsrechnung." : error.message });
    await aendern(m.id, { kategorie: "eingangsrechnung", kategorie_quelle: "manuell" });
    toast({ title: "Als Eingangsrechnung übernommen", description: "Beträge jetzt prüfen und ergänzen." });
    navigate(`/eingangsrechnungen?offen=${data.id}`);
  };

  const antworten = (m: Mail) => setSchreiben({
    an: m.von_adresse ?? "",
    betreff: `AW: ${(m.betreff ?? "").replace(/^(AW|RE|WG|FW):\s*/i, "")}`,
    text: `\n\n\n----- Ursprüngliche Nachricht -----\nVon: ${absender(m)}\nGesendet: ${new Date(m.empfangen_am).toLocaleString("de-AT")}\nBetreff: ${m.betreff ?? ""}\n\n${(m.koerper_text ?? "").slice(0, 2000)}`,
  });

  const projektName = (id: string | null) => {
    const p = projekte.find((x) => x.id === id);
    return p ? projectLabel(p as never) : "";
  };
  const ungelesen = mails.filter((m) => !m.gelesen && m.richtung === "eingang" && !m.erledigt).length;

  return (
    <div className="kb-page min-h-screen">
      <PageHeader
        title={projektFilter ? `Schriftverkehr · ${projektName(projektFilter)}` : "E-Mail"}
        backPath="/"
        rightActions={
          <>
            <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setSchreiben({})}>
              <PenSquare className="h-4 w-4" /><span className="hidden sm:inline">Schreiben</span>
            </Button>
            <Button size="sm" className="gap-1.5" onClick={abholen} disabled={holen}>
              {holen ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              <span className="hidden sm:inline">Abholen</span>
            </Button>
          </>
        }
      />
      <main className="container mx-auto px-3 sm:px-4 lg:px-6 py-4 space-y-3">
        {projektFilter && (
          <div className="flex flex-wrap items-center gap-2 rounded-md border bg-muted/40 p-3 text-sm">
            <FolderKanban className="h-4 w-4 shrink-0 text-muted-foreground" />
            <span className="flex-1 min-w-0">Nur der Schriftverkehr zu <b>{projektName(projektFilter)}</b></span>
            <Button size="sm" variant="ghost" onClick={() => { setParams({}); setFilter("posteingang"); }}>Ganzes Postfach</Button>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input value={suche} onChange={(e) => setSuche(e.target.value)} placeholder="Absender, Betreff, Text…" className="pl-8" />
          </div>
          <div className="flex flex-wrap gap-1.5">
            {FILTER.map((f) => {
              const n = mails.filter((m) => (!projektFilter || m.project_id === projektFilter) && f.passt(m)).length;
              return (
                <button key={f.key} type="button" onClick={() => setFilter(f.key)}
                  className={cn("rounded-md border px-2.5 py-1.5 text-sm transition-colors", filter === f.key ? "border-primary bg-primary/10 font-medium" : "hover:bg-accent/50")}>
                  {f.label} <span className="text-xs text-muted-foreground tabular-nums">{n}</span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,380px)_minmax(0,1fr)] gap-3">
          {/* Liste */}
          <div className={cn("rounded-md border divide-y overflow-hidden", offen && "hidden lg:block")}>
            {laden && <div className="p-6 text-center text-sm text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin mx-auto mb-2" />Postfach wird geladen…</div>}
            {!laden && gefiltert.length === 0 && (
              <div className="p-6 text-center text-sm text-muted-foreground">
                <Inbox className="h-8 w-8 mx-auto mb-2 opacity-40" />
                {mails.length === 0 ? "Noch keine Mails geholt — auf „Abholen“ drücken." : "Hier ist nichts."}
              </div>
            )}
            <div className="max-h-[calc(100dvh-260px)] overflow-y-auto divide-y">
              {gefiltert.map((m) => (
                <button key={m.id} type="button" onClick={() => setOffenId(m.id)}
                  className={cn("w-full text-left p-3 hover:bg-accent/50 transition-colors block", offenId === m.id && "bg-accent", m.erledigt && "opacity-60")}>
                  <div className="flex items-center gap-2">
                    {!m.gelesen && m.richtung === "eingang" && <span className="h-2 w-2 rounded-full bg-primary shrink-0" aria-label="ungelesen" />}
                    <span className={cn("flex-1 min-w-0 truncate text-sm", !m.gelesen && m.richtung === "eingang" && "font-semibold")}>
                      {m.richtung === "ausgang" ? `An: ${adressenText(m.an_adressen) || "—"}` : absender(m)}
                    </span>
                    {m.wichtig && <Star className="h-3.5 w-3.5 shrink-0 text-amber-500 fill-amber-400" />}
                    {m.hat_anhang && <Paperclip className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
                    <span className="text-xs text-muted-foreground shrink-0 tabular-nums">{mailZeit(m.empfangen_am)}</span>
                  </div>
                  <div className="truncate text-sm mt-0.5">{m.betreff || "(kein Betreff)"}</div>
                  <div className="truncate text-xs text-muted-foreground mt-0.5">{m.vorschau}</div>
                  <div className="flex flex-wrap items-center gap-1 mt-1.5">
                    {m.kategorie !== "sonstiges" && (
                      <Badge variant="outline" className={cn("text-[11px] font-normal", KATEGORIE_KLASSE[m.kategorie])}>{KATEGORIE_LABEL[m.kategorie]}</Badge>
                    )}
                    {m.project_id && <Badge variant="outline" className="text-[11px] font-normal gap-1"><FolderKanban className="h-3 w-3" />{projektName(m.project_id)}</Badge>}
                    {m.erledigt && <Badge variant="outline" className="text-[11px] font-normal gap-1"><Check className="h-3 w-3" />erledigt</Badge>}
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* Mail */}
          <div className={cn("rounded-md border", !offen && "hidden lg:flex lg:items-center lg:justify-center")}>
            {!offen && <p className="p-8 text-sm text-muted-foreground text-center">Links eine Mail auswählen.</p>}
            {offen && (
              <div className="flex flex-col max-h-[calc(100dvh-260px)]">
                <div className="p-3 sm:p-4 border-b space-y-2">
                  <div className="flex items-start gap-2">
                    <Button variant="ghost" size="icon" className="lg:hidden shrink-0 h-8 w-8" onClick={() => setOffenId(null)} aria-label="Zurück zur Liste">
                      <ArrowLeft className="h-4 w-4" />
                    </Button>
                    <h2 className="flex-1 min-w-0 font-semibold text-base sm:text-lg break-words">{offen.betreff || "(kein Betreff)"}</h2>
                  </div>
                  <div className="text-sm">
                    <span className="font-medium">{absender(offen)}</span>
                    {offen.von_adresse && <span className="text-muted-foreground"> · {offen.von_adresse}</span>}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    An: {adressenText(offen.an_adressen) || "—"}
                    {offen.cc_adressen?.length ? ` · Kopie: ${adressenText(offen.cc_adressen)}` : ""}
                    {" · "}{new Date(offen.empfangen_am).toLocaleString("de-AT")}
                    {" · "}Ordner {offen.ordner}
                  </div>
                  {offen.kategorie_grund && (
                    <div className="text-xs text-muted-foreground italic">
                      Eingeordnet als „{KATEGORIE_LABEL[offen.kategorie]}“{offen.kategorie_quelle === "ki" ? " (automatisch)" : ""}: {offen.kategorie_grund}
                    </div>
                  )}

                  <div className="flex flex-wrap gap-1.5 pt-1">
                    <Button size="sm" variant="outline" className="gap-1.5" onClick={() => antworten(offen)}><Reply className="h-4 w-4" />Antworten</Button>
                    <Button size="sm" variant={offen.erledigt ? "default" : "outline"} className="gap-1.5" onClick={() => aendern(offen.id, { erledigt: !offen.erledigt })}>
                      <Check className="h-4 w-4" />{offen.erledigt ? "Erledigt" : "Als erledigt"}
                    </Button>
                    {offen.kategorie !== "eingangsrechnung" && offen.kategorie !== "mahnung" && (
                      <Button size="sm" variant="outline" className="gap-1.5" onClick={() => alsRechnung(offen)}><Receipt className="h-4 w-4" />Ist eine Rechnung</Button>
                    )}
                    {offen.web_link && (
                      <Button size="sm" variant="ghost" className="gap-1.5" onClick={() => window.open(offen.web_link!, "_blank", "noopener")}>
                        <ExternalLink className="h-4 w-4" />In Outlook
                      </Button>
                    )}
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
                    <div className="space-y-1">
                      <label className="text-xs text-muted-foreground flex items-center gap-1"><FolderKanban className="h-3 w-3" />Projekt</label>
                      <Select value={offen.project_id ?? "keins"} onValueChange={(v) => aendern(offen.id, { project_id: v === "keins" ? null : v })}>
                        <SelectTrigger className="h-9"><SelectValue placeholder="Keinem Projekt" /></SelectTrigger>
                        <SelectContent className="max-h-64">
                          <SelectItem value="keins">Keinem Projekt</SelectItem>
                          {projekte.map((p) => <SelectItem key={p.id} value={p.id}>{projectLabel(p as never)}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs text-muted-foreground flex items-center gap-1"><MailIcon className="h-3 w-3" />Einordnung</label>
                      <Select value={offen.kategorie} onValueChange={(v) => aendern(offen.id, { kategorie: v as MailKategorie, kategorie_quelle: "manuell" })}>
                        <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {(Object.keys(KATEGORIE_LABEL) as MailKategorie[]).map((k) => <SelectItem key={k} value={k}>{KATEGORIE_LABEL[k]}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  {offen.project_id && (
                    <p className="text-xs text-muted-foreground">
                      Liegt beim Projekt unter „Schriftverkehr“ — nur in der App, nicht in OneDrive.
                    </p>
                  )}
                </div>

                {anhaenge.length > 0 && (
                  <div className="p-3 sm:p-4 border-b space-y-1">
                    <div className="text-xs font-medium text-muted-foreground">{anhaenge.length} Anhang{anhaenge.length > 1 ? "/Anhänge" : ""}</div>
                    {anhaenge.map((a) => (
                      <button key={a.id} type="button" onClick={() => anhangOeffnen(a)}
                        className="w-full flex items-center gap-2 rounded-md border p-2 text-sm hover:bg-accent/50 text-left">
                        <Paperclip className="h-4 w-4 shrink-0 text-muted-foreground" />
                        <span className="flex-1 min-w-0 truncate">{a.name}</span>
                        <span className="text-xs text-muted-foreground shrink-0">{dateiGroesse(a.groesse)}</span>
                        {a.pfad ? <Download className="h-4 w-4 shrink-0 text-muted-foreground" /> : <span className="text-xs text-muted-foreground shrink-0">nur in Outlook</span>}
                      </button>
                    ))}
                  </div>
                )}

                <div className="p-3 sm:p-4 overflow-y-auto">
                  <p className="text-sm whitespace-pre-wrap break-words leading-relaxed">{offen.koerper_text || offen.vorschau || "(kein Text)"}</p>
                </div>
              </div>
            )}
          </div>
        </div>

        <p className="text-xs text-muted-foreground">
          {ungelesen > 0 ? `${ungelesen} ungelesen · ` : ""}
          {letzterLauf ? `zuletzt geholt ${new Date(letzterLauf).toLocaleString("de-AT")}` : "noch nicht geholt"}
          {" · in Outlook wird nichts verändert"}
        </p>
      </main>

      <MailSenden open={!!schreiben} onOpenChange={(o) => !o && setSchreiben(null)} entwurf={schreiben ?? {}} />
    </div>
  );
}
