import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Calendar, Clock, User, Mail, Phone, MapPin, FileText, Package, Plus, Trash2 } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import { newId, isOffline, saveInsert, saveInvoke } from "@/lib/offlineData";
import { getSessionUser } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";
import { MultiEmployeeSelect } from "@/components/MultiEmployeeSelect";
import { VoiceInputButton, type VoiceContext } from "@/components/VoiceInputButton";
import { MaterialPicker } from "@/components/MaterialPicker";

type MaterialEntry = {
  id: string;
  material: string;
  menge: string;
  notizen: string;
};

type CustomerSuggestion = {
  name: string;
  email: string | null;
  adresse: string | null;
  telefon: string | null;
};

type DisturbanceFormProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
  editData?: {
    id: string;
    user_id: string;
    datum: string;
    start_time: string;
    end_time: string;
    pause_minutes: number;
    kunde_name: string;
    kunde_email: string | null;
    kunde_adresse: string | null;
    kunde_telefon: string | null;
    beschreibung: string;
    notizen: string | null;
  } | null;
};

export const DisturbanceForm = ({ open, onOpenChange, onSuccess, editData }: DisturbanceFormProps) => {
  const { toast } = useToast();
  const navigate = useNavigate();
  const [saving, setSaving] = useState(false);

  const [formData, setFormData] = useState({
    datum: format(new Date(), "yyyy-MM-dd"),
    startTime: "08:00",
    endTime: "10:00",
    pauseMinutes: 0,
    kundeName: "",
    kundeEmail: "",
    kundeAdresse: "",
    kundeTelefon: "",
    beschreibung: "",
    notizen: "",
  });

  const [selectedEmployees, setSelectedEmployees] = useState<string[]>([]);
  const [materials, setMaterials] = useState<MaterialEntry[]>([]);
  const [voiceContext, setVoiceContext] = useState<VoiceContext>({});
  const [transcription, setTranscription] = useState<string>("");
  const [aiFilledFields, setAiFilledFields] = useState<Set<string>>(new Set());
  const [customerSuggestions, setCustomerSuggestions] = useState<CustomerSuggestion[]>([]);
  const [showCustomerSuggestions, setShowCustomerSuggestions] = useState(false);

  useEffect(() => {
    if (editData) {
      setFormData({
        datum: editData.datum,
        startTime: editData.start_time.slice(0, 5),
        endTime: editData.end_time.slice(0, 5),
        pauseMinutes: editData.pause_minutes,
        kundeName: editData.kunde_name,
        kundeEmail: editData.kunde_email || "",
        kundeAdresse: editData.kunde_adresse || "",
        kundeTelefon: editData.kunde_telefon || "",
        beschreibung: editData.beschreibung,
        notizen: editData.notizen || "",
      });
      // Load existing workers and materials when editing
      loadExistingWorkers(editData.id);
      loadExistingMaterials(editData.id);
    } else {
      // Reset form for new entry
      setFormData({
        datum: format(new Date(), "yyyy-MM-dd"),
        startTime: "08:00",
        endTime: "10:00",
        pauseMinutes: 0,
        kundeName: "",
        kundeEmail: "",
        kundeAdresse: "",
        kundeTelefon: "",
        beschreibung: "",
        notizen: "",
      });
      setSelectedEmployees([]);
      setMaterials([]);
    }
  }, [editData, open]);

  // Load voice context (employees + Kundenverwaltung + recent customers + material catalog)
  useEffect(() => {
    if (!open) return;
    (async () => {
      const [empRes, kundenRes, custRes, matRes, catalogRes] = await Promise.all([
        supabase.from("profiles").select("id, vorname, nachname").eq("is_active", true),
        supabase.from("customers")
          .select("vorname, nachname, email, strasse, ort, telefon, mobil")
          .order("nachname"),
        supabase.from("disturbances")
          .select("kunde_name, kunde_email, kunde_adresse, kunde_telefon")
          .order("datum", { ascending: false })
          .limit(80),
        supabase.from("disturbance_materials").select("material").limit(300),
        supabase.from("materials").select("name").eq("is_active", true),
      ]);
      const employees = (empRes.data ?? []).map((e: any) => ({
        id: e.id,
        name: [e.vorname, e.nachname].filter(Boolean).join(" ").trim() || "Unbenannt",
      }));
      // Kunden aus der Kundenverwaltung zuerst, dann Kunden aus früheren Regieberichten
      // (Dedupe: Name, Groß-/Kleinschreibung ignoriert)
      const seen = new Set<string>();
      const fromKundenverwaltung: CustomerSuggestion[] = (kundenRes.data ?? [])
        .map((c: any) => ({
          name: [c.vorname, c.nachname].filter(Boolean).join(" ").trim(),
          email: c.email ?? null,
          adresse: [c.strasse, c.ort].filter(Boolean).join(", ") || null,
          telefon: c.mobil || c.telefon || null,
        }))
        .filter((c) => c.name && !seen.has(c.name.toLowerCase()) && seen.add(c.name.toLowerCase()));
      const fromDisturbances: CustomerSuggestion[] = (custRes.data ?? [])
        .filter((c: any) => c.kunde_name && !seen.has(c.kunde_name.toLowerCase()) && seen.add(c.kunde_name.toLowerCase()))
        .map((c: any) => ({
          name: c.kunde_name,
          email: c.kunde_email,
          adresse: c.kunde_adresse,
          telefon: c.kunde_telefon,
        }));
      const customers = [...fromKundenverwaltung, ...fromDisturbances];
      const materialsSet = new Set<string>();
      (catalogRes.data ?? []).forEach((m: any) => m.name && materialsSet.add(m.name));
      (matRes.data ?? []).forEach((m: any) => m.material && materialsSet.add(m.material));
      setVoiceContext({ employees, customers, materials: Array.from(materialsSet) });
      setCustomerSuggestions(customers);
    })();
  }, [open]);

  // Kundenvorschläge (Kundenverwaltung + frühere Regieberichte) passend zur Eingabe
  const filteredCustomerSuggestions = (() => {
    const q = formData.kundeName.trim().toLowerCase();
    if (!q) return [];
    return customerSuggestions
      .filter((c) => c.name.toLowerCase().includes(q) && c.name.toLowerCase() !== q)
      .slice(0, 6);
  })();

  const pickCustomerSuggestion = (c: CustomerSuggestion) => {
    setFormData((prev) => ({
      ...prev,
      kundeName: c.name,
      kundeEmail: c.email || prev.kundeEmail,
      kundeAdresse: c.adresse || prev.kundeAdresse,
      kundeTelefon: c.telefon || prev.kundeTelefon,
    }));
    setShowCustomerSuggestions(false);
  };

  const handleVoiceResult = (result: { transcription: string; extracted: any }) => {
    setTranscription(result.transcription);
    const d = result.extracted?.disturbance;
    if (!d) return;
    const filled = new Set<string>();
    setFormData((prev) => {
      const next = { ...prev };
      if (d.date && /^\d{4}-\d{2}-\d{2}$/.test(d.date)) { next.datum = d.date; filled.add("datum"); }
      if (d.startTime && /^\d{2}:\d{2}$/.test(d.startTime)) { next.startTime = d.startTime; filled.add("startTime"); }
      if (d.endTime && /^\d{2}:\d{2}$/.test(d.endTime)) { next.endTime = d.endTime; filled.add("endTime"); }
      if (typeof d.pauseMinutes === "number") { next.pauseMinutes = d.pauseMinutes; filled.add("pauseMinutes"); }
      if (d.kundeName) { next.kundeName = d.kundeName; filled.add("kundeName"); }
      if (d.kundeEmail) { next.kundeEmail = d.kundeEmail; filled.add("kundeEmail"); }
      if (d.kundeAdresse) { next.kundeAdresse = d.kundeAdresse; filled.add("kundeAdresse"); }
      if (d.kundeTelefon) { next.kundeTelefon = d.kundeTelefon; filled.add("kundeTelefon"); }
      if (d.beschreibung) { next.beschreibung = d.beschreibung; filled.add("beschreibung"); }
      if (d.notizen) { next.notizen = d.notizen; filled.add("notizen"); }
      return next;
    });
    if (Array.isArray(d.employeeIds) && d.employeeIds.length) {
      setSelectedEmployees((prev) => Array.from(new Set([...prev, ...d.employeeIds])));
    }
    if (Array.isArray(d.materials) && d.materials.length) {
      setMaterials((prev) => [
        ...prev,
        ...d.materials.map((m: any) => ({
          id: crypto.randomUUID(),
          material: String(m.material ?? ""),
          menge: String(m.menge ?? ""),
          notizen: String(m.notizen ?? ""),
        })).filter((m: MaterialEntry) => m.material.trim()),
      ]);
    }
    setAiFilledFields(filled);
    const warnings = result.extracted?.warnings ?? [];
    if (warnings.length) {
      toast({ title: "Hinweise", description: warnings.join(" • ") });
    }
  };

  const loadExistingWorkers = async (disturbanceId: string) => {
    const { data } = await supabase
      .from("disturbance_workers")
      .select("user_id, is_main")
      .eq("disturbance_id", disturbanceId);
    
    if (data) {
      // Only load non-main workers (main is the creator)
      const additionalWorkers = data.filter(w => !w.is_main).map(w => w.user_id);
      setSelectedEmployees(additionalWorkers);
    }
  };

  const loadExistingMaterials = async (disturbanceId: string) => {
    const { data } = await supabase
      .from("disturbance_materials")
      .select("id, material, menge, notizen")
      .eq("disturbance_id", disturbanceId);

    if (data) {
      setMaterials(data.map(m => ({
        id: m.id,
        material: m.material,
        menge: m.menge || "",
        notizen: m.notizen || "",
      })));
    }
  };

  const calculateHours = (): number => {
    const [startH, startM] = formData.startTime.split(":").map(Number);
    const [endH, endM] = formData.endTime.split(":").map(Number);
    const totalMinutes = (endH * 60 + endM) - (startH * 60 + startM) - formData.pauseMinutes;
    return Math.max(0, totalMinutes / 60);
  };

  const addMaterial = () => {
    setMaterials([...materials, { id: crypto.randomUUID(), material: "", menge: "", notizen: "" }]);
  };

  const removeMaterial = (id: string) => {
    setMaterials(materials.filter(m => m.id !== id));
  };

  const updateMaterial = (id: string, field: "material" | "menge", value: string) => {
    setMaterials(materials.map(m => m.id === id ? { ...m, [field]: value } : m));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);

    const user = await getSessionUser();
    if (!user) {
      toast({ variant: "destructive", title: "Fehler", description: "Sie müssen angemeldet sein" });
      setSaving(false);
      return;
    }

    // Validation
    if (!formData.kundeName.trim()) {
      toast({ variant: "destructive", title: "Fehler", description: "Kundenname ist erforderlich" });
      setSaving(false);
      return;
    }

    if (!formData.beschreibung.trim()) {
      toast({ variant: "destructive", title: "Fehler", description: "Arbeitsbeschreibung ist erforderlich" });
      setSaving(false);
      return;
    }

    const [startH, startM] = formData.startTime.split(":").map(Number);
    const [endH, endM] = formData.endTime.split(":").map(Number);
    if (endH * 60 + endM <= startH * 60 + startM) {
      toast({ variant: "destructive", title: "Fehler", description: "Endzeit muss nach Startzeit liegen" });
      setSaving(false);
      return;
    }

    const stunden = calculateHours();

    // NOTE: user_id is intentionally NOT part of this shared payload. It is only set
    // on INSERT (create). On UPDATE it must never be sent, otherwise an admin editing
    // someone else's Regiebericht would overwrite (steal) the original owner's user_id.
    const disturbanceData = {
      datum: formData.datum,
      start_time: formData.startTime,
      end_time: formData.endTime,
      pause_minutes: formData.pauseMinutes,
      stunden,
      kunde_name: formData.kundeName.trim(),
      kunde_email: formData.kundeEmail.trim() || null,
      kunde_adresse: formData.kundeAdresse.trim() || null,
      kunde_telefon: formData.kundeTelefon.trim() || null,
      beschreibung: formData.beschreibung.trim(),
      notizen: formData.notizen.trim() || null,
    };

    if (editData) {
      // EDIT-existing bleibt online-only: Änderungen an bestehenden Berichten werden
      // NICHT offline in die Warteschlange gelegt (zu hohes Konfliktrisiko).
      if (isOffline()) {
        toast({ variant: "destructive", title: "Nur mit Internet möglich", description: "Bitte später erneut versuchen." });
        setSaving(false);
        return;
      }

      // Did the scheduled date/times change? Team members' time entries cannot be
      // updated from the client (RLS restricts updates to the owner's own rows), so
      // we warn the user afterwards instead of silently leaving them out of sync.
      const timesChanged =
        editData.datum !== formData.datum ||
        editData.start_time.slice(0, 5) !== formData.startTime ||
        editData.end_time.slice(0, 5) !== formData.endTime ||
        editData.pause_minutes !== formData.pauseMinutes;

      // Update existing. disturbanceData does NOT contain user_id, so ownership is
      // preserved even when an admin edits another user's Regiebericht (BUG 1).
      const { error } = await supabase
        .from("disturbances")
        .update(disturbanceData)
        .eq("id", editData.id);

      if (error) {
        toast({ variant: "destructive", title: "Fehler", description: "Regiebericht konnte nicht aktualisiert werden" });
        setSaving(false);
        return;
      }

      // Update time entries for all workers
      await updateTimeEntriesForAllWorkers(editData.id, user.id, stunden);

      // Update workers
      await updateDisturbanceWorkers(editData.id, user.id, selectedEmployees);

      // Update materials
      await updateMaterials(editData.id, user.id);

      if (timesChanged && (selectedEmployees.length > 0 || editData.user_id !== user.id)) {
        // Time entries of team members could not be updated here (RLS). An admin
        // editing another user's Regiebericht also cannot touch that owner's own
        // entry (RLS), so their booked hours would be left stale. Make it explicit.
        toast({
          title: "Regiebericht aktualisiert",
          description: "Zeiten des Regieberichts geändert — die Stundeneinträge der Team-Mitglieder müssen ggf. manuell angepasst werden",
        });
      } else {
        toast({ title: "Erfolg", description: "Regiebericht wurde aktualisiert" });
      }
    } else {
      // Create new disturbance — offline-fähig. Die id wird clientseitig erzeugt und
      // in die Eltern-Zeile geschrieben, damit Kind-Zeilen (Worker/Material/Zeiten)
      // schon offline auf sie verweisen und der Sync die FK-Reihenfolge wahrt.
      const disturbanceId = newId();
      const label = `Regiebericht: ${formData.kundeName.trim()}`;
      let anyQueued = false;

      // 1) Eltern: disturbance (user_id NUR beim Insert — dieser User wird Eigentümer)
      const distRes = await saveInsert(
        "disturbances",
        { ...disturbanceData, user_id: user.id, id: disturbanceId },
        label
      );
      if (distRes.error) {
        toast({ variant: "destructive", title: "Fehler", description: "Regiebericht konnte nicht erstellt werden" });
        setSaving(false);
        return;
      }
      if (distRes.queued) anyQueued = true;

      // 2) Kind: Worker (Ersteller als Haupt-Techniker + zusätzliche Mitarbeiter)
      const workerRows = [
        { id: newId(), disturbance_id: disturbanceId, user_id: user.id, is_main: true },
        ...selectedEmployees.map(workerId => ({
          id: newId(),
          disturbance_id: disturbanceId,
          user_id: workerId,
          is_main: false,
        })),
      ];
      const workersRes = await saveInsert("disturbance_workers", workerRows, label, anyQueued);
      if (workersRes.error) {
        toast({ variant: "destructive", title: "Fehler", description: "Regiebericht konnte nicht erstellt werden" });
        setSaving(false);
        return;
      }
      if (workersRes.queued) anyQueued = true;

      // 3) Kind: Materialien (notizen je Material bleiben erhalten)
      const validMaterials = materials.filter(m => m.material.trim());
      if (validMaterials.length > 0) {
        const matRes = await saveInsert(
          "disturbance_materials",
          validMaterials.map(m => ({
            id: m.id,
            disturbance_id: disturbanceId,
            user_id: user.id,
            material: m.material.trim(),
            menge: m.menge.trim() || null,
            notizen: m.notizen?.trim() || null,
          })),
          label,
          anyQueued
        );
        if (matRes.error) {
          toast({ variant: "destructive", title: "Fehler", description: "Regiebericht konnte nicht erstellt werden" });
          setSaving(false);
          return;
        }
        if (matRes.queued) anyQueued = true;
      }

      // 4) Zeiteinträge über Edge Function (umgeht RLS für Team-Mitglieder).
      //    mainEntry/teamEntries tragen die disturbance_id bereits.
      const mainEntry = {
        id: newId(),
        user_id: user.id,
        datum: formData.datum,
        start_time: formData.startTime,
        end_time: formData.endTime,
        pause_minutes: formData.pauseMinutes,
        stunden,
        project_id: null,
        disturbance_id: disturbanceId,
        taetigkeit: `Regiebericht: ${formData.kundeName.trim()}`,
        location_type: "baustelle",
      };
      const teamEntries = selectedEmployees.map(workerId => ({
        id: newId(),
        user_id: workerId,
        datum: formData.datum,
        start_time: formData.startTime,
        end_time: formData.endTime,
        pause_minutes: formData.pauseMinutes,
        stunden,
        project_id: null,
        disturbance_id: disturbanceId,
        taetigkeit: `Regiebericht: ${formData.kundeName.trim()}`,
        location_type: "baustelle",
      }));
      const timeRes = await saveInvoke(
        "create-team-time-entries",
        { mainEntry, teamEntries, createWorkerLinks: false }, // Disturbances nutzen disturbance_workers
        label,
        anyQueued
      );
      if (timeRes.error) {
        toast({ variant: "destructive", title: "Fehler", description: "Regiebericht konnte nicht erstellt werden" });
        setSaving(false);
        return;
      }
      if (timeRes.queued) anyQueued = true;

      if (anyQueued) {
        toast({ title: "Offline gespeichert", description: "Wird automatisch gesendet, sobald wieder Internet da ist." });
      } else {
        toast({ title: "Erfolg", description: "Regiebericht wurde erfasst" });
      }

      setSaving(false);
      onOpenChange(false);

      if (anyQueued) {
        // Offline: Der Regiebericht liegt nur in der lokalen Warteschlange — die
        // Detailseite (/disturbances/:id) wäre nicht erreichbar/leer. Deshalb zur
        // gecachten Liste navigieren; die Kundenunterschrift kann später nachgetragen
        // werden, sobald wieder synchronisiert/online.
        navigate("/disturbances");
      } else {
        // Online: zur Detailseite mit direkt geöffnetem Unterschrifts-Dialog.
        navigate(`/disturbances/${disturbanceId}?openSignature=true`);
      }
      return;
    }

    setSaving(false);
    onSuccess();
  };

  const updateTimeEntriesForAllWorkers = async (disturbanceId: string, mainUserId: string, stunden: number) => {
    // RLS only allows a user to update their OWN time_entries. We therefore scope the
    // update to the current user's entry and actually check for errors instead of
    // failing silently. Team members' entries cannot be updated from the client — the
    // caller shows a warning toast when times change and team workers are involved.
    const { error } = await supabase
      .from("time_entries")
      .update({
        datum: formData.datum,
        start_time: formData.startTime,
        end_time: formData.endTime,
        pause_minutes: formData.pauseMinutes,
        stunden,
        taetigkeit: `Regiebericht: ${formData.kundeName.trim()}`,
      })
      .eq("disturbance_id", disturbanceId)
      .eq("user_id", mainUserId);

    if (error) {
      console.error("Error updating own time entry:", error);
      toast({
        variant: "destructive",
        title: "Fehler",
        description: "Ihr Stundeneintrag konnte nicht aktualisiert werden",
      });
    }
  };

  const updateDisturbanceWorkers = async (disturbanceId: string, mainUserId: string, newWorkerIds: string[]) => {
    // Get current workers
    const { data: currentWorkers } = await supabase
      .from("disturbance_workers")
      .select("user_id, is_main")
      .eq("disturbance_id", disturbanceId);

    const currentNonMainIds = (currentWorkers || [])
      .filter(w => !w.is_main)
      .map(w => w.user_id);

    // Workers to add
    const toAdd = newWorkerIds.filter(id => !currentNonMainIds.includes(id));
    
    // Workers to remove
    const toRemove = currentNonMainIds.filter(id => !newWorkerIds.includes(id));

    // Remove workers and their time entries
    for (const workerId of toRemove) {
      await supabase
        .from("time_entries")
        .delete()
        .eq("disturbance_id", disturbanceId)
        .eq("user_id", workerId);
      
      await supabase
        .from("disturbance_workers")
        .delete()
        .eq("disturbance_id", disturbanceId)
        .eq("user_id", workerId);
    }

    // Add new workers via Edge Function (bypasses RLS)
    if (toAdd.length > 0) {
      const stunden = calculateHours();
      
      // Get current user for main entry validation
      const currentUser = await getSessionUser();
      if (!currentUser) return;

      // Create time entries for new workers via Edge Function
      // Use skipMainEntry=true since the main user already has their entry
      const teamEntries = toAdd.map(workerId => ({
        user_id: workerId,
        datum: formData.datum,
        start_time: formData.startTime,
        end_time: formData.endTime,
        pause_minutes: formData.pauseMinutes,
        stunden,
        project_id: null,
        disturbance_id: disturbanceId,
        taetigkeit: `Regiebericht: ${formData.kundeName.trim()}`,
        location_type: "baustelle",
      }));

      const { error: timeError } = await supabase.functions.invoke(
        "create-team-time-entries",
        {
          body: {
            mainEntry: {
              user_id: currentUser.id,
              datum: formData.datum,
              start_time: formData.startTime,
              end_time: formData.endTime,
              pause_minutes: formData.pauseMinutes,
              stunden,
            project_id: null,
            disturbance_id: disturbanceId,
            taetigkeit: `Regiebericht: ${formData.kundeName.trim()}`,
            location_type: "baustelle",
          },
          teamEntries,
            createWorkerLinks: false,
            skipMainEntry: true, // Don't create duplicate main entry
          },
        }
      );

      if (timeError) {
        console.error("Error creating time entries for workers:", timeError);
      }

      // Add disturbance_workers entries
      for (const workerId of toAdd) {
        await supabase.from("disturbance_workers").insert({
          disturbance_id: disturbanceId,
          user_id: workerId,
          is_main: false,
        });
      }
    }
  };

  const updateMaterials = async (disturbanceId: string, userId: string) => {
    const validMaterials = materials.filter(m => m.material.trim());

    // Guard: if the form currently has no materials, do NOT delete existing rows.
    // An empty form during an edit is far more likely a load/RLS artefact than an
    // intentional wipe, and the delete could also be RLS-blocked for rows added by
    // other users (leaving duplicates). Skipping avoids destroying valid data.
    if (validMaterials.length === 0) {
      return;
    }

    // Replace existing materials, preserving each material's notizen so an edit
    // never silently loses per-material notes.
    await supabase
      .from("disturbance_materials")
      .delete()
      .eq("disturbance_id", disturbanceId);

    await supabase.from("disturbance_materials").insert(
      validMaterials.map(m => ({
        disturbance_id: disturbanceId,
        user_id: userId,
        material: m.material.trim(),
        menge: m.menge.trim() || null,
        notizen: m.notizen?.trim() || null,
      }))
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] flex flex-col overflow-hidden">
        <DialogHeader className="flex-shrink-0">
          <DialogTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5" />
            {editData ? "Regiebericht bearbeiten" : "Neuen Regiebericht erfassen"}
          </DialogTitle>
          <DialogDescription>
            Erfassen Sie einen Service-Einsatz beim Kunden. Die Arbeitszeit wird automatisch für alle beteiligten Mitarbeiter gebucht.
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto pr-1">
        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Voice-Eingabe */}
          <VoiceInputButton
            mode="disturbance"
            context={voiceContext}
            onResult={handleVoiceResult}
            label="Regiebericht per Sprache diktieren"
          />
          {transcription && (
            <div className="rounded-md border bg-muted/50 p-2 text-xs italic text-muted-foreground">
              „{transcription}"
            </div>
          )}

          {/* Date and Time Section */}
          <div className="space-y-4">
            <h3 className="font-medium flex items-center gap-2">
              <Calendar className="h-4 w-4" />
              Datum & Uhrzeit
            </h3>
            <div className="grid grid-cols-2 gap-4">
              <div className="col-span-2">
                <Label htmlFor="datum">Datum</Label>
                <Input
                  id="datum"
                  type="date"
                  value={formData.datum}
                  onChange={(e) => setFormData({ ...formData, datum: e.target.value })}
                  required
                />
              </div>
              <div>
                <Label htmlFor="startTime">Startzeit</Label>
                <Input
                  id="startTime"
                  type="time"
                  value={formData.startTime}
                  onChange={(e) => setFormData({ ...formData, startTime: e.target.value })}
                  required
                />
              </div>
              <div>
                <Label htmlFor="endTime">Endzeit</Label>
                <Input
                  id="endTime"
                  type="time"
                  value={formData.endTime}
                  onChange={(e) => setFormData({ ...formData, endTime: e.target.value })}
                  required
                />
              </div>
              <div>
                <Label htmlFor="pauseMinutes">Pause (Minuten)</Label>
                <Input
                  id="pauseMinutes"
                  type="number"
                  min="0"
                  value={formData.pauseMinutes}
                  onChange={(e) => setFormData({ ...formData, pauseMinutes: parseInt(e.target.value) || 0 })}
                />
              </div>
              <div className="flex items-end">
                <div className="bg-muted rounded-md px-3 py-2 w-full text-center">
                  <span className="text-sm text-muted-foreground">Stunden: </span>
                  <span className="font-bold text-primary">{calculateHours().toFixed(2)}</span>
                </div>
              </div>
            </div>
          </div>

          {/* Customer Section */}
          <div className="space-y-4">
            <h3 className="font-medium flex items-center gap-2">
              <User className="h-4 w-4" />
              Kundendaten
            </h3>
            <div className="space-y-3">
              <div className="relative">
                <Label htmlFor="kundeName">Kundenname *</Label>
                <Input
                  id="kundeName"
                  value={formData.kundeName}
                  onChange={(e) => {
                    setFormData({ ...formData, kundeName: e.target.value });
                    setShowCustomerSuggestions(true);
                  }}
                  onFocus={() => setShowCustomerSuggestions(true)}
                  onBlur={() => setTimeout(() => setShowCustomerSuggestions(false), 150)}
                  placeholder="Max Mustermann"
                  autoComplete="off"
                  required
                />
                {showCustomerSuggestions && filteredCustomerSuggestions.length > 0 && (
                  <div className="absolute z-50 mt-1 w-full max-h-48 overflow-y-auto rounded-md border bg-popover shadow-md">
                    {filteredCustomerSuggestions.map((c) => (
                      <button
                        key={c.name}
                        type="button"
                        className="w-full px-3 py-2 text-left text-sm hover:bg-accent"
                        onMouseDown={(e) => {
                          e.preventDefault();
                          pickCustomerSuggestion(c);
                        }}
                      >
                        <span className="font-medium">{c.name}</span>
                        {c.adresse && (
                          <span className="block text-xs text-muted-foreground truncate">{c.adresse}</span>
                        )}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <div>
                <Label htmlFor="kundeEmail" className="flex items-center gap-1">
                  <Mail className="h-3 w-3" /> E-Mail (optional)
                </Label>
                <Input
                  id="kundeEmail"
                  type="email"
                  value={formData.kundeEmail}
                  onChange={(e) => setFormData({ ...formData, kundeEmail: e.target.value })}
                  placeholder="kunde@email.at"
                />
              </div>
              <div>
                <Label htmlFor="kundeTelefon" className="flex items-center gap-1">
                  <Phone className="h-3 w-3" /> Telefon (optional)
                </Label>
                <Input
                  id="kundeTelefon"
                  type="tel"
                  value={formData.kundeTelefon}
                  onChange={(e) => setFormData({ ...formData, kundeTelefon: e.target.value })}
                  placeholder="+43 664 ..."
                />
              </div>
              <div>
                <Label htmlFor="kundeAdresse" className="flex items-center gap-1">
                  <MapPin className="h-3 w-3" /> Adresse (optional)
                </Label>
                <Input
                  id="kundeAdresse"
                  value={formData.kundeAdresse}
                  onChange={(e) => setFormData({ ...formData, kundeAdresse: e.target.value })}
                  placeholder="Musterstraße 1, 9020 Klagenfurt"
                />
              </div>
            </div>
          </div>

          {/* Multi-Employee Selection */}
          <MultiEmployeeSelect
            selectedEmployees={selectedEmployees}
            onSelectionChange={setSelectedEmployees}
            date={formData.datum}
            startTime={formData.startTime}
            endTime={formData.endTime}
          />

          {/* Work Description Section */}
          <div className="space-y-4">
            <h3 className="font-medium flex items-center gap-2">
              <FileText className="h-4 w-4" />
              Arbeitsdetails
            </h3>
            <div className="space-y-3">
              <div>
                <Label htmlFor="beschreibung">Durchgeführte Arbeit *</Label>
                <Textarea
                  id="beschreibung"
                  value={formData.beschreibung}
                  onChange={(e) => setFormData({ ...formData, beschreibung: e.target.value })}
                  placeholder="Beschreiben Sie die durchgeführten Arbeiten..."
                  rows={4}
                  required
                />
              </div>
              <div>
                <Label htmlFor="notizen">Notizen (optional)</Label>
                <Textarea
                  id="notizen"
                  value={formData.notizen}
                  onChange={(e) => setFormData({ ...formData, notizen: e.target.value })}
                  placeholder="Zusätzliche Bemerkungen..."
                  rows={2}
                />
              </div>
            </div>
          </div>

          {/* Materials Section */}
          <div className="space-y-4">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <h3 className="font-medium flex items-center gap-2">
                <Package className="h-4 w-4" />
                Verwendetes Material (optional)
              </h3>
              <div className="flex gap-2">
                <MaterialPicker
                  triggerLabel="Aus Katalog"
                  onSelect={(m) =>
                    setMaterials((prev) => [
                      ...prev,
                      {
                        id: crypto.randomUUID(),
                        material: m.einheit ? `${m.name} (${m.einheit})` : m.name,
                        menge: "",
                        notizen: "",
                      },
                    ])
                  }
                />
                <Button type="button" variant="outline" size="sm" onClick={addMaterial}>
                  <Plus className="h-4 w-4 mr-1" />
                  Material
                </Button>
              </div>
            </div>
            
            {materials.length > 0 && (
              <div className="space-y-2">
                {materials.map((mat) => (
                  <div key={mat.id} className="flex gap-2 items-start">
                    <Input
                      placeholder="Material"
                      value={mat.material}
                      onChange={(e) => updateMaterial(mat.id, "material", e.target.value)}
                      className="flex-1"
                    />
                    <Input
                      placeholder="Menge"
                      value={mat.menge}
                      onChange={(e) => updateMaterial(mat.id, "menge", e.target.value)}
                      className="w-24"
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => removeMaterial(mat.id)}
                      className="text-destructive hover:text-destructive"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </form>
        </div>

        {/* Sticky Actions */}
        <div className="flex gap-3 justify-end pt-4 border-t bg-background flex-shrink-0">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Abbrechen
          </Button>
          <Button onClick={(e) => { 
            e.preventDefault();
            const form = document.querySelector('form');
            if (form) form.requestSubmit();
          }} disabled={saving}>
            {saving ? "Speichern..." : editData ? "Aktualisieren" : "Regiebericht erfassen"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};
