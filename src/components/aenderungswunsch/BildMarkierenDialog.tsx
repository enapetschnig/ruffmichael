import { useEffect, useRef, useState } from "react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Check, Eraser, Undo2, X } from "lucide-react";

/** Ein gezeichneter Strich in BILD-Koordinaten (nicht Bildschirm). */
type Strich = { x: number; y: number }[];

interface Props {
  open: boolean;
  /** Das Bildschirmfoto als data-URL. */
  bild: string;
  onAbbrechen: () => void;
  /** Liefert das Bild samt Einzeichnungen zurück. */
  onFertig: (bildMitStrichen: string) => void;
}

/**
 * Bildschirmfoto groß ansehen und einkreisen.
 *
 * Statt das Bild in einem kleinen Kasten hin- und herzuschieben, geht es
 * hier auf den ganzen Bildschirm — und man malt mit dem Finger einen Kreis
 * um die Stelle, um die es geht. Das sagt mehr als drei Sätze Beschreibung.
 *
 * Gezeichnet wird in BILD-Koordinaten: Die Striche sitzen dadurch immer
 * richtig, egal wie groß das Bild gerade dargestellt wird (Handy quer,
 * Fenster verkleinert …).
 */
export function BildMarkierenDialog({ open, bild, onAbbrechen, onFertig }: Props) {
  const leinwand = useRef<HTMLCanvasElement | null>(null);
  const bildRef = useRef<HTMLImageElement | null>(null);
  const [striche, setStriche] = useState<Strich[]>([]);
  const [maltGerade, setMaltGerade] = useState(false);
  const [bereit, setBereit] = useState(false);

  // Bild laden — erst danach kennen wir seine Maße.
  useEffect(() => {
    if (!open) { setStriche([]); setBereit(false); return; }
    const img = new Image();
    img.onload = () => { bildRef.current = img; setBereit(true); };
    img.src = bild;
  }, [open, bild]);

  /** Alles neu zeichnen: Bild, darüber die Striche. */
  useEffect(() => {
    const c = leinwand.current;
    const img = bildRef.current;
    if (!c || !img || !bereit) return;
    c.width = img.naturalWidth;
    c.height = img.naturalHeight;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(img, 0, 0);
    // Strichstärke am Bild ausrichten, damit sie auf großen wie kleinen
    // Bildern gleich kräftig wirkt.
    ctx.lineWidth = Math.max(3, Math.round(img.naturalWidth / 300));
    ctx.strokeStyle = "#e11d48";
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    for (const s of striche) {
      if (s.length < 2) continue;
      ctx.beginPath();
      ctx.moveTo(s[0].x, s[0].y);
      for (const p of s.slice(1)) ctx.lineTo(p.x, p.y);
      ctx.stroke();
    }
  }, [striche, bereit]);

  /** Bildschirm- zu Bild-Koordinaten. */
  const punkt = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const c = leinwand.current!;
    const r = c.getBoundingClientRect();
    return {
      x: ((e.clientX - r.left) / r.width) * c.width,
      y: ((e.clientY - r.top) / r.height) * c.height,
    };
  };

  const anfangen = (e: React.PointerEvent<HTMLCanvasElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    setMaltGerade(true);
    setStriche((alt) => [...alt, [punkt(e)]]);
  };

  const weiter = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!maltGerade) return;
    const p = punkt(e);
    setStriche((alt) => {
      if (!alt.length) return alt;
      const kopie = [...alt];
      kopie[kopie.length - 1] = [...kopie[kopie.length - 1], p];
      return kopie;
    });
  };

  const aufhoeren = () => setMaltGerade(false);

  const fertig = () => {
    const c = leinwand.current;
    if (!c) { onAbbrechen(); return; }
    onFertig(c.toDataURL("image/jpeg", 0.85));
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onAbbrechen(); }}>
      {/* Vollbild: Die Basis-Positionierung wird überschrieben, 100dvh
          statt 100vh wegen der Adressleiste am Handy. */}
      <DialogContent
        className="left-0 top-0 translate-x-0 translate-y-0 w-screen max-w-none h-[100dvh] max-h-none rounded-none border-0 gap-0 p-0 grid-rows-[auto_minmax(0,1fr)_auto] bg-neutral-900"
        data-bildschirmfoto="aus"
      >
        <DialogTitle className="px-4 py-3 text-sm font-medium text-white/90 border-b border-white/10">
          Mit dem Finger einkreisen, worum es geht
        </DialogTitle>

        <div className="flex items-center justify-center overflow-hidden p-2">
          {bereit ? (
            <canvas
              ref={leinwand}
              onPointerDown={anfangen}
              onPointerMove={weiter}
              onPointerUp={aufhoeren}
              onPointerCancel={aufhoeren}
              // touch-none: Sonst scrollt das Handy statt zu zeichnen.
              className="max-h-full max-w-full touch-none cursor-crosshair rounded bg-white"
            />
          ) : (
            <p className="text-sm text-white/70">Bild wird geladen …</p>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2 border-t border-white/10 px-4 py-3">
          <Button
            type="button" variant="outline" size="sm" className="gap-2"
            onClick={() => setStriche((alt) => alt.slice(0, -1))}
            disabled={!striche.length}
          >
            <Undo2 className="h-4 w-4" /> Zurück
          </Button>
          <Button
            type="button" variant="outline" size="sm" className="gap-2"
            onClick={() => setStriche([])}
            disabled={!striche.length}
          >
            <Eraser className="h-4 w-4" /> Alles weg
          </Button>
          <div className="ml-auto flex gap-2">
            <Button type="button" variant="outline" size="sm" className="gap-2" onClick={onAbbrechen}>
              <X className="h-4 w-4" /> Abbrechen
            </Button>
            <Button type="button" size="sm" className="gap-2" onClick={fertig} disabled={!bereit}>
              <Check className="h-4 w-4" /> Übernehmen
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
