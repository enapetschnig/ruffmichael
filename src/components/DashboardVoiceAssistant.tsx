import { useEffect, useState } from "react";
import {
  VoiceInputButton,
  type VoiceContext,
  type VoiceResult,
} from "@/components/VoiceInputButton";
import { fileTimestamp, type ErstaufnahmePrefill } from "@/components/ErstaufnahmeDialog";
import { customerDisplayName, customerAddress } from "@/pages/Customers";
import { supabase } from "@/integrations/supabase/client";
import { saveUpload } from "@/lib/offlineData";
import { useToast } from "@/hooks/use-toast";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

// WICHTIG: Diese Komponente wird von Mitarbeitern und Kunden gesehen.
// Es dürfen hier NIEMALS Preise geladen oder angezeigt werden.

// Wandelt einen Dateinamen in einen gültigen Supabase-Storage-Key um
// (Umlaute transliterieren, restliche Sonderzeichen ersetzen).
const toStorageKey = (name: string) =>
  name
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/Ä/g, "Ae")
    .replace(/Ö/g, "Oe")
    .replace(/Ü/g, "Ue")
    .replace(/ß/g, "ss")
    .replace(/[^a-zA-Z0-9._ ()-]/g, "_");

type AssistantProject = {
  id: string;
  name: string;
  plz: string | null;
  adresse: string | null;
};

interface DashboardVoiceAssistantProps {
  onErstaufnahme: (prefill: ErstaufnahmePrefill) => void;
}

