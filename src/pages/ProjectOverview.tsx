import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { ArrowLeft, FileText, FileCheck, FolderOpen, Package, Camera, ImagePlus, Lock, FileSignature, Plus, CheckCircle2, Pencil, Settings, Receipt } from "lucide-react";
import { format } from "date-fns";
import { de } from "date-fns/locale";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { projectLabel } from "@/lib/projectLabel";
import { saveUpdate } from "@/lib/offlineData";
import { UebernahmeDialog } from "@/components/UebernahmeDialog";
import { cachedSelect } from "@/lib/offlineStore";
import { fetchCustomersCached, fetchStatusesCached } from "@/lib/cachedQueries";
import { ProjectEditDialog, type EditableProject, type CustomerOption, type StatusOption } from "@/components/ProjectEditDialog";
import {
  CATEGORY_ORDER,
  CUSTOM_FOLDERS_AFTER,
  TOGGLEABLE_CATEGORIES,
  CATEGORY_LABELS,
  CATEGORY_DESCRIPTIONS,
  CATEGORY_BUCKETS,
  isCategoryVisible,
  type FolderCategory,
} from "@/lib/projectFolders";

type ProjectNachtrag = {
  id: string;
  titel: string;
  status: string;
  created_at: string;
  unterschrieben_am: string | null;
};

type CustomFolder = { name: string; count: number };

const CATEGORY_ICON: Record<FolderCategory, React.ReactNode> = {
  photos: <Camera className="h-8 w-8" />,
  reports: <FileCheck className="h-8 w-8" />,
  plans: <FileText className="h-8 w-8" />,
  materials: <Package className="h-8 w-8" />,
  chef: <Lock className="h-8 w-8" />,
};

