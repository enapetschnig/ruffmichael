import { useEffect, useState, useRef } from "react";
import { ArrowLeft, FolderOpen, Plus, FileText, Image, Package, Lock, Search, Upload, Camera, Trash2, ChevronDown, Home, Settings, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { useNavigate } from "react-router-dom";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { QuickUploadDialog } from "@/components/QuickUploadDialog";
import { MobilePhotoCapture } from "@/components/MobilePhotoCapture";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CustomerFormFields, customerFormToRow, customerAddress, customerDisplayName, type Customer } from "./Customers";

type ProjectCustomer = Pick<Customer, "id" | "vorname" | "nachname" | "strasse" | "ort">;

// Konfigurierbarer Projektstatus (Ampel)
type ProjectStatus = {
  id: string;
  name: string;
  color: string;
  sort_order: number;
};

type Project = {
  id: string;
  name: string;
  beschreibung: string | null;
  adresse: string | null;
  plz: string | null;
  status: string;
  status_id?: string | null;
  project_statuses?: Pick<ProjectStatus, "id" | "name" | "color"> | null;
  customer_id?: string | null;
  customers?: ProjectCustomer | null;
  created_at: string;
  updated_at: string;
  fileCount?: {
    plans: number;
    reports: number;
    materials: number;
    photos: number;
    chef: number;
  };
};

// Anzeige: Projektname, dahinter die Adresse des Kunden (Fallback: Projektadresse)
export const projectDisplayAddress = (p: Pick<Project, "adresse" | "customers">): string => {
  if (p.customers) {
    const addr = customerAddress(p.customers);
    if (addr) return addr;
  }
  return p.adresse ?? "";
};

// Standardordner für neue Projekte (lt. Vorlage der Firma, ohne Vorlagen-Ordner)
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

