import { useCallback, useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Check, PartyPopper, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

interface Erledigt {
  id: string;
  text: string;
  art: string;
  status: string;
  antwort: string | null;
  updated_at: string;
}

const ART_TITEL: Record<string, string> = {
  fehler: "Passt nicht", wunsch: "Wunsch", frage: "Frage",
};

/**
 * "Dein Wunsch ist erledigt" — auf der Startseite, einmal.
 *
 * Wer einen Änderungswunsch meldet, soll erfahren, dass etwas passiert ist,
 * ohne im Adminbereich nachzusehen. Gezeigt werden nur die EIGENEN Wünsche,
 * die auf umgesetzt oder abgelehnt stehen und noch nicht zur Kenntnis
 * genommen wurden. Ein Klick auf "Verstanden" (oder das X je Zeile) setzt
 * melder_gesehen_am — danach ist der Hinweis dauerhaft weg, auch am anderen
 * Gerät.
 */
export function ErledigteWuensche() {
  const [liste, setListe] = useState<Erledigt[]>([]);
  const [arbeitet, setArbeitet] = useState(false);

  const laden = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const { data } = await supabase
      .from("aenderungswuensche")
      .select("id, text, art, status, antwort, updated_at")
      .eq("erstellt_von", user.id)
      .in("status", ["umgesetzt", "abgelehnt"])
      .is("melder_gesehen_am", null)
      .order("updated_at", { ascending: false })
      .limit(20);
    setListe((data ?? []) as unknown as Erledigt[]);
  }, []);

  useEffect(() => { laden(); }, [laden]);

  const wegklicken = async (ids: string[]) => {
    if (!ids.length) return;
    setArbeitet(true);
    await supabase
      .from("aenderungswuensche")
      .update({ melder_gesehen_am: new Date().toISOString() } as never)
      .in("id", ids);
    setListe((alt) => alt.filter((w) => !ids.includes(w.id)));
    setArbeitet(false);
  };

  if (!liste.length) return null;

  const umgesetzt = liste.filter((w) => w.status === "umgesetzt").length;

  return (
    <Card className="mb-4 border-emerald-300 bg-emerald-50/70">
      <CardContent className="p-4 space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <PartyPopper className="h-5 w-5 shrink-0 text-emerald-700" />
          <p className="font-medium text-emerald-900">
            {umgesetzt > 0
              ? `${umgesetzt} ${umgesetzt === 1 ? "Änderungswunsch wurde" : "Änderungswünsche wurden"} umgesetzt`
              : "Antwort auf deinen Änderungswunsch"}
          </p>
          <Button
            size="sm" variant="outline" className="ml-auto gap-1.5 bg-background"
            disabled={arbeitet}
            onClick={() => wegklicken(liste.map((w) => w.id))}
          >
            <Check className="h-4 w-4" />
            Verstanden
          </Button>
        </div>

        <ul className="space-y-2">
          {liste.map((w) => (
            <li key={w.id} className="rounded-md border bg-background/80 px-3 py-2 text-sm">
              <div className="flex flex-wrap items-start gap-2">
                <Badge
                  variant="outline"
                  className={w.status === "umgesetzt"
                    ? "shrink-0 border-emerald-300 bg-emerald-100 text-emerald-800"
                    : "shrink-0 border-amber-300 bg-amber-50 text-amber-800"}
                >
                  {w.status === "umgesetzt" ? "erledigt" : "nicht umgesetzt"}
                </Badge>
                <span className="text-xs text-muted-foreground">
                  {ART_TITEL[w.art] ?? w.art}
                </span>
                <Button
                  size="icon" variant="ghost" className="ml-auto h-6 w-6 shrink-0"
                  title="Diesen Hinweis ausblenden"
                  disabled={arbeitet}
                  onClick={() => wegklicken([w.id])}
                >
                  <X className="h-3.5 w-3.5" />
                </Button>
              </div>
              <p className="mt-1 whitespace-pre-wrap">{w.text}</p>
              {w.antwort?.trim() && (
                <p className="mt-1.5 rounded bg-muted/60 px-2 py-1.5 text-xs whitespace-pre-wrap">
                  {w.antwort}
                </p>
              )}
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