export function DashboardVoiceAssistant({
  onErstaufnahme,
}: DashboardVoiceAssistantProps): JSX.Element {
  const { toast } = useToast();

  const [projects, setProjects] = useState<AssistantProject[]>([]);
  const [customers, setCustomers] = useState<VoiceContext["customers"]>([]);
  const [checklist, setChecklist] = useState<string[]>([]);

  // Bestätigungs-Dialog für Sprachnotizen: Der erkannte Text und die
  // Projekt-Zuordnung werden VOR dem Speichern angezeigt und sind änderbar –
  // nichts wird mehr "blind" gespeichert.
  const [noteOpen, setNoteOpen] = useState(false);
  const [noteText, setNoteText] = useState("");
  const [noteProjectId, setNoteProjectId] = useState<string>("");
  const [savingNote, setSavingNote] = useState(false);

  useEffect(() => {
    (async () => {
      const [projectsRes, customersRes, checklistRes] = await Promise.all([
        supabase
          .from("projects")
          .select("id, name, plz, adresse, customers(strasse, ort)")
          .eq("status", "aktiv")
          .order("name"),
        supabase
          .from("customers")
          .select("id, vorname, nachname, strasse, ort, telefon, email")
          .order("nachname")
          .order("vorname"),
        supabase
          .from("erstaufnahme_checklist_items")
          .select("text")
          .eq("is_active", true)
          .order("sort_order", { ascending: true }),
      ]);

      setProjects(
        (projectsRes.data ?? []).map((p) => ({
          id: p.id,
          name: p.name,
          plz: p.plz,
          adresse: p.customers
            ? [p.customers.strasse, p.customers.ort].filter(Boolean).join(", ") || p.adresse
            : p.adresse,
        }))
      );
      setCustomers(
        (customersRes.data ?? []).map((c) => ({
          id: c.id,
          name: customerDisplayName(c),
          email: c.email,
          adresse: customerAddress(c) || null,
          telefon: c.telefon,
        }))
      );
      setChecklist((checklistRes.data ?? []).map((i) => i.text));
    })();
  }, []);

  const voiceContext: VoiceContext = {
    projects,
    customers,
    checklist,
  };

  const handleProjektnotiz = async (projectId: string, notiz: string) => {
    const project = projects.find((p) => p.id === projectId);
    const now = new Date();
    const content = [
      `Notiz vom ${now.toLocaleDateString("de-AT")}, ${now.toLocaleTimeString("de-AT", { hour: "2-digit", minute: "2-digit" })} Uhr`,
      project ? `Projekt: ${project.name}` : null,
      "",
      notiz,
    ]
      .filter((l) => l !== null)
      .join("\n");

    // Offline-fähig speichern: bei fehlendem/instabilem Netz landet die Notiz in
    // der Warteschlange statt verloren zu gehen. Storage-Key ohne Sonderzeichen.
    const path = `${projectId}/Notizen/${toStorageKey(`Notiz_${fileTimestamp(now)}.txt`)}`;
    const res = await saveUpload(
      {
        bucket: "project-files",
        path,
        blob: new Blob([content], { type: "text/plain;charset=utf-8" }),
        contentType: "text/plain;charset=utf-8",
        upsert: false,
      },
      `Projektnotiz: ${project?.name ?? "Unbekannt"}`
    );

    if (res.error) {
      toast({
        variant: "destructive",
        title: "Fehler",
        description: "Notiz konnte nicht gespeichert werden",
      });
      return;
    }
    // Warteschlangen-Zustand im Hinweis widerspiegeln.
    toast({
      title: res.queued ? "Notiz offline gespeichert" : "Notiz gespeichert",
      description: res.queued
        ? `Wird synchronisiert, sobald wieder Netz da ist — Projekt: ${project?.name ?? "Unbekannt"}`
        : `Projekt: ${project?.name ?? "Unbekannt"}`,
    });
  };

  const handleResult = async (result: VoiceResult) => {
    const assistent = result.extracted?.assistent as
      | { intent?: string; projectId?: string; notiz?: string }
      | undefined;
    const erstaufnahme = result.extracted?.erstaufnahme as ErstaufnahmePrefill | undefined;

    if (assistent?.intent === "projektnotiz" && (assistent.notiz ?? "").trim()) {
      // Nicht sofort speichern: Erkannten Text + Projekt-Zuordnung zur Kontrolle
      // anzeigen (beides änderbar). Auch ohne erkanntes Projekt öffnen – dann
      // wählt der Nutzer das Projekt selbst.
      setNoteText((assistent.notiz ?? "").trim());
      setNoteProjectId(
        assistent.projectId && projects.some((p) => p.id === assistent.projectId)
          ? assistent.projectId
          : ""
      );
      setNoteOpen(true);
      return;
    }

    if (assistent?.intent === "erstaufnahme") {
      const prefill: ErstaufnahmePrefill = {
        existingCustomerId: erstaufnahme?.existingCustomerId || undefined,
        kunde: erstaufnahme?.kunde || undefined,
        projektName: erstaufnahme?.projektName || undefined,
        notizen: erstaufnahme?.notizen || undefined,
        checklist: Array.isArray(erstaufnahme?.checklist) ? erstaufnahme?.checklist : undefined,
      };
      onErstaufnahme(prefill);
      return;
    }

    toast({
      title: "Nicht erkannt",
      description: "Ich habe keine eindeutige Absicht erkannt — bitte nochmal.",
    });
  };

  // Bestätigte Notiz speichern (Text ggf. vom Nutzer korrigiert).
  const handleSaveNote = async () => {
    if (!noteProjectId || !noteText.trim() || savingNote) return;
    setSavingNote(true);
    try {
      await handleProjektnotiz(noteProjectId, noteText.trim());
      setNoteOpen(false);
    } finally {
      setSavingNote(false);
    }
  };

  const noteProject = projects.find((p) => p.id === noteProjectId);

  return (
    <>
      <VoiceInputButton
        mode="assistent"
        context={voiceContext}
        label="Sprachassistent"
        hint='Sag z. B. „Notiz zum Projekt Fassl: Ventil bestellt" oder diktiere eine komplette Erstaufnahme.'
        onResult={handleResult}
      />

      {/* Notiz prüfen & zuordnen, bevor gespeichert wird */}
      <Dialog open={noteOpen} onOpenChange={(o) => { if (!o && !savingNote) setNoteOpen(false); }}>
        <DialogContent className="max-w-sm sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Notiz prüfen &amp; speichern</DialogTitle>
            <DialogDescription>
              Das wurde erkannt — Text und Projekt-Zuordnung bitte kontrollieren (beides änderbar).
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="voice-note-text">Erkannte Notiz</Label>
              <Textarea
                id="voice-note-text"
                value={noteText}
                onChange={(e) => setNoteText(e.target.value)}
                rows={5}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Projekt *</Label>
              <Select value={noteProjectId} onValueChange={setNoteProjectId}>
                <SelectTrigger>
                  <SelectValue placeholder="Projekt auswählen" />
                </SelectTrigger>
                <SelectContent>
                  {projects.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}{p.adresse ? ` – ${p.adresse}` : p.plz ? ` – PLZ ${p.plz}` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {!noteProjectId && (
                <p className="text-xs text-muted-foreground">
                  Kein Projekt eindeutig erkannt — bitte auswählen.
                </p>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              Gespeichert wird im Projektordner „Notizen"{noteProject ? ` von ${noteProject.name}` : ""}.
            </p>
            <div className="flex flex-col-reverse sm:flex-row justify-end gap-2">
              <Button variant="outline" onClick={() => setNoteOpen(false)} disabled={savingNote}>
                Abbrechen
              </Button>
              <Button onClick={handleSaveNote} disabled={!noteProjectId || !noteText.trim() || savingNote}>
                {savingNote ? "Speichert…" : "Notiz speichern"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
