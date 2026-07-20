import { useEffect, useState } from "react";
import { CheckCircle2, ClipboardList, Loader2, Plus, Settings2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
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
import {
  VoiceInputButton,
  type VoiceContext,
  type VoiceResult,
} from "@/components/VoiceInputButton";
import {
  CustomerFormFields,
  customerFormToRow,
  customerDisplayName,
  customerAddress,
  type Customer,
} from "@/pages/Customers";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { newId, isOffline, saveInsert, saveUpload } from "@/lib/offlineData";

// WICHTIG: Diese Komponente wird von Mitarbeitern und Kunden gesehen.
// Es dürfen hier NIEMALS Preise geladen oder angezeigt werden.

// Standardordner für neue Projekte (identisch zu Projects.tsx)
const STANDARD_PROJECT_FOLDERS = [
  "Abnahme Protokoll",
  "Beschreibung",
  "Foto",
  "Hydraulik",
  "Programmierung",
];

const emptyCustomerForm = {
  vorname: "",
  nachname: "",
  strasse: "",
  ort: "",
  telefon: "",
  mobil: "",
  email: "",
  liefer_strasse: "",
  liefer_ort: "",
};

type ErstaufnahmeCustomer = Pick<
  Customer,
  "id" | "vorname" | "nachname" | "strasse" | "ort" | "telefon" | "email"
>;

type ChecklistItem = {
  id: string;
  text: string;
  sort_order: number;
  is_active: boolean;
};

type ChecklistEntryState = { erledigt: boolean; bemerkung: string };

/** Zeitstempel für Dateinamen: yyyy-MM-dd_HH-mm */
export const fileTimestamp = (d: Date = new Date()): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}` +
  `_${String(d.getHours()).padStart(2, "0")}-${String(d.getMinutes()).padStart(2, "0")}`;

const normalizeText = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();

export interface ErstaufnahmePrefill {
  existingCustomerId?: string;
  kunde?: {
    vorname?: string;
    nachname?: string;
    strasse?: string;
    ort?: string;
    telefon?: string;
    email?: string;
  };
  projektName?: string;
  notizen?: string;
  checklist?: { item: string; bemerkung?: string; erledigt?: boolean }[];
}

interface ErstaufnahmeDialogProps {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  prefill?: ErstaufnahmePrefill;
  onFinished?: (projectId: string) => void;
}

export function ErstaufnahmeDialog({
  open,
  onOpenChange,
  prefill,
  onFinished,
}: ErstaufnahmeDialogProps): JSX.Element {
  const { toast } = useToast();

  const [customers, setCustomers] = useState<ErstaufnahmeCustomer[]>([]);
  const [selectedCustomerId, setSelectedCustomerId] = useState("");
  const [newCustomerMode, setNewCustomerMode] = useState(false);
  const [customerForm, setCustomerForm] = useState(emptyCustomerForm);

  const [projektName, setProjektName] = useState("");
  const [notizen, setNotizen] = useState("");

  const [checklistItems, setChecklistItems] = useState<ChecklistItem[]>([]);
  const [checklistState, setChecklistState] = useState<Record<string, ChecklistEntryState>>({});
  const [editChecklist, setEditChecklist] = useState(false);
  const [newItemText, setNewItemText] = useState("");

  const [saving, setSaving] = useState(false);

  const activeItems = checklistItems.filter((i) => i.is_active);

  const entryFor = (id: string): ChecklistEntryState =>
    checklistState[id] ?? { erledigt: false, bemerkung: "" };

  const setEntry = (id: string, patch: Partial<ChecklistEntryState>) =>
    setChecklistState((s) => ({
      ...s,
      [id]: { ...(s[id] ?? { erledigt: false, bemerkung: "" }), ...patch },
    }));

  const fetchCustomers = async (): Promise<ErstaufnahmeCustomer[]> => {
    const { data } = await supabase
      .from("customers")
      .select("id, vorname, nachname, strasse, ort, telefon, email")
      .order("nachname")
      .order("vorname");
    const list = data ?? [];
    setCustomers(list);
    return list;
  };

  const fetchChecklistItems = async (): Promise<ChecklistItem[]> => {
    const { data } = await supabase
      .from("erstaufnahme_checklist_items")
      .select("id, text, sort_order, is_active")
      .order("sort_order", { ascending: true });
    const list = data ?? [];
    setChecklistItems(list);
    return list;
  };

  const applyPrefill = (p: ErstaufnahmePrefill, items: ChecklistItem[]) => {
    if (p.existingCustomerId) {
      setSelectedCustomerId(p.existingCustomerId);
      setNewCustomerMode(false);
    } else if (p.kunde && Object.values(p.kunde).some((v) => v && String(v).trim())) {
      const k = p.kunde;
      setNewCustomerMode(true);
      setCustomerForm((f) => ({
        ...f,
        vorname: k.vorname?.trim() || f.vorname,
        nachname: k.nachname?.trim() || f.nachname,
        strasse: k.strasse?.trim() || f.strasse,
        ort: k.ort?.trim() || f.ort,
        telefon: k.telefon?.trim() || f.telefon,
        email: k.email?.trim() || f.email,
      }));
    }
    if (p.projektName?.trim()) setProjektName(p.projektName.trim());
    if (p.notizen?.trim()) setNotizen(p.notizen.trim());
    if (Array.isArray(p.checklist)) {
      const active = items.filter((i) => i.is_active);
      for (const entry of p.checklist) {
        if (!entry?.item) continue;
        const n = normalizeText(entry.item);
        const match =
          active.find((i) => normalizeText(i.text) === n) ??
          active.find((i) => normalizeText(i.text).includes(n) || n.includes(normalizeText(i.text)));
        if (!match) continue;
        setEntry(match.id, {
          ...(typeof entry.erledigt === "boolean" ? { erledigt: entry.erledigt } : {}),
          ...(entry.bemerkung?.trim() ? { bemerkung: entry.bemerkung.trim() } : {}),
        });
      }
    }
  };

  // Bei jedem Öffnen: Formular zurücksetzen, Daten laden, Prefill anwenden
  useEffect(() => {
    if (!open) return;
    setSelectedCustomerId("");
    setNewCustomerMode(false);
    setCustomerForm(emptyCustomerForm);
    setProjektName("");
    setNotizen("");
    setChecklistState({});
    setEditChecklist(false);
    setNewItemText("");
    (async () => {
      const [, items] = await Promise.all([fetchCustomers(), fetchChecklistItems()]);
      if (prefill) applyPrefill(prefill, items);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, prefill]);

  const voiceContext: VoiceContext = {
    customers: customers.map((c) => ({
      id: c.id,
      name: customerDisplayName(c),
      email: c.email,
      adresse: customerAddress(c) || null,
      telefon: c.telefon,
    })),
    checklist: activeItems.map((i) => i.text),
  };

  const handleVoiceResult = (result: VoiceResult) => {
    const e = result.extracted?.erstaufnahme as ErstaufnahmePrefill | undefined;
    if (!e) return;
    applyPrefill(e, checklistItems);
  };

  // --- Checklisten-Editor: Änderungen werden sofort gespeichert ("Einstellung direkt vor Ort") ---

  const updateItemLocal = (id: string, patch: Partial<ChecklistItem>) =>
    setChecklistItems((items) => items.map((i) => (i.id === id ? { ...i, ...patch } : i)));

  const persistItemText = async (item: ChecklistItem) => {
    // Checklisten-Vorlage (Einstellung) nur mit Internet ändern.
    if (isOffline()) {
      toast({
        variant: "destructive",
        title: "Nur mit Internet möglich",
        description: "Die Checklisten-Vorlage kann nur mit Internetverbindung geändert werden.",
      });
      await fetchChecklistItems();
      return;
    }
    const text = item.text.trim();
    if (!text) {
      // Leeren Text nicht speichern – Stand aus der Datenbank wiederherstellen
      await fetchChecklistItems();
      return;
    }
    const { error } = await supabase
      .from("erstaufnahme_checklist_items")
      .update({ text })
      .eq("id", item.id);
    if (error) {
      toast({
        variant: "destructive",
        title: "Fehler",
        description: "Checklisten-Punkt konnte nicht gespeichert werden",
      });
      await fetchChecklistItems();
    }
  };

  const toggleItemActive = async (item: ChecklistItem, isActive: boolean) => {
    // Checklisten-Vorlage (Einstellung) nur mit Internet ändern.
    if (isOffline()) {
      toast({
        variant: "destructive",
        title: "Nur mit Internet möglich",
        description: "Die Checklisten-Vorlage kann nur mit Internetverbindung geändert werden.",
      });
      return;
    }
    updateItemLocal(item.id, { is_active: isActive });
    const { error } = await supabase
      .from("erstaufnahme_checklist_items")
      .update({ is_active: isActive })
      .eq("id", item.id);
    if (error) {
      updateItemLocal(item.id, { is_active: !isActive });
      toast({
        variant: "destructive",
        title: "Fehler",
        description: "Checklisten-Punkt konnte nicht aktualisiert werden",
      });
    }
  };

  const handleAddItem = async () => {
    const text = newItemText.trim();
    if (!text) return;
    // Checklisten-Vorlage (Einstellung) nur mit Internet ändern.
    if (isOffline()) {
      toast({
        variant: "destructive",
        title: "Nur mit Internet möglich",
        description: "Die Checklisten-Vorlage kann nur mit Internetverbindung geändert werden.",
      });
      return;
    }
    const maxSort = checklistItems.reduce((m, i) => Math.max(m, i.sort_order), 0);
    const { data, error } = await supabase
      .from("erstaufnahme_checklist_items")
      .insert({ text, sort_order: maxSort + 1 })
      .select("id, text, sort_order, is_active")
      .single();
    if (error || !data) {
      toast({
        variant: "destructive",
        title: "Fehler",
        description: "Checklisten-Punkt konnte nicht hinzugefügt werden",
      });
      return;
    }
    setChecklistItems((items) => [...items, data]);
    setNewItemText("");
  };

  // --- Abschluss ---

  const buildSummary = (
    customer: { vorname: string | null; nachname: string | null; strasse: string | null; ort: string | null; telefon: string | null; email: string | null },
    projectName: string,
    now: Date
  ): string => {
    const lines: string[] = [];
    lines.push("ERSTAUFNAHME");
    lines.push(
      `Datum: ${now.toLocaleDateString("de-AT")}, ${now.toLocaleTimeString("de-AT", { hour: "2-digit", minute: "2-digit" })} Uhr`
    );
    lines.push("");
    lines.push("KUNDE");
    lines.push(customerDisplayName({ vorname: customer.vorname ?? "", nachname: customer.nachname ?? "" }) || "-");
    const addr = customerAddress({ strasse: customer.strasse, ort: customer.ort });
    if (addr) lines.push(addr);
    if (customer.telefon) lines.push(`Telefon: ${customer.telefon}`);
    if (customer.email) lines.push(`E-Mail: ${customer.email}`);
    lines.push("");
    lines.push("PROJEKT");
    lines.push(`Projektname: ${projectName}`);
    lines.push("");
    lines.push("CHECKLISTE");
    if (activeItems.length === 0) {
      lines.push("-");
    } else {
      for (const item of activeItems) {
        const st = entryFor(item.id);
        lines.push(
          `${st.erledigt ? "✓" : "○"} ${item.text}${st.bemerkung.trim() ? ` – Bemerkung: ${st.bemerkung.trim()}` : ""}`
        );
      }
    }
    lines.push("");
    lines.push("NOTIZEN");
    lines.push(notizen.trim() || "-");
    return lines.join("\n");
  };

  const handleFinish = async () => {
    if (saving) return;

    if (newCustomerMode) {
      if (!customerForm.nachname.trim()) {
        toast({
          variant: "destructive",
          title: "Fehler",
          description: "Bitte Nachname des Kunden eingeben",
        });
        return;
      }
    } else if (!selectedCustomerId) {
      toast({
        variant: "destructive",
        title: "Fehler",
        description: "Bitte einen Kunden auswählen oder neu anlegen",
      });
      return;
    }

    setSaving(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();

      // Verfolgt, ob (mind.) ein Schritt in die Offline-Warteschlange ging.
      let queued = false;

      // (a) Kunde anlegen (Client-ID) oder bestehenden verwenden.
      // Für die Zusammenfassung brauchen wir die Kundendaten auch offline lokal.
      let customerId: string;
      const customer: {
        vorname: string | null;
        nachname: string | null;
        strasse: string | null;
        ort: string | null;
        telefon: string | null;
        email: string | null;
      } = { vorname: null, nachname: null, strasse: null, ort: null, telefon: null, email: null };

      if (newCustomerMode) {
        const row = customerFormToRow(customerForm);
        customerId = newId();
        const custRes = await saveInsert(
          "customers",
          { id: customerId, ...row, created_by: user?.id ?? null },
          `Kunde ${row.nachname || row.vorname || ""}`.trim()
        );
        if (custRes.error) {
          toast({
            variant: "destructive",
            title: "Fehler",
            description: "Kunde konnte nicht angelegt werden",
          });
          return;
        }
        queued = queued || custRes.queued;
        customer.vorname = row.vorname;
        customer.nachname = row.nachname;
        customer.strasse = row.strasse;
        customer.ort = row.ort;
        customer.telefon = row.telefon;
        customer.email = row.email;
      } else {
        const c = customers.find((c) => c.id === selectedCustomerId);
        if (!c) {
          toast({
            variant: "destructive",
            title: "Fehler",
            description: "Ausgewählter Kunde wurde nicht gefunden",
          });
          return;
        }
        customerId = c.id;
        customer.vorname = c.vorname;
        customer.nachname = c.nachname;
        customer.strasse = c.strasse;
        customer.ort = c.ort;
        customer.telefon = c.telefon;
        customer.email = c.email;
      }

      // (b) Projekt anlegen (Client-ID, Status: "Warte auf Angebotsbestätigung").
      // Status-Lesevorgang kann offline scheitern → dann einfach null.
      let statusId: string | null = null;
      try {
        const { data: statusRows } = await supabase
          .from("project_statuses")
          .select("id")
          .ilike("name", "%angebotsbest%")
          .limit(1);
        statusId = statusRows?.[0]?.id ?? null;
      } catch {
        statusId = null;
      }

      const plzMatch = (customer.ort ?? "").match(/\b(\d{4,5})\b/);
      const plz = plzMatch?.[1] ?? "0000";
      const adresse = [customer.strasse, customer.ort].filter(Boolean).join(", ") || null;
      const projectName =
        projektName.trim() ||
        [customer.nachname, customer.vorname].filter(Boolean).join(" ").trim() ||
        "Erstaufnahme";

      const projectId = newId();
      const projRes = await saveInsert(
        "projects",
        {
          id: projectId,
          name: projectName,
          plz,
          adresse,
          customer_id: customerId,
          status_id: statusId,
        },
        `Projekt ${projectName}`,
        queued
      );
      if (projRes.error) {
        toast({
          variant: "destructive",
          title: "Fehler",
          description: "Projekt konnte nicht erstellt werden",
        });
        return;
      }
      queued = queued || projRes.queued;

      // (c) Standardordner anlegen (leere Ordner via .keep-Platzhalter), sequenziell.
      for (const folder of STANDARD_PROJECT_FOLDERS) {
        const folderRes = await saveUpload(
          {
            bucket: "project-files",
            path: `${projectId}/${folder}/.keep`,
            blob: new Blob([""], { type: "text/plain" }),
            contentType: "text/plain",
          },
          `Ordner ${folder}`,
          queued
        );
        if (folderRes.queued) queued = true;
      }

      // (d) Erstaufnahme-Datensatz speichern (Client-ID)
      const checklistJson = activeItems.map((item) => {
        const st = entryFor(item.id);
        return { item: item.text, bemerkung: st.bemerkung.trim(), erledigt: st.erledigt };
      });
      const erstRes = await saveInsert(
        "erstaufnahmen",
        {
          id: newId(),
          customer_id: customerId,
          project_id: projectId,
          projekt_name: projectName,
          notizen: notizen.trim() || null,
          checklist: checklistJson,
          created_by: user?.id ?? null,
        },
        `Erstaufnahme ${projectName}`,
        queued
      );
      if (erstRes.queued) {
        queued = true;
      } else if (erstRes.error) {
        toast({
          variant: "destructive",
          title: "Fehler",
          description: "Erstaufnahme-Daten konnten nicht gespeichert werden (Projekt wurde angelegt)",
        });
      }

      // (e) Zusammenfassung als Textdatei in den Beschreibung-Ordner
      const now = new Date();
      const summary = buildSummary(customer, projectName, now);
      const txtRes = await saveUpload(
        {
          bucket: "project-files",
          path: `${projectId}/Beschreibung/Erstaufnahme_${fileTimestamp(now)}.txt`,
          blob: new Blob([summary], { type: "text/plain;charset=utf-8" }),
          contentType: "text/plain;charset=utf-8",
        },
        `Erstaufnahme-Zusammenfassung ${projectName}`,
        queued
      );
      if (txtRes.queued) {
        queued = true;
      } else if (txtRes.error) {
        toast({
          variant: "destructive",
          title: "Fehler",
          description: "Zusammenfassung konnte nicht hochgeladen werden (Projekt wurde angelegt)",
        });
      }

      // (f) Fertig
      if (queued) {
        toast({
          title: "Offline gespeichert",
          description: "Wird automatisch gesendet, sobald wieder Internet da ist.",
        });
      } else {
        toast({
          title: "Erstaufnahme abgeschlossen",
          description: "Projekt angelegt (Warte auf Angebotsbestätigung)",
        });
      }
      onFinished?.(projectId);
      onOpenChange(false);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ClipboardList className="h-5 w-5" />
            Erstaufnahme
          </DialogTitle>
          <DialogDescription>
            Kunde, Checkliste und Notizen direkt vor Ort erfassen – daraus wird automatisch ein Projekt angelegt.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <VoiceInputButton
            mode="erstaufnahme"
            context={voiceContext}
            label="Erstaufnahme per Sprache — einfach alles reinsprechen"
            hint='Sag z. B. „Neuer Kunde Max Huber in Linz, Heizungstausch, Zählpunkt vorhanden, Platz für Wärmepumpe passt." – die KI füllt alles aus.'
            onResult={handleVoiceResult}
          />

          {/* Kunde */}
          <div className="space-y-1.5">
            <Label>Kunde *</Label>
            {newCustomerMode ? (
              <div className="rounded-lg border p-3 space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium">Neuer Kunde</span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setNewCustomerMode(false)}
                  >
                    Bestehenden Kunden wählen
                  </Button>
                </div>
                <CustomerFormFields form={customerForm} setForm={setCustomerForm} />
              </div>
            ) : (
              <div className="space-y-2">
                <Select value={selectedCustomerId} onValueChange={setSelectedCustomerId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Kunde auswählen" />
                  </SelectTrigger>
                  <SelectContent>
                    {customers.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {customerDisplayName(c)}
                        {customerAddress(c) ? ` (${customerAddress(c)})` : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="gap-1"
                  onClick={() => setNewCustomerMode(true)}
                >
                  <Plus className="h-4 w-4" />
                  Neuen Kunden anlegen
                </Button>
              </div>
            )}
          </div>

          {/* Projektname */}
          <div className="space-y-1.5">
            <Label htmlFor="erstaufnahme-projektname">Projektname</Label>
            <Input
              id="erstaufnahme-projektname"
              value={projektName}
              onChange={(e) => setProjektName(e.target.value)}
              placeholder="Leer lassen – wird aus dem Kundennamen gebildet"
            />
          </div>

          {/* Checkliste */}
          <div className="space-y-2">
            <Label>Checkliste</Label>
            {activeItems.length === 0 && (
              <p className="text-sm text-muted-foreground">Keine Checklisten-Punkte vorhanden.</p>
            )}
            {activeItems.map((item) => {
              const st = entryFor(item.id);
              return (
                <div key={item.id} className="rounded-md border p-2 space-y-1.5">
                  <div className="flex items-start gap-2">
                    <Checkbox
                      id={`erstaufnahme-check-${item.id}`}
                      checked={st.erledigt}
                      onCheckedChange={(v) => setEntry(item.id, { erledigt: v === true })}
                      className="mt-0.5"
                    />
                    <Label
                      htmlFor={`erstaufnahme-check-${item.id}`}
                      className="text-sm font-normal leading-snug cursor-pointer"
                    >
                      {item.text}
                    </Label>
                  </div>
                  <Input
                    value={st.bemerkung}
                    onChange={(e) => setEntry(item.id, { bemerkung: e.target.value })}
                    placeholder="Bemerkung"
                    className="h-8 text-sm"
                  />
                </div>
              );
            })}

            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="gap-1 text-muted-foreground"
              onClick={() => setEditChecklist((v) => !v)}
            >
              <Settings2 className="h-3.5 w-3.5" />
              Checkliste anpassen
            </Button>

            {editChecklist && (
              <div className="rounded-lg border bg-muted/30 p-3 space-y-2">
                <p className="text-xs text-muted-foreground">
                  Änderungen werden sofort gespeichert und gelten als neue Vorlage für künftige
                  Erstaufnahmen.
                </p>
                {checklistItems.map((item) => (
                  <div key={item.id} className="flex items-center gap-2">
                    <Input
                      value={item.text}
                      onChange={(e) => updateItemLocal(item.id, { text: e.target.value })}
                      onBlur={() => persistItemText(checklistItems.find((i) => i.id === item.id) ?? item)}
                      className="h-8 text-sm flex-1 min-w-0"
                    />
                    <Switch
                      checked={item.is_active}
                      onCheckedChange={(v) => toggleItemActive(item, v)}
                      title={item.is_active ? "Aktiv" : "Inaktiv"}
                    />
                  </div>
                ))}
                <div className="flex items-center gap-2 pt-1">
                  <Input
                    value={newItemText}
                    onChange={(e) => setNewItemText(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        handleAddItem();
                      }
                    }}
                    placeholder="Neuer Checklisten-Punkt"
                    className="h-8 text-sm flex-1 min-w-0"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="gap-1 shrink-0"
                    onClick={handleAddItem}
                    disabled={!newItemText.trim()}
                  >
                    <Plus className="h-4 w-4" />
                    Punkt hinzufügen
                  </Button>
                </div>
              </div>
            )}
          </div>

          {/* Notizen */}
          <div className="space-y-1.5">
            <Label htmlFor="erstaufnahme-notizen">Notizen</Label>
            <Textarea
              id="erstaufnahme-notizen"
              value={notizen}
              onChange={(e) => setNotizen(e.target.value)}
              placeholder="Notizen zur Erstaufnahme..."
              rows={4}
            />
          </div>

          {/* Abschluss */}
          <div className="pt-2 border-t">
            <Button onClick={handleFinish} disabled={saving} className="w-full gap-2">
              {saving ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Wird gespeichert...
                </>
              ) : (
                <>
                  <CheckCircle2 className="h-4 w-4" />
                  Erstaufnahme abschließen
                </>
              )}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
