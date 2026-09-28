import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Wrench, ChevronRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { heuteISO, plusTage } from "@/lib/faktura";
import { WartungAktionen } from "@/components/wartung/WartungAktionen";
import {
  STUFE_FARBE, WARTUNG_SELECT, datumAT, kundeText, restText, stufe, type WartungMitBezug,
} from "@/lib/wartung";

/**
 * Ganz oben am Dashboard: Wartungen, deren Vorwarnzeit begonnen hat oder die
 * überfällig sind. Direkt von hier: Mail an den Kunden, abschließen, Rechnung.
 */
export function WartungenFaellig() {
  const navigate = useNavigate();
  const [liste, setListe] = useState<WartungMitBezug[]>([]);

  const laden = useCallback(async () => {
    // Längste Vorwarnzeit ist 365 Tage — grob vorfiltern, genau rechnet stufe()
    const { data } = await supabase.from("wartungen").select(WARTUNG_SELECT)
      .eq("status", "offen").lte("faellig_am", plusTage(heuteISO(), 365)).order("faellig_am");
    const heute = heuteISO();
    setListe(((data ?? []) as unknown as WartungMitBezug[]).filter((w) => stufe(w, heute) !== "geplant"));
  }, []);

  useEffect(() => { laden(); }, [laden]);

  if (!liste.length) return null;

  return (
    <section aria-label="Fällige Wartungen" className="mb-4 rounded-lg border-2 border-orange-400 bg-orange-50 dark:bg-orange-950/20 p-3 sm:p-4">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Wrench className="h-5 w-5 shrink-0 text-orange-600" />
        <h2 className="text-base sm:text-lg font-bold flex-1 min-w-0">
          {liste.length === 1 ? "1 Wartung steht an" : `${liste.length} Wartungen stehen an`}
        </h2>
        <Button size="sm" variant="ghost" className="gap-1" onClick={() => navigate("/wartungen")}>
          Alle Wartungen <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
      <div className="space-y-2">
        {liste.map((w) => {
          const s = stufe(w);
          return (
            <div key={w.id} className={`rounded-md border border-l-4 ${STUFE_FARBE[s].rand} bg-background p-3 space-y-2`}>
              <div className="flex flex-col-reverse sm:flex-row items-start gap-1 sm:gap-2">
                <div className="min-w-0 flex-1">
                  <p className="font-semibold break-words">{w.bezeichnung}</p>
                  <p className="text-sm text-muted-foreground break-words">
                    {[kundeText(w.customers), w.projects?.name].filter(Boolean).join(" · ") || "ohne Kunde"}
                  </p>
                </div>
                <div className="sm:text-right shrink-0 flex sm:block items-center gap-2">
                  <Badge className={STUFE_FARBE[s].badge}>{restText(w.faellig_am)}</Badge>
                  <p className="text-xs text-muted-foreground sm:mt-1">{datumAT(w.faellig_am)}</p>
                </div>
              </div>
              {w.mail_gesendet_am && (
                <p className="text-xs text-muted-foreground">Mail an den Kunden geschickt am {datumAT(w.mail_gesendet_am.slice(0, 10))}</p>
              )}
              <WartungAktionen w={w} onGeaendert={laden} kompakt />
            </div>
          );
        })}
      </div>
    </section>
  );
}
