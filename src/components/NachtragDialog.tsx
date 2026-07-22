import { useEffect, useRef, useState } from "react";
import { CheckCircle2, FileSignature, Loader2, PenLine, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
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
import { MaterialPicker, type CatalogMaterial } from "@/components/MaterialPicker";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { projectLabel } from "@/lib/projectLabel";
import { getSessionUser } from "@/lib/auth";
import { newId, saveInsert } from "@/lib/offlineData";

// WICHTIG: Diese Komponente wird von Mitarbeitern und Kunden gesehen.
// Es dürfen hier NIEMALS Preise geladen oder angezeigt werden.

export type MaterialRow = {
  key: number;
  material: string;
  menge: string;
  einheit: string;
  material_id: string | null;
};

export type ProjectOption = {
  id: string;
  name: string;
  adresse: string | null;
  customers?: { strasse: string | null; ort: string | null } | null;
};

export type MaterialSummaryItem = {
  id: string;
  material: string;
  menge: string | null;
  einheit: string | null;
};

export const materialRowsToInserts = (nachtragId: string, rows: MaterialRow[]) =>
  rows
    .filter((r) => r.material.trim())
    .map((r) => ({
      nachtrag_id: nachtragId,
      material: r.material.trim(),
      menge: r.menge.trim() || null,
      einheit: r.einheit.trim() || null,
      material_id: r.material_id,
    }));

export const MaterialRowsEditor = ({
  rows,
  setRows,
  nextKey,
}: {
  rows: MaterialRow[];
  setRows: (rows: MaterialRow[]) => void;
  nextKey: () => number;
}) => {
  const updateRow = (key: number, patch: Partial<MaterialRow>) => {
    setRows(rows.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  };

  const addFromCatalog = (m: CatalogMaterial) => {
    setRows([
      ...rows,
      { key: nextKey(), material: m.name, menge: "", einheit: m.einheit ?? "", material_id: m.id },
    ]);
  };

  const addFreeRow = () => {
    setRows([...rows, { key: nextKey(), material: "", menge: "", einheit: "", material_id: null }]);
  };

  return (
    <div className="space-y-2">
      <Label>Material</Label>
      {rows.map((row) => (
        <div key={row.key} className="flex items-center gap-2">
          <Input
            placeholder="Material"
            value={row.material}
            onChange={(e) => updateRow(row.key, { material: e.target.value, material_id: null })}
            className="flex-1 min-w-0"
          />
          <Input
            placeholder="Menge"
            value={row.menge}
            onChange={(e) => updateRow(row.key, { menge: e.target.value })}
            className="w-16 sm:w-20 shrink-0"
          />
          <Input
            placeholder="Einh."
            value={row.einheit}
            onChange={(e) => updateRow(row.key, { einheit: e.target.value })}
            className="w-14 sm:w-20 shrink-0"
          />
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="shrink-0 text-destructive hover:text-destructive"
            onClick={() => setRows(rows.filter((r) => r.key !== row.key))}
            title="Zeile entfernen"
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      ))}
      <div className="flex flex-wrap gap-2 pt-1">
        <MaterialPicker onSelect={addFromCatalog} triggerLabel="Material aus Katalog" />
        <Button type="button" variant="outline" size="sm" onClick={addFreeRow} className="gap-1">
          <Plus className="h-4 w-4" />
          Zeile hinzufügen
        </Button>
      </div>
    </div>
  );
};

export const MaterialSummaryList = ({ materials }: { materials: MaterialSummaryItem[] }) => (
  <ul className="text-sm space-y-1">
    {materials.map((m) => (
      <li key={m.id} className="flex gap-2">
        <span>•</span>
        <span>
          {[m.menge, m.einheit].filter(Boolean).join(" ")}
          {(m.menge || m.einheit) && " "}
          {m.material}
        </span>
      </li>
    ))}
  </ul>
);

export interface NachtragDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Projekt vorauswählen; wenn gesetzt, wird die Projektauswahl fixiert angezeigt */
  projectId?: string;
  /** Wird nach erfolgreichem Speichern aufgerufen */
  onCreated?: () => void;
}

export function NachtragDialog({
  open,
  onOpenChange,
  projectId,
  onCreated,
}: NachtragDialogProps): JSX.Element {
  const { toast } = useToast();

  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState("");
  const [titel, setTitel] = useState("");
  const [beschreibung, setBeschreibung] = useState("");
  const [materials, setMaterials] = useState<MaterialRow[]>([]);
  const [signMode, setSignMode] = useState(false);
  const [signature, setSignature] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const keyCounter = useRef(0);
  const nextKey = () => ++keyCounter.current;

  // Formular bei jedem Öffnen zurücksetzen
  useEffect(() => {
    if (!open) return;
    setSelectedProjectId(projectId ?? "");
    setTitel("");
    setBeschreibung("");
    setMaterials([]);
    setSignMode(false);
    setSignature(null);
  }, [open, projectId]);

  // Aktive Projekte laden (für Auswahl bzw. fixe Anzeige)
  useEffect(() => {
    if (!open) return;
    (async () => {
      const { data } = await supabase
        .from("projects")
        .select("id, name, adresse, customers(strasse, ort)")
        .eq("status", "aktiv")
        .order("name");
      let list: ProjectOption[] = data ?? [];
      // Falls das vorgegebene Projekt nicht (mehr) aktiv ist, trotzdem nachladen
      if (projectId && !list.some((p) => p.id === projectId)) {
        const { data: single } = await supabase
          .from("projects")
          .select("id, name, adresse, customers(strasse, ort)")
          .eq("id", projectId)
          .maybeSingle();
        if (single) list = [...list, single];
      }
      setProjects(list);
    })();
  }, [open, projectId]);

  const selectedProject = projects.find((p) => p.id === selectedProjectId);
  const selectedProjectLabel = selectedProject ? projectLabel(selectedProject) : "";

  const materialsPreview: MaterialSummaryItem[] = materials
    .filter((r) => r.material.trim())
    .map((r) => ({
      id: String(r.key),
      material: r.material.trim(),
      menge: r.menge.trim() || null,
      einheit: r.einheit.trim() || null,
    }));

  const validate = () => {
    if (!selectedProjectId) {
      toast({ variant: "destructive", title: "Fehler", description: "Bitte ein Projekt auswählen" });
      return false;
    }
    if (!titel.trim()) {
      toast({ variant: "destructive", title: "Fehler", description: "Bitte einen Titel eingeben" });
      return false;
    }
    return true;
  };

  // Legt Nachtrag + Materialien offline-fähig an (Client-IDs, Eltern vor Kindern).
  // Rückgabe: queued=true, wenn (mind.) ein Schritt in die Warteschlange ging.
  const insertNachtrag = async (
    withSignature: boolean
  ): Promise<{ queued: boolean; error?: string }> => {
    const user = await getSessionUser();
    const nachtragId = newId();
    const label = `Nachtrag ${titel.trim()}`;

    const res = await saveInsert(
      "nachtraege",
      {
        id: nachtragId,
        project_id: selectedProjectId,
        titel: titel.trim(),
        beschreibung: beschreibung.trim() || null,
        created_by: user?.id ?? null,
        status: withSignature ? "unterschrieben" : "offen",
        unterschrift_kunde: withSignature ? signature : null,
        unterschrieben_am: withSignature ? new Date().toISOString() : null,
      },
      label
    );
    if (res.error) return res;
    let queued = res.queued;

    const materialInserts = materialRowsToInserts(nachtragId, materials).map((r) => ({
      ...r,
      id: newId(),
    }));
    if (materialInserts.length > 0) {
      const matRes = await saveInsert("nachtrag_materials", materialInserts, label, queued);
      if (matRes.error) return matRes;
      queued = queued || matRes.queued;
    }
    return { queued };
  };

  const handleSave = async () => {
    if (!validate()) return;
    setSaving(true);
    try {
      const res = await insertNachtrag(false);
      if (res.error) {
        toast({ variant: "destructive", title: "Fehler", description: res.error });
        return;
      }
      if (res.queued) {
        toast({
          title: "Offline gespeichert",
          description: "Wird automatisch gesendet, sobald wieder Internet da ist.",
        });
      } else {
        toast({ title: "Nachtrag angelegt", description: titel.trim() });
      }
      onOpenChange(false);
      onCreated?.();
    } catch (error: unknown) {
      toast({
        variant: "destructive",
        title: "Fehler",
        description:
          error instanceof Error ? error.message : "Nachtrag konnte nicht gespeichert werden",
      });
    } finally {
      setSaving(false);
    }
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
      const res = await insertNachtrag(true);
      if (res.error) {
        toast({ variant: "destructive", title: "Fehler", description: res.error });
        return;
      }
      if (res.queued) {
        toast({
          title: "Offline gespeichert",
          description: "Wird automatisch gesendet, sobald wieder Internet da ist.",
        });
      } else {
        toast({
          title: "Nachtrag unterschrieben",
          description: "Die Unterschrift des Kunden wurde gespeichert.",
        });
      }
      onOpenChange(false);
      onCreated?.();
    } catch (error: unknown) {
      toast({
        variant: "destructive",
        title: "Fehler",
        description:
          error instanceof Error ? error.message : "Unterschrift konnte nicht gespeichert werden",
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
            <FileSignature className="h-5 w-5" />
            {signMode ? "Nachtrag unterschreiben" : "Neuer Nachtrag"}
          </DialogTitle>
          <DialogDescription>
            {signMode
              ? selectedProjectLabel || "Zusatzauftrag unterschreiben"
              : "Zusatzauftrag für ein Projekt erfassen"}
          </DialogDescription>
        </DialogHeader>

        {signMode ? (
          /* Unterschrifts-Ansicht: Zusammenfassung für den Kunden + SignaturePad */
          <div className="space-y-4">
            <Card>
              <CardContent className="p-4 space-y-3 text-sm">
                <div>
                  <p className="text-xs text-muted-foreground mb-0.5">Nachtrag</p>
                  <p className="font-semibold">{titel}</p>
                </div>
                {beschreibung.trim() && (
                  <div>
                    <p className="text-xs text-muted-foreground mb-0.5">Beschreibung</p>
                    <p className="whitespace-pre-wrap">{beschreibung}</p>
                  </div>
                )}
                {materialsPreview.length > 0 && (
                  <div>
                    <p className="text-xs text-muted-foreground mb-0.5">Material</p>
                    <MaterialSummaryList materials={materialsPreview} />
                  </div>
                )}
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
                    Unterschrift bestätigen
                  </>
                )}
              </Button>
            </div>
          </div>
        ) : (
          /* Erfassungs-Ansicht */
          <div className="space-y-4">
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
              <Label htmlFor="nachtrag-dialog-titel">Titel *</Label>
              <Input
                id="nachtrag-dialog-titel"
                value={titel}
                onChange={(e) => setTitel(e.target.value)}
                placeholder="z. B. Zusätzliche Steckdosen Wohnzimmer"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="nachtrag-dialog-beschreibung">Beschreibung</Label>
              <Textarea
                id="nachtrag-dialog-beschreibung"
                value={beschreibung}
                onChange={(e) => setBeschreibung(e.target.value)}
                placeholder="Beschreibung der zusätzlichen Arbeiten..."
                rows={4}
              />
            </div>
            <MaterialRowsEditor rows={materials} setRows={setMaterials} nextKey={nextKey} />
            <div className="flex flex-col sm:flex-row gap-2 pt-2 border-t">
              <Button variant="outline" onClick={handleSave} disabled={saving} className="flex-1">
                {saving ? "Speichern..." : "Speichern"}
              </Button>
              <Button onClick={handleGoToSign} disabled={saving} className="flex-1 gap-2">
                <PenLine className="h-4 w-4" />
                Speichern & unterschreiben
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