const ProjectOverview = () => {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const { toast } = useToast();

  const [projectName, setProjectName] = useState("");
  const [project, setProject] = useState<EditableProject | null>(null);
  const [hiddenCategories, setHiddenCategories] = useState<string[]>([]);
  const [isAdmin, setIsAdmin] = useState(false);

  const [counts, setCounts] = useState<Partial<Record<FolderCategory, number>>>({});
  const [customFolders, setCustomFolders] = useState<CustomFolder[]>([]);
  const [nachtraege, setNachtraege] = useState<ProjectNachtrag[]>([]);

  const [uebernahmeOpen, setUebernahmeOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [savingSettings, setSavingSettings] = useState(false);
  // Entwurf im Einstellungen-Dialog: true = Ordner sichtbar.
  const [settingsDraft, setSettingsDraft] = useState<Record<string, boolean>>({});

  const [customers, setCustomers] = useState<CustomerOption[]>([]);
  const [statuses, setStatuses] = useState<StatusOption[]>([]);

  useEffect(() => {
    if (projectId) {
      checkAdminStatus();
      fetchProject();
      fetchNachtraege();
      fetchCustomersAndStatuses();
    }
  }, [projectId]);

  useEffect(() => {
    if (projectId) {
      fetchCounts();
    }
  }, [projectId, isAdmin, hiddenCategories]);

  const checkAdminStatus = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const { data } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", user.id)
      .eq("role", "administrator")
      .maybeSingle();
    setIsAdmin(!!data);
  };

  const fetchProject = async () => {
    if (!projectId) return;
    // Offline-fähig: Projektdaten aus der lokalen Ablage, wenn kein Netz da ist.
    type Row = EditableProject & { hidden_categories: string[] | null; customers: { strasse: string | null; ort: string | null } | null };
    const { data } = await cachedSelect<Row>(`project:${projectId}:overview`, () =>
      supabase
        .from("projects")
        .select("id, name, plz, adresse, beschreibung, customer_id, status_id, hidden_categories, customers(strasse, ort)")
        .eq("id", projectId)
        .single() as unknown as PromiseLike<{ data: Row | null; error: { message: string } | null }>,
    );
    if (data) {
      setProjectName(projectLabel(data));
      setProject({
        id: data.id,
        name: data.name,
        plz: data.plz,
        adresse: data.adresse,
        beschreibung: data.beschreibung,
        customer_id: data.customer_id,
        status_id: data.status_id,
      });
      setHiddenCategories(data.hidden_categories ?? []);
    }
  };

  const fetchCustomersAndStatuses = async () => {
    // Offline-fähig: gemeinsame lokale Ablage (gleiche Schlüssel wie überall).
    const [cust, stat] = await Promise.all([fetchCustomersCached(), fetchStatusesCached()]);
    setCustomers((cust.data as unknown as CustomerOption[]) ?? []);
    setStatuses((stat.data as StatusOption[]) ?? []);
  };

  const fetchNachtraege = async () => {
    if (!projectId) return;
    const { data } = await supabase
      .from("nachtraege")
      .select("id, titel, status, created_at, unterschrieben_am")
      .eq("project_id", projectId)
      .order("created_at", { ascending: false });
    setNachtraege(data ?? []);
  };

  // Zählt Dateien (ohne .keep) rekursiv unter einem project-files-Prefix.
  const countFilesUnder = async (prefix: string): Promise<number> => {
    const { data } = await supabase.storage.from("project-files").list(prefix, { limit: 1000 });
    if (!data) return 0;
    let total = 0;
    for (const item of data) {
      if (item.id === null) {
        // Unterordner
        total += await countFilesUnder(`${prefix}/${item.name}`);
      } else if (item.name !== ".keep") {
        total += 1;
      }
    }
    return total;
  };

  const fetchCounts = async () => {
    if (!projectId) return;

    // Kategorie-Zähler
    const next: Partial<Record<FolderCategory, number>> = {};
    await Promise.all(
      CATEGORY_ORDER.map(async (cat) => {
        if (!isCategoryVisible(cat, hiddenCategories, isAdmin)) return;
        if (cat === "materials") {
          const { count } = await supabase
            .from("material_entries")
            .select("*", { count: "exact", head: true })
            .eq("project_id", projectId);
          next.materials = count || 0;
          return;
        }
        const bucket = CATEGORY_BUCKETS[cat];
        if (!bucket) return;
        const { data } = await supabase.storage.from(bucket).list(projectId);
        next[cat] = data?.length || 0;
      })
    );
    setCounts(next);

    // Selbst erstellte Ordner (project-files, oberste Ebene)
    const { data: top } = await supabase.storage.from("project-files").list(projectId, { limit: 1000 });
    const folderNames = (top ?? []).filter((i) => i.id === null).map((i) => i.name);
    const folders: CustomFolder[] = await Promise.all(
      folderNames.map(async (name) => ({ name, count: await countFilesUnder(`${projectId}/${name}`) }))
    );
    folders.sort((a, b) => a.name.localeCompare(b.name, "de"));
    setCustomFolders(folders);
  };

  const openSettings = () => {
    const draft: Record<string, boolean> = {};
    TOGGLEABLE_CATEGORIES.forEach((cat) => {
      draft[cat] = !hiddenCategories.includes(cat);
    });
    setSettingsDraft(draft);
    setSettingsOpen(true);
  };

  const handleSaveSettings = async () => {
    if (!projectId || savingSettings) return;
    setSavingSettings(true);
    // Ausgeblendet = alle abschaltbaren Kategorien, deren Schalter AUS ist.
    const hidden = TOGGLEABLE_CATEGORIES.filter((cat) => !settingsDraft[cat]);
    const res = await saveUpdate("projects", { id: projectId }, { hidden_categories: hidden }, "Projektordner");
    setSavingSettings(false);
    if (res.error) {
      toast({ variant: "destructive", title: "Fehler", description: "Einstellungen konnten nicht gespeichert werden" });
      return;
    }
    setHiddenCategories(hidden);
    setSettingsOpen(false);
    toast({ title: "Gespeichert", description: "Ordner-Einstellungen aktualisiert." });
  };

  const handleCategoryClick = (cat: FolderCategory) => {
    if (cat === "materials") {
      navigate(`/projects/${projectId}/materials`);
    } else {
      navigate(`/projects/${projectId}/${cat}`);
    }
  };

  // Kachel-Reihenfolge aufbauen: feste Kategorien in CATEGORY_ORDER, die selbst
  // erstellten Ordner werden nach "reports" (Regieberichte) eingeschoben.
  type Tile =
    | { kind: "category"; category: FolderCategory }
    | { kind: "custom"; name: string; count: number };

  const tiles: Tile[] = [];
  for (const cat of CATEGORY_ORDER) {
    if (isCategoryVisible(cat, hiddenCategories, isAdmin)) {
      tiles.push({ kind: "category", category: cat });
    }
    if (cat === CUSTOM_FOLDERS_AFTER) {
      for (const f of customFolders) tiles.push({ kind: "custom", name: f.name, count: f.count });
    }
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-card sticky top-0 z-50 shadow-sm">
        <div className="container mx-auto px-3 sm:px-4 lg:px-6 py-3 sm:py-4">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <Button variant="ghost" size="sm" onClick={() => navigate("/projects")}>
                {/* Am Handy nur das Pfeil-Symbol, daher Abstand erst ab sm */}
                <ArrowLeft className="h-4 w-4 sm:mr-2" />
                <span className="hidden sm:inline">Zurück</span>
              </Button>
              <img
                src="/ruff-logo.png"
                alt="Ruff Michael Logo"
                className="h-8 w-8 sm:h-10 sm:w-10 cursor-pointer hover:opacity-80 transition-opacity object-contain"
                onClick={() => navigate("/projects")}
              />
            </div>
            <div className="flex items-center gap-1 shrink-0">
              {/* Projekt bearbeiten: wie in der Projektliste für alle sichtbar. */}
              <Button variant="outline" size="sm" className="gap-1" onClick={() => setEditOpen(true)}>
                <Pencil className="h-4 w-4" />
                <span className="hidden sm:inline">Bearbeiten</span>
              </Button>
              {/* Angebote & Rechnungen zum Projekt: nur Admin (Preise). */}
              {isAdmin && (
                <Button variant="outline" size="sm" className="gap-1" onClick={() => navigate(`/belege?projekt=${projectId}`)}>
                  <Receipt className="h-4 w-4" />
                  <span className="hidden sm:inline">Belege</span>
                </Button>
              )}
              {/* Ordner konfigurieren: nur Admin. */}
              {isAdmin && (
                <Button variant="outline" size="sm" className="gap-1" onClick={openSettings}>
                  <Settings className="h-4 w-4" />
                  <span className="hidden sm:inline">Ordner</span>
                </Button>
              )}
            </div>
          </div>
        </div>
      </header>

      {/* pb-24: Platz, damit der runde Foto-Knopf unten die letzte Kachel nicht verdeckt */}
      <main className="container mx-auto px-3 sm:px-4 lg:px-6 py-4 sm:py-6 pb-24 max-w-4xl">
        <div className="mb-6">
          {/* break-words: lange Projekt-/Adressnamen dürfen die Seite nicht breiter machen */}
          <h1 className="text-2xl sm:text-3xl font-bold mb-2 break-words">{projectName}</h1>
          <p className="text-muted-foreground">Dokumentation und Dateien</p>
        </div>

        {/* Schnellaktionen */}
        <div className="mb-4 flex flex-wrap gap-2">
          <Button className="gap-2" onClick={() => setUebernahmeOpen(true)}>
            <FileCheck className="h-4 w-4" />
            Übernahmebestätigung erstellen
          </Button>
          {/* Zugang zur freien Ordnerstruktur (Ordner erstellen/umbenennen/verschieben/löschen) */}
          <Button variant="outline" className="gap-2" onClick={() => navigate(`/projects/${projectId}/files`)}>
            <FolderOpen className="h-4 w-4" />
            Ordner verwalten
          </Button>
        </div>

        {/* Nachträge - nur anzeigen, wenn das Projekt Nachträge hat */}
        {nachtraege.length > 0 && (
          <div className="mb-4 space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-lg font-semibold flex items-center gap-2">
                <FileSignature className="h-5 w-5 text-primary shrink-0" />
                Nachträge
              </h2>
              <Button
                variant="outline"
                size="sm"
                className="gap-1"
                onClick={() => navigate(`/nachtraege?new=1&project=${projectId}`)}
              >
                <Plus className="h-4 w-4" />
                Neuer Nachtrag
              </Button>
            </div>
            <div className="space-y-2">
              {nachtraege.map((n) => (
                <Card
                  key={n.id}
                  className="cursor-pointer hover:shadow-md transition-shadow"
                  onClick={() => navigate(`/nachtraege?project=${projectId}`)}
                >
                  <CardContent className="p-3 flex items-center justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="font-medium truncate">{n.titel}</p>
                      <p className="text-xs text-muted-foreground">
                        {format(new Date(n.created_at), "dd.MM.yyyy", { locale: de })}
                      </p>
                    </div>
                    <div className="shrink-0">
                      {n.status === "unterschrieben" ? (
                        <Badge className="bg-green-600 text-white hover:bg-green-600 gap-1">
                          <CheckCircle2 className="h-3 w-3" />
                          Unterschrieben
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="border-yellow-500 text-yellow-600">
                          Offen
                        </Badge>
                      )}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        )}

        <div className="grid gap-4 md:grid-cols-2">
          {tiles.map((tile) =>
            tile.kind === "category" ? (
              <Card
                key={`cat-${tile.category}`}
                className="cursor-pointer hover:shadow-lg transition-shadow"
                onClick={() => handleCategoryClick(tile.category)}
              >
                <CardHeader className="p-4 sm:p-6">
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-primary shrink-0">{CATEGORY_ICON[tile.category]}</div>
                    <div className="text-xl sm:text-2xl font-bold shrink-0">{counts[tile.category] ?? 0}</div>
                  </div>
                  <CardTitle className="text-lg sm:text-xl break-words">{CATEGORY_LABELS[tile.category]}</CardTitle>
                  <CardDescription className="break-words">{CATEGORY_DESCRIPTIONS[tile.category]}</CardDescription>
                </CardHeader>
                <CardContent className="p-4 pt-0 sm:p-6 sm:pt-0">
                  <Button variant="outline" className="w-full">Öffnen</Button>
                </CardContent>
              </Card>
            ) : (
              <Card
                key={`custom-${tile.name}`}
                className="cursor-pointer hover:shadow-lg transition-shadow"
                onClick={() => navigate(`/projects/${projectId}/files?path=${encodeURIComponent(tile.name)}`)}
              >
                <CardHeader className="p-4 sm:p-6">
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-primary shrink-0"><FolderOpen className="h-8 w-8" /></div>
                    <div className="text-xl sm:text-2xl font-bold shrink-0">{tile.count}</div>
                  </div>
                  {/* break-words: selbst vergebene Ordnernamen können sehr lang sein */}
                  <CardTitle className="text-lg sm:text-xl break-words">{tile.name}</CardTitle>
                  <CardDescription>Projektordner</CardDescription>
                </CardHeader>
                <CardContent className="p-4 pt-0 sm:p-6 sm:pt-0">
                  <Button variant="outline" className="w-full">Öffnen</Button>
                </CardContent>
              </Card>
            )
          )}
        </div>

        {/* Floating Action Button für Fotos */}
        <Button
          className="fixed bottom-6 right-6 z-50 h-14 w-14 rounded-full shadow-lg"
          size="icon"
          onClick={() => navigate(`/projects/${projectId}/photos`)}
        >
          <ImagePlus className="h-6 w-6" />
        </Button>
      </main>

      <UebernahmeDialog
        open={uebernahmeOpen}
        onOpenChange={setUebernahmeOpen}
        projectId={projectId}
      />

      <ProjectEditDialog
        project={project}
        open={editOpen}
        onOpenChange={setEditOpen}
        customers={customers}
        statuses={statuses}
        onSaved={fetchProject}
      />

      {/* Ordner-Einstellungen (nur Admin) */}
      <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
        <DialogContent className="max-w-[calc(100vw-1.5rem)] sm:max-w-md max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Projektordner verwalten</DialogTitle>
            <DialogDescription>
              Lege fest, welche Ordner dieses Projekt hat. Bereits hochgeladene Dateien
              bleiben erhalten, auch wenn ein Ordner ausgeblendet wird.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            {TOGGLEABLE_CATEGORIES.map((cat) => (
              <div key={cat} className="flex items-center justify-between gap-3 rounded-lg border p-3">
                <div className="min-w-0">
                  <p className="font-medium break-words">{CATEGORY_LABELS[cat]}</p>
                  <p className="text-xs text-muted-foreground break-words">{CATEGORY_DESCRIPTIONS[cat]}</p>
                </div>
                <Switch
                  className="shrink-0"
                  checked={!!settingsDraft[cat]}
                  onCheckedChange={(v) => setSettingsDraft((d) => ({ ...d, [cat]: v }))}
                />
              </div>
            ))}
            {/* Chef ist nicht abschaltbar */}
            <div className="flex items-center justify-between gap-3 rounded-lg border p-3 opacity-70">
              <div className="min-w-0">
                <p className="font-medium flex items-center gap-1"><Lock className="h-3.5 w-3.5 shrink-0" /> {CATEGORY_LABELS.chef}</p>
                <p className="text-xs text-muted-foreground break-words">Immer vorhanden – nur für Admins sichtbar</p>
              </div>
              <Switch className="shrink-0" checked disabled />
            </div>
            <Button onClick={handleSaveSettings} disabled={savingSettings} className="w-full">
              {savingSettings ? "Speichern..." : "Speichern"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default ProjectOverview;
