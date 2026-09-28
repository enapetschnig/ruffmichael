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
  VoiceInputButton,
  type VoiceContext,
  type VoiceResult,
} from "@/components/VoiceInputButton";
import {
  customerDisplayName,
  customerAddress,
  type Customer,
} from "@/pages/Customers";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { getSessionUser } from "@/lib/auth";
import { newId, isOffline, saveInsert, saveUpload, saveInvoke } from "@/lib/offlineData";
import { STANDARD_PROJECT_FOLDERS } from "@/lib/projectFolders";
import { fetchCustomersCached } from "@/lib/cachedQueries";
import { cachedSelect } from "@/lib/offlineStore";

// WICHTIG: Diese Komponente wird von Mitarbeitern und Kunden gesehen.
// Es dürfen hier NIEMALS Preise geladen oder angezeigt werden.

// Kundenvorlage kommt aus der Kundenverwaltung — eine Quelle für alle Felder.
import { emptyCustomerForm } from "@/pages/Customers";
import { plzEingabe, projektPlz, PLZ_FEHLT } from "@/lib/plz";
import { KundenAuswahl, kundeAdresse, type Kunde } from "@/components/kunde/KundenAuswahl";

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
  // Gewählter (oder gerade angelegter) Kunde — gleiche Kundenauswahl wie überall in der App
  const [kunde, setKunde] = useState<Kunde | null>(null);
  // Neuer Kunde aus der Spracheingabe → öffnet „Neuer Kunde“ vorausgefüllt
  const [neuVorlage, setNeuVorlage] = useState<Partial<typeof emptyCustomerForm> | null>(null);
  // PLZ, die zuletzt automatisch vom Kunden kam (nur die wird beim Kundenwechsel ersetzt)
  const [autoPlz, setAutoPlz] = useState("");

  const [projektName, setProjektName] = useState("");
  const [plz, setPlz] = useState("");
  const [notizen, setNotizen] = useState("");

  const [checklistItems, setChecklistItems] = useState<ChecklistItem[]>([]);
  const [checklistState, setChecklistState] = useState<Record<string, ChecklistEntryState>>({});
  const [editChecklist, setEditChecklist] = useState(false);
  // Die Checkliste ist eine GLOBALE Vorlage für alle künftigen Erstaufnahmen —
  // ändern darf sie nur der Admin (die Datenbank erzwingt es zusätzlich).
  const [istAdmin, setIstAdmin] = useState(false);
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
    // Offline-fähig: letzter bekannter Stand, wenn kein Netz da ist.
    const { data } = await fetchCustomersCached();
    const list = (data as unknown as ErstaufnahmeCustomer[]) ?? [];
    setCustomers(list);
    return list;
  };

  const fetchChecklistItems = async (): Promise<ChecklistItem[]> => {
    // Offline-fähig (eigener Schlüssel: hier werden auch inaktive Punkte gebraucht)
    const { data } = await cachedSelect<ChecklistItem[]>("checklist:editor", () =>
      supabase
        .from("erstaufnahme_checklist_items")
        .select("id, text, sort_order, is_active")
        .order("sort_order", { ascending: true }) as unknown as PromiseLike<{ data: ChecklistItem[] | null; error: { message: string } | null }>,
    );
    const list = data ?? [];
    setChecklistItems(list);
    return list;
  };

  const applyPrefill = (p: ErstaufnahmePrefill, items: ChecklistItem[], liste: ErstaufnahmeCustomer[] = customers) => {
    if (p.existingCustomerId) {
      const k = liste.find((c) => c.id === p.existingCustomerId);
      if (k) kundeWaehlen(k as unknown as Kunde);
    } else if (p.kunde && Object.values(p.kunde).some((v) => v && String(v).trim())) {
      const k = p.kunde;
      setNeuVorlage({
        vorname: k.vorname?.trim() ?? "",
        nachname: k.nachname?.trim() ?? "",
        strasse: k.strasse?.trim() ?? "",
        ort: k.ort?.trim() ?? "",
        telefon: k.telefon?.trim() ?? "",
        email: k.email?.trim() ?? "",
      });
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
    setKunde(null);
    setNeuVorlage(null);
    setAutoPlz("");
    setProjektName("");
    setPlz("");
    setNotizen("");
    setChecklistState({});
    setEditChecklist(false);
    setNewItemText("");
    (async () => {
      const [liste, items] = await Promise.all([fetchCustomers(), fetchChecklistItems()]);
      const nutzer = await getSessionUser();
      if (nutzer) {
        const { data: rolle } = await supabase
          .from("user_roles").select("role")
          .eq("user_id", nutzer.id).eq("role", "administrator").maybeSingle();
        setIstAdmin(!!rolle);
      }
      if (prefill) applyPrefill(prefill, items, liste);
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

  // Kunde gewählt → PLZ sichtbar übernehmen (wenn leer oder vom vorigen Kunden)
  const kundeWaehlen = (k: Kunde | null) => {
    setKunde(k);
    setNeuVorlage(null);
    const kp = kundeAdresse(k).plz;
    setPlz((alt) => (!alt.trim() || alt === autoPlz ? kp : alt));
    setAutoPlz(kp);
  };

  const handleFinish = async () => {
    if (saving) return;

    if (!kunde) {
      toast({
        variant: "destructive",
        title: "Kunde fehlt",
        description: "Bitte einen Kunden suchen und wählen – oder den neuen Kunden mit „Kunde speichern“ anlegen.",
      });
      return;
    }

    const plzFertig = projektPlz(plz, kunde.ort);
    if (!plzFertig) {
      toast({
        variant: "destructive",
        title: "Postleitzahl fehlt",
        description: PLZ_FEHLT,
      });
      return;
    }

    setSaving(true);
    try {
      const user = await getSessionUser();

      // Verfolgt, ob (mind.) ein Schritt in die Offline-Warteschlange ging.
      let queued = false;

      // (a) Kunde anlegen (Client-ID) oder bestehenden verwenden.
      // Für die Zusammenfassung brauchen wir die Kundendaten auch offline lokal.
      const customer: {
        vorname: string | null;
        nachname: string | null;
        strasse: string | null;
        ort: string | null;
        telefon: string | null;
        email: string | null;
      } = { vorname: null, nachname: null, strasse: null, ort: null, telefon: null, email: null };

      // Der Kunde ist schon gespeichert (Kundenauswahl legt neue sofort an, auch offline).
      const customerId = kunde.id;
      customer.vorname = kunde.vorname;
      customer.nachname = kunde.nachname;
      customer.strasse = kunde.strasse;
      customer.ort = kunde.ort;
      customer.telefon = kunde.mobil || kunde.telefon;
      customer.email = kunde.email;

      // (b) Projekt anlegen (Client-ID, Status: "Warte auf Angebotsbestätigung").
      // Status-Lesevorgang kann offline scheitern → dann einfach null.
      let statusId: string | null = null;
      let statusName: string | null = null;
      try {
        const { data: statusRows } = await supabase
          .from("project_statuses")
          .select("id, name")
          .ilike("name", "%angebotsbest%")
          .limit(1);
        statusId = statusRows?.[0]?.id ?? null;
        statusName = statusRows?.[0]?.name ?? null;
      } catch {
        statusId = null;
        statusName = null;
      }

      const projectPlz = plzFertig;
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
          plz: projectPlz,
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

      // OneDrive-Ordner SOFORT anlegen (online direkt, offline über die Warteschlange
      // nach den Inserts). Fehler stören nicht — der 10-Min-Sync ist das Sicherheitsnetz.
      void saveInvoke("onedrive-sync", { projectId }, `OneDrive-Ordner: ${projektName.trim() || "Projekt"}`, queued);

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
        // Offline: Das Projekt liegt nur in der lokalen Warteschlange — die
        // Detailseite (/projects/:id) wäre nicht erreichbar/leer. Deshalb NICHT
        // dorthin navigieren (onFinished), sondern nur den Hinweis zeigen und
        // den Dialog schließen. Das Formular wird beim nächsten Öffnen zurückgesetzt.
        toast({
          title: "Offline gespeichert",
          description: "Wird automatisch gesendet, sobald wieder Internet da ist.",
        });
        onOpenChange(false);
      } else {
        toast({
          title: "Erstaufnahme abgeschlossen",
          description: statusId
            ? `Projekt angelegt (${statusName ?? "Warte auf Angebotsbestätigung"})`
            : "Projekt angelegt (ohne Status)",
        });
        onFinished?.(projectId);
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[calc(100vw-1.5rem)] sm:max-w-lg max-h-[90vh] overflow-y-auto p-4 sm:p-6">
        <DialogHeader className="pr-8">
          <DialogTitle className="flex items-center gap-2">
            <ClipboardList className="h-5 w-5 shrink-0" />
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
            <KundenAuswahl wert={kunde?.id} onChange={kundeWaehlen} pflicht neuVorlage={neuVorlage} />
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

          {/* PLZ */}
          <div className="space-y-1.5">
            <Label htmlFor="erstaufnahme-plz">PLZ *</Label>
            <Input
              id="erstaufnahme-plz"
              value={plz}
              onChange={(e) => setPlz(plzEingabe(e.target.value))}
              inputMode="numeric"
              placeholder="z. B. 2700"
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
                      className="mt-0.5 shrink-0"
                    />
                    <Label
                      htmlFor={`erstaufnahme-check-${item.id}`}
                      className="text-sm font-normal leading-snug cursor-pointer min-w-0 break-words"
                    >
                      {item.text}
                    </Label>
                  </div>
                  <Input
                    value={st.bemerkung}
                    onChange={(e) => setEntry(item.id, { bemerkung: e.target.value })}
                    placeholder="Bemerkung"
                    className="h-9 sm:h-8 text-sm"
                  />
                </div>
              );
            })}

            {istAdmin && (
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
            )}

            {istAdmin && editChecklist && (
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
                      className="h-9 sm:h-8 text-sm flex-1 min-w-0"
                    />
                    <Switch
                      checked={item.is_active}
                      onCheckedChange={(v) => toggleItemActive(item, v)}
                      title={item.is_active ? "Aktiv" : "Inaktiv"}
                      className="shrink-0"
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
                    className="h-9 sm:h-8 text-sm flex-1 min-w-0"
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
