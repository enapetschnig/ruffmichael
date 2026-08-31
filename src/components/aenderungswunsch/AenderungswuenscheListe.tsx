import { useCallback, useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Bug, Copy, HelpCircle, Lightbulb, Loader2, MessageSquarePlus, Mic, RefreshCw, Trash2,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

interface Wunsch {
  id: string;
  erstellt_von: string | null;
  text: string;
  art: string;
  seite: string | null;
  bild_pfad: string | null;
  audio_pfad: string | null;
  abschrift: string;
  abschrift_fehler: string | null;
  status: string;
  antwort: string | null;
  created_at: string;
}

const ART_ZEICHEN: Record<string, typeof Bug> = {
  fehler: Bug, wunsch: Lightbulb, frage: HelpCircle,
};
const ART_TITEL: Record<string, string> = {
  fehler: "Passt nicht", wunsch: "Wunsch", frage: "Frage",
};
const STATUS = ["neu", "gesehen", "umgesetzt", "abgelehnt"] as const;

const dat = (s: string) =>
  new Date(s).toLocaleString("de-AT", { dateStyle: "short", timeStyle: "short" });

/**
 * Änderungswünsche verwalten (Adminbereich).
 *
 * Der wichtigste Knopf ist "Für KI kopieren": Er legt alle offenen Wünsche
 * als sauberen Text in die Zwischenablage — von dort wandern sie direkt in
 * die Entwicklungs-KI, ohne dass jemand etwas abtippt.
 */
export function AenderungswuenscheListe() {
  const { toast } = useToast();
  const [wuensche, setWuensche] = useState<Wunsch[]>([]);
  const [namen, setNamen] = useState<Record<string, string>>({});
  const [bilder, setBilder] = useState<Record<string, string>>({});
  const [toene, setToene] = useState<Record<string, string>>({});
  const [laedt, setLaedt] = useState(true);
  const [nurOffene, setNurOffene] = useState(true);
  const [arbeitet, setArbeitet] = useState<string | null>(null);

  const laden = useCallback(async () => {
    setLaedt(true);
    const { data } = await supabase
      .from("aenderungswuensche")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(200);
    const liste = (data ?? []) as unknown as Wunsch[];
    setWuensche(liste);

    // Namen nachladen — erstellt_von zeigt auf auth.users, kein FK-Join.
    const ids = [...new Set(liste.map((w) => w.erstellt_von).filter(Boolean))] as string[];
    if (ids.length) {
      const { data: profile } = await supabase
        .from("profiles").select("id, vorname, nachname").in("id", ids);
      const abbild: Record<string, string> = {};
      (profile ?? []).forEach((p: any) => {
        abbild[p.id] = [p.vorname, p.nachname].filter(Boolean).join(" ").trim() || "Unbekannt";
      });
      setNamen(abbild);
    }

    // Dateien liegen geschützt — je Eintrag eine befristete Adresse (1 h).
    const b: Record<string, string> = {};
    const t: Record<string, string> = {};
    await Promise.all(liste.map(async (w) => {
      if (w.bild_pfad) {
        const { data: s } = await supabase.storage
          .from("aenderungswuensche").createSignedUrl(w.bild_pfad, 3600);
        if (s?.signedUrl) b[w.id] = s.signedUrl;
      }
      if (w.audio_pfad) {
        const { data: s } = await supabase.storage
          .from("aenderungswuensche").createSignedUrl(w.audio_pfad, 3600);
        if (s?.signedUrl) t[w.id] = s.signedUrl;
      }
    }));
    setBilder(b);
    setToene(t);
    setLaedt(false);
  }, []);

  useEffect(() => { laden(); }, [laden]);

  /**
   * Nachzieher: Eine Abschrift, die beim Absenden nicht durchkam (der
   * Browser bricht laufende Anfragen beim Seitenwechsel ab), wird hier
   * nachgeholt. Genau hier landet Christoph ohnehin, wenn er die Wünsche
   * abholt — also merkt niemand etwas davon.
   */
  useEffect(() => {
    const liegen = wuensche.filter((w) => w.abschrift === "offen" && w.audio_pfad);
    if (!liegen.length) return;
    let abgebrochen = false;
    (async () => {
      for (const w of liegen) {
        if (abgebrochen) return;
        await supabase.functions
          .invoke("sprache-zu-text", { body: { wunschId: w.id, audioPfad: w.audio_pfad } })
          .catch(() => { /* Fehler steht danach am Wunsch */ });
      }
      if (!abgebrochen) laden();
    })();
    return () => { abgebrochen = true; };
    // Bewusst nur an der Zahl der offenen hängen — sonst dreht sich der
    // Effekt im Kreis, weil laden() den Zustand neu setzt.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wuensche.filter((w) => w.abschrift === "offen" && w.audio_pfad).length]);

  // Läuft gerade eine Abschrift? Dann in Ruhe nachsehen, bis sie durch ist.
  useEffect(() => {
    const offen = wuensche.some((w) => w.abschrift === "offen" || w.abschrift === "laeuft");
    if (!offen) return;
    const t = setTimeout(() => laden(), 6000);
    return () => clearTimeout(t);
  }, [wuensche, laden]);

  const setzen = async (id: string, felder: Partial<Wunsch>) => {
    const { error } = await supabase
      .from("aenderungswuensche").update(felder as never).eq("id", id);
    if (error) { toast({ variant: "destructive", title: "Nicht gespeichert", description: error.message }); return; }
    setWuensche((v) => v.map((w) => (w.id === id ? { ...w, ...felder } : w)));
  };

  const loeschen = async (w: Wunsch) => {
    if (!window.confirm("Diesen Änderungswunsch endgültig löschen?")) return;
    setArbeitet(w.id);
    // Erst die Dateien, dann die Zeile — sonst bleiben Leichen im Ablagebereich.
    const pfade = [w.bild_pfad, w.audio_pfad].filter(Boolean) as string[];
    if (pfade.length) await supabase.storage.from("aenderungswuensche").remove(pfade);
    const { error } = await supabase.from("aenderungswuensche").delete().eq("id", w.id);
    setArbeitet(null);
    if (error) { toast({ variant: "destructive", title: "Nicht gelöscht", description: error.message }); return; }
    setWuensche((v) => v.filter((x) => x.id !== w.id));
  };

  /** Abschrift erneut anstoßen — wenn sie beim ersten Mal schiefging. */
  const nochmalAbschreiben = async (w: Wunsch) => {
    if (!w.audio_pfad) return;
    setArbeitet(w.id);
    await setzen(w.id, { abschrift: "laeuft", abschrift_fehler: null });
    await supabase.functions.invoke("sprache-zu-text", {
      body: { wunschId: w.id, audioPfad: w.audio_pfad },
    }).catch(() => { /* Fehler landet am Wunsch */ });
    setArbeitet(null);
    setTimeout(() => laden(), 1500);
  };

  const sichtbar = nurOffene
    ? wuensche.filter((w) => w.status === "neu" || w.status === "gesehen")
    : wuensche;
  const offeneAnzahl = wuensche.filter((w) => w.status === "neu").length;

  /** Alles Sichtbare als Text für die Entwicklungs-KI. */
  const fuerKiKopieren = async () => {
    if (!sichtbar.length) return;
    const zeilen = sichtbar.map((w, i) => {
      const teile = [
        `## ${i + 1}. ${ART_TITEL[w.art] ?? w.art} — ${dat(w.created_at)}`,
        `Von: ${namen[w.erstellt_von ?? ""] ?? "Unbekannt"}`,
        w.seite ? `Seite: ${w.seite}` : null,
        w.audio_pfad ? "(gesprochen, automatisch abgeschrieben)" : null,
        "",
        w.text?.trim() || "(kein Text — Abschrift steht noch aus)",
        w.antwort?.trim() ? `\nNotiz: ${w.antwort.trim()}` : null,
      ].filter(Boolean);
      return teile.join("\n");
    });
    const text = `# Änderungswünsche CS Powermetall (${sichtbar.length})\n`
      + `Stand: ${new Date().toLocaleString("de-AT")}\n\n`
      + zeilen.join("\n\n---\n\n");
    try {
      await navigator.clipboard.writeText(text);
      toast({
        title: "Kopiert",
        description: `${sichtbar.length} Wünsche liegen in der Zwischenablage — direkt in die KI einfügen.`,
      });
    } catch {
      toast({ variant: "destructive", title: "Kopieren nicht möglich", description: "Bitte den Text von Hand markieren." });
    }
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="text-base flex items-center gap-2">
              <MessageSquarePlus className="h-4 w-4" />
              Änderungswünsche
              {offeneAnzahl > 0 && <Badge variant="destructive">{offeneAnzahl} neu</Badge>}
            </CardTitle>
            <CardDescription className="text-xs">
              Gemeldet über den Knopf unten rechts auf jeder Seite — mit Bildschirmfoto und Sprachnachricht.
            </CardDescription>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setNurOffene((v) => !v)}>
              {nurOffene ? "Auch erledigte" : "Nur offene"}
            </Button>
            <Button size="sm" variant="outline" className="gap-1.5" onClick={() => laden()}>
              <RefreshCw className="h-3.5 w-3.5" />
            </Button>
            <Button size="sm" className="gap-1.5" onClick={() => void fuerKiKopieren()} disabled={!sichtbar.length}>
              <Copy className="h-3.5 w-3.5" />
              Für KI kopieren
            </Button>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-3">
        {laedt && (
          <div className="flex items-center gap-2 py-3 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Lädt…
          </div>
        )}
        {!laedt && !sichtbar.length && (
          <p className="py-2 text-sm text-muted-foreground">
            {nurOffene ? "Nichts Offenes — alles abgearbeitet." : "Noch keine Änderungswünsche."}
          </p>
        )}

        {sichtbar.map((w) => {
          const Zeichen = ART_ZEICHEN[w.art] ?? Lightbulb;
          const laeuft = w.abschrift === "offen" || w.abschrift === "laeuft";
          return (
            <div key={w.id} className="rounded-md border p-3 space-y-2">
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <Zeichen className="h-4 w-4 shrink-0 text-muted-foreground" />
                <span className="font-medium">{ART_TITEL[w.art] ?? w.art}</span>
                {w.audio_pfad && (
                  <Badge variant="outline" className="gap-1 text-[10px]">
                    <Mic className="h-3 w-3" /> gesprochen
                  </Badge>
                )}
                {laeuft && (
                  <Badge variant="outline" className="gap-1 border-amber-300 bg-amber-50 text-[10px] text-amber-800">
                    <Loader2 className="h-3 w-3 animate-spin" /> wird abgeschrieben
                  </Badge>
                )}
                {w.abschrift === "fehler" && (
                  <Badge variant="destructive" className="text-[10px]">Abschrift fehlgeschlagen</Badge>
                )}
                <span className="ml-auto text-xs text-muted-foreground">
                  {namen[w.erstellt_von ?? ""] ?? "Unbekannt"} · {dat(w.created_at)}
                </span>
              </div>

              <p className="whitespace-pre-wrap text-sm">
                {w.text?.trim() || (
                  <span className="text-muted-foreground italic">
                    {laeuft ? "Abschrift läuft …" : "Kein Text"}
                  </span>
                )}
              </p>
              {w.abschrift_fehler && (
                <p className="text-xs text-destructive">{w.abschrift_fehler}</p>
              )}

              {w.seite && (
                <p className="text-xs text-muted-foreground">
                  Seite: <code className="rounded bg-muted px-1">{w.seite}</code>
                </p>
              )}

              {toene[w.id] && (
                <audio controls src={toene[w.id]} className="h-9 w-full max-w-sm" />
              )}
              {bilder[w.id] && (
                <a href={bilder[w.id]} target="_blank" rel="noreferrer">
                  <img src={bilder[w.id]} alt="Bildschirm"
                    className="max-h-56 w-full rounded-md border object-contain bg-muted/30" />
                </a>
              )}

              <div className="flex flex-wrap items-center gap-2">
                <Select value={w.status} onValueChange={(v) => setzen(w.id, { status: v })}>
                  <SelectTrigger className="h-8 w-40 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {STATUS.map((s) => (
                      <SelectItem key={s} value={s} className="text-xs">
                        {s === "neu" ? "Neu" : s === "gesehen" ? "Gesehen"
                          : s === "umgesetzt" ? "Umgesetzt" : "Abgelehnt"}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {w.audio_pfad && (w.abschrift === "fehler" || !w.text?.trim()) && (
                  <Button size="sm" variant="outline" className="h-8 gap-1.5 text-xs"
                    disabled={arbeitet === w.id}
                    onClick={() => void nochmalAbschreiben(w)}>
                    <RefreshCw className="h-3.5 w-3.5" /> Nochmal abschreiben
                  </Button>
                )}
                <Button size="icon" variant="ghost" className="h-8 w-8 ml-auto"
                  disabled={arbeitet === w.id}
                  onClick={() => void loeschen(w)} title="Löschen">
                  <Trash2 className="h-3.5 w-3.5 text-destructive" />
                </Button>
              </div>

              <Textarea
                className="min-h-14 text-sm"
                placeholder="Antwort oder Notiz"
                defaultValue={w.antwort ?? ""}
                onBlur={(e) => {
                  const wert = e.target.value.trim() || null;
                  if (wert !== (w.antwort ?? null)) void setzen(w.id, { antwort: wert });
                }}
              />
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
