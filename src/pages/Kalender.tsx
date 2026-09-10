import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Loader2, CalendarDays, MapPin, Users, ExternalLink, RefreshCw, List, LayoutGrid } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { outlook, type Termin } from "@/lib/postfach";
import { cn } from "@/lib/utils";

const TAGE = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];
const MONATE = ["Jänner", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"];

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const uhr = (s?: string) => (s ? s.slice(11, 16) : "");
/** Graph liefert die Zeit ohne Zone (schon in Europe/Vienna) — Tag daraus lesen. */
const tagVon = (t: Termin) => (t.start?.dateTime ?? "").slice(0, 10);
const tagBis = (t: Termin) => {
  const ende = (t.end?.dateTime ?? "").slice(0, 10);
  // Ganztägige Termine enden laut Graph am Folgetag um 00:00
  if (t.isAllDay && ende) { const d = new Date(`${ende}T00:00:00`); d.setDate(d.getDate() - 1); return iso(d); }
  return ende;
};

/**
 * Outlook-Kalender in der App — nur zum Nachschauen.
 *
 * Die Termine kommen live aus Microsoft 365 (Kalender von
 * office@ruffinstallateur.at). Geändert oder angelegt wird hier bewusst
 * nichts: Michael führt seinen Kalender weiter in Outlook, die App zeigt ihn
 * nur mit, damit man unterwegs sieht, was ansteht.
 */
export default function Kalender() {
  const { toast } = useToast();
  const [monat, setMonat] = useState(() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1); });
  const [termine, setTermine] = useState<Termin[]>([]);
  const [laden, setLaden] = useState(true);
  const [fehler, setFehler] = useState<string | null>(null);
  const [ansicht, setAnsicht] = useState<"monat" | "liste">(() => (typeof window !== "undefined" && window.innerWidth < 768 ? "liste" : "monat"));
  const [gewaehlterTag, setGewaehlterTag] = useState<string | null>(iso(new Date()));

  // Ganzer sichtbarer Bereich inklusive der Randtage aus Vor- und Folgemonat
  const bereich = useMemo(() => {
    const ersterTag = new Date(monat.getFullYear(), monat.getMonth(), 1);
    const start = new Date(ersterTag);
    start.setDate(start.getDate() - ((ersterTag.getDay() + 6) % 7));
    const ende = new Date(start);
    ende.setDate(ende.getDate() + 41);
    return { start, ende };
  }, [monat]);

  const holen = useCallback(async () => {
    setLaden(true);
    setFehler(null);
    try {
      const r = await outlook<{ termine: Termin[] }>("kalender", { von: iso(bereich.start), bis: iso(bereich.ende) });
      setTermine(r.termine ?? []);
    } catch (e) {
      const text = e instanceof Error ? e.message : String(e);
      setFehler(text);
      toast({ variant: "destructive", title: "Kalender nicht erreichbar", description: text });
    } finally {
      setLaden(false);
    }
  }, [bereich, toast]);

  useEffect(() => { holen(); }, [holen]);

  // Termine je Tag — mehrtägige laufen über alle betroffenen Tage
  const nachTag = useMemo(() => {
    const map = new Map<string, Termin[]>();
    for (const t of termine) {
      const von = tagVon(t), bis = tagBis(t) || tagVon(t);
      if (!von) continue;
      const d = new Date(`${von}T00:00:00`);
      for (let i = 0; i < 60; i++) {
        const tag = iso(d);
        if (tag > bis) break;
        map.set(tag, [...(map.get(tag) ?? []), t]);
        d.setDate(d.getDate() + 1);
      }
    }
    for (const liste of map.values()) {
      liste.sort((a, b) => (a.isAllDay === b.isAllDay ? (a.start?.dateTime ?? "").localeCompare(b.start?.dateTime ?? "") : a.isAllDay ? -1 : 1));
    }
    return map;
  }, [termine]);

  const tage = useMemo(() => {
    const liste: Date[] = [];
    const d = new Date(bereich.start);
    for (let i = 0; i < 42; i++) { liste.push(new Date(d)); d.setDate(d.getDate() + 1); }
    return liste;
  }, [bereich]);

  const heute = iso(new Date());
  const kommende = useMemo(
    () => termine
      .filter((t) => (tagBis(t) || tagVon(t)) >= heute)
      .sort((a, b) => (a.start?.dateTime ?? "").localeCompare(b.start?.dateTime ?? ""))
      .slice(0, 60),
    [termine, heute],
  );

  const tagText = (s: string) => {
    const d = new Date(`${s}T00:00:00`);
    return `${TAGE[(d.getDay() + 6) % 7]}, ${d.getDate()}. ${MONATE[d.getMonth()]}`;
  };

  const TerminZeile = ({ t, mitDatum }: { t: Termin; mitDatum?: boolean }) => (
    <div className="rounded-md border p-2.5 space-y-1">
      <div className="flex items-start gap-2">
        <div className="flex-1 min-w-0">
          <div className="font-medium text-sm break-words">{t.subject || "(ohne Titel)"}</div>
          <div className="text-xs text-muted-foreground">
            {mitDatum ? `${tagText(tagVon(t))} · ` : ""}
            {t.isAllDay ? "ganztägig" : `${uhr(t.start?.dateTime)} – ${uhr(t.end?.dateTime)}`}
          </div>
        </div>
        {t.webLink && (
          <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={() => window.open(t.webLink!, "_blank", "noopener")} aria-label="In Outlook öffnen">
            <ExternalLink className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>
      {t.location?.displayName && (
        <div className="text-xs text-muted-foreground flex items-center gap-1"><MapPin className="h-3 w-3 shrink-0" />{t.location.displayName}</div>
      )}
      {t.attendees && t.attendees.length > 0 && (
        <div className="text-xs text-muted-foreground flex items-center gap-1">
          <Users className="h-3 w-3 shrink-0" />
          <span className="truncate">{t.attendees.map((a) => a.emailAddress?.name || a.emailAddress?.address).filter(Boolean).join(", ")}</span>
        </div>
      )}
      {t.bodyPreview && <p className="text-xs text-muted-foreground line-clamp-2">{t.bodyPreview}</p>}
    </div>
  );

  return (
    <div className="kb-page min-h-screen">
      <PageHeader
        title="Kalender"
        backPath="/"
        rightActions={
          <>
            <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setAnsicht(ansicht === "monat" ? "liste" : "monat")}>
              {ansicht === "monat" ? <List className="h-4 w-4" /> : <LayoutGrid className="h-4 w-4" />}
              <span className="hidden sm:inline">{ansicht === "monat" ? "Liste" : "Monat"}</span>
            </Button>
            <Button size="sm" variant="outline" className="gap-1.5" onClick={holen} disabled={laden}>
              {laden ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            </Button>
          </>
        }
      />
      <main className="container mx-auto px-3 sm:px-4 lg:px-6 py-4 space-y-3">
        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon" onClick={() => setMonat(new Date(monat.getFullYear(), monat.getMonth() - 1, 1))} aria-label="Voriger Monat">
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <h2 className="flex-1 text-center font-semibold">{MONATE[monat.getMonth()]} {monat.getFullYear()}</h2>
          <Button variant="outline" size="icon" onClick={() => setMonat(new Date(monat.getFullYear(), monat.getMonth() + 1, 1))} aria-label="Nächster Monat">
            <ChevronRight className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="sm" onClick={() => { const d = new Date(); setMonat(new Date(d.getFullYear(), d.getMonth(), 1)); setGewaehlterTag(iso(d)); }}>Heute</Button>
        </div>

        {fehler && (
          <div className="rounded-md border border-amber-300 bg-amber-50 dark:bg-amber-950/30 p-3 text-sm">
            Der Kalender konnte nicht geladen werden: {fehler}
          </div>
        )}

        {ansicht === "monat" ? (
          <>
            <div className="rounded-md border overflow-hidden">
              <div className="grid grid-cols-7 border-b bg-muted/50">
                {TAGE.map((t) => <div key={t} className="p-1.5 text-center text-xs font-medium text-muted-foreground">{t}</div>)}
              </div>
              <div className="grid grid-cols-7">
                {tage.map((d) => {
                  const tag = iso(d);
                  const liste = nachTag.get(tag) ?? [];
                  const fremd = d.getMonth() !== monat.getMonth();
                  return (
                    <button key={tag} type="button" onClick={() => setGewaehlterTag(tag)}
                      className={cn(
                        "min-h-[76px] sm:min-h-[96px] border-b border-r p-1 text-left align-top transition-colors hover:bg-accent/50",
                        fremd && "bg-muted/30 text-muted-foreground",
                        gewaehlterTag === tag && "ring-2 ring-inset ring-primary",
                      )}>
                      <div className={cn("text-xs font-medium mb-0.5 inline-flex h-5 w-5 items-center justify-center rounded-full",
                        tag === heute && "bg-primary text-primary-foreground")}>{d.getDate()}</div>
                      <div className="space-y-0.5">
                        {liste.slice(0, 3).map((t, i) => (
                          <div key={`${t.id}-${i}`} className="truncate rounded bg-primary/10 px-1 py-0.5 text-[10px] leading-tight">
                            {!t.isAllDay && <span className="tabular-nums text-muted-foreground">{uhr(t.start?.dateTime)} </span>}
                            {t.subject}
                          </div>
                        ))}
                        {liste.length > 3 && <div className="text-[10px] text-muted-foreground">+{liste.length - 3} weitere</div>}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            {gewaehlterTag && (
              <div className="space-y-2">
                <h3 className="font-medium text-sm flex items-center gap-2">
                  <CalendarDays className="h-4 w-4" />{tagText(gewaehlterTag)}
                  <Badge variant="outline" className="font-normal">{(nachTag.get(gewaehlterTag) ?? []).length} Termine</Badge>
                </h3>
                {(nachTag.get(gewaehlterTag) ?? []).map((t, i) => <TerminZeile key={`${t.id}-${i}`} t={t} />)}
                {(nachTag.get(gewaehlterTag) ?? []).length === 0 && <p className="text-sm text-muted-foreground">Nichts eingetragen.</p>}
              </div>
            )}
          </>
        ) : (
          <div className="space-y-2">
            {laden && <div className="p-8 text-center text-sm text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin mx-auto mb-2" />Termine werden geholt…</div>}
            {!laden && kommende.length === 0 && <p className="p-8 text-center text-sm text-muted-foreground">Keine kommenden Termine.</p>}
            {kommende.map((t, i) => <TerminZeile key={`${t.id}-${i}`} t={t} mitDatum />)}
          </div>
        )}

        <p className="text-xs text-muted-foreground">
          Kalender von office@ruffinstallateur.at — Termine werden hier nur angezeigt. Eintragen und ändern weiterhin in Outlook.
        </p>
      </main>
    </div>
  );
}
