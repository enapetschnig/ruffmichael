import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { saveUpdate, isOffline } from "@/lib/offlineData";
import { customerAddress, customerDisplayName, type Customer } from "@/pages/Customers";

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
  customers: CustomerOption[];
  statuses: StatusOption[];
  onSaved: () => void;
}

// Einheitlicher Dialog zum Bearbeiten von Projektdaten (Name, Kunde, PLZ,
// Adresse, Ampel-Status, Beschreibung). Wird sowohl in der Projektliste als
// auch in der Projekt-Übersicht verwendet, damit "Projekt bearbeiten" überall
// gleich funktioniert.
export function ProjectEditDialog({ project, open, onOpenChange, customers, statuses, onSaved }: ProjectEditDialogProps) {
  const { toast } = useToast();
  const [form, setForm] = useState({
    name: "", plz: "", adresse: "", beschreibung: "",
    customerId: "none" as string, statusId: "none" as string,
  });
  const [saving, setSaving] = useState(false);

  // Formular bei jedem Öffnen mit den aktuellen Projektdaten vorbelegen.
  useEffect(() => {
    if (open && project) {
      setForm({
        name: project.name ?? "",
        plz: project.plz ?? "",
        adresse: project.adresse ?? "",
        beschreibung: project.beschreibung ?? "",
        customerId: project.customer_id ?? "none",
        statusId: project.status_id ?? "none",
      });
    }
  }, [open, project]);

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
    if (!/^\d{4,5}$/.test(form.plz.trim())) {
      toast({ variant: "destructive", title: "Fehler", description: "PLZ muss 4-5 Ziffern enthalten" });
      return;
    }
    setSaving(true);
    // Adresse: leer -> aus gewähltem Kunden ableiten (wie bei der Anlage).
    let derivedAdresse = form.adresse.trim();
    if (!derivedAdresse && form.customerId !== "none") {
      const c = customers.find((c) => c.id === form.customerId);
      if (c) derivedAdresse = [c.strasse, c.ort].filter(Boolean).join(", ");
    }
    const res = await saveUpdate("projects", { id: project.id }, {
      name: form.name.trim(),
      plz: form.plz.trim(),
      adresse: derivedAdresse || null,
      beschreibung: form.beschreibung.trim() || null,
      customer_id: form.customerId !== "none" ? form.customerId : null,
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
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Projekt bearbeiten</DialogTitle>
          <DialogDescription>Projektdaten, Kunde und Ampel-Status ändern</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="edit-name">Projektname *</Label>
            <Input id="edit-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </div>
          <div className="space-y-2">
            <Label>Kunde</Label>
            <Select value={form.customerId} onValueChange={(v) => setForm({ ...form, customerId: v })}>
              <SelectTrigger><SelectValue placeholder="Kunde auswählen" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">— Kein Kunde —</SelectItem>
                {customers.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {customerDisplayName(c)}{customerAddress(c) ? ` (${customerAddress(c)})` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="edit-plz">PLZ *</Label>
            <Input id="edit-plz" value={form.plz} maxLength={5} onChange={(e) => setForm({ ...form, plz: e.target.value })} placeholder="z.B. 9613" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="edit-adresse">Adresse</Label>
            <Input id="edit-adresse" value={form.adresse} onChange={(e) => setForm({ ...form, adresse: e.target.value })} placeholder="Leer lassen = Adresse des Kunden" />
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
