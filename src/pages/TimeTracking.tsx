import { useState, useEffect, useRef } from "react";
import { Clock, Plus, AlertTriangle, CheckCircle2, Calendar, Sun, Trash2, Users, FolderOpen, ChevronDown, FilePlus2 } from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Switch } from "@/components/ui/switch";
import { MultiEmployeeSelect } from "@/components/MultiEmployeeSelect";
import { NachtragDialog } from "@/components/NachtragDialog";
import { PageHeader } from "@/components/PageHeader";
import { VoiceInputButton, type VoiceContext } from "@/components/VoiceInputButton";
import { resolveTimeBlocks } from "@/lib/timeBlockResolver";
import { enqueue } from "@/lib/offlineQueue";
import { isOffline, newId, saveInsert, saveUpload } from "@/lib/offlineData";
import { format, startOfWeek } from "date-fns";
import { de } from "date-fns/locale";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { toast as sonnerToast } from "sonner";
import { 
  getNormalWorkingHours, 
  getDefaultWorkTimes, 
  isNonWorkingDay,
  getWeeklyTargetHours,
  getTotalWorkingHours
} from "@/lib/workingHours";

// Standardordner für neue Projekte (identisch zu Projects.tsx / ErstaufnahmeDialog)
const STANDARD_PROJECT_FOLDERS = [
  "Abnahme Protokoll",
  "Beschreibung",
  "Foto",
  "Hydraulik",
  "Programmierung",
];

type Project = {
  id: string;
  name: string;
  status: string;
  plz: string;
  customers?: { strasse: string | null; ort: string | null } | null;
};

// Anzeige: Projektname – Adresse des Kunden (Fallback: PLZ)
const projectLabel = (p: Project): string => {
  const addr = p.customers ? [p.customers.strasse, p.customers.ort].filter(Boolean).join(", ") : "";
  return addr ? `${p.name} – ${addr}` : `${p.name} (${p.plz})`;
};

type ExistingEntry = {
  id: string;
  start_time: string;
  end_time: string;
  stunden: number;
  taetigkeit: string;
  project_name: string | null;
  plz: string | null;
  pause_start: string | null;
};

interface TimeBlock {
  id: string;
  locationType: "baustelle" | "werkstatt";
  projectId: string;
  taetigkeit: string;
  notizen: string;
  startTime: string;
  endTime: string;
  pauseStart: string;
  pauseEnd: string;
  selectedEmployees: string[];
  manualHours: string;
}

const createDefaultBlock = (startTime = "", endTime = "", pauseStart = "", pauseEnd = ""): TimeBlock => ({
  id: crypto.randomUUID(),
  locationType: "baustelle",
  projectId: "",
  taetigkeit: "",
  notizen: "",
  startTime,
  endTime,
  pauseStart,
  pauseEnd,
  selectedEmployees: [],
  manualHours: "",
});

// Ueberdeckt der Zeitraum die Mittagspause (12:00-12:30)? Dann gehoert eine Pause abgezogen.
const absenceSpansLunch = (start: string, end: string): boolean => {
  if (!/^\d{2}:\d{2}$/.test(start) || !/^\d{2}:\d{2}$/.test(end)) return false;
  const toMin = (s: string) => {
    const [h, m] = s.split(":").map(Number);
    return h * 60 + m;
  };
  return toMin(start) < 12 * 60 && toMin(end) > 12 * 60;
};

