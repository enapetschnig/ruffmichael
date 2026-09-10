import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  Search, RefreshCw, Loader2, Paperclip, Receipt, Check, FolderKanban, ExternalLink, Reply,
  PenSquare, Inbox, ArrowLeft, Download, Mail as MailIcon, MailOpen, FolderPlus, FileText, X, Send,
} from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { MailSenden, type MailEntwurf } from "@/components/MailSenden";
import { MailZuProjekt, type ProjektOpt } from "@/components/MailZuProjekt";
import { projectLabel } from "@/lib/projectLabel";
import { cn } from "@/lib/utils";
import {
  KATEGORIE_LABEL, KATEGORIE_KLASSE, absender, adressenText, anhangUrl, dateiGroesse, mailZeit, outlook,
  type Mail, type MailAnhang, type MailKategorie,
} from "@/lib/postfach";

const FILTER: { key: string; label: string; passt: (m: Mail) => boolean }[] = [
  { key: "posteingang", label: "Posteingang", passt: (m) => m.richtung === "eingang" && !m.erledigt },
  { key: "alle", label: "Alle", passt: () => true },
  { key: "rechnungen", label: "Rechnungen", passt: (m) => m.kategorie === "eingangsrechnung" || m.kategorie === "mahnung" },
  { key: "kunden", label: "Kunden", passt: (m) => m.kategorie === "kundenanfrage" || !!m.kunde_id },
  { key: "anhang", label: "Mit Anhang", passt: (m) => m.hat_anhang },
  { key: "gesendet", label: "Gesendet", passt: (m) => m.richtung === "ausgang" },
  { key: "erledigt", label: "Erledigt", passt: (m) => m.erledigt },
];

