import { useEffect, useState } from "react";
import { CheckCircle2, FileCheck, Loader2, PenLine } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SignaturePad } from "@/components/SignaturePad";
import { VoiceInputButton } from "@/components/VoiceInputButton";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { projectLabel } from "@/lib/projectLabel";
import { getSessionUser } from "@/lib/auth";
import { newId, saveInsert, saveInvoke } from "@/lib/offlineData";

// WICHTIG: Diese Komponente wird von Mitarbeitern und Kunden gesehen.
// Es dürfen hier NIEMALS Preise geladen oder angezeigt werden.

type UebernahmeProject = {
  id: string;
  name: string;
  adresse: string | null;
  customers?: {
    vorname: string | null;
    nachname: string | null;
    strasse: string | null;
    ort: string | null;
  } | null;
};

const PROJECT_SELECT = "id, name, adresse, customers(vorname, nachname, strasse, ort)";

const todayISO = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(
    now.getDate()
  ).padStart(2, "0")}`;
};

interface UebernahmeDialogProps {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  /** Projekt vorauswählen; wenn gesetzt, wird die Projektauswahl fixiert angezeigt */
  projectId?: string;
  /** Wird nach erfolgreichem Speichern aufgerufen */
  onCreated?: () => void;
}

export function UebernahmeDialog({
  open,
  onOpenChange,
  projectId,
  onCreated,
}: UebernahmeDialogProps): JSX.Element {
  const { toast } = useToast();

  const [projects, setProjects] = useState<UebernahmeProject[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState("");

  const [kundeName, setKundeName] = useState("");
  const [strasse, setStrasse] = useState("");
  const [plzOrt, setPlzOrt] = useState("");
  const [auftragNr, setAuftragNr] = useState("");
  const [zusatzLeistungen, setZusatzLeistungen] = useState("");
  const [leistungsverzeichnis, setLeistungsverzeichnis] = useState("");
  const [bedienungsanleitung, setBedienungsanleitung] = useState(false);
  const [ort, setOrt] = useState("");
  const [datum, setDatum] = useState(todayISO());

  const [signMode, setSignMode] = useState(false);
  const [signature, setSignature] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Formular bei jedem Öffnen zurücksetzen
  useEffect(() => {
    if (!open) return;
    setSelectedProjectId(projectId ?? "");
    setKundeName("");
    setStrasse("");
    setPlzOrt("");
    setAuftragNr("");
    setZusatzLeistungen("");
    setLeistungsverzeichnis("");
    setBedienungsanleitung(false);
    setOrt("");
    setDatum(todayISO());
    setSignMode(false);
    setSignature(null);
  }, [open, projectId]);

  // Projekte laden: fixes Projekt oder Auswahl aktiver Projekte
  useEffect(() => {
    if (!open) return;
    (async () => {
      if (projectId) {
        const { data } = await supabase
          .from("projects")
          .select(PROJECT_SELECT)
          .eq("id", projectId)
          .maybeSingle();
        setProjects(data ? [data as UebernahmeProject] : []);
        return;
      }
      const { data } = await supabase
        .from("projects")
        .select(PROJECT_SELECT)
        .eq("status", "aktiv")
        .order("name");
      setProjects((data as UebernahmeProject[]) ?? []);
    })();
  }, [open, projectId]);

  const selectedProject = projects.find((p) => p.id === selectedProjectId);
  const selectedProjectLabel = selectedProject ? projectLabel(selectedProject) : "";

  // Kundendaten aus dem Projekt übernehmen (nur leere Felder befüllen)
  useEffect(() => {
    if (!open || !selectedProject?.customers) return;
    const c = selectedProject.customers;
    const name = [c.vorname, c.nachname].filter(Boolean).join(" ").trim();
    if (name) setKundeName((prev) => (prev.trim() ? prev : name));
    if (c.strasse) setStrasse((prev) => (prev.trim() ? prev : c.strasse ?? ""));
    if (c.ort) setPlzOrt((prev) => (prev.trim() ? prev : c.ort ?? ""));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, selectedProject?.id, projects.length]);

  const applyVoiceResult = (extracted: any) => {
    const u = extracted?.uebernahme;
    if (!u) return;
    if (u.auftragNr) setAuftragNr(String(u.auftragNr));
    if (u.zusatzLeistungen) setZusatzLeistungen(String(u.zusatzLeistungen));
    if (u.leistungsverzeichnis) setLeistungsverzeichnis(String(u.leistungsverzeichnis));
    // Schalter nur einschalten, wenn per Sprache ausdrücklich bestätigt.
    // Niemals einen bereits gesetzten Schalter durch fehlende/false-Werte zurücksetzen.
    if (u.bedienungsanleitung === true) setBedienungsanleitung(true);
    if (u.ort) setOrt(String(u.ort));
    if (u.datum) setDatum(String(u.datum));
    // Kundenfelder nur überschreiben, wenn per Sprache etwas erkannt wurde
    if (u.kundeName) setKundeName(String(u.kundeName));
    if (u.strasse) setStrasse(String(u.strasse));
    if (u.plzOrt) setPlzOrt(String(u.plzOrt));
  };

  const validate = () => {
    if (!selectedProjectId) {
      toast({ variant: "destructive", title: "Fehler", description: "Bitte ein Projekt auswählen" });
      return false;
    }
    if (!kundeName.trim()) {
      toast({
        variant: "destructive",
        title: "Fehler",
        description: "Bitte den Kundennamen eingeben",
      });
      return false;
    }
    return true;
  };

  const handleGoToSign = () => {
    if (!validate()) return;
    setSignature(null);
    setSignMode(true);
  };

  const handleConfirmSign = async () => {
    if (!signature) {
      toast({
        variant: "destructive",
        title: "Unterschrift fehlt",
        description: "Bitte lassen Sie den Kunden unterschreiben",
      });
      return;
    }
    setSaving(true);
    try {
      const user = await getSessionUser();
      const uebId = newId();
      const label = `Übernahmebestätigung ${kundeName.trim()}`;

      const res = await saveInsert(
        "uebernahmen",
        {
          id: uebId,
          project_id: selectedProjectId,
          kunde_name: kundeName.trim(),
          strasse: strasse.trim() || null,
          plz_ort: plzOrt.trim() || null,
          auftrag_nr: auftragNr.trim() || null,
          zusatz_leistungen: zusatzLeistungen.trim() || null,
          leistungsverzeichnis: leistungsverzeichnis.trim() || null,
          bedienungsanleitung,
          ort: ort.trim() || null,
          datum: datum || todayISO(),
          unterschrift: signature,
          created_by: user?.id ?? null,
        },
        label
      );
      if (res.error) {
        toast({ variant: "destructive", title: "Fehler", description: res.error });
        return;
      }

      // PDF erzeugen – die Edge Function speichert das PDF selbst im Projektordner.
      // Wurde der Insert eingereiht (offline), MUSS auch der PDF-Aufruf in die
      // Warteschlange (force = res.queued), sonst liefe die Edge Function online
      // gegen einen Übernahme-Datensatz, der erst später synchronisiert wird.
      const pdfRes = await saveInvoke(
        "generate-uebernahme-pdf",
        { uebernahmeId: uebId },
        label,
        res.queued
      );

      if (res.queued || pdfRes.queued) {
        toast({
          title: "Offline gespeichert",
          description:
            "Die Übernahmebestätigung samt PDF wird erstellt, sobald wieder Internet da ist.",
        });
      } else if (pdfRes.error) {
        toast({
          variant: "destructive",
          title: "PDF-Erstellung fehlgeschlagen",
          description:
            "Die Übernahmebestätigung wurde gespeichert, das PDF konnte aber nicht erstellt werden. Erneut möglich über die Übersicht.",
        });
      } else {
        toast({
          title: "Übernahmebestätigung gespeichert",
          description:
            "Übernahmebestätigung als PDF im Projektordner (Abnahme Protokoll) gespeichert",
        });
      }

      onOpenChange(false);
      onCreated?.();
    } catch (error: unknown) {
      toast({
        variant: "destructive",
        title: "Fehler",
        description:
          error instanceof Error
            ? error.message
            : "Übernahmebestätigung konnte nicht gespeichert werden",
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileCheck className="h-5 w-5" />
            {signMode ? "Übernahmebestätigung unterschreiben" : "Übernahmebestätigung"}
          </DialogTitle>
          <DialogDescription>
            {signMode
              ? selectedProjectLabel || "Bestätigung der Übernahme unterschreiben"
              : "Übernahmebestätigung für ein Projekt erstellen"}
          </DialogDescription>
        </DialogHeader>

        {signMode ? (
          /* Unterschrifts-Ansicht: Zusammenfassung für den Kunden + SignaturePad */
          <div className="space-y-4">
            <Card>
              <CardContent className="p-4 space-y-3 text-sm">
                <div>
                  <p className="text-xs text-muted-foreground mb-0.5">Kunde</p>
                  <p className="font-semibold">{kundeName}</p>
                  {(strasse.trim() || plzOrt.trim()) && (
                    <p className="text-muted-foreground">
                      {[strasse.trim(), plzOrt.trim()].filter(Boolean).join(", ")}
                    </p>
                  )}
                </div>
                {auftragNr.trim() && (
                  <div>
                    <p className="text-xs text-muted-foreground mb-0.5">Auftragsbestätigung Nr.</p>
                    <p>{auftragNr}</p>
                  </div>
                )}
                {zusatzLeistungen.trim() && (
                  <div>
                    <p className="text-xs text-muted-foreground mb-0.5">
                      Zusätzlich aufgewendete Leistungen
                    </p>
                    <p className="whitespace-pre-wrap">{zusatzLeistungen}</p>
                  </div>
                )}
                {leistungsverzeichnis.trim() && (
                  <div>
                    <p className="text-xs text-muted-foreground mb-0.5">
                      Leistungsverzeichnis bei Regiemontagen
                    </p>
                    <p className="whitespace-pre-wrap">{leistungsverzeichnis}</p>
                  </div>
                )}
                <div>
                  <p className="text-xs text-muted-foreground mb-0.5">
                    Bedienungsanleitung übergeben
                  </p>
                  <p>{bedienungsanleitung ? "Ja" : "Nein"}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground mb-0.5">Ort / Datum</p>
                  <p>
                    {[ort.trim(), datum ? datum.split("-").reverse().join(".") : ""]
                      .filter(Boolean)
                      .join(", ")}
                  </p>
                </div>
              </CardContent>
            </Card>
            <div className="space-y-2">
              <Label>Unterschrift des Kunden</Label>
              <SignaturePad onSignatureChange={setSignature} />
            </div>
            <div className="flex flex-col-reverse sm:flex-row justify-end gap-2 pt-2 border-t">
              <Button variant="outline" onClick={() => setSignMode(false)} disabled={saving}>
                Zurück
              </Button>
              <Button onClick={handleConfirmSign} disabled={!signature || saving} className="gap-2">
                {saving ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Wird gespeichert...
                  </>
                ) : (
                  <>
                    <CheckCircle2 className="h-4 w-4" />
                    Bestätigen & PDF erstellen
                  </>
                )}
              </Button>
            </div>
          </div>
        ) : (
          /* Erfassungs-Ansicht */
          <div className="space-y-4">
            <VoiceInputButton
              mode="uebernahme"
              context={{}}
              onResult={(r) => applyVoiceResult(r.extracted)}
              label="Per Sprache ausfüllen"
            />

            <div className="space-y-1.5">
              <Label>Projekt {projectId ? "" : "*"}</Label>
              {projectId ? (
                <div className="rounded-md border bg-muted/50 px-3 py-2 text-sm">
                  {selectedProjectLabel || "Projekt wird geladen..."}
                </div>
              ) : (
                <Select value={selectedProjectId} onValueChange={setSelectedProjectId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Projekt auswählen" />
                  </SelectTrigger>
                  <SelectContent>
                    {projects.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {projectLabel(p)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="uebernahme-kunde-name">Kunden Name *</Label>
              <Input
                id="uebernahme-kunde-name"
                value={kundeName}
                onChange={(e) => setKundeName(e.target.value)}
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="uebernahme-strasse">Straße</Label>
                <Input
                  id="uebernahme-strasse"
                  value={strasse}
                  onChange={(e) => setStrasse(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="uebernahme-plz-ort">PLZ Ort</Label>
                <Input
                  id="uebernahme-plz-ort"
                  value={plzOrt}
                  onChange={(e) => setPlzOrt(e.target.value)}
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="uebernahme-auftrag-nr">Auftragsbestätigung Nr.</Label>
              <Input
                id="uebernahme-auftrag-nr"
                value={auftragNr}
                onChange={(e) => setAuftragNr(e.target.value)}
                placeholder="z. B. 2026 / 45"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="uebernahme-zusatz">Zusätzlich aufgewendete Leistungen</Label>
              <Textarea
                id="uebernahme-zusatz"
                value={zusatzLeistungen}
                onChange={(e) => setZusatzLeistungen(e.target.value)}
                rows={3}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="uebernahme-lv">Leistungsverzeichnis bei Regiemontagen</Label>
              <Textarea
                id="uebernahme-lv"
                value={leistungsverzeichnis}
                onChange={(e) => setLeistungsverzeichnis(e.target.value)}
                rows={3}
              />
            </div>

            <div className="flex items-center justify-between rounded-lg border p-3">
              <Label htmlFor="uebernahme-bedienungsanleitung" className="cursor-pointer">
                Bedienungsanleitung übergeben
              </Label>
              <Switch
                id="uebernahme-bedienungsanleitung"
                checked={bedienungsanleitung}
                onCheckedChange={setBedienungsanleitung}
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="uebernahme-ort">Ort</Label>
                <Input
                  id="uebernahme-ort"
                  value={ort}
                  onChange={(e) => setOrt(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="uebernahme-datum">Datum</Label>
                <Input
                  id="uebernahme-datum"
                  type="date"
                  value={datum}
                  onChange={(e) => setDatum(e.target.value)}
                />
              </div>
            </div>

            <div className="pt-2 border-t">
              <Button onClick={handleGoToSign} disabled={saving} className="w-full gap-2">
                <PenLine className="h-4 w-4" />
                Unterschreiben & PDF erstellen
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
