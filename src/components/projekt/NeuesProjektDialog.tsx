import { useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { KundenAuswahl, kundeAdresse, type Kunde } from "@/components/kunde/KundenAuswahl";
import { fetchStatusesCached, type CachedStatus } from "@/lib/cachedQueries";
import { newId, saveInsert, saveInvoke, saveUpload } from "@/lib/offlineData";
import { STANDARD_PROJECT_FOLDERS } from "@/lib/projectFolders";
import { PLZ_FEHLT, plzAus, plzEingabe } from "@/lib/plz";

const leer = { name: "", strasse: "", plz: "", ort: "", beschreibung: "", statusId: "none" };

/** Projektadresse wie bisher in einem Feld: „Grundäckergasse 14, 1100 Wien“. */
export const projektAdresse = (strasse: string, plz: string, ort: string) =>
  [strasse.trim(), [plz.trim(), ort.trim()].filter(Boolean).join(" ")].filter(Boolean).join(", ");

/**
 * DER „Neues Projekt“-Dialog — Projektliste, Dashboard und Zeiterfassung benutzen ihn gemeinsam.
 * Kunde wählen (oder direkt anlegen) → Name, Straße, PLZ und Ort stehen sofort sichtbar drin.
 */
export function NeuesProjektDialog({ open, onOpenChange, onErstellt }: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onErstellt?: (projekt: { id: string; name: string; queued: boolean }) => void;
}) {
  const { toast } = useToast();
  const [f, setF] = useState(leer);
  const [kunde, setKunde] = useState<Kunde | null>(null);
  const [statuses, setStatuses] = useState<CachedStatus[]>([]);
  const [speichert, setSpeichert] = useState(false);
  // Was zuletzt automatisch vom Kunden kam — nur das wird beim Kundenwechsel überschrieben,
  // selbst Getipptes bleibt stehen.
  const auto = useRef({ name: "", strasse: "", plz: "", ort: "" });

  useEffect(() => {
    if (!open) return;
    setF(leer);
    setKunde(null);
    auto.current = { name: "", strasse: "", plz: "", ort: "" };
    fetchStatusesCached().then(({ data }) => setStatuses((data as CachedStatus[]) ?? []));
  }, [open]);

  const kundeWaehlen = (k: Kunde | null) => {
    setKunde(k);
    const a = kundeAdresse(k);
    const vorschlag = {
      name: k ? (k.firma?.trim() || [k.nachname, k.vorname].filter(Boolean).join(" ")).trim() : "",
      strasse: a.strasse, plz: a.plz, ort: a.ort,
    };
    // Vorigen Stand festhalten — der Updater läuft erst später, wenn auto.current schon neu ist
    const vorher = auto.current;
    setF((alt) => {
      const neu = { ...alt };
      for (const feld of ["name", "strasse", "plz", "ort"] as const) {
        // Feld leer oder noch vom vorigen Kunden befüllt → neuen Wert übernehmen
        if (!alt[feld].trim() || alt[feld] === vorher[feld]) neu[feld] = vorschlag[feld];
      }
      return neu;
    });
    auto.current = vorschlag;
  };

  const erstellen = async () => {
    if (speichert) return;
    if (!f.name.trim()) return toast({ variant: "destructive", title: "Projektname fehlt", description: "Bitte einen Namen für das Projekt eingeben." });
    const plz = plzAus(f.plz);
    if (!plz) return toast({ variant: "destructive", title: "Postleitzahl fehlt", description: PLZ_FEHLT });
    setSpeichert(true);
    const name = f.name.trim();
    const label = `Projekt ${name}`;
    const id = newId();
    try {
      const r = await saveInsert("projects", {
        id,
        name,
        plz,
        adresse: projektAdresse(f.strasse, plz, f.ort) || null,
        beschreibung: f.beschreibung.trim() || null,
        customer_id: kunde?.id ?? null,
        status_id: f.statusId !== "none" ? f.statusId : null,
      }, label);
      if (r.error) {
        toast({ variant: "destructive", title: "Projekt nicht erstellt", description: r.error });
        return;
      }
      let queued = r.queued;
      // Standardordner (bei Warteschlange ebenfalls in die Warteschlange, in der richtigen Reihenfolge)
      for (const ordner of STANDARD_PROJECT_FOLDERS) {
        const fr = await saveUpload({ bucket: "project-files", path: `${id}/${ordner}/.keep`, blob: new Blob([""], { type: "text/plain" }) }, label, queued);
        queued = queued || fr.queued;
      }
      // OneDrive-Ordner sofort anlegen — Fehler stören nicht, der 10-Minuten-Abgleich holt es nach
      void saveInvoke("onedrive-sync", { projectId: id }, `OneDrive-Ordner: ${name}`, queued);
      toast({
        title: queued ? "Offline gespeichert" : "Projekt erstellt",
        description: queued ? "Das Projekt wird angelegt, sobald wieder Internet da ist." : `${name} ist angelegt (inkl. Standardordner).`,
      });
      onOpenChange(false);
      onErstellt?.({ id, name, queued });
    } finally {
      setSpeichert(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !speichert && onOpenChange(o)}>
      <DialogContent className="max-w-[calc(100vw-1.5rem)] sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Neues Projekt</DialogTitle>
          <DialogDescription>Kunde wählen – Adresse und PLZ werden übernommen.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>Kunde</Label>
            <KundenAuswahl wert={kunde?.id} onChange={kundeWaehlen} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="projekt-name">Projektname *</Label>
            <Input id="projekt-name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="z. B. Müller Heizungstausch" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="projekt-strasse">Straße</Label>
            <Input id="projekt-strasse" value={f.strasse} onChange={(e) => setF({ ...f, strasse: e.target.value })} placeholder="Straße und Hausnummer" />
          </div>
          <div className="grid grid-cols-[6.5rem_1fr] gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="projekt-plz">PLZ *</Label>
              <Input id="projekt-plz" inputMode="numeric" value={f.plz} onChange={(e) => setF({ ...f, plz: plzEingabe(e.target.value) })} placeholder="2700" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="projekt-ort">Ort</Label>
              <Input id="projekt-ort" value={f.ort} onChange={(e) => setF({ ...f, ort: e.target.value })} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="projekt-beschreibung">Beschreibung <span className="text-muted-foreground font-normal">(optional)</span></Label>
            <Textarea id="projekt-beschreibung" value={f.beschreibung} onChange={(e) => setF({ ...f, beschreibung: e.target.value })} placeholder="Kurze Projektbeschreibung …" className="min-h-20" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="projekt-status">Ampel-Status</Label>
            <Select value={f.statusId} onValueChange={(v) => setF({ ...f, statusId: v })}>
              <SelectTrigger id="projekt-status"><SelectValue placeholder="Status wählen" /></SelectTrigger>
              <SelectContent className="max-w-[calc(100vw-2rem)]">
                <SelectItem value="none">
                  <span className="flex items-center gap-2"><span className="h-3 w-3 rounded-full border-2 border-muted-foreground/50 shrink-0" />Kein Status</span>
                </SelectItem>
                {statuses.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    <span className="flex items-center gap-2"><span className="h-3 w-3 rounded-full shrink-0" style={{ backgroundColor: s.color }} />{s.name}</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button onClick={erstellen} disabled={speichert} className="w-full gap-1.5">
            {speichert && <Loader2 className="h-4 w-4 animate-spin" />}
            {speichert ? "Erstelle …" : "Projekt erstellen"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
