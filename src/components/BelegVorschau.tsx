import { useEffect, useRef } from "react";
import { Download, Printer, ExternalLink } from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

/**
 * Rechnungs-/Angebotsvorschau im Fenster (wie bei Holzbau Lutz / Monti.pro):
 * das PDF wird in einem eingebetteten Rahmen gezeigt, dazu Drucken, Herunter-
 * laden und „in neuem Tab öffnen“. Funktioniert auch als installierte App am
 * Handy, wo window.open mit Blob-Adressen oft blockiert wird.
 */
export function BelegVorschau({
  open, onClose, titel, url, dateiname, entwurf,
}: {
  open: boolean;
  onClose: () => void;
  titel: string;
  url: string | null;      // Blob-URL (Entwurf) oder signierte URL (festgeschrieben)
  dateiname: string;
  entwurf?: boolean;
}) {
  const frame = useRef<HTMLIFrameElement>(null);

  // Blob-URLs nach dem Schließen wieder freigeben
  useEffect(() => {
    return () => { if (url && url.startsWith("blob:")) URL.revokeObjectURL(url); };
  }, [url]);

  const drucken = () => {
    try { frame.current?.contentWindow?.print(); }
    catch { if (url) window.open(url, "_blank"); }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-[calc(100vw-1rem)] sm:max-w-4xl h-[92vh] p-0 gap-0 flex flex-col overflow-hidden">
        {/* pr-12: Platz für das eingebaute Schließen-X des Dialogs oben rechts */}
        <div className="flex items-center gap-2 pl-3 sm:pl-4 pr-12 py-2 border-b shrink-0 flex-wrap">
          <DialogTitle className="text-sm sm:text-base font-semibold truncate flex-1 min-w-0">
            {titel}{entwurf ? <span className="ml-2 text-xs font-normal text-muted-foreground">Vorschau · noch ohne Nummer</span> : null}
          </DialogTitle>
          {url && (
            <>
              <Button variant="outline" size="sm" className="gap-1" onClick={drucken}><Printer className="h-4 w-4" /><span className="hidden sm:inline">Drucken</span></Button>
              <Button variant="outline" size="sm" className="gap-1" asChild>
                <a href={url} download={dateiname}><Download className="h-4 w-4" /><span className="hidden sm:inline">Herunterladen</span></a>
              </Button>
              <Button variant="outline" size="sm" className="gap-1" asChild>
                <a href={url} target="_blank" rel="noreferrer"><ExternalLink className="h-4 w-4" /><span className="hidden sm:inline">Neuer Tab</span></a>
              </Button>
            </>
          )}
        </div>
        <div className="flex-1 min-h-0 bg-muted/40">
          {url ? (
            <iframe ref={frame} src={url} title={titel} className="w-full h-full border-0 bg-white" />
          ) : (
            <div className="h-full flex items-center justify-center text-sm text-muted-foreground">PDF wird erzeugt…</div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default BelegVorschau;