const TimeTracking = () => {
  const { toast } = useToast();
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [creatingProject, setCreatingProject] = useState(false);
  const [submittingAbsence, setSubmittingAbsence] = useState(false);
  const [showNewProjectDialog, setShowNewProjectDialog] = useState(false);
  const [newProjectName, setNewProjectName] = useState("");
  const [newProjectPlz, setNewProjectPlz] = useState("");
  const [newProjectAddress, setNewProjectAddress] = useState("");
  const [pendingBlockIdForNewProject, setPendingBlockIdForNewProject] = useState<string | null>(null);

  const [existingDayEntries, setExistingDayEntries] = useState<ExistingEntry[]>([]);
  const [loadingDayEntries, setLoadingDayEntries] = useState(false);

  // Nachtrag-Dialog (direkt aus der Zeiterfassung, ohne Seitenwechsel)
  const [showNachtragDialog, setShowNachtragDialog] = useState(false);
  const [nachtragProjectId, setNachtragProjectId] = useState<string>("");
  
  const [showAbsenceDialog, setShowAbsenceDialog] = useState(false);
  
  const [absenceData, setAbsenceData] = useState({
    date: new Date().toISOString().split('T')[0],
    type: "urlaub" as "urlaub" | "krankenstand" | "weiterbildung" | "feiertag" | "za",
    document: null as File | null,
    customHours: "" as string,
    isFullDay: true,
    absenceStartTime: "07:00",
    absenceEndTime: "16:00",
    absencePauseMinutes: "30",
  });
  
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().split('T')[0]);
  const [timeBlocks, setTimeBlocks] = useState<TimeBlock[]>([createDefaultBlock()]);
  // Steuert, ob der [selectedDate]-Effekt die Zeitblöcke zurücksetzen darf.
  // true = beim initialen Mount und bei manueller Datumsänderung (Datumsfeld).
  // false = bei programmatischen Datumsänderungen (z.B. Sprachsteuerung), damit
  // diktierte Blöcke beim Datumswechsel nicht überschrieben werden.
  const resetBlocksOnDateChange = useRef(true);
  const entryMode = "zeitraum" as const;
  const [voiceTranscription, setVoiceTranscription] = useState<string>("");
  const [projectListOpen, setProjectListOpen] = useState<boolean>(() => {
    try { return localStorage.getItem("tt.projectListOpen") === "1"; } catch { return false; }
  });
  useEffect(() => {
    try { localStorage.setItem("tt.projectListOpen", projectListOpen ? "1" : "0"); } catch { /* ignore */ }
  }, [projectListOpen]);
  const openProjects = [...projects].sort((a, b) => a.name.localeCompare(b.name));
  const [voiceEmployees, setVoiceEmployees] = useState<{ id: string; name: string }[]>([]);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.from("profiles").select("id, vorname, nachname").eq("is_active", true);
      setVoiceEmployees((data ?? []).map((e: any) => ({
        id: e.id,
        name: [e.vorname, e.nachname].filter(Boolean).join(" ").trim() || "Unbenannt",
      })));
    })();
  }, []);

  const voiceContext: VoiceContext = {
    projects: projects.map((p) => ({
      id: p.id,
      name: p.name,
      plz: p.plz,
      adresse: p.customers ? [p.customers.strasse, p.customers.ort].filter(Boolean).join(", ") || null : null,
    })),
    employees: voiceEmployees,
    coreHours: { start: "07:00", end: "16:00", pauseStart: "12:00", pauseEnd: "12:30" },
  };

  const handleVoiceResult = (result: { transcription: string; extracted: any }) => {
    setVoiceTranscription(result.transcription);
    const t = result.extracted?.time;
    if (!t) return;
    // Reihenfolge wichtig: Datum ZUERST setzen (programmatisch, ohne
    // resetBlocksOnDateChange zu setzen). Der [selectedDate]-Effekt lädt dann nur
    // die bestehenden Tageseinträge für das Info-Banner und setzt die Zeitblöcke
    // NICHT zurück. Dadurch überleben die weiter unten aus der Sprache gesetzten
    // Blöcke (setTimeBlocks) den Datumswechsel.
    if (t.date && /^\d{4}-\d{2}-\d{2}$/.test(t.date)) {
      setSelectedDate(t.date);
    }
    if (t.absence?.isAbsence) {
      const a = t.absence;
      setAbsenceData((prev) => {
        const nextStart = /^\d{2}:\d{2}$/.test(a.startTime || "") ? a.startTime : prev.absenceStartTime;
        const nextEnd = /^\d{2}:\d{2}$/.test(a.endTime || "") ? a.endTime : prev.absenceEndTime;
        // Pause: diktierter Wert hat Vorrang, sonst automatisch anhand des Zeitraums
        const nextPause = typeof a.pauseMinutes === "number" && a.pauseMinutes > 0
          ? String(a.pauseMinutes)
          : (absenceSpansLunch(nextStart, nextEnd) ? "30" : "0");
        return {
          ...prev,
          date: t.date && /^\d{4}-\d{2}-\d{2}$/.test(t.date) ? t.date : prev.date,
          type: (a.type || prev.type) as any,
          isFullDay: typeof a.isFullDay === "boolean" ? a.isFullDay : prev.isFullDay,
          absenceStartTime: nextStart,
          absenceEndTime: nextEnd,
          absencePauseMinutes: nextPause,
        };
      });
      setShowAbsenceDialog(true);
      return;
    }
    if (Array.isArray(t.blocks) && t.blocks.length > 0) {
      const projectIds = new Set(projects.map((p) => p.id));
      // Zuerst durch Resolver: fuellt fehlende Zeiten aus Dauern und schlaegt Mittagspause vor
      const { blocks: resolved, suggestions } = resolveTimeBlocks(
        t.blocks.map((b: any) => ({
          startTime: /^\d{2}:\d{2}$/.test(b.startTime || "") ? b.startTime : undefined,
          endTime: /^\d{2}:\d{2}$/.test(b.endTime || "") ? b.endTime : undefined,
          durationHours: typeof b.durationHours === "number" && b.durationHours > 0 ? b.durationHours : undefined,
          pauseStart: /^\d{2}:\d{2}$/.test(b.pauseStart || "") ? b.pauseStart : undefined,
          pauseEnd: /^\d{2}:\d{2}$/.test(b.pauseEnd || "") ? b.pauseEnd : undefined,
          _raw: b,
        })),
        { anchor: "07:00", pauseWindow: { start: "12:00", end: "12:30" } },
      );
      const newBlocks: TimeBlock[] = resolved.map((r) => {
        const b = r._raw;
        return {
          id: crypto.randomUUID(),
          locationType: (b.locationType === "werkstatt" ? "werkstatt" : "baustelle") as "baustelle" | "werkstatt",
          projectId: b.projectId && projectIds.has(b.projectId) ? b.projectId : "",
          taetigkeit: b.taetigkeit || (b.projectNameGuess ? `${b.projectNameGuess}` : ""),
          notizen: "",
          startTime: r.startTime,
          endTime: r.endTime,
          pauseStart: r.pauseStart,
          pauseEnd: r.pauseEnd,
          selectedEmployees: Array.isArray(b.employeeIds) ? b.employeeIds : [],
          manualHours: "",
        };
      });
      setTimeBlocks(newBlocks);
      if (suggestions.length) {
        sonnerToast.info(suggestions.join(" • "));
      }
    }
    const warnings = result.extracted?.warnings ?? [];
    if (warnings.length) {
      sonnerToast.info(warnings.join(" • "));
    }
  };

  // Fetch existing entries for selected date.
  // resetBlocks steuert, ob die Zeitblöcke auf Standard zurückgesetzt werden.
  // Der [selectedDate]-Effekt übergibt hier false bei programmatischen
  // Datumswechseln (Sprachsteuerung), damit diktierte Blöcke erhalten bleiben.
  const fetchExistingDayEntries = async (date: string, resetBlocks = true) => {
    setLoadingDayEntries(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      setLoadingDayEntries(false);
      return;
    }

    const { data, error } = await supabase
      .from("time_entries")
      .select(`
        id,
        start_time,
        end_time,
        stunden,
        taetigkeit,
        pause_start,
        projects (name, plz)
      `)
      .eq("user_id", user.id)
      .eq("datum", date)
      .order("start_time");

    if (!error && data) {
      const entries: ExistingEntry[] = data.map((entry: any) => ({
        id: entry.id,
        start_time: entry.start_time,
        end_time: entry.end_time,
        stunden: entry.stunden,
        taetigkeit: entry.taetigkeit,
        project_name: entry.projects?.name || null,
        plz: entry.projects?.plz || null,
        pause_start: entry.pause_start || null,
      }));
      setExistingDayEntries(entries);

      // Zeitblöcke nur zurücksetzen, wenn erlaubt (nicht bei Sprach-Datumswechsel).
      if (resetBlocks) {
        // If entries exist, suggest next time slot for first block
        if (entries.length > 0 && !entries.some(e => ["Urlaub", "Krankenstand", "Weiterbildung", "Feiertag", "Zeitausgleich"].includes(e.taetigkeit))) {
          const lastEntry = entries[entries.length - 1];
          const [lastEndHours, lastEndMinutes] = lastEntry.end_time.split(':').map(Number);
          const nextStartMinutes = lastEndHours * 60 + lastEndMinutes + 30;
          const suggestedStart = `${String(Math.floor(nextStartMinutes / 60)).padStart(2, '0')}:${String(nextStartMinutes % 60).padStart(2, '0')}`;

          setTimeBlocks([createDefaultBlock(suggestedStart)]);
        } else if (!entries.some(e => ["Urlaub", "Krankenstand", "Weiterbildung", "Feiertag", "Zeitausgleich"].includes(e.taetigkeit))) {
          // Auto-fill default work times for the selected date
          const dateObj = new Date(date);
          const defaults = getDefaultWorkTimes(dateObj);
          if (defaults) {
            setTimeBlocks([createDefaultBlock(defaults.startTime, defaults.endTime, defaults.pauseStart, defaults.pauseEnd)]);
          } else {
            setTimeBlocks([createDefaultBlock()]);
          }
        }
      }
    } else {
      setExistingDayEntries([]);
      // Reset to empty default for new day (nur wenn erlaubt)
      if (resetBlocks) {
        setTimeBlocks([createDefaultBlock()]);
      }
    }
    setLoadingDayEntries(false);
  };

  // Load existing entries when date changes (Info-Banner).
  // Die Zeitblöcke werden nur zurückgesetzt, wenn der Wechsel vom initialen Mount
  // oder einer manuellen Datumsänderung stammt (resetBlocksOnDateChange). Bei
  // programmatischen Wechseln aus der Sprachsteuerung bleibt das Flag false, damit
  // die dort gesetzten Blöcke nicht überschrieben werden.
  useEffect(() => {
    const resetBlocks = resetBlocksOnDateChange.current;
    resetBlocksOnDateChange.current = false;
    fetchExistingDayEntries(selectedDate, resetBlocks);
  }, [selectedDate]);

  useEffect(() => {
    fetchProjects();

    const channel = supabase
      .channel('projects-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'projects' }, () => {
        fetchProjects();
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  const handleCreateNewProject = async () => {
    if (creatingProject) return;
    
    if (!newProjectName.trim() || !newProjectPlz.trim()) {
      sonnerToast.error("Name und PLZ sind Pflichtfelder");
      return;
    }

    if (!/^\d{4,5}$/.test(newProjectPlz)) {
      sonnerToast.error("PLZ muss 4-5 Ziffern haben");
      return;
    }

    setCreatingProject(true);

    // Client-ID -> offline-fähig; abhängige Ordner referenzieren dieselbe ID.
    const projectId = newId();
    let anyQueued = false;
    const label = `Projekt ${newProjectName.trim()}`;
    const r = await saveInsert("projects", {
      id: projectId,
      name: newProjectName.trim(),
      plz: newProjectPlz.trim(),
      adresse: newProjectAddress.trim() || null,
      status: "aktiv",
    }, label);
    if (r.error) {
      sonnerToast.error(/23505|duplicate/i.test(r.error) ? "Ein Projekt mit diesem Namen und PLZ existiert bereits" : "Projekt konnte nicht erstellt werden");
      setCreatingProject(false);
      return;
    }
    anyQueued = r.queued;

    // Standardordner anlegen (leere Ordner via .keep-Platzhalter). Sobald das
    // Projekt in der Warteschlange steckt, gehen auch die Ordner in die
    // Warteschlange (force), damit sie nicht online gegen ein noch nicht
    // synchronisiertes Projekt laufen.
    for (const folder of STANDARD_PROJECT_FOLDERS) {
      const fr = await saveUpload(
        { bucket: "project-files", path: `${projectId}/${folder}/.keep`, blob: new Blob([""], { type: "text/plain" }) },
        label,
        anyQueued
      );
      anyQueued = anyQueued || fr.queued;
    }

    sonnerToast.success(anyQueued ? "Projekt offline gespeichert – wird gesendet, sobald wieder Internet da ist" : "Projekt erfolgreich erstellt");

    // Set the project in the pending block (client-ID ist stabil)
    if (pendingBlockIdForNewProject) {
      updateBlock(pendingBlockIdForNewProject, { projectId });
    }

    setShowNewProjectDialog(false);
    setNewProjectName("");
    setNewProjectPlz("");
    setNewProjectAddress("");
    setPendingBlockIdForNewProject(null);
    setCreatingProject(false);
  };

  const fetchProjects = async () => {
    const { data } = await supabase
      .from("projects")
      .select("id, name, status, plz, customers(strasse, ort)")
      .eq("status", "aktiv")
      .order("name");

    if (data) setProjects(data);
    setLoading(false);
  };

  // Mittagspause automatisch eintragen, wenn der Block das Pausenfenster (12:00-12:30)
  // ueberdeckt und noch keine Pause gesetzt ist. Pause zaehlt nie als Arbeitszeit.
  const withAutoPause = (block: TimeBlock): TimeBlock => {
    if (block.pauseStart || block.pauseEnd) return block;
    if (!block.startTime || !block.endTime) return block;
    const toMin = (s: string) => {
      const [h, m] = s.split(':').map(Number);
      return h * 60 + m;
    };
    const start = toMin(block.startTime);
    const end = toMin(block.endTime);
    const pauseStart = 12 * 60;
    const pauseEnd = 12 * 60 + 30;
    if (start < pauseStart && end > pauseStart) {
      const effEnd = Math.min(pauseEnd, end);
      const fmt = (min: number) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
      return { ...block, pauseStart: fmt(pauseStart), pauseEnd: fmt(effEnd) };
    }
    return block;
  };

  // Update a specific block
  const updateBlock = (blockId: string, updates: Partial<TimeBlock>) => {
    setTimeBlocks(prev => prev.map(block => {
      if (block.id !== blockId) return block;
      const next = { ...block, ...updates };
      // Bei Zeitaenderungen ggf. Mittagspause automatisch nachziehen
      if (updates.startTime !== undefined || updates.endTime !== undefined) {
        return withAutoPause(next);
      }
      return next;
    }));
  };

  // Add a new time block
  const addTimeBlock = () => {
    const lastBlock = timeBlocks[timeBlocks.length - 1];
    let suggestedStart = "";
    
    if (lastBlock.endTime) {
      const [endH, endM] = lastBlock.endTime.split(':').map(Number);
      const nextMinutes = endH * 60 + endM + 30; // 30 min after last block ends
      suggestedStart = `${String(Math.floor(nextMinutes / 60)).padStart(2, '0')}:${String(nextMinutes % 60).padStart(2, '0')}`;
    }
    
    setTimeBlocks(prev => [...prev, createDefaultBlock(suggestedStart)]);
  };

  // Remove a time block
  const removeBlock = (blockId: string) => {
    setTimeBlocks(prev => prev.filter(block => block.id !== blockId));
  };

  // Update selected employees for a block
  const updateBlockEmployees = (blockId: string, employees: string[]) => {
    setTimeBlocks(prev => prev.map(block =>
      block.id === blockId ? { ...block, selectedEmployees: employees } : block
    ));
  };

  // Calculate pause minutes for a block
  const calculateBlockPauseMinutes = (block: TimeBlock): number => {
    if (!block.pauseStart || !block.pauseEnd) return 0;
    
    const [pauseStartH, pauseStartM] = block.pauseStart.split(':').map(Number);
    const [pauseEndH, pauseEndM] = block.pauseEnd.split(':').map(Number);
    
    const pauseMinutes = (pauseEndH * 60 + pauseEndM) - (pauseStartH * 60 + pauseStartM);
    return Math.max(0, pauseMinutes);
  };

  // Calculate hours for a single block
  const calculateBlockHours = (block: TimeBlock): number => {
    if (!block.startTime || !block.endTime) return 0;
    
    const [startH, startM] = block.startTime.split(':').map(Number);
    const [endH, endM] = block.endTime.split(':').map(Number);
    const pauseMinutes = calculateBlockPauseMinutes(block);
    
    const totalMinutes = (endH * 60 + endM) - (startH * 60 + startM) - pauseMinutes;
    return Math.max(0, totalMinutes / 60);
  };

  // Calculate total hours across all blocks
  const calculateTotalHours = (): string => {
    const total = timeBlocks.reduce((sum, block) => sum + calculateBlockHours(block), 0);
    return total.toFixed(2);
  };

  // Quick-fill preset for first block
  const applyFullDayPreset = () => {
    if (timeBlocks.length > 0) {
      const selectedDateObj = new Date(selectedDate);
      const defaultTimes = getDefaultWorkTimes(selectedDateObj);
      
      if (!defaultTimes) {
        toast({ 
          variant: "destructive", 
          title: "Arbeitsfrei", 
          description: "Am Wochenende wird nicht gearbeitet"
        });
        return;
      }
      
      updateBlock(timeBlocks[0].id, {
        startTime: defaultTimes.startTime,
        endTime: defaultTimes.endTime,
        pauseStart: defaultTimes.pauseStart,
        pauseEnd: defaultTimes.pauseEnd,
      });
    }
  };

  const handleAbsenceSubmit = async () => {
    if (submittingAbsence) return;
    
    setSubmittingAbsence(true);

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      toast({ variant: "destructive", title: "Fehler", description: "Sie müssen angemeldet sein" });
      setSubmittingAbsence(false);
      return;
    }

    const { count: existingCount } = await supabase
      .from("time_entries")
      .select("id", { count: "exact", head: true })
      .eq("user_id", user.id)
      .eq("datum", absenceData.date);

    if ((existingCount ?? 0) > 0) {
      toast({ 
        variant: "destructive", 
        title: "Eintrag bereits vorhanden", 
        description: "Für diesen Tag wurden die Stunden bereits eingetragen, gehe unter Meine Stunden rein." 
      });
      setSubmittingAbsence(false);
      return;
    }

    let documentPath = null;
    if (absenceData.type === "krankenstand" && absenceData.document) {
      const fileName = `${user.id}/${Date.now()}_${absenceData.document.name}`;
      const uploadRes = await saveUpload(
        {
          bucket: "employee-documents",
          path: fileName,
          blob: absenceData.document,
          contentType: absenceData.document.type || undefined,
        },
        `Krankmeldung ${absenceData.document.name}`
      );

      if (uploadRes.error) {
        toast({ variant: "destructive", title: "Fehler", description: `Dokument konnte nicht hochgeladen werden: ${uploadRes.error}` });
        setSubmittingAbsence(false);
        return;
      }

      documentPath = fileName;
    }

    const selectedDateObj = new Date(absenceData.date);
    const automaticHours = getNormalWorkingHours(selectedDateObj);
    const defaultTimes = getDefaultWorkTimes(selectedDateObj);

    let workingHours: number;
    let entryStartTime: string;
    let entryEndTime: string;
    let entryPauseMinutes: number;

    if (absenceData.isFullDay) {
      workingHours = absenceData.customHours ? parseFloat(absenceData.customHours) : automaticHours;
      entryStartTime = defaultTimes?.startTime || "07:00";
      entryEndTime = defaultTimes?.endTime || "16:00";
      entryPauseMinutes = defaultTimes?.pauseMinutes || 30;
    } else {
      // Calculate from Von/Bis
      const [sH, sM] = absenceData.absenceStartTime.split(':').map(Number);
      const [eH, eM] = absenceData.absenceEndTime.split(':').map(Number);
      const pause = parseInt(absenceData.absencePauseMinutes) || 0;
      const totalMinutes = (eH * 60 + eM) - (sH * 60 + sM) - pause;
      workingHours = Math.max(0, totalMinutes / 60);
      entryStartTime = absenceData.absenceStartTime;
      entryEndTime = absenceData.absenceEndTime;
      entryPauseMinutes = pause;
    }

    // ZA: Check and deduct from time account
    if (absenceData.type === "za") {
      // Zeitausgleich braucht den aktuellen Zeitkonto-Stand -> nur mit Internet.
      if (isOffline()) {
        toast({ variant: "destructive", title: "Zeitausgleich nur mit Internet möglich", description: "Für Zeitausgleich wird der aktuelle Zeitkonto-Stand benötigt." });
        setSubmittingAbsence(false);
        return;
      }
      const { data: timeAccount, error: taError } = await supabase
        .from("time_accounts")
        .select("id, balance_hours")
        .eq("user_id", user.id)
        .maybeSingle();

      if (taError || !timeAccount) {
        toast({ variant: "destructive", title: "Fehler", description: "Kein Zeitkonto gefunden. Bitte wenden Sie sich an den Administrator." });
        setSubmittingAbsence(false);
        return;
      }

      if (Number(timeAccount.balance_hours) < workingHours) {
        toast({ variant: "destructive", title: "Nicht genügend ZA-Stunden", description: `Verfügbar: ${timeAccount.balance_hours}h, benötigt: ${workingHours}h` });
        setSubmittingAbsence(false);
        return;
      }

      const balanceBefore = Number(timeAccount.balance_hours);
      const balanceAfter = balanceBefore - workingHours;

      const { error: updateErr } = await supabase
        .from("time_accounts")
        .update({ balance_hours: balanceAfter, updated_at: new Date().toISOString() })
        .eq("id", timeAccount.id);

      if (updateErr) {
        toast({ variant: "destructive", title: "Fehler", description: "ZA-Stunden konnten nicht abgebucht werden" });
        setSubmittingAbsence(false);
        return;
      }

      await supabase.from("time_account_transactions").insert({
        user_id: user.id,
        changed_by: user.id,
        change_type: "za_abzug",
        hours: -workingHours,
        balance_before: balanceBefore,
        balance_after: balanceAfter,
        reason: `Zeitausgleich am ${absenceData.date}`,
      });
    }

    const absenceLabel = absenceData.type === "urlaub" ? "Urlaub" : absenceData.type === "krankenstand" ? "Krankenstand" : absenceData.type === "weiterbildung" ? "Weiterbildung" : absenceData.type === "za" ? "Zeitausgleich" : "Feiertag";

    // Abwesenheit als Zeiteintrag speichern. Für urlaub/krankenstand/weiterbildung/
    // feiertag offline-fähig (clientseitige id); ZA ist oben bereits auf Online
    // beschränkt, läuft hier also direkt online durch.
    const res = await saveInsert(
      "time_entries",
      {
        id: newId(),
        user_id: user.id,
        datum: absenceData.date,
        project_id: null,
        taetigkeit: absenceLabel,
        stunden: workingHours,
        start_time: entryStartTime,
        end_time: entryEndTime,
        pause_minutes: entryPauseMinutes,
        location_type: "baustelle",
        notizen: documentPath ? `Krankmeldung: ${documentPath}` : null,
        week_type: null,
      },
      `${absenceLabel} ${absenceData.date}`
    );

    if (!res.error) {
      toast(
        res.queued
          ? { title: "Offline gespeichert", description: "Wird automatisch gesendet, sobald wieder Internet da ist." }
          : { title: "Erfolg", description: `${absenceLabel} erfasst` }
      );
      setShowAbsenceDialog(false);
      setAbsenceData({
        date: new Date().toISOString().split('T')[0],
        type: "urlaub",
        document: null,
        customHours: "",
        isFullDay: true,
        absenceStartTime: "07:00",
        absenceEndTime: "16:00",
        absencePauseMinutes: "30",
      });
      fetchExistingDayEntries(selectedDate);
    } else {
      toast({ variant: "destructive", title: "Fehler", description: "Konnte nicht gespeichert werden" });
    }
    setSubmittingAbsence(false);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      toast({ variant: "destructive", title: "Fehler", description: "Sie müssen angemeldet sein" });
      setSaving(false);
      return;
    }

    // Sicherheitsnetz: Mittagspause immer automatisch eintragen, wenn sie fehlt
    const blocksToSave = timeBlocks.map(withAutoPause);
    const autoPausedBlocks = blocksToSave
      .map((b, i) => (b.pauseStart && !timeBlocks[i].pauseStart ? i + 1 : null))
      .filter((n): n is number => n !== null);
    if (autoPausedBlocks.length > 0) {
      sonnerToast.info(
        `Mittagspause 12:00-12:30 automatisch eingetragen (Block ${autoPausedBlocks.join(", ")}) – zählt nicht als Arbeitszeit.`
      );
    }

    // Validate all blocks
    for (let i = 0; i < blocksToSave.length; i++) {
      const block = blocksToSave[i];
      const blockNum = i + 1;

      if (!block.startTime || !block.endTime) {
        toast({ variant: "destructive", title: "Fehler", description: `Block ${blockNum}: Start- und Endzeit erforderlich` });
        setSaving(false);
        return;
      }

      const [startH, startM] = block.startTime.split(':').map(Number);
      const [endH, endM] = block.endTime.split(':').map(Number);
      if (endH * 60 + endM <= startH * 60 + startM) {
        toast({ variant: "destructive", title: "Fehler", description: `Block ${blockNum}: Endzeit muss nach Startzeit liegen` });
        setSaving(false);
        return;
      }

      // Tätigkeit and Projekt are now optional - no validation needed
    }

    // Check for overlaps between blocks
    const timeToMinutes = (time: string): number => {
      const [hours, minutes] = time.split(':').map(Number);
      return hours * 60 + minutes;
    };

    for (let i = 0; i < blocksToSave.length; i++) {
      for (let j = i + 1; j < blocksToSave.length; j++) {
        const blockA = blocksToSave[i];
        const blockB = blocksToSave[j];
        
        const aStart = timeToMinutes(blockA.startTime);
        const aEnd = timeToMinutes(blockA.endTime);
        const bStart = timeToMinutes(blockB.startTime);
        const bEnd = timeToMinutes(blockB.endTime);
        
        if (aStart < bEnd && aEnd > bStart) {
          toast({ 
            variant: "destructive", 
            title: "Zeitüberschneidung", 
            description: `Block ${i + 1} und Block ${j + 1} überschneiden sich` 
          });
          setSaving(false);
          return;
        }
      }
    }

    // Check for overlaps with existing entries
    const { data: existingEntries } = await supabase
      .from("time_entries")
      .select("id, start_time, end_time, taetigkeit")
      .eq("user_id", user.id)
      .eq("datum", selectedDate);

    if (existingEntries && existingEntries.length > 0) {
      for (const entry of existingEntries) {
        if (["Urlaub", "Krankenstand", "Weiterbildung", "Feiertag", "Zeitausgleich"].includes(entry.taetigkeit)) {
          toast({ 
            variant: "destructive", 
            title: "Tag bereits blockiert", 
            description: `Für diesen Tag ist bereits ${entry.taetigkeit} eingetragen.` 
          });
          setSaving(false);
          return;
        }
        
        const existingStart = timeToMinutes(entry.start_time);
        const existingEnd = timeToMinutes(entry.end_time);
        
        for (let i = 0; i < blocksToSave.length; i++) {
          const block = blocksToSave[i];
          const blockStart = timeToMinutes(block.startTime);
          const blockEnd = timeToMinutes(block.endTime);
          
          if (blockStart < existingEnd && blockEnd > existingStart) {
            toast({ 
              variant: "destructive", 
              title: "Zeitüberschneidung", 
              description: `Block ${i + 1} überschneidet mit bestehendem Eintrag (${entry.start_time.substring(0, 5)} - ${entry.end_time.substring(0, 5)})` 
            });
            setSaving(false);
            return;
          }
        }
      }
    }

    // Insert all blocks with team members via Edge Function.
    // Ohne Netz (oder wenn die Anfrage am Netz scheitert) landet der Block in der
    // Offline-Warteschlange und wird automatisch gesendet, sobald wieder Netz da ist.
    let totalEntriesCreated = 0;
    let queuedCount = 0;
    let hasError = false;

    for (const block of blocksToSave) {
      const blockHours = calculateBlockHours(block);
      const pauseMinutes = calculateBlockPauseMinutes(block);

      // Prepare main entry for current user (client-ID -> idempotenter Offline-Sync)
      const mainEntry = {
        id: newId(),
        user_id: user.id,
        datum: selectedDate,
        project_id: block.locationType === "werkstatt" ? null : (block.projectId || null),
        taetigkeit: block.taetigkeit,
        stunden: blockHours,
        start_time: block.startTime,
        end_time: block.endTime,
        pause_minutes: pauseMinutes,
        pause_start: block.pauseStart || null,
        pause_end: block.pauseEnd || null,
        location_type: block.locationType,
        notizen: block.notizen.trim() || null,
        week_type: null,
      };

      // Prepare team entries (je Mitarbeiter eigene client-ID)
      const teamEntries = block.selectedEmployees.map(workerId => ({
        id: newId(),
        user_id: workerId,
        datum: selectedDate,
        project_id: block.locationType === "werkstatt" ? null : (block.projectId || null),
        taetigkeit: block.taetigkeit,
        stunden: blockHours,
        start_time: block.startTime,
        end_time: block.endTime,
        pause_minutes: pauseMinutes,
        pause_start: block.pauseStart || null,
        pause_end: block.pauseEnd || null,
        location_type: block.locationType,
        notizen: block.notizen.trim() || null,
        week_type: null,
      }));

      const body = { mainEntry, teamEntries, createWorkerLinks: true };
      const label = `Zeiteintrag ${format(new Date(selectedDate), "dd.MM.yyyy")} ${block.startTime}-${block.endTime}`;

      // Offline? Direkt in die Warteschlange.
      if (typeof navigator !== "undefined" && navigator.onLine === false) {
        await enqueue("time-entries", body, label);
        queuedCount++;
        continue;
      }

      // Online: versuchen; bei Netzwerkfehler in die Warteschlange ausweichen.
      try {
        const { data: result, error: functionError } = await supabase.functions.invoke(
          "create-team-time-entries",
          { body }
        );
        if (functionError || !result?.success) {
          // Netzwerkbedingt? -> Warteschlange. Sonst echter Fehler.
          const msg = functionError?.message || result?.error || "";
          if (/fetch|network|Failed to fetch|load failed/i.test(msg) || !navigator.onLine) {
            await enqueue("time-entries", body, label);
            queuedCount++;
          } else {
            hasError = true;
            console.error("Error creating time entries:", functionError || result?.error);
          }
          continue;
        }
        totalEntriesCreated += result.totalCreated || 1;
      } catch (err) {
        // Verbindung mittendrin weg -> Warteschlange
        await enqueue("time-entries", body, label);
        queuedCount++;
      }
    }

    const teamInfo = timeBlocks.some(b => b.selectedEmployees.length > 0) ? " (inkl. Team-Mitglieder)" : "";
    if (queuedCount > 0 && !hasError) {
      toast({
        title: "Offline gespeichert",
        description: `${queuedCount} Eintrag/Einträge werden automatisch gesendet, sobald wieder Internet da ist${totalEntriesCreated > 0 ? ` (${totalEntriesCreated} bereits gesendet)` : ""}.`,
      });
      // Formular zurücksetzen wie bei Erfolg
      setTimeBlocks([createDefaultBlock()]);
    } else if (!hasError) {
      toast({ title: "Erfolg", description: `${totalEntriesCreated} Eintrag/Einträge gespeichert${teamInfo}` });
      await fetchExistingDayEntries(selectedDate);
    } else {
      toast({ variant: "destructive", title: "Fehler", description: "Einige Einträge konnten nicht gespeichert werden" });
    }
    setSaving(false);
  };

  const isDayBlocked = existingDayEntries.some(e => ["Urlaub", "Krankenstand", "Weiterbildung", "Feiertag", "Zeitausgleich"].includes(e.taetigkeit));

  if (loading) return <div className="p-4">Lädt...</div>;

  return (
    <div className="min-h-screen bg-background">
      <PageHeader title="Zeiterfassung" />
      
      <div className="p-4">
        <Card className="max-w-2xl mx-auto">
          <CardHeader>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Clock className="h-5 w-5" />
                <CardTitle>Zeiterfassung</CardTitle>
              </div>
              <Button 
                variant="outline" 
                onClick={() => setShowAbsenceDialog(true)} 
                className="gap-2"
              >
                <Calendar className="h-4 w-4" />
                Abwesenheit
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-6">
              <VoiceInputButton
                mode="time"
                context={voiceContext}
                onResult={handleVoiceResult}
                label="Zeit per Sprache erfassen"
              />
              {voiceTranscription && (
                <div className="rounded-md border bg-muted/50 p-2 text-xs italic text-muted-foreground">
                  „{voiceTranscription}"
                </div>
              )}

              {/* Offene Projekte (Referenz) */}
              <Collapsible open={projectListOpen} onOpenChange={setProjectListOpen}>
                <CollapsibleTrigger asChild>
                  <button
                    type="button"
                    className="flex w-full items-center justify-between rounded-md border bg-card px-3 py-2 text-sm hover:bg-muted/50 transition-colors"
                  >
                    <span className="flex items-center gap-2 font-medium">
                      <FolderOpen className="h-4 w-4 text-primary" />
                      Offene Projekte
                      <Badge variant="secondary" className="ml-1">{openProjects.length}</Badge>
                    </span>
                    <ChevronDown className={`h-4 w-4 transition-transform ${projectListOpen ? "rotate-180" : ""}`} />
                  </button>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <div className="mt-2 rounded-md border bg-card">
                    <div className="max-h-48 overflow-y-auto divide-y">
                      {openProjects.length === 0 ? (
                        <div className="p-3 text-sm text-muted-foreground">Keine offenen Projekte.</div>
                      ) : (
                        openProjects.map((p) => (
                          <div key={p.id} className="flex items-center justify-between px-3 py-1.5 text-sm">
                            <span className="truncate">{p.name}</span>
                            <span className="text-xs text-muted-foreground ml-2 shrink-0">
                              {p.customers && [p.customers.strasse, p.customers.ort].filter(Boolean).join(", ") || p.plz}
                            </span>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                </CollapsibleContent>
              </Collapsible>



              {/* Date picker */}
              <div className="space-y-2">
                <Label htmlFor="date">Datum</Label>
                <Input
                  id="date"
                  type="date"
                  value={selectedDate}
                  onChange={(e) => {
                    // Manuelle Datumsänderung: Zeitblöcke auf Standard zurücksetzen.
                    resetBlocksOnDateChange.current = true;
                    setSelectedDate(e.target.value);
                  }}
                  required
                />
                {selectedDate && (
                  <p className="text-sm text-muted-foreground">
                    {format(new Date(selectedDate), "EEEE, dd. MMMM yyyy", { locale: de })}
                  </p>
                )}
              </div>

              {/* Weekly target info */}
              <div className="rounded-lg border bg-card p-4">
                <div className="flex items-center gap-2">
                  <Badge variant="secondary" className="text-xs">
                    {getWeeklyTargetHours()}h Wochensoll
                  </Badge>
                  <span className="text-xs text-muted-foreground">
                    Mo-Do: 8,5h • Fr: 5h (inkl. 0,5h Überstunde/ZA)
                  </span>
                </div>
              </div>

              {/* Existing entries info box */}
              {loadingDayEntries ? (
                <div className="bg-muted/50 rounded-lg p-3 text-sm text-muted-foreground flex items-center gap-2">
                  <Calendar className="w-4 h-4 animate-pulse" />
                  Lade Tageseinträge...
                </div>
              ) : existingDayEntries.length > 0 ? (
                <div className={`rounded-lg p-4 space-y-3 ${
                  isDayBlocked
                    ? "bg-destructive/10 border border-destructive/30"
                    : "bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800"
                }`}>
                  <div className="flex items-center gap-2 font-medium text-sm">
                    {isDayBlocked ? (
                      <>
                        <AlertTriangle className="w-4 h-4 text-destructive" />
                        <span className="text-destructive">Tag blockiert ({existingDayEntries[0].taetigkeit})</span>
                      </>
                    ) : (
                      <>
                        <Calendar className="w-4 h-4 text-amber-600 dark:text-amber-400" />
                        <span className="text-amber-700 dark:text-amber-300">Bereits gebuchte Zeiten</span>
                      </>
                    )}
                  </div>
                  
                  {!isDayBlocked && (
                    <div className="space-y-1.5">
                      {existingDayEntries.map((entry) => (
                        <div key={entry.id} className="flex items-center justify-between text-sm bg-background/60 rounded px-2 py-1.5">
                          <div className="flex items-center gap-2">
                            <Badge variant="outline" className="font-mono text-xs">
                              {entry.start_time.substring(0, 5)} - {entry.end_time.substring(0, 5)}
                            </Badge>
                            <span className="truncate max-w-[150px]">
                              {entry.project_name ? `${entry.project_name}` : entry.taetigkeit}
                            </span>
                          </div>
                          <span className="font-medium">{Number(entry.stunden).toFixed(2)}h</span>
                        </div>
                      ))}
                    </div>
                  )}
                  
                  <div className="flex items-center justify-between pt-2 border-t border-amber-200 dark:border-amber-700">
                    <span className="text-sm font-medium">Tagessumme</span>
                    <span className="font-bold">
                      {existingDayEntries.reduce((sum, e) => sum + Number(e.stunden), 0).toFixed(2)} Stunden
                    </span>
                  </div>
                </div>
              ) : (
                <div className="bg-primary/5 border border-primary/20 rounded-lg p-3 text-sm text-muted-foreground">
                  <p className="flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 text-green-600" />
                    Noch keine Einträge für diesen Tag
                  </p>
                </div>
              )}

              {/* Only show form if day is not blocked */}
              {!isDayBlocked && (
                <>

                  {/* Time Blocks */}
                  <div className="space-y-4">
                    {timeBlocks.map((block, index) => (
                      <div 
                        key={block.id} 
                        className="border rounded-lg p-4 space-y-4 bg-card"
                      >
                        {/* Block header */}
                        <div className="flex items-center justify-between">
                          <h3 className="font-semibold text-sm flex items-center gap-2">
                            <Clock className="w-4 h-4" />
                            {timeBlocks.length > 1 ? `Zeitblock ${index + 1}` : "Arbeitszeit"}
                          </h3>
                          {timeBlocks.length > 1 && (
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              onClick={() => removeBlock(block.id)}
                              className="text-destructive hover:text-destructive hover:bg-destructive/10"
                            >
                              <Trash2 className="w-4 h-4" />
                            </Button>
                          )}
                        </div>

                        {/* Location selection */}
                        <div className="space-y-2">
                          <Label>Arbeitsort</Label>
                          <RadioGroup 
                            value={block.locationType} 
                            onValueChange={(value: 'baustelle' | 'werkstatt') => updateBlock(block.id, { locationType: value })} 
                            className="grid grid-cols-2 gap-4"
                          >
                            <div>
                              <RadioGroupItem value="baustelle" id={`baustelle-${block.id}`} className="peer sr-only" />
                              <Label htmlFor={`baustelle-${block.id}`} className="flex h-12 cursor-pointer items-center justify-center rounded-md border-2 border-muted bg-popover p-4 hover:bg-accent peer-data-[state=checked]:border-primary text-sm">
                                🏗️ Baustelle
                              </Label>
                            </div>
                            <div>
                              <RadioGroupItem value="werkstatt" id={`werkstatt-${block.id}`} className="peer sr-only" />
                              <Label htmlFor={`werkstatt-${block.id}`} className="flex h-12 cursor-pointer items-center justify-center rounded-md border-2 border-muted bg-popover p-4 hover:bg-accent peer-data-[state=checked]:border-primary text-sm">
                                🔧 Werkstatt
                              </Label>
                            </div>
                          </RadioGroup>
                        </div>

                        {/* Project selection - only for Baustelle */}
                        {block.locationType === "baustelle" && (
                          <div className="space-y-2">
                            <Label>Projekt <span className="text-muted-foreground font-normal">(optional)</span></Label>
                            <Select 
                              value={block.projectId} 
                              onValueChange={(value) => {
                                if (value === "new") {
                                  setPendingBlockIdForNewProject(block.id);
                                  setShowNewProjectDialog(true);
                                } else {
                                  updateBlock(block.id, { projectId: value });
                                }
                              }}
                            >
                              <SelectTrigger><SelectValue placeholder="Projekt auswählen" /></SelectTrigger>
                              <SelectContent>
                                {projects.map((p) => (
                                  <SelectItem key={p.id} value={p.id}>{projectLabel(p)}</SelectItem>
                                ))}
                                <SelectItem value="new" className="text-primary font-semibold">
                                  <div className="flex items-center gap-2"><Plus className="w-4 h-4" />Neues Projekt erstellen</div>
                                </SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                        )}

                        {/* Activity - optional */}
                        <div className="space-y-2">
                          <Label>Tätigkeit <span className="text-muted-foreground font-normal">(optional)</span></Label>
                          <Input
                            value={block.taetigkeit}
                            onChange={(e) => updateBlock(block.id, { taetigkeit: e.target.value })}
                            placeholder="Optional - z.B. Montage, Aufmaß..."
                          />
                        </div>

                        {/* Notizen - optional */}
                        <div className="space-y-2">
                          <Label>Notizen <span className="text-muted-foreground font-normal">(optional)</span></Label>
                          <Textarea
                            value={block.notizen}
                            onChange={(e) => updateBlock(block.id, { notizen: e.target.value })}
                            placeholder="Notizen zu diesem Arbeitsblock..."
                            className="min-h-16"
                          />
                        </div>

                        {/* Nachtrag zum Projekt */}
                        {block.projectId && (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="w-full gap-2"
                            onClick={() => {
                              setNachtragProjectId(block.projectId);
                              setShowNachtragDialog(true);
                            }}
                          >
                            <FilePlus2 className="h-4 w-4" />
                            Nachtrag zu diesem Projekt erstellen
                          </Button>
                        )}

                        {/* Start/End/Pause time inputs */}
                        <div className="grid grid-cols-2 gap-3">
                          <div className="space-y-1.5">
                            <Label>Beginn</Label>
                            <Input
                              type="time"
                              value={block.startTime}
                              onChange={(e) => updateBlock(block.id, { startTime: e.target.value })}
                              required
                            />
                          </div>
                          <div className="space-y-1.5">
                            <Label>Ende</Label>
                            <Input
                              type="time"
                              value={block.endTime}
                              onChange={(e) => updateBlock(block.id, { endTime: e.target.value })}
                              required
                            />
                          </div>
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                          <div className="space-y-1.5">
                            <Label>Pause von <span className="text-muted-foreground font-normal">(optional)</span></Label>
                            <Input
                              type="time"
                              value={block.pauseStart}
                              onChange={(e) => updateBlock(block.id, { pauseStart: e.target.value })}
                            />
                          </div>
                          <div className="space-y-1.5">
                            <Label>Pause bis <span className="text-muted-foreground font-normal">(optional)</span></Label>
                            <Input
                              type="time"
                              value={block.pauseEnd}
                              onChange={(e) => updateBlock(block.id, { pauseEnd: e.target.value })}
                            />
                          </div>
                        </div>
                        {/* Regelarbeitszeit button */}
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            const dateObj = new Date(selectedDate);
                            const defaults = getDefaultWorkTimes(dateObj);
                            if (defaults) {
                              updateBlock(block.id, {
                                startTime: defaults.startTime,
                                endTime: defaults.endTime,
                                pauseStart: defaults.pauseStart,
                                pauseEnd: defaults.pauseEnd,
                              });
                            }
                          }}
                          className="w-full text-xs"
                        >
                          <Sun className="w-3 h-3 mr-1" />
                          Regelarbeitszeit einfüllen
                        </Button>

                        {/* Multi-employee selection */}
                        <div className="border-t pt-3">
                          <MultiEmployeeSelect
                            selectedEmployees={block.selectedEmployees}
                            onSelectionChange={(employees) => updateBlockEmployees(block.id, employees)}
                            date={selectedDate}
                            startTime={block.startTime}
                            endTime={block.endTime}
                            label="Weitere Mitarbeiter (optional)"
                          />
                        </div>

                        {/* Block hours */}
                        <div className="bg-muted/50 rounded px-3 py-2 flex items-center justify-between text-sm">
                          <span>Stunden</span>
                          <span className="font-bold">{calculateBlockHours(block).toFixed(2)} h</span>
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* Add another block button */}
                  <Button 
                    type="button" 
                    variant="outline" 
                    onClick={addTimeBlock}
                    className="w-full gap-2 border-dashed"
                  >
                    <Plus className="w-4 h-4" />
                    Weitere Stunden hinzufügen
                  </Button>

                  {/* Total hours */}
                  <div className="bg-primary/10 border border-primary/30 rounded-lg p-4 flex items-center justify-between">
                    <span className="font-medium">Gesamt zu buchen</span>
                    <span className="text-2xl font-bold">{calculateTotalHours()} h</span>
                  </div>

                  <Button type="submit" className="w-full" disabled={saving}>
                    {saving ? "Wird gespeichert..." : `${timeBlocks.length > 1 ? 'Alle Einträge' : 'Stunden'} erfassen`}
                  </Button>
                </>
              )}
            </form>
          </CardContent>
        </Card>

        {/* New Project Dialog */}
        <Dialog open={showNewProjectDialog} onOpenChange={setShowNewProjectDialog}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Neues Projekt erstellen</DialogTitle>
              <DialogDescription>Geben Sie die Details ein.</DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div><Label>Projektname *</Label><Input value={newProjectName} onChange={(e) => setNewProjectName(e.target.value)} /></div>
              <div><Label>PLZ *</Label><Input value={newProjectPlz} onChange={(e) => setNewProjectPlz(e.target.value)} maxLength={5} /></div>
              <div><Label>Adresse</Label><Input value={newProjectAddress} onChange={(e) => setNewProjectAddress(e.target.value)} /></div>
              <div className="flex gap-2 justify-end">
                <Button 
                  variant="outline" 
                  onClick={() => { 
                    setShowNewProjectDialog(false); 
                    setNewProjectName(""); 
                    setNewProjectPlz(""); 
                    setNewProjectAddress(""); 
                    setPendingBlockIdForNewProject(null);
                  }}
                  disabled={creatingProject}
                >
                  Abbrechen
                </Button>
                <Button onClick={handleCreateNewProject} disabled={creatingProject}>
                  {creatingProject ? 'Wird erstellt...' : 'Erstellen'}
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>

        {/* Absence Dialog */}
        <Dialog open={showAbsenceDialog} onOpenChange={setShowAbsenceDialog}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Abwesenheit erfassen</DialogTitle>
              <DialogDescription>Erfassen Sie Urlaub, Krankenstand, ZA, Weiterbildung oder Feiertag</DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div>
                <Label htmlFor="absence-date">Datum</Label>
                <Input 
                  id="absence-date" 
                  type="date" 
                  value={absenceData.date} 
                  onChange={(e) => setAbsenceData({ ...absenceData, date: e.target.value })} 
                />
              </div>
              
              <div>
                <Label>Art</Label>
                <RadioGroup 
                  value={absenceData.type} 
                  onValueChange={(value: "urlaub" | "krankenstand" | "weiterbildung" | "feiertag" | "za") => setAbsenceData({ ...absenceData, type: value })}
                  className="grid grid-cols-3 gap-2 mt-2"
                >
                  <div>
                    <RadioGroupItem value="urlaub" id="urlaub" className="peer sr-only" />
                    <Label 
                      htmlFor="urlaub" 
                      className="flex h-14 cursor-pointer items-center justify-center rounded-md border-2 border-muted bg-popover p-2 hover:bg-accent peer-data-[state=checked]:border-primary text-sm"
                    >
                      🏖️ Urlaub
                    </Label>
                  </div>
                  <div>
                    <RadioGroupItem value="krankenstand" id="krankenstand" className="peer sr-only" />
                    <Label 
                      htmlFor="krankenstand" 
                      className="flex h-14 cursor-pointer items-center justify-center rounded-md border-2 border-muted bg-popover p-2 hover:bg-accent peer-data-[state=checked]:border-primary text-sm"
                    >
                      🏥 Kranken.
                    </Label>
                  </div>
                  <div>
                    <RadioGroupItem value="za" id="za" className="peer sr-only" />
                    <Label 
                      htmlFor="za" 
                      className="flex h-14 cursor-pointer items-center justify-center rounded-md border-2 border-muted bg-popover p-2 hover:bg-accent peer-data-[state=checked]:border-primary text-sm"
                    >
                      ⏰ ZA
                    </Label>
                  </div>
                  <div>
                    <RadioGroupItem value="weiterbildung" id="weiterbildung" className="peer sr-only" />
                    <Label 
                      htmlFor="weiterbildung" 
                      className="flex h-14 cursor-pointer items-center justify-center rounded-md border-2 border-muted bg-popover p-2 hover:bg-accent peer-data-[state=checked]:border-primary text-sm"
                    >
                      📚 Weiterbild.
                    </Label>
                  </div>
                  <div>
                    <RadioGroupItem value="feiertag" id="feiertag" className="peer sr-only" />
                    <Label 
                      htmlFor="feiertag" 
                      className="flex h-14 cursor-pointer items-center justify-center rounded-md border-2 border-muted bg-popover p-2 hover:bg-accent peer-data-[state=checked]:border-primary text-sm"
                    >
                      🎉 Feiertag
                    </Label>
                  </div>
                </RadioGroup>
              </div>

              {/* Ganzer Tag toggle */}
              <div className="flex items-center justify-between">
                <Label htmlFor="full-day-toggle">Ganzer Tag</Label>
                <Switch
                  id="full-day-toggle"
                  checked={absenceData.isFullDay}
                  onCheckedChange={(checked) => {
                    const dateObj = new Date(absenceData.date);
                    const defaults = getDefaultWorkTimes(dateObj);
                    setAbsenceData({
                      ...absenceData,
                      isFullDay: checked,
                      absenceStartTime: defaults?.startTime || "07:00",
                      absenceEndTime: defaults?.endTime || "16:00",
                      absencePauseMinutes: String(defaults?.pauseMinutes ?? 30),
                    });
                  }}
                />
              </div>

              {absenceData.isFullDay ? (
                /* Full day: show calculated hours with optional override */
                <div className="bg-muted/50 rounded-lg p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">Berechnete Stunden für diesen Tag:</span>
                    <Badge variant="secondary" className="text-lg font-bold px-3 py-1">
                      {absenceData.customHours || getNormalWorkingHours(new Date(absenceData.date))} h
                    </Badge>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {(() => {
                      const absenceDateObj = new Date(absenceData.date);
                      const dayOfWeek = absenceDateObj.getDay();
                      if (dayOfWeek === 0 || dayOfWeek === 6) return "Wochenende: 0 Stunden";
                      if (dayOfWeek === 5) return "Freitag: 4,5 Stunden (07:00 - 12:00)";
                      return "Mo-Do: 8,5 Stunden (07:00 - 16:00, 30min Pause)";
                    })()}
                  </div>
                  <div className="pt-2 border-t">
                    <Label className="text-sm">Stunden anpassen (optional)</Label>
                    <div className="flex items-center gap-2 mt-1">
                      <Input
                        type="number"
                        step="0.5"
                        min="0"
                        max="24"
                        placeholder={String(getNormalWorkingHours(new Date(absenceData.date)))}
                        value={absenceData.customHours}
                        onChange={(e) => setAbsenceData({ ...absenceData, customHours: e.target.value })}
                        className="w-24 text-center"
                      />
                      <span className="text-sm text-muted-foreground">Stunden</span>
                      {absenceData.customHours && (
                        <Button 
                          type="button" 
                          variant="ghost" 
                          size="sm"
                          onClick={() => setAbsenceData({ ...absenceData, customHours: "" })}
                        >
                          Zurücksetzen
                        </Button>
                      )}
                    </div>
                  </div>
                </div>
              ) : (
                /* Partial day: Von/Bis time inputs */
                <div className="bg-muted/50 rounded-lg p-4 space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label>Von</Label>
                      <Input
                        type="time"
                        value={absenceData.absenceStartTime}
                        onChange={(e) => {
                          const start = e.target.value;
                          setAbsenceData({
                            ...absenceData,
                            absenceStartTime: start,
                            absencePauseMinutes: absenceSpansLunch(start, absenceData.absenceEndTime) ? "30" : "0",
                          });
                        }}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label>Bis</Label>
                      <Input
                        type="time"
                        value={absenceData.absenceEndTime}
                        onChange={(e) => {
                          const end = e.target.value;
                          setAbsenceData({
                            ...absenceData,
                            absenceEndTime: end,
                            absencePauseMinutes: absenceSpansLunch(absenceData.absenceStartTime, end) ? "30" : "0",
                          });
                        }}
                      />
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <Label>Pause (Minuten)</Label>
                    <Input
                      type="number"
                      min="0"
                      max="120"
                      value={absenceData.absencePauseMinutes}
                      onChange={(e) => setAbsenceData({ ...absenceData, absencePauseMinutes: e.target.value })}
                      className="w-24"
                    />
                  </div>
                  <div className="flex items-center justify-between pt-2 border-t">
                    <span className="text-sm text-muted-foreground">Berechnete Stunden:</span>
                    <Badge variant="secondary" className="text-lg font-bold px-3 py-1">
                      {(() => {
                        const [sH, sM] = absenceData.absenceStartTime.split(':').map(Number);
                        const [eH, eM] = absenceData.absenceEndTime.split(':').map(Number);
                        const pause = parseInt(absenceData.absencePauseMinutes) || 0;
                        const total = Math.max(0, ((eH * 60 + eM) - (sH * 60 + sM) - pause) / 60);
                        return total.toFixed(2);
                      })()} h
                    </Badge>
                  </div>
                </div>
              )}

              {absenceData.type === "krankenstand" && (
                <div>
                  <Label htmlFor="document">Krankmeldung (optional)</Label>
                  <Input 
                    id="document" 
                    type="file" 
                    accept=".pdf,.jpg,.jpeg,.png"
                    onChange={(e) => setAbsenceData({ ...absenceData, document: e.target.files?.[0] || null })}
                    className="mt-2"
                  />
                </div>
              )}

              <div className="flex gap-2 justify-end">
                <Button 
                  variant="outline" 
                  onClick={() => {
                    setShowAbsenceDialog(false);
                    setAbsenceData({ date: new Date().toISOString().split('T')[0], type: "urlaub", document: null, customHours: "", isFullDay: true, absenceStartTime: "07:00", absenceEndTime: "16:00", absencePauseMinutes: "30" });
                  }}
                  disabled={submittingAbsence}
                >
                  Abbrechen
                </Button>
                <Button onClick={handleAbsenceSubmit} disabled={submittingAbsence}>
                  {submittingAbsence ? "Wird gespeichert..." : "Erfassen"}
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>

        {/* Nachtrag Dialog */}
        <NachtragDialog
          open={showNachtragDialog}
          onOpenChange={setShowNachtragDialog}
          projectId={nachtragProjectId || undefined}
        />

      </div>
    </div>
  );
};

export default TimeTracking;
