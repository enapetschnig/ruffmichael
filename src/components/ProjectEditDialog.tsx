import { useEffect, useRef, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { saveUpdate, isOffline } from "@/lib/offlineData";
import type { Customer } from "@/pages/Customers";
import { plzAus, plzEingabe, PLZ_FEHLT } from "@/lib/plz";
import { KundenAuswahl, kundeAdresse, type Kunde } from "@/components/kunde/KundenAuswahl";
import { projektAdresse } from "@/components/projekt/NeuesProjektDialog";

// Minimale Projektform, die dieser Dialog bearbeiten kann.
export type EditableProject = {
  id: string;
  name: string;
  plz: string | null;
  adresse: string | null;
  beschreibung: string | null;
  customer_id?: string | null;
  status_id?: string | null;
};

export type CustomerOption = Pick<Customer, "id" | "vorname" | "nachname" | "strasse" | "ort">;
export type StatusOption = { id: string; name: string; color: string };

interface ProjectEditDialogProps {
  project: EditableProject | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Nicht mehr nötig — die Kundenauswahl lädt selbst. Bleibt für alte Aufrufer. */
  customers?: CustomerOption[];
  statuses: StatusOption[];
  onSaved: () => void;
}

/** „Grundäckergasse 14, 1100 Wien“ → Straße / PLZ / Ort für die getrennten Felder. */
const adresseTrennen = (adresse: string | null, plz: string | null) => {
  const text = String(adresse ?? "").trim();
  const m = text.match(/^(.*?)[,\s]+(?:[A-Z]{1,2}-)?(\d{4,5})\s+(.+)$/);
  if (m) return { strasse: m[1].trim(), plz: m[2], ort: m[3].trim() };
  return { strasse: text, plz: plz ?? "", ort: "" };
};

// Einheitlicher Dialog zum Bearbeiten von Projektdaten (Name, Kunde, Adresse,
// Ampel-Status, Beschreibung). Projektliste und Projekt-Übersicht benutzen ihn.
// Kundenauswahl und Adressfelder wie beim Anlegen (NeuesProjektDialog).
export function ProjectEditDialog({ project, open, onOpenChange, statuses, onSaved }: ProjectEditDialogProps) {
  const { toast } = useToast();
  const [form, setForm] = useState({
    name: "", strasse: "", plz: "", ort: "", beschreibung: "",
    customerId: "" as string, statusId: "none" as string,
  });
  const [saving, setSaving] = useState(false);
  // Zuletzt vom Kunden übernommene Adresse — nur die wird beim Kundenwechsel ersetzt
  const auto = useRef({ strasse: "", plz: "", ort: "" });

  // Formular bei jedem Öffnen mit den aktuellen Projektdaten vorbelegen.
  useEffect(() => {
    if (open && project) {
      const a = adresseTrennen(project.adresse, project.plz);
      setForm({
        name: project.name ?? "",
        strasse: a.strasse,
        plz: project.plz ?? a.plz,
        ort: a.ort,
        beschreibung: project.beschreibung ?? "",
        customerId: project.customer_id ?? "",
        statusId: project.status_id ?? "none",
      });
      auto.current = { strasse: "", plz: "", ort: "" };
    }
  }, [open, project]);

  const kundeWaehlen = (k: Kunde | null) => {
    const a = kundeAdresse(k);
    const vorher = auto.current; // der Updater läuft erst später, wenn auto.current schon neu ist
    setForm((alt) => {
      const neu = { ...alt, customerId: k?.id ?? "" };
      // Adresse vom Kunden übernehmen, wenn sie leer ist oder vom vorigen Kunden stammt
      const leerOderAuto = (["strasse", "plz", "ort"] as const).every((f) => !alt[f].trim() || alt[f] === vorher[f]);
      if (k && leerOderAuto) { neu.strasse = a.strasse; neu.plz = a.plz || alt.plz; neu.ort = a.ort; }
      return neu;
    });
    auto.current = { strasse: a.strasse, plz: a.plz, ort: a.ort };
  };

  const handleSave = async () => {
    if (!project || saving) return;
    // Bearbeiten bestehender Daten bleibt online-only (klarer Hinweis statt stillem Fehler).
    if (isOffline()) {
      toast({ variant: "destructive", title: "Nur mit Internet möglich", description: "Projekt-Änderungen brauchen eine Internetverbindung." });
      return;
    }
    if (!form.name.trim()) {
      toast({ variant: "destructive", title: "Fehler", description: "Projektname ist erforderlich" });
      return;
    }
    const plz = plzAus(form.plz);
    if (!plz) {
      toast({ variant: "destructive", title: "Postleitzahl fehlt", description: PLZ_FEHLT });
      return;
    }
    setSaving(true);
    const res = await saveUpdate("projects", { id: project.id }, {
      name: form.name.trim(),
      plz,
      adresse: projektAdresse(form.strasse, plz, form.ort) || null,
      beschreibung: form.beschreibung.trim() || null,
      customer_id: form.customerId || null,
      status_id: form.statusId !== "none" ? form.statusId : null,
    }, `Projekt ${form.name.trim()}`);
    setSaving(false);
    if (res.error) {
      toast({ variant: "destructive", title: "Fehler", description: "Projekt konnte nicht gespeichert werden" });
      return;
    }
    toast({ title: "Gespeichert", description: "Projekt wurde aktualisiert." });
    onOpenChange(false);
    onSaved();
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !saving && onOpenChange(o)}>
      <DialogContent className="max-w-[calc(100vw-1.5rem)] sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Projekt bearbeiten</DialogTitle>
          <DialogDescription>Projektdaten, Kunde und Ampel-Status ändern</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Kunde</Label>
            <KundenAuswahl wert={form.customerId} onChange={kundeWaehlen} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="edit-name">Projektname *</Label>
            <Input id="edit-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="edit-strasse">Straße</Label>
            <Input id="edit-strasse" value={form.strasse} onChange={(e) => setForm({ ...form, strasse: e.target.value })} placeholder="Straße und Hausnummer" />
          </div>
          <div className="grid grid-cols-[6.5rem_1fr] gap-3">
            <div className="space-y-2">
              <Label htmlFor="edit-plz">PLZ *</Label>
              <Input id="edit-plz" value={form.plz} inputMode="numeric" onChange={(e) => setForm({ ...form, plz: plzEingabe(e.target.value) })} placeholder="2700" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-ort">Ort</Label>
              <Input id="edit-ort" value={form.ort} onChange={(e) => setForm({ ...form, ort: e.target.value })} />
            </div>
          </div>
          <div className="space-y-2">
            <Label>Ampel-Status</Label>
            <Select value={form.statusId} onValueChange={(v) => setForm({ ...form, statusId: v })}>
              <SelectTrigger><SelectValue placeholder="Status wählen" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Kein Status</SelectItem>
                {statuses.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    <span className="inline-flex items-center gap-2">
                      <span className="h-3 w-3 rounded-full" style={{ backgroundColor: s.color }} />
                      {s.name}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="edit-beschreibung">Beschreibung</Label>
            <Textarea id="edit-beschreibung" value={form.beschreibung} onChange={(e) => setForm({ ...form, beschreibung: e.target.value })} className="min-h-20" />
          </div>
          <Button onClick={handleSave} disabled={saving} className="w-full">
            {saving ? "Speichern..." : "Änderungen speichern"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
