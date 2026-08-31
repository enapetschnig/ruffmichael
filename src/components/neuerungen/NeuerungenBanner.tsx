// ============================================================================
// NeuerungenBanner — "Das ist neu" ganz oben auf der Startseite.
//
// Kundenwunsch 26.08.2026: Nach einem Update soll man auf der Startseite
// sehen, WAS umgesetzt wurde (kurz und wie es zu bedienen ist) — samt
// Hinweis, die App einmal neu zu laden. Danach ist die Meldung weg.
//
// „Weg" heisst: je Benutzer vermerkt (neuerungen_gelesen), nicht im Browser —
// sonst käme die Meldung am Handy noch einmal, obwohl sie am Rechner schon
// bestätigt wurde.
// ============================================================================
import { useCallback, useEffect, useState } from "react";
import { Sparkles, X, RefreshCw } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";

interface Neuerung {
  id: string;
  titel: string;
  text: string | null;
  created_at: string;
}

/** Tabellen fehlen in den generierten Supabase-Typen → wie üblich gecastet. */
const neuerungenTable = () => (supabase.from("neuerungen" as never) as any);
const gelesenTable = () => (supabase.from("neuerungen_gelesen" as never) as any);

export function NeuerungenBanner({ userId }: { userId: string }) {
  const [offen, setOffen] = useState<Neuerung[]>([]);
  const [schliesst, setSchliesst] = useState(false);

  const laden = useCallback(async () => {
    // Nur die letzten Wochen zeigen: Wer länger nicht in der App war (oder
    // neu dazukommt), soll nicht von alten Meldungen erschlagen werden —
    // die gelten als bekannt.
    const grenze = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const [{ data: alle }, { data: gelesen }] = await Promise.all([
      neuerungenTable()
        .select("id, titel, text, created_at")
        .gte("created_at", grenze)
        .order("created_at", { ascending: false })
        .limit(20),
      gelesenTable().select("neuerung_id").eq("user_id", userId),
    ]);
    const erledigt = new Set(((gelesen as { neuerung_id: string }[]) || []).map((g) => g.neuerung_id));
    setOffen(((alle as Neuerung[]) || []).filter((n) => !erledigt.has(n.id)));
  }, [userId]);

  useEffect(() => { void laden(); }, [laden]);

  const bestaetigen = async () => {
    if (offen.length === 0) return;
    setSchliesst(true);
    // Fehler hier dürfen den Anwender nicht aufhalten — im Zweifel erscheint
    // die Meldung noch einmal, statt dass etwas hängen bleibt.
    const { error } = await gelesenTable()
      .upsert(offen.map((n) => ({ neuerung_id: n.id, user_id: userId })), { onConflict: "neuerung_id,user_id" });
    setOffen([]);
    setSchliesst(false);
    if (error) console.warn("Neuerungen nicht als gelesen vermerkt:", error.message);
  };

  if (offen.length === 0) return null;

  return (
    <div className="mb-4 rounded-lg border border-kb-green/40 bg-[#F0F7EC] p-3 shadow-sm sm:mb-6" data-bildschirmfoto="aus">
      <div className="flex items-start gap-2">
        <Sparkles className="mt-0.5 h-5 w-5 shrink-0 text-kb-green" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-bold text-kb-blue-dark">
              Das ist neu {offen.length > 1 ? `(${offen.length} Änderungen)` : ""}
            </span>
            <span className="flex items-center gap-1 rounded-full bg-white/70 px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
              <RefreshCw className="h-3 w-3" />
              Bitte die App einmal ganz schließen und neu öffnen
            </span>
          </div>
          <ul className="mt-1.5 space-y-1.5">
            {offen.map((n) => (
              <li key={n.id} className="text-sm leading-snug">
                <span className="font-semibold">{n.titel}</span>
                {n.text && <span className="block text-[13px] text-foreground/80">{n.text}</span>}
              </li>
            ))}
          </ul>
          <Button
            size="sm"
            variant="outline"
            className="mt-2 h-9 bg-white"
            onClick={() => void bestaetigen()}
            disabled={schliesst}
          >
            Verstanden — nicht mehr anzeigen
          </Button>
        </div>
        <button
          type="button"
          onClick={() => void bestaetigen()}
          title="Ausblenden"
          aria-label="Ausblenden"
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-white/60"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
