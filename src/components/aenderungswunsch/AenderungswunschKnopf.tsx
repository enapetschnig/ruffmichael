import { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { MessageSquarePlus } from "lucide-react";
import { bildschirmfotoMachen } from "@/lib/bildschirmfoto";
import { AenderungswunschDialog } from "./AenderungswunschDialog";

/**
 * Der Melde-Knopf.
 *
 * Die Reihenfolge ist der ganze Trick: ERST das Bildschirmfoto, DANN der
 * Dialog. Andersherum wäre auf dem Bild nur das Meldefenster zu sehen.
 *
 * Zwei Erscheinungsformen:
 *   "kopf"      — in der Kopfzeile rechts oben (PageHeader), gut sichtbar
 *   "schwebend" — unten rechts, für die Seiten OHNE Kopfzeile. Er blendet
 *                 sich selbst aus, sobald auf der Seite ein [data-seitenkopf]
 *                 steht — sonst gäbe es den Knopf zweimal.
 *
 * `data-bildschirmfoto="aus"` hält ihn aus dem Bild heraus.
 */
export function AenderungswunschKnopf({
  gestalt = "kopf",
}: { gestalt?: "kopf" | "schwebend" }) {
  const ort = useLocation();
  const [offen, setOffen] = useState(false);
  const [bild, setBild] = useState<string | null>(null);
  const [seite, setSeite] = useState("");
  const [arbeitet, setArbeitet] = useState(false);
  /** Nur für die schwebende Form: Gibt es hier schon eine Kopfzeile? */
  const [kopfDa, setKopfDa] = useState(false);

  useEffect(() => {
    if (gestalt !== "schwebend") return;
    // Die Kopfzeile erscheint auf manchen Seiten erst NACH dem Laden der
    // Daten — deshalb eine Weile lang immer wieder nachsehen, statt einmal
    // zu früh zu urteilen.
    setKopfDa(!!document.querySelector("[data-seitenkopf]"));
    let versuche = 0;
    const uhr = setInterval(() => {
      const da = !!document.querySelector("[data-seitenkopf]");
      setKopfDa(da);
      if (da || ++versuche > 12) clearInterval(uhr);   // längstens ~4 s
    }, 300);
    return () => clearInterval(uhr);
  }, [gestalt, ort.pathname]);

  const starten = async () => {
    setArbeitet(true);
    setSeite(ort.pathname);
    try {
      setBild(await bildschirmfotoMachen());
    } catch {
      setBild(null);
    }
    setArbeitet(false);
    setOffen(true);
  };

  if (gestalt === "schwebend" && kopfDa) return null;

  return (
    <>
      <Button
        type="button"
        variant={gestalt === "kopf" ? "outline" : "outline"}
        size={gestalt === "kopf" ? "sm" : "icon"}
        onClick={() => void starten()}
        disabled={arbeitet}
        title="Änderung vorschlagen — Bild vom Bildschirm ist automatisch dabei"
        aria-label="Änderung vorschlagen"
        data-bildschirmfoto="aus"
        className={
          gestalt === "kopf"
            ? "gap-2 print:hidden"
            // Über dem Menü-Knopf (der sitzt bottom-4 right-4), damit sich
            // beide nicht überdecken.
            : "fixed bottom-20 right-4 z-40 h-11 w-11 rounded-full shadow-md bg-background/90 backdrop-blur hover:bg-accent print:hidden"
        }
      >
        <MessageSquarePlus className={gestalt === "kopf" ? "h-4 w-4" : "h-5 w-5"} />
        {gestalt === "kopf" && (
          <span className="hidden sm:inline">{arbeitet ? "Moment…" : "Änderung melden"}</span>
        )}
      </Button>

      <AenderungswunschDialog
        open={offen}
        onOpenChange={setOffen}
        bild={bild}
        seite={seite || ort.pathname}
      />
    </>
  );
}