const Projects = () => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [showNewDialog, setShowNewDialog] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [newProject, setNewProject] = useState({
    name: "",
    beschreibung: "",
    adresse: "",
    plz: "",
  });
  const [customers, setCustomers] = useState<ProjectCustomer[]>([]);
  const [selectedCustomerId, setSelectedCustomerId] = useState<string>("none");
  const [showNewCustomerForm, setShowNewCustomerForm] = useState(false);
  const [newCustomer, setNewCustomer] = useState(emptyCustomerForm);
  const [creating, setCreating] = useState(false);
  const [quickUploadProject, setQuickUploadProject] = useState<{
    projectId: string;
    documentType: 'photos' | 'plans' | 'reports' | 'materials';
  } | null>(null);
  const [projectToClose, setProjectToClose] = useState<{id: string, name: string} | null>(null);
  const [projectToDelete, setProjectToDelete] = useState<{id: string, name: string} | null>(null);
  const [showCameraDialog, setShowCameraDialog] = useState(false);
  const [closedProjectsOpen, setClosedProjectsOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [togglingStatus, setTogglingStatus] = useState<string | null>(null);
  const [selectedProject, setSelectedProject] = useState<Project | null>(null);
  const [showStatusDialog, setShowStatusDialog] = useState(false);

  // Ampel-Status (project_statuses)
  const [statuses, setStatuses] = useState<ProjectStatus[]>([]);
  const [statusFilter, setStatusFilter] = useState<string | null>(null);
  const [newProjectStatusId, setNewProjectStatusId] = useState<string>("none");
  const [showStatusSettings, setShowStatusSettings] = useState(false);
  const [editStatuses, setEditStatuses] = useState<ProjectStatus[]>([]);
  const [newStatusForm, setNewStatusForm] = useState({ name: "", color: "#22c55e" });
  const [statusToDelete, setStatusToDelete] = useState<ProjectStatus | null>(null);
  const [savingStatuses, setSavingStatuses] = useState(false);

  useEffect(() => {
    checkAdminStatus();
    fetchStatuses();
    fetchProjects();
    fetchCustomers();

    // Realtime subscription
    const channel = supabase
      .channel('projects-list-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'projects' }, () => {
        fetchProjects();
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  const checkAdminStatus = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    // Base role only determines admin actions (no overrides)

    const { data } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", user.id)
      .single();

    setIsAdmin(data?.role === "administrator");
  };

  const fetchCustomers = async () => {
    const { data } = await supabase
      .from("customers")
      .select("id, vorname, nachname, strasse, ort")
      .order("nachname")
      .order("vorname");
    setCustomers(data ?? []);
  };

  const fetchStatuses = async (): Promise<ProjectStatus[]> => {
    const { data } = await supabase
      .from("project_statuses")
      .select("id, name, color, sort_order")
      .order("sort_order", { ascending: true });
    const list = data ?? [];
    setStatuses(list);
    return list;
  };

  const fetchProjects = async () => {
    const { data, error } = await supabase
      .from("projects")
      .select("*, customers(id, vorname, nachname, strasse, ort), project_statuses(id, name, color)")
      .order("created_at", { ascending: false });

    if (error) {
      setLoading(false);
      return;
    }

    // Fetch file counts for each project
    const projectsWithCounts = await Promise.all(
      (data || []).map(async (project) => {
        const [plans, reports, materials, photos, chef] = await Promise.all([
          getFileCount(project.id, 'project-plans'),
          getFileCount(project.id, 'project-reports'),
          getFileCount(project.id, 'project-materials'),
          getFileCount(project.id, 'project-photos'),
          getFileCount(project.id, 'project-chef'),
        ]);

        return {
          ...project,
          fileCount: { plans, reports, materials, photos, chef },
        };
      })
    );

    setProjects(projectsWithCounts);
    setLoading(false);
  };

  const handleCreateProject = async () => {
    if (creating) return;
    if (!newProject.name.trim()) {
      toast({
        variant: "destructive",
        title: "Fehler",
        description: "Projektname ist erforderlich",
      });
      return;
    }

    if (!newProject.plz.trim()) {
      toast({
        variant: "destructive",
        title: "Fehler",
        description: "PLZ ist erforderlich",
      });
      return;
    }

    if (!/^\d{4,5}$/.test(newProject.plz.trim())) {
      toast({
        variant: "destructive",
        title: "Fehler",
        description: "PLZ muss 4-5 Ziffern enthalten",
      });
      return;
    }

    if (showNewCustomerForm && !newCustomer.nachname.trim()) {
      toast({
        variant: "destructive",
        title: "Fehler",
        description: "Bitte Nachname des Kunden eingeben",
      });
      return;
    }

    setCreating(true);
    try {
      // Kunde: entweder neu anlegen oder bestehenden verwenden
      let customerId: string | null = null;
      let customerForAddress: { strasse: string | null; ort: string | null } | null = null;

      if (showNewCustomerForm) {
        const { data: { user } } = await supabase.auth.getUser();
        const row = customerFormToRow(newCustomer);
        const { data: created, error: custError } = await supabase
          .from("customers")
          .insert({ ...row, created_by: user?.id ?? null })
          .select("id, strasse, ort")
          .single();
        if (custError || !created) {
          toast({ variant: "destructive", title: "Fehler", description: "Kunde konnte nicht angelegt werden" });
          setCreating(false);
          return;
        }
        customerId = created.id;
        customerForAddress = created;
      } else if (selectedCustomerId !== "none") {
        customerId = selectedCustomerId;
        const c = customers.find((c) => c.id === selectedCustomerId);
        customerForAddress = c ? { strasse: c.strasse, ort: c.ort } : null;
      }

      // Projektadresse: falls leer, aus Kundenadresse übernehmen
      const derivedAdresse = newProject.adresse.trim()
        || (customerForAddress ? [customerForAddress.strasse, customerForAddress.ort].filter(Boolean).join(", ") : "");

      const { data: createdProject, error } = await supabase
        .from("projects")
        .insert({
          name: newProject.name.trim(),
          beschreibung: newProject.beschreibung.trim() || null,
          adresse: derivedAdresse || null,
          plz: newProject.plz.trim(),
          customer_id: customerId,
          status_id: newProjectStatusId !== "none" ? newProjectStatusId : null,
        })
        .select("id")
        .single();

      if (error || !createdProject) {
        toast({
          variant: "destructive",
          title: "Fehler",
          description: "Projekt konnte nicht erstellt werden",
        });
        setCreating(false);
        return;
      }

      // Standardordner anlegen (leere Ordner via .keep-Platzhalter)
      await Promise.all(
        STANDARD_PROJECT_FOLDERS.map((folder) =>
          supabase.storage
            .from("project-files")
            .upload(`${createdProject.id}/${folder}/.keep`, new Blob([""], { type: "text/plain" }))
        )
      );

      toast({
        title: "Erfolg",
        description: "Projekt wurde erstellt (inkl. Standardordner)",
      });
      setNewProject({ name: "", beschreibung: "", adresse: "", plz: "" });
      setNewProjectStatusId("none");
      setSelectedCustomerId("none");
      setShowNewCustomerForm(false);
      setNewCustomer(emptyCustomerForm);
      setShowNewDialog(false);
      fetchProjects();
      fetchCustomers();
    } finally {
      setCreating(false);
    }
  };

  const handleToggleProjectStatus = async (projectId: string, currentStatus: string, projectName: string) => {
    if (togglingStatus) return; // Prevent double-click
    
    // Wenn Projekt geschlossen wird → Bestätigung anfordern
    if (currentStatus === 'aktiv') {
      setProjectToClose({ id: projectId, name: projectName });
      return;
    }
    // Wiedereröffnen ohne Bestätigung
    await updateProjectStatus(projectId, 'aktiv', projectName);
  };

  const updateProjectStatus = async (projectId: string, newStatus: string, projectName: string) => {
    if (togglingStatus) return;
    setTogglingStatus(projectId);

    const { error } = await supabase
      .from("projects")
      .update({ status: newStatus })
      .eq("id", projectId);

    if (error) {
      toast({
        variant: "destructive",
        title: "Fehler",
        description: "Projekt konnte nicht aktualisiert werden",
      });
      setTogglingStatus(null);
    } else {
      toast({
        title: newStatus === 'aktiv' ? 'Projekt wiedereröffnet' : 'Projekt geschlossen',
        description: `${projectName} wurde ${newStatus === 'aktiv' ? 'wiedereröffnet' : 'geschlossen'}`,
      });
      fetchProjects();
      setTogglingStatus(null);
    }
    setProjectToClose(null);
  };

  // Ampel: Status eines Projekts setzen (auch für Nicht-Admins)
  const handleSetProjectAmpel = async (projectId: string, statusId: string | null) => {
    const { error } = await supabase
      .from("projects")
      .update({ status_id: statusId })
      .eq("id", projectId);

    if (error) {
      toast({
        variant: "destructive",
        title: "Fehler",
        description: "Status konnte nicht gesetzt werden",
      });
      return;
    }
    fetchProjects();
  };

  // --- Status-Einstellungen (nur Admin) ---
  const openStatusSettings = () => {
    setEditStatuses(statuses.map((s) => ({ ...s })));
    setNewStatusForm({ name: "", color: "#22c55e" });
    setShowStatusSettings(true);
  };

  const isStatusDirty = (edited: ProjectStatus) => {
    const original = statuses.find((s) => s.id === edited.id);
    if (!original) return false;
    return original.name !== edited.name || original.color !== edited.color;
  };

  const handleSaveStatus = async (edited: ProjectStatus) => {
    if (!edited.name.trim()) {
      toast({ variant: "destructive", title: "Fehler", description: "Name darf nicht leer sein" });
      return false;
    }
    const { error } = await supabase
      .from("project_statuses")
      .update({ name: edited.name.trim(), color: edited.color })
      .eq("id", edited.id);
    if (error) {
      toast({ variant: "destructive", title: "Fehler", description: "Status konnte nicht gespeichert werden" });
      return false;
    }
    return true;
  };

  const handleSaveSingleStatus = async (edited: ProjectStatus) => {
    if (savingStatuses) return;
    setSavingStatuses(true);
    const ok = await handleSaveStatus(edited);
    if (ok) {
      toast({ title: "Gespeichert", description: `Status "${edited.name.trim()}" wurde aktualisiert` });
      await fetchStatuses();
      fetchProjects();
    }
    setSavingStatuses(false);
  };

  const handleSaveAllStatuses = async () => {
    if (savingStatuses) return;
    const dirty = editStatuses.filter(isStatusDirty);
    if (dirty.length === 0) {
      toast({ title: "Keine Änderungen", description: "Es gibt nichts zu speichern" });
      return;
    }
    setSavingStatuses(true);
    let allOk = true;
    for (const s of dirty) {
      const ok = await handleSaveStatus(s);
      if (!ok) allOk = false;
    }
    if (allOk) {
      toast({ title: "Gespeichert", description: "Alle Änderungen wurden übernommen" });
    }
    await fetchStatuses();
    fetchProjects();
    setSavingStatuses(false);
  };

  const handleAddStatus = async () => {
    if (savingStatuses) return;
    if (!newStatusForm.name.trim()) {
      toast({ variant: "destructive", title: "Fehler", description: "Bitte einen Namen für den neuen Status eingeben" });
      return;
    }
    setSavingStatuses(true);
    const maxOrder = statuses.reduce((max, s) => Math.max(max, s.sort_order), 0);
    const { data: created, error } = await supabase
      .from("project_statuses")
      .insert({
        name: newStatusForm.name.trim(),
        color: newStatusForm.color,
        sort_order: maxOrder + 1,
      })
      .select("id, name, color, sort_order")
      .single();
    if (error || !created) {
      toast({ variant: "destructive", title: "Fehler", description: "Status konnte nicht angelegt werden" });
    } else {
      toast({ title: "Erfolg", description: `Status "${created.name}" wurde angelegt` });
      setEditStatuses((prev) => [...prev, { ...created }]);
      setNewStatusForm({ name: "", color: "#22c55e" });
      await fetchStatuses();
    }
    setSavingStatuses(false);
  };

  const handleDeleteStatus = async () => {
    if (!statusToDelete || savingStatuses) return;
    setSavingStatuses(true);
    const { id, name } = statusToDelete;
    const { error } = await supabase
      .from("project_statuses")
      .delete()
      .eq("id", id);
    if (error) {
      toast({ variant: "destructive", title: "Fehler", description: "Status konnte nicht gelöscht werden" });
    } else {
      toast({ title: "Gelöscht", description: `Status "${name}" wurde gelöscht` });
      setEditStatuses((prev) => prev.filter((s) => s.id !== id));
      if (statusFilter === id) setStatusFilter(null);
      await fetchStatuses();
      fetchProjects();
    }
    setStatusToDelete(null);
    setSavingStatuses(false);
  };

  // Echte Ampel vor dem Projektnamen: alle Farben nebeneinander,
  // ein Klick auf eine Farbe setzt den Status direkt.
  // Klick auf die aktive Farbe entfernt den Status wieder.
  const renderAmpel = (project: Project) => (
    <span
      className="flex items-center gap-1 shrink-0 rounded-full border bg-background/90 px-1.5 py-1"
      onClick={(e) => { e.stopPropagation(); e.preventDefault(); }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      {statuses.map((s) => {
        const active = project.status_id === s.id;
        return (
          <button
            key={s.id}
            type="button"
            title={active ? `${s.name} – Klick zum Entfernen` : s.name}
            aria-label={`Status setzen: ${s.name}`}
            aria-pressed={active}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              e.preventDefault();
              handleSetProjectAmpel(project.id, active ? null : s.id);
            }}
            className="flex items-center justify-center h-9 w-9 rounded-full transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-ring hover:bg-muted"
          >
            <span
              className={
                active
                  ? "block h-7 w-7 rounded-full ring-2 ring-offset-1 ring-foreground/50 transition-all"
                  : "block h-5 w-5 rounded-full opacity-60 hover:opacity-100 transition-all"
              }
              style={{ backgroundColor: s.color }}
            />
          </button>
        );
      })}
    </span>
  );

  // Karten-Einfärbung je nach Ampel-Status
  const ampelCardStyle = (project: Project) =>
    project.project_statuses
      ? { backgroundColor: `${project.project_statuses.color}14`, borderColor: project.project_statuses.color }
      : undefined;

  const ampelHeaderStyle = (project: Project) =>
    project.project_statuses
      ? { backgroundColor: `${project.project_statuses.color}22` }
      : undefined;

  const handleDeleteProject = async () => {
    if (!projectToDelete || deleting) return;
    setDeleting(true);

    const { id, name } = projectToDelete;

    try {
      // Unterschriebene Nachträge blockieren das Löschen (rechtlich relevante Dokumente)
      const { count: signedCount, error: signedError } = await supabase
        .from('nachtraege')
        .select('id', { count: 'exact', head: true })
        .eq('project_id', id)
        .eq('status', 'unterschrieben');

      if (signedError) throw signedError;

      if ((signedCount ?? 0) > 0) {
        toast({
          title: "Löschen nicht möglich",
          description:
            signedCount === 1
              ? "Projekt hat 1 unterschriebenen Nachtrag und kann nicht gelöscht werden"
              : `Projekt hat ${signedCount} unterschriebene Nachträge und kann nicht gelöscht werden`,
          variant: "destructive",
        });
        return;
      }

      // Delete all files from storage buckets
      const buckets = ['project-plans', 'project-reports', 'project-materials', 'project-photos'];
      
      for (const bucket of buckets) {
        const { data: files } = await supabase.storage
          .from(bucket)
          .list(id);
        
        if (files && files.length > 0) {
          const filePaths = files.map(file => `${id}/${file.name}`);
          await supabase.storage
            .from(bucket)
            .remove(filePaths);
        }
      }

      // Delete documents entries
      await supabase
        .from('documents')
        .delete()
        .eq('project_id', id);

      // Set project_id to null in time_entries and reports
      await supabase
        .from('time_entries')
        .update({ project_id: null })
        .eq('project_id', id);

      await supabase
        .from('reports')
        .update({ project_id: null })
        .eq('project_id', id);

      // Finally delete the project
      const { error } = await supabase
        .from('projects')
        .delete()
        .eq('id', id);

      if (error) throw error;

      toast({
        title: "Erfolg",
        description: `Projekt "${name}" wurde erfolgreich gelöscht`,
      });
    } catch (error) {
      console.error('Delete error:', error);
      toast({
        title: "Fehler",
        description: "Projekt konnte nicht vollständig gelöscht werden",
        variant: "destructive",
      });
    } finally {
      setDeleting(false);
      setProjectToDelete(null);
    }
  };

  const handlePhotoCapture = async (file: File) => {
    if (!quickUploadProject) {
      throw new Error("Kein Projekt ausgewählt");
    }

    const timestamp = Date.now();
    const filePath = `${quickUploadProject.projectId}/${timestamp}_${file.name}`;
    
    const { error: uploadError } = await supabase
      .storage
      .from('project-photos')
      .upload(filePath, file, {
        cacheControl: '3600',
        upsert: false
      });

    if (uploadError) throw uploadError;

    const { data: { publicUrl } } = supabase
      .storage
      .from('project-photos')
      .getPublicUrl(filePath);

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error("Nicht angemeldet");

    const { error: dbError } = await supabase
      .from('documents')
      .insert({
        user_id: user.id,
        project_id: quickUploadProject.projectId,
        typ: 'photos',
        name: file.name,
        file_url: publicUrl,
        beschreibung: 'Foto hochgeladen',
      });

    if (dbError) throw dbError;

    setQuickUploadProject(null);
    fetchProjects();
  };

  const getFileCount = async (projectId: string, bucketName: string): Promise<number> => {
    const { data, error } = await supabase.storage
      .from(bucketName)
      .list(projectId);

    if (error) {
      console.error(`Error fetching file count from ${bucketName}:`, error);
      return 0;
    }

    return data?.length || 0;
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    
    if (diffMins < 60) return `vor ${diffMins} Min.`;
    if (diffMins < 1440) return `vor ${Math.floor(diffMins / 60)} Std.`;
    if (diffMins < 2880) return "Gestern";
    return date.toLocaleDateString("de-DE");
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p>Lädt...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-card sticky top-0 z-50 shadow-sm">
        <div className="container mx-auto px-3 sm:px-4 lg:px-6 py-3 sm:py-4">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Button variant="ghost" size="icon" onClick={() => navigate("/")}>
                <Home className="h-5 w-5" />
              </Button>
              <img 
                src="/ruff-logo.png"
                alt="Ruff Michael Logo"
                className="h-8 w-8 sm:h-10 sm:w-10 cursor-pointer hover:opacity-80 transition-opacity object-contain" 
                onClick={() => navigate("/")}
              />
            </div>
            <div className="flex items-center gap-2">
              {isAdmin && (
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1"
                  onClick={openStatusSettings}
                  title="Status-Einstellungen"
                  aria-label="Status-Einstellungen"
                >
                  <Settings className="h-4 w-4" />
                </Button>
              )}
              <Dialog open={showNewDialog} onOpenChange={setShowNewDialog}>
              <DialogTrigger asChild>
                <Button size="sm" className="gap-1 sm:gap-2">
                  <Plus className="h-3 w-3 sm:h-4 sm:w-4" />
                  <span className="hidden sm:inline">Neues Projekt</span>
                  <span className="sm:hidden">Neu</span>
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-sm sm:max-w-lg max-h-[90vh] overflow-y-auto">
                <DialogHeader>
                  <DialogTitle>Neues Projekt erstellen</DialogTitle>
                  <DialogDescription>Bauvorhaben hinzufügen</DialogDescription>
                </DialogHeader>
                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="name">Projektname *</Label>
                    <Input
                      id="name"
                      value={newProject.name}
                      onChange={(e) => setNewProject({ ...newProject, name: e.target.value })}
                      placeholder="z.B. Einfamilienhaus Müller"
                    />
                  </div>

                  {/* Kunde: aus Bestand wählen oder neu anlegen (gleiche Struktur wie Kundenverwaltung) */}
                  <div className="rounded-lg border p-3 space-y-3">
                    <Label>Kunde</Label>
                    {!showNewCustomerForm ? (
                      <>
                        <Select value={selectedCustomerId} onValueChange={setSelectedCustomerId}>
                          <SelectTrigger>
                            <SelectValue placeholder="Kunde auswählen" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="none">— Kein Kunde —</SelectItem>
                            {customers.map((c) => (
                              <SelectItem key={c.id} value={c.id}>
                                {customerDisplayName(c)}{customerAddress(c) ? ` (${customerAddress(c)})` : ""}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="w-full gap-2"
                          onClick={() => setShowNewCustomerForm(true)}
                        >
                          <Plus className="h-4 w-4" /> Neuen Kunden anlegen
                        </Button>
                      </>
                    ) : (
                      <>
                        <CustomerFormFields form={newCustomer} setForm={setNewCustomer} />
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="w-full"
                          onClick={() => setShowNewCustomerForm(false)}
                        >
                          Stattdessen bestehenden Kunden wählen
                        </Button>
                      </>
                    )}
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="plz">PLZ *</Label>
                    <Input
                      id="plz"
                      value={newProject.plz}
                      onChange={(e) => setNewProject({ ...newProject, plz: e.target.value })}
                      placeholder="z.B. 9613"
                      maxLength={5}
                    />
                    <p className="text-xs text-muted-foreground">
                      4-5 stellige Postleitzahl
                    </p>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="adresse">Adresse</Label>
                    <Input
                      id="adresse"
                      value={newProject.adresse}
                      onChange={(e) => setNewProject({ ...newProject, adresse: e.target.value })}
                      placeholder="Leer lassen = Adresse des Kunden"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="beschreibung">Beschreibung</Label>
                    <Textarea
                      id="beschreibung"
                      value={newProject.beschreibung}
                      onChange={(e) => setNewProject({ ...newProject, beschreibung: e.target.value })}
                      placeholder="Kurze Projektbeschreibung..."
                      className="min-h-20"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="projekt-status">Ampel-Status</Label>
                    <Select value={newProjectStatusId} onValueChange={setNewProjectStatusId}>
                      <SelectTrigger id="projekt-status">
                        <SelectValue placeholder="Status wählen" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">
                          <span className="flex items-center gap-2">
                            <span className="h-3 w-3 rounded-full border-2 border-muted-foreground/50 shrink-0" />
                            Kein Status
                          </span>
                        </SelectItem>
                        {statuses.map((s) => (
                          <SelectItem key={s.id} value={s.id}>
                            <span className="flex items-center gap-2">
                              <span className="h-3 w-3 rounded-full shrink-0" style={{ backgroundColor: s.color }} />
                              {s.name}
                            </span>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <Button onClick={handleCreateProject} disabled={creating} className="w-full">
                    {creating ? "Erstelle..." : "Projekt erstellen"}
                  </Button>
                </div>
              </DialogContent>
              </Dialog>
            </div>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-3 sm:px-4 lg:px-6 py-4 sm:py-6 max-w-6xl">
        <div className="mb-4 sm:mb-6">
          <h1 className="text-2xl sm:text-3xl font-bold mb-1 sm:mb-2">Projekte</h1>
          <p className="text-sm sm:text-base text-muted-foreground">
            Bauvorhaben verwalten und dokumentieren
          </p>
        </div>

        {/* Aktive Projekte Section */}
        <div className="mb-6">
          <div className="flex items-center gap-2 mb-4">
            <h2 className="text-xl font-semibold">Aktive Projekte</h2>
            <Badge variant="secondary">
              {projects.filter(p => p.status === 'aktiv').length}
            </Badge>
          </div>

          {/* Ampel-Filter */}
          {statuses.length > 0 && (
            <div className="mb-4 flex flex-wrap items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className={`h-8 rounded-full ${statusFilter === null ? 'bg-primary text-primary-foreground border-primary hover:bg-primary/90 hover:text-primary-foreground' : ''}`}
                onClick={() => setStatusFilter(null)}
              >
                Alle
              </Button>
              {statuses.map((s) => {
                const count = projects.filter((p) => p.status === 'aktiv' && p.status_id === s.id).length;
                const selected = statusFilter === s.id;
                return (
                  <Button
                    key={s.id}
                    type="button"
                    variant="outline"
                    size="sm"
                    className={`h-8 rounded-full gap-2 ${selected ? 'hover:opacity-90' : ''}`}
                    style={selected ? { backgroundColor: s.color, borderColor: s.color, color: '#ffffff' } : undefined}
                    onClick={() => setStatusFilter(selected ? null : s.id)}
                    title={s.name}
                  >
                    <span
                      className="h-3 w-3 rounded-full shrink-0"
                      style={{ backgroundColor: selected ? '#ffffff' : s.color }}
                    />
                    {s.name}
                    <span className={selected ? 'text-white/80' : 'text-muted-foreground'}>({count})</span>
                  </Button>
                );
              })}
            </div>
          )}

          <div className="mb-4">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                type="text"
                placeholder="Aktive Projekte durchsuchen..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10"
              />
            </div>
          </div>

          <div className="grid gap-3 sm:gap-4 lg:gap-6">
            {projects
              .filter((project) => {
                if (project.status !== 'aktiv') return false;
                if (statusFilter && project.status_id !== statusFilter) return false;
                const query = searchQuery.toLowerCase();
                return (
                  project.name.toLowerCase().includes(query) ||
                  project.adresse?.toLowerCase().includes(query) ||
                  project.beschreibung?.toLowerCase().includes(query) ||
                  (project.customers ? customerDisplayName(project.customers).toLowerCase().includes(query) : false) ||
                  projectDisplayAddress(project).toLowerCase().includes(query)
                );
              })
              .map((project) => (
            <Card
              key={project.id}
              className="border-2 hover:shadow-lg transition-all cursor-pointer"
              style={ampelCardStyle(project)}
              onClick={() => navigate(`/projects/${project.id}`)}

            >
              <CardHeader className="bg-primary/5 pb-3 sm:pb-4" style={ampelHeaderStyle(project)}>
                <div className="flex flex-col sm:flex-row sm:justify-between gap-3">
                  <div className="flex gap-2 sm:gap-3">
                    <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-lg bg-primary/10 text-primary flex items-center justify-center shrink-0">
                      {project.status === "geschlossen" ? (
                        <Lock className="w-5 h-5 sm:w-6 sm:h-6" />
                      ) : (
                        <FolderOpen className="w-5 h-5 sm:w-6 sm:h-6" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <CardTitle className="text-base sm:text-xl flex items-center gap-2 min-w-0">
                        {renderAmpel(project)}
                        <span className="truncate">
                          {project.name}
                          {projectDisplayAddress(project) && (
                            <span className="font-normal text-muted-foreground text-sm sm:text-base"> – {projectDisplayAddress(project)}</span>
                          )}
                        </span>
                      </CardTitle>
                      {project.customers && (
                        <CardDescription className="text-xs sm:text-sm">
                          Kunde: {customerDisplayName(project.customers)}
                        </CardDescription>
                      )}
                    </div>
                  </div>
                  <Badge 
                    variant={project.status === "aktiv" ? "default" : "secondary"}
                    className="self-start sm:self-center whitespace-nowrap"
                  >
                    {project.status === "aktiv" ? "Aktiv" : "Geschlossen"}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="pt-4 sm:pt-6">
                {project.beschreibung && (
                  <p className="text-xs sm:text-sm text-muted-foreground mb-4 line-clamp-2">
                    {project.beschreibung}
                  </p>
                )}
                
                <div className={`grid ${isAdmin ? 'grid-cols-5' : 'grid-cols-2 sm:grid-cols-4'} gap-2 sm:gap-3 mb-4`}>
                  <div className="flex flex-col items-center gap-1 p-2">
                    <FileText className="w-5 h-5 text-primary" />
                    <span className="text-xs font-medium">Pläne</span>
                    <span className="text-xs text-muted-foreground">
                      {project.fileCount?.plans || 0}
                    </span>
                  </div>
                  <div className="flex flex-col items-center gap-1 p-2">
                    <FileText className="w-5 h-5 text-primary" />
                    <span className="text-xs font-medium">Berichte</span>
                    <span className="text-xs text-muted-foreground">
                      {project.fileCount?.reports || 0}
                    </span>
                  </div>
                  <div className="flex flex-col items-center gap-1 p-2">
                    <Package className="w-5 h-5 text-primary" />
                    <span className="text-xs font-medium">Material</span>
                    <span className="text-xs text-muted-foreground">
                      {project.fileCount?.materials || 0}
                    </span>
                  </div>
                  <div className="flex flex-col items-center gap-1 p-2">
                    <Image className="w-5 h-5 text-primary" />
                    <span className="text-xs font-medium">Fotos</span>
                    <span className="text-xs text-muted-foreground">
                      {project.fileCount?.photos || 0}
                    </span>
                  </div>
                  {isAdmin && (
                    <div className="flex flex-col items-center gap-1 p-2">
                      <Lock className="w-5 h-5 text-primary" />
                      <span className="text-xs font-medium">Chef</span>
                      <span className="text-xs text-muted-foreground">
                        {project.fileCount?.chef || 0}
                      </span>
                    </div>
                  )}
                </div>

                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="outline"
                      size="sm"
                      className="w-full gap-2 mt-3"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <Upload className="w-4 h-4" />
                      + Dateien hochladen
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start" className="w-56 bg-background z-50">
                    <DropdownMenuItem onClick={(e) => {
                      e.stopPropagation();
                      setQuickUploadProject({ projectId: project.id, documentType: 'photos' });
                      setShowCameraDialog(true);
                    }}>
                      <Camera className="w-4 h-4 mr-2" />
                      📸 Foto aufnehmen
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={(e) => {
                      e.stopPropagation();
                      setQuickUploadProject({ projectId: project.id, documentType: 'photos' });
                    }}>
                      <Camera className="w-4 h-4 mr-2" />
                      📷 Fotos hochladen
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={(e) => {
                      e.stopPropagation();
                      setQuickUploadProject({ projectId: project.id, documentType: 'plans' });
                    }}>
                      <FileText className="w-4 h-4 mr-2" />
                      📋 Pläne hochladen
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={(e) => {
                      e.stopPropagation();
                      setQuickUploadProject({ projectId: project.id, documentType: 'reports' });
                    }}>
                      <FileText className="w-4 h-4 mr-2" />
                      📄 Regieberichte hochladen
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={(e) => {
                      e.stopPropagation();
                      setQuickUploadProject({ projectId: project.id, documentType: 'materials' });
                    }}>
                      <Package className="w-4 h-4 mr-2" />
                      📦 Materiallisten hochladen
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>

                <div 
                  className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pt-2 border-t mt-3"
                  onClick={(e) => e.stopPropagation()}
                >
                  <p className="text-xs text-muted-foreground">
                    Aktualisiert: {formatDate(project.updated_at)}
                  </p>
                  {isAdmin && (
                    <Button
                      variant={project.status === 'aktiv' ? 'ghost' : 'default'}
                      size="sm"
                      className="text-xs self-end sm:self-auto"
                      onClick={() => handleToggleProjectStatus(project.id, project.status, project.name)}
                    >
                      {project.status === 'aktiv' ? 'Projekt schließen' : 'Projekt wiedereröffnen'}
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}

          {projects.filter(p => p.status === 'aktiv').length === 0 && (
            <Card>
              <CardContent className="py-12 text-center">
                <FolderOpen className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
                <p className="text-lg font-semibold mb-2">Keine aktiven Projekte</p>
                <p className="text-sm text-muted-foreground mb-4">
                  Erstelle dein erstes Projekt
                </p>
                <Button onClick={() => setShowNewDialog(true)}>
                  <Plus className="w-4 h-4 mr-2" />
                  Neues Projekt
                </Button>
              </CardContent>
            </Card>
          )}
          </div>
        </div>

        {/* Geschlossene Projekte Section */}
        {projects.filter(p => p.status === 'geschlossen').length > 0 && (
          <Collapsible open={closedProjectsOpen} onOpenChange={setClosedProjectsOpen}>
            <div className="mb-4">
              <CollapsibleTrigger asChild>
                <Button variant="ghost" className="w-full justify-between p-0 hover:bg-transparent">
                  <div className="flex items-center gap-2">
                    <h2 className="text-xl font-semibold">Geschlossene Projekte</h2>
                    <Badge variant="secondary">
                      {projects.filter(p => p.status === 'geschlossen').length}
                    </Badge>
                  </div>
                  <ChevronDown className={`h-5 w-5 transition-transform ${closedProjectsOpen ? 'rotate-180' : ''}`} />
                </Button>
              </CollapsibleTrigger>
            </div>

            <CollapsibleContent>
              <div className="grid gap-3 sm:gap-4 lg:gap-6">
                {projects
                  .filter((project) => project.status === 'geschlossen')
                  .map((project) => (
                  <Card
                    key={project.id}
                    className="border-2 hover:shadow-lg transition-all cursor-pointer"
                    style={ampelCardStyle(project)}
                    onClick={() => navigate(`/projects/${project.id}`)}
                  >
                    <CardHeader className="bg-primary/5 pb-3 sm:pb-4" style={ampelHeaderStyle(project)}>
                      <div className="flex flex-col sm:flex-row sm:justify-between gap-3">
                        <div className="flex gap-2 sm:gap-3">
                          <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-lg bg-primary/10 text-primary flex items-center justify-center shrink-0">
                            <Lock className="w-5 h-5 sm:w-6 sm:h-6" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <CardTitle className="text-base sm:text-xl flex items-center gap-2 min-w-0">
                              {renderAmpel(project)}
                              <span className="truncate">
                                {project.name}
                                {projectDisplayAddress(project) && (
                                  <span className="font-normal text-muted-foreground text-sm sm:text-base"> – {projectDisplayAddress(project)}</span>
                                )}
                              </span>
                            </CardTitle>
                            {project.customers && (
                              <CardDescription className="text-xs sm:text-sm">
                                Kunde: {customerDisplayName(project.customers)}
                              </CardDescription>
                            )}
                          </div>
                        </div>
                        <Badge variant="secondary" className="self-start sm:self-center whitespace-nowrap">
                          Geschlossen
                        </Badge>
                      </div>
                    </CardHeader>
                    <CardContent className="pt-4 sm:pt-6">
                      {project.beschreibung && (
                        <p className="text-xs sm:text-sm text-muted-foreground mb-4 line-clamp-2">
                          {project.beschreibung}
                        </p>
                      )}
                      
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-3 mb-4">
                        <div className="flex flex-col items-center gap-1 p-2">
                          <FileText className="w-5 h-5 text-primary" />
                          <span className="text-xs font-medium">Pläne</span>
                          <span className="text-xs text-muted-foreground">
                            {project.fileCount?.plans || 0}
                          </span>
                        </div>
                        <div className="flex flex-col items-center gap-1 p-2">
                          <FileText className="w-5 h-5 text-primary" />
                          <span className="text-xs font-medium">Berichte</span>
                          <span className="text-xs text-muted-foreground">
                            {project.fileCount?.reports || 0}
                          </span>
                        </div>
                        <div className="flex flex-col items-center gap-1 p-2">
                          <Package className="w-5 h-5 text-primary" />
                          <span className="text-xs font-medium">Material</span>
                          <span className="text-xs text-muted-foreground">
                            {project.fileCount?.materials || 0}
                          </span>
                        </div>
                        <div className="flex flex-col items-center gap-1 p-2">
                          <Image className="w-5 h-5 text-primary" />
                          <span className="text-xs font-medium">Fotos</span>
                          <span className="text-xs text-muted-foreground">
                            {project.fileCount?.photos || 0}
                          </span>
                        </div>
                      </div>

                      <div 
                        className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pt-2 border-t mt-3"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <p className="text-xs text-muted-foreground">
                          Aktualisiert: {formatDate(project.updated_at)}
                        </p>
                        {isAdmin && (
                          <div className="flex gap-2 self-end sm:self-auto">
                            <Button
                              variant="default"
                              size="sm"
                              className="text-xs"
                              onClick={() => handleToggleProjectStatus(project.id, project.status, project.name)}
                              disabled={togglingStatus === project.id}
                            >
                              {togglingStatus === project.id ? 'Wird geöffnet...' : 'Wiedereröffnen'}
                            </Button>
                            <Button
                              variant="destructive"
                              size="sm"
                              className="text-xs"
                              onClick={() => setProjectToDelete({ id: project.id, name: project.name })}
                              disabled={deleting}
                            >
                              <Trash2 className="w-3 h-3 mr-1" />
                              {deleting ? 'Wird gelöscht...' : 'Löschen'}
                            </Button>
                          </div>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
          </CollapsibleContent>
        </Collapsible>
        )}
      </main>

      {/* Quick Upload Dialog - Only show when NOT in camera mode */}
      {quickUploadProject && !showCameraDialog && (
        <QuickUploadDialog
          projectId={quickUploadProject.projectId}
          documentType={quickUploadProject.documentType}
          open={!!quickUploadProject}
          onClose={() => setQuickUploadProject(null)}
          onSuccess={() => {
            fetchProjects();
            setQuickUploadProject(null);
          }}
        />
      )}

      {/* Mobile Photo Capture Dialog */}
      <MobilePhotoCapture
        open={showCameraDialog}
        onClose={() => {
          setShowCameraDialog(false);
          setQuickUploadProject(null);
        }}
        onPhotoCapture={handlePhotoCapture}
      />

      {/* AlertDialog für Projekt schließen */}
      <AlertDialog open={!!projectToClose} onOpenChange={(open) => !open && setProjectToClose(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Projekt schließen?</AlertDialogTitle>
            <AlertDialogDescription>
              Bist du sicher, dass du das Projekt <strong>{projectToClose?.name}</strong> schließen möchtest?
              <br /><br />
              Das Projekt wird als "Geschlossen" markiert und kann später wieder geöffnet werden.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={togglingStatus !== null}>Abbrechen</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => projectToClose && updateProjectStatus(projectToClose.id, 'geschlossen', projectToClose.name)}
              disabled={togglingStatus !== null}
            >
              {togglingStatus ? 'Wird geschlossen...' : 'Ja, Projekt schließen'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* AlertDialog für Projekt löschen */}
      <AlertDialog open={!!projectToDelete} onOpenChange={(open) => !open && setProjectToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Projekt endgültig löschen?</AlertDialogTitle>
            <AlertDialogDescription>
              Bist du sicher, dass du das Projekt <strong>{projectToDelete?.name}</strong> unwiderruflich löschen möchtest?
              <br /><br />
              <span className="text-destructive font-semibold">Alle zugehörigen Dateien, Dokumente, Ordner, Nachträge und Zuweisungen des Projekts werden ebenfalls gelöscht.</span>
              <br /><br />
              Diese Aktion kann nicht rückgängig gemacht werden!
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Abbrechen</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteProject}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={deleting}
            >
              {deleting ? 'Wird gelöscht...' : 'Ja, endgültig löschen'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Dialog: Status-Einstellungen (nur Admin) */}
      <Dialog open={showStatusSettings} onOpenChange={setShowStatusSettings}>
        <DialogContent className="max-w-sm sm:max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Status-Einstellungen</DialogTitle>
            <DialogDescription>
              Projekt-Status (Ampel) verwalten: Name und Farbe anpassen, Status löschen oder neue anlegen
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              {editStatuses.length === 0 && (
                <p className="text-sm text-muted-foreground">Noch keine Status vorhanden.</p>
              )}
              {editStatuses.map((s) => (
                <div key={s.id} className="flex items-center gap-2 rounded-lg border p-2">
                  <input
                    type="color"
                    value={s.color}
                    onChange={(e) =>
                      setEditStatuses((prev) =>
                        prev.map((x) => (x.id === s.id ? { ...x, color: e.target.value } : x))
                      )
                    }
                    className="h-8 w-10 shrink-0 cursor-pointer rounded border bg-background p-0.5"
                    title="Farbe wählen"
                    aria-label={`Farbe für ${s.name}`}
                  />
                  <Input
                    value={s.name}
                    onChange={(e) =>
                      setEditStatuses((prev) =>
                        prev.map((x) => (x.id === s.id ? { ...x, name: e.target.value } : x))
                      )
                    }
                    placeholder="Statusname"
                    className="flex-1"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    className="shrink-0"
                    onClick={() => handleSaveSingleStatus(s)}
                    disabled={savingStatuses || !isStatusDirty(s)}
                    title="Speichern"
                    aria-label={`Status ${s.name} speichern`}
                  >
                    <Save className="h-4 w-4" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="shrink-0 text-destructive hover:text-destructive"
                    onClick={() => setStatusToDelete(s)}
                    disabled={savingStatuses}
                    title="Löschen"
                    aria-label={`Status ${s.name} löschen`}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>

            {editStatuses.length > 0 && (
              <Button
                type="button"
                variant="secondary"
                className="w-full gap-2"
                onClick={handleSaveAllStatuses}
                disabled={savingStatuses || !editStatuses.some(isStatusDirty)}
              >
                <Save className="h-4 w-4" />
                {savingStatuses ? 'Speichert...' : 'Alle Änderungen speichern'}
              </Button>
            )}

            {/* Neuen Status hinzufügen */}
            <div className="rounded-lg border p-3 space-y-3">
              <Label>Neuen Status hinzufügen</Label>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={newStatusForm.color}
                  onChange={(e) => setNewStatusForm({ ...newStatusForm, color: e.target.value })}
                  className="h-8 w-10 shrink-0 cursor-pointer rounded border bg-background p-0.5"
                  title="Farbe wählen"
                  aria-label="Farbe für neuen Status"
                />
                <Input
                  value={newStatusForm.name}
                  onChange={(e) => setNewStatusForm({ ...newStatusForm, name: e.target.value })}
                  placeholder="z.B. In Bearbeitung"
                  className="flex-1"
                />
              </div>
              <Button
                type="button"
                className="w-full gap-2"
                onClick={handleAddStatus}
                disabled={savingStatuses}
              >
                <Plus className="h-4 w-4" />
                Status hinzufügen
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* AlertDialog: Status löschen */}
      <AlertDialog open={!!statusToDelete} onOpenChange={(open) => !open && setStatusToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Status löschen?</AlertDialogTitle>
            <AlertDialogDescription>
              Bist du sicher, dass du den Status <strong>{statusToDelete?.name}</strong> löschen möchtest?
              <br /><br />
              Projekte mit diesem Status bleiben erhalten – ihr Status wird lediglich auf "Kein Status" zurückgesetzt.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={savingStatuses}>Abbrechen</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteStatus}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={savingStatuses}
            >
              {savingStatuses ? 'Wird gelöscht...' : 'Ja, Status löschen'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default Projects;
