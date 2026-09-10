import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { CalendarDays, MapPin, ChevronRight, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { outlook, type Termin } from "@/lib/postfach";

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const uhr = (s?: string) => (s ? s.slice(11, 16) : "");

/**
 * Die Termine von heute, kurz über dem Hauptmenü.
 *
 * Kommt live aus Michaels Outlook-Kalender. Fällt der Abruf aus (kein Netz,
 * Microsoft nicht erreichbar), verschwindet der Streifen einfach — die
 * Startseite darf davon nie blockiert werden.
 */
export function TermineHeute() {
  const navigate = useNavigate();
  const [termine, setTermine] = useState<Termin[] | null>(null);

  useEffect(() => {
    let aktiv = true;
    const heute = iso(new Date());
    outlook<{ termine: Termin[] }>("kalender", { von: heute, bis: heute })
      .then((r) => { if (aktiv) setTermine(r.termine ?? []); })
      .catch(() => { if (aktiv) setTermine([]); });
    return () => { aktiv = false; };
  }, []);

  if (termine === null) {
    return (
      <div className="mb-4 flex items-center gap-2 rounded-md border bg-card px-3 py-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin shrink-0" />Termine werden geladen…
      </div>
    );
  }
  if (termine.length === 0) return null;

  const sortiert = [...termine].sort((a, b) =>
    a.isAllDay === b.isAllDay
      ? (a.start?.dateTime ?? "").localeCompare(b.start?.dateTime ?? "")
      : a.isAllDay ? -1 : 1,
  );
  const jetzt = new Date().toTimeString().slice(0, 5);

  return (
    <section className="mb-4 rounded-md border bg-card overflow-hidden" aria-label="Termine heute">
      <button type="button" onClick={() => navigate("/kalender")}
        className="flex w-full items-center gap-2 border-b bg-muted/40 px-3 py-2 text-left hover:bg-muted/70 transition-colors">
        <CalendarDays className="h-4 w-4 shrink-0 text-primary" />
        <span className="text-sm font-semibold">Heute</span>
        <span className="text-xs text-muted-foreground">
          {new Date().toLocaleDateString("de-AT", { weekday: "long", day: "2-digit", month: "long" })} · {sortiert.length} Termin{sortiert.length === 1 ? "" : "e"}
        </span>
        <ChevronRight className="ml-auto h-4 w-4 shrink-0 text-muted-foreground" />
      </button>
      <ul className="divide-y">
        {sortiert.slice(0, 6).map((t, i) => {
          const vorbei = !t.isAllDay && uhr(t.end?.dateTime) < jetzt;
          return (
            <li key={`${t.id}-${i}`} className={cn("flex items-start gap-2.5 px-3 py-2", vorbei && "opacity-50")}>
              <span className="w-[86px] shrink-0 text-xs tabular-nums text-muted-foreground pt-0.5">
                {t.isAllDay ? "ganztägig" : `${uhr(t.start?.dateTime)}–${uhr(t.end?.dateTime)}`}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{t.subject || "(ohne Titel)"}</span>
                {t.location?.displayName && (
                  <span className="flex items-center gap-1 truncate text-xs text-muted-foreground">
                    <MapPin className="h-3 w-3 shrink-0" />{t.location.displayName}
                  </span>
                )}
              </span>
            </li>
          );
        })}
        {sortiert.length > 6 && (
          <li className="px-3 py-1.5 text-xs text-muted-foreground">+{sortiert.length - 6} weitere — im Kalender ansehen</li>
        )}
      </ul>
    </section>
  );
}

export default TermineHeute;