/**
 * Firmenpostfach in der App.
 *
 * Aufbau wie in einem Mailprogramm: links die Liste, rechts die Mail mit
 * ihrer echten Formatierung (HTML in einer Sandbox ohne Skripte). Beim Holen
 * wird jede Mail eingeordnet; was nach Lieferantenrechnung aussieht, landet
 * zusätzlich unter „Eingangsrechnungen“. In Outlook selbst wird nichts
 * verändert — „erledigt“ und die Zuordnung zu Projekt und Kunde führt die
 * App für sich.
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
  const [filter, setFilter] = useState(projektFilter ? "alle" : params.get("filter") || "posteingang");
  const [suche, setSuche] = useState("");
  const [offenId, setOffenId] = useState<string | null>(params.get("mail"));
  const [anhaenge, setAnhaenge] = useState<MailAnhang[]>([]);
  const [schreiben, setSchreiben] = useState<MailEntwurf | null>(null);
  const [projektDialog, setProjektDialog] = useState(false);
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
      const r = await outlook<{ neu: number; rechnungen: number; entfernt: number; offen: boolean }>("sync", { zeit: 100 });
      await laden_();
      toast({
        title: r.neu > 0 ? `${r.neu} neue Mail${r.neu === 1 ? "" : "s"}` : "Keine neuen Mails",
        description: [
          r.rechnungen > 0 ? `${r.rechnungen} als Eingangsrechnung erkannt` : "",
          r.entfernt > 0 ? `${r.entfernt} in Outlook gelöschte entfernt` : "",
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
      return [m.betreff, m.von_name, m.von_adresse, m.vorschau, m.koerper_text, adressenText(m.an_adressen)]
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

  const weiterleiten = (m: Mail) => setSchreiben({
    betreff: `WG: ${(m.betreff ?? "").replace(/^(AW|RE|WG|FW):\s*/i, "")}`,
    text: `\n\n\n----- Weitergeleitete Nachricht -----\nVon: ${absender(m)}\nGesendet: ${new Date(m.empfangen_am).toLocaleString("de-AT")}\nAn: ${adressenText(m.an_adressen)}\nBetreff: ${m.betreff ?? ""}\n\n${(m.koerper_text ?? "").slice(0, 4000)}`,
    dateien: anhaenge.filter((a) => a.pfad).map((a) => ({ bucket: "mail-anhaenge", pfad: a.pfad!, name: a.name, groesse: a.groesse })),
  });

  const projektName = (id: string | null) => {
    const p = projekte.find((x) => x.id === id);
    return p ? projectLabel(p as never) : "";
  };
  const ungelesen = mails.filter((m) => !m.gelesen && m.richtung === "eingang" && !m.erledigt).length;

  // Mail-HTML in der Sandbox: kein Skript, keine Formulare. Eine kleine
  // Grundformatierung sorgt dafür, dass Outlook-Mails lesbar bleiben.
  const rahmenHtml = (html: string) =>
    `<!doctype html><html><head><meta charset="utf-8"><base target="_blank">
     <style>
       body{margin:0;padding:12px;font-family:Segoe UI,-apple-system,Arial,sans-serif;font-size:14px;line-height:1.5;color:#1a1a1a;background:#fff;word-break:break-word}
       img{max-width:100%;height:auto}table{max-width:100%}
       blockquote{margin:0 0 0 12px;padding-left:10px;border-left:3px solid #ddd;color:#555}
     </style></head><body>${html}</body></html>`;

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
      <main className="mx-auto w-full max-w-[1700px] px-3 sm:px-4 lg:px-6 py-4 space-y-3">
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
            <Input value={suche} onChange={(e) => setSuche(e.target.value)} placeholder="Absender, Betreff, Inhalt…" className="pl-8" />
            {suche && (
              <button type="button" className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground" onClick={() => setSuche("")} aria-label="Suche löschen">
                <X className="h-4 w-4" />
              </button>
            )}
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

        <div className="flex gap-3">
          {/* Liste */}
          <div className={cn("rounded-md border overflow-hidden bg-card", offen ? "hidden lg:block lg:w-[400px] lg:shrink-0" : "w-full")}>
            {laden && <div className="p-6 text-center text-sm text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin mx-auto mb-2" />Postfach wird geladen…</div>}
            {!laden && gefiltert.length === 0 && (
              <div className="p-6 text-center text-sm text-muted-foreground">
                <Inbox className="h-8 w-8 mx-auto mb-2 opacity-40" />
                {mails.length === 0 ? "Noch keine Mails geholt — auf „Abholen“ drücken." : "Hier ist nichts."}
              </div>
            )}
            <div className="max-h-[calc(100dvh-230px)] overflow-y-auto divide-y">
              {gefiltert.map((m) => {
                const neu = !m.gelesen && m.richtung === "eingang";
                return (
                  <button key={m.id} type="button" onClick={() => setOffenId(m.id)}
                    className={cn("w-full text-left px-3 py-2 hover:bg-accent/50 transition-colors block", offenId === m.id && "bg-accent", m.erledigt && "opacity-60")}>
                    <div className="flex items-center gap-2">
                      {neu ? <MailIcon className="h-3.5 w-3.5 shrink-0 text-primary" /> : <MailOpen className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
                      <span className={cn("flex-1 min-w-0 truncate text-sm", neu && "font-bold")}>
                        {m.richtung === "ausgang" ? `An: ${adressenText(m.an_adressen) || "—"}` : absender(m)}
                      </span>
                      {m.hat_anhang && <Paperclip className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
                      <span className="text-xs text-muted-foreground shrink-0 tabular-nums">{mailZeit(m.empfangen_am)}</span>
                    </div>
                    <div className={cn("truncate text-sm", neu ? "font-semibold" : "text-muted-foreground")}>{m.betreff || "(kein Betreff)"}</div>
                    <div className="truncate text-xs text-muted-foreground">{m.vorschau}</div>
                    {(m.kategorie !== "sonstiges" || m.project_id || m.erledigt) && (
                      <div className="flex flex-wrap items-center gap-1 mt-1">
                        {m.kategorie !== "sonstiges" && (
                          <Badge variant="outline" className={cn("text-[11px] font-normal", KATEGORIE_KLASSE[m.kategorie])}>{KATEGORIE_LABEL[m.kategorie]}</Badge>
                        )}
                        {m.project_id && <Badge variant="outline" className="text-[11px] font-normal gap-1"><FolderKanban className="h-3 w-3" />{projektName(m.project_id)}</Badge>}
                        {m.erledigt && <Badge variant="outline" className="text-[11px] font-normal gap-1"><Check className="h-3 w-3" />erledigt</Badge>}
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Mail */}
          <div className={cn("rounded-md border bg-card min-w-0 flex-1", !offen && "hidden lg:flex lg:items-center lg:justify-center")}>
            {!offen && <p className="p-8 text-sm text-muted-foreground text-center">Links eine Mail auswählen.</p>}
            {offen && (
              <div className="flex flex-col max-h-[calc(100dvh-230px)]">
                <div className="border-b px-3 sm:px-4 py-3 space-y-2">
                  <div className="flex items-start gap-2">
                    <Button variant="ghost" size="icon" className="lg:hidden shrink-0 h-8 w-8" onClick={() => setOffenId(null)} aria-label="Zurück zur Liste">
                      <ArrowLeft className="h-4 w-4" />
                    </Button>
                    <div className="min-w-0 flex-1">
                      <h2 className="text-base font-bold leading-snug break-words">{offen.betreff || "(kein Betreff)"}</h2>
                      <div className="mt-0.5 text-xs text-muted-foreground">
                        <span className="font-medium text-foreground">{absender(offen)}</span>
                        {offen.von_adresse && <> &lt;{offen.von_adresse}&gt;</>}
                        {" · "}{new Date(offen.empfangen_am).toLocaleString("de-AT")}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        An: {adressenText(offen.an_adressen) || "—"}
                        {offen.cc_adressen?.length ? ` · Kopie: ${adressenText(offen.cc_adressen)}` : ""}
                        {" · Ordner "}{offen.ordner}
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      <Button variant="ghost" size="icon" className="h-8 w-8" title="Antworten" onClick={() => antworten(offen)}>
                        <Reply className="h-4 w-4" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-8 w-8" title="Weiterleiten" onClick={() => weiterleiten(offen)}>
                        <Send className="h-4 w-4" />
                      </Button>
                      {offen.web_link && (
                        <Button variant="ghost" size="icon" className="h-8 w-8" title="In Outlook öffnen" onClick={() => window.open(offen.web_link!, "_blank", "noopener")}>
                          <ExternalLink className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                  </div>

                  {/* Hauptaktionen — hier ordnet man die Mail einem Projekt zu */}
                  <div className="flex flex-wrap gap-1.5">
                    <Button size="sm" variant={offen.project_id ? "secondary" : "default"} className="gap-1.5"
                      title="Mail einem Projekt zuordnen — sie erscheint dort unter „Schriftverkehr“"
                      onClick={() => setProjektDialog(true)}>
                      <FolderPlus className="h-4 w-4" />
                      {offen.project_id ? projektName(offen.project_id) : "Zu Projekt"}
                    </Button>
                    {offen.kategorie !== "eingangsrechnung" && offen.kategorie !== "mahnung" && (
                      <Button size="sm" variant="outline" className="gap-1.5" onClick={() => alsRechnung(offen)}>
                        <Receipt className="h-4 w-4" />Als Eingangsrechnung
                      </Button>
                    )}
                    {(offen.kategorie === "eingangsrechnung" || offen.kategorie === "mahnung") && (
                      <Button size="sm" variant="outline" className="gap-1.5" onClick={() => navigate("/eingangsrechnungen")}>
                        <Receipt className="h-4 w-4" />Bei den Eingangsrechnungen
                      </Button>
                    )}
                    <Button size="sm" variant={offen.erledigt ? "default" : "outline"} className="gap-1.5" onClick={() => aendern(offen.id, { erledigt: !offen.erledigt })}>
                      <Check className="h-4 w-4" />{offen.erledigt ? "Erledigt" : "Als erledigt"}
                    </Button>
                    <Select value={offen.kategorie} onValueChange={(v) => aendern(offen.id, { kategorie: v as MailKategorie, kategorie_quelle: "manuell" })}>
                      <SelectTrigger className="h-9 w-auto gap-1.5 text-sm"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {(Object.keys(KATEGORIE_LABEL) as MailKategorie[]).map((k) => <SelectItem key={k} value={k}>{KATEGORIE_LABEL[k]}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>

                  {offen.kategorie_grund && (
                    <p className="text-xs text-muted-foreground italic">
                      Eingeordnet{offen.kategorie_quelle === "ki" ? " (automatisch)" : ""}: {offen.kategorie_grund}
                    </p>
                  )}

                  {anhaenge.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {anhaenge.map((a) => (
                        <button key={a.id} type="button" onClick={() => anhangOeffnen(a)}
                          className="flex items-center gap-1.5 rounded-md border bg-muted/40 px-2 py-1 text-xs hover:bg-muted">
                          <FileText className="h-3.5 w-3.5 text-primary shrink-0" />
                          <span className="max-w-[220px] truncate">{a.name}</span>
                          <span className="text-muted-foreground">({dateiGroesse(a.groesse) || "—"})</span>
                          {a.pfad ? <Download className="h-3 w-3 text-muted-foreground" /> : <span className="text-muted-foreground">nur in Outlook</span>}
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {/* Inhalt — HTML in der Sandbox, sonst schlichter Text */}
                <div className="min-h-[300px] flex-1 overflow-y-auto">
                  {offen.koerper_html ? (
                    <iframe title="Mail-Inhalt" sandbox="" srcDoc={rahmenHtml(offen.koerper_html)} className="h-[62vh] w-full border-0 bg-white" />
                  ) : (
                    <p className="px-3 sm:px-4 py-3 text-sm whitespace-pre-wrap break-words leading-relaxed">{offen.koerper_text || offen.vorschau || "(kein Text)"}</p>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>

        <p className="text-xs text-muted-foreground">
          {ungelesen > 0 ? `${ungelesen} ungelesen · ` : ""}
          {letzterLauf ? `zuletzt geholt ${new Date(letzterLauf).toLocaleString("de-AT")}` : "noch nicht geholt"}
          {" · holt sich alle 5 Minuten neue Mails · in Outlook wird nichts verändert"}
        </p>
      </main>

      <MailSenden open={!!schreiben} onOpenChange={(o) => !o && setSchreiben(null)} entwurf={schreiben ?? {}} />
      <MailZuProjekt
        open={projektDialog}
        onOpenChange={setProjektDialog}
        mail={offen}
        anhaenge={anhaenge}
        projekte={projekte}
        onFertig={(projektId) => { if (offen) setMails((l) => l.map((m) => (m.id === offen.id ? { ...m, project_id: projektId } : m))); }}
      />
    </div>
  );
}
