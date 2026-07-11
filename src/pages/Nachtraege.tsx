import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  Plus,
  Search,
  FileSignature,
  Package,
  CheckCircle2,
  PenLine,
  Loader2,
  MapPin,
} from "lucide-react";
import { format } from "date-fns";
import { de } from "date-fns/locale";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
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
import {
  NachtragDialog,
  MaterialRowsEditor,
  MaterialSummaryList,
  materialRowsToInserts,
  type MaterialRow,
  type ProjectOption,
} from "@/components/NachtragDialog";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

type NachtragMaterial = {
  id: string;
  material: string;
  menge: string | null;
  einheit: string | null;
  material_id: string | null;
};

type Nachtrag = {
  id: string;
  project_id: string;
  titel: string;
  beschreibung: string | null;
  status: string;
  unterschrift_kunde: string | null;
  unterschrieben_am: string | null;
  created_at: string;
  projects: {
    name: string;
    adresse: string | null;
    customers: {
      vorname: string | null;
      nachname: string | null;
      strasse: string | null;
      ort: string | null;
    } | null;
  } | null;
  nachtrag_materials: NachtragMaterial[];
};

const projectLabel = (n: Nachtrag) => {
  const p = n.projects;
  if (!p) return "Unbekanntes Projekt";
  const c = p.customers;
  const kundenAdresse = c ? [c.strasse, c.ort].filter(Boolean).join(", ") : "";
  const adresse = kundenAdresse || p.adresse || "";
  return adresse ? `${p.name} – ${adresse}` : p.name;
};

const StatusBadge = ({ nachtrag }: { nachtrag: Nachtrag }) => {
  if (nachtrag.status === "unterschrieben") {
    return (
      <Badge className="bg-green-600 text-white hover:bg-green-600 gap-1">
        <CheckCircle2 className="h-3 w-3" />
        Unterschrieben
        {nachtrag.unterschrieben_am &&
          ` · ${format(new Date(nachtrag.unterschrieben_am), "dd.MM.yyyy", { locale: de })}`}
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="border-yellow-500 text-yellow-600">
      Offen
    </Badge>
  );
};

const Nachtraege = () => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [searchParams, setSearchParams] = useSearchParams();

  const [nachtraege, setNachtraege] = useState<Nachtrag[]>([]);
  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [projectFilter, setProjectFilter] = useState<string>("alle");

  // Create dialog (shared NachtragDialog)
  const [createOpen, setCreateOpen] = useState(false);
  const [createProjectId, setCreateProjectId] = useState<string>("");
  const [saving, setSaving] = useState(false);

  // Detail dialog
  const [detail, setDetail] = useState<Nachtrag | null>(null);
  const [editTitel, setEditTitel] = useState("");
  const [editBeschreibung, setEditBeschreibung] = useState("");
  const [editMaterials, setEditMaterials] = useState<MaterialRow[]>([]);
  const [signMode, setSignMode] = useState(false);
  const [signature, setSignature] = useState<string | null>(null);
  const [signing, setSigning] = useState(false);

  const keyCounter = useRef(0);
  const nextKey = () => ++keyCounter.current;
  const paramsHandled = useRef(false);

  useEffect(() => {
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        navigate("/auth");
        return;
      }
      await Promise.all([fetchNachtraege(), fetchProjects()]);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Query params: ?new=1 opens create dialog, &project=<uuid> preselects/filters
  useEffect(() => {
    if (paramsHandled.current) return;
    paramsHandled.current = true;
    const isNew = searchParams.get("new") === "1";
    const projectId = searchParams.get("project");
    if (projectId) {
      setProjectFilter(projectId);
      if (isNew) setCreateProjectId(projectId);
    }
    if (isNew) {
      setCreateOpen(true);
      const next = new URLSearchParams(searchParams);
      next.delete("new");
      setSearchParams(next, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fetchNachtraege = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("nachtraege")
      .select(
        "*, projects(name, adresse, customers(vorname, nachname, strasse, ort)), nachtrag_materials(id, material, menge, einheit, material_id)"
      )
      .order("created_at", { ascending: false });
    if (error) {
      toast({
        variant: "destructive",
        title: "Fehler",
        description: "Nachträge konnten nicht geladen werden",
      });
    } else {
      setNachtraege((data as unknown as Nachtrag[]) ?? []);
    }
    setLoading(false);
  };

  const fetchProjects = async () => {
    const { data } = await supabase
      .from("projects")
      .select("id, name, adresse")
      .eq("status", "aktiv")
      .order("name");
    setProjects(data ?? []);
  };

  // Filter options: active projects + projects that already have Nachträge
  const filterProjects = useMemo(() => {
    const map = new Map<string, string>();
    projects.forEach((p) => map.set(p.id, p.name));
    nachtraege.forEach((n) => {
      if (n.projects && !map.has(n.project_id)) map.set(n.project_id, n.projects.name);
    });
    return Array.from(map.entries())
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name, "de"));
  }, [projects, nachtraege]);

  const filtered = useMemo(() => {
    let list = nachtraege;
    if (projectFilter !== "alle") {
      list = list.filter((n) => n.project_id === projectFilter);
    }
    const q = search.trim().toLowerCase();
    if (q) {
      list = list.filter((n) => {
        const kunde = n.projects?.customers
          ? [n.projects.customers.vorname, n.projects.customers.nachname].filter(Boolean).join(" ")
          : "";
        return [n.titel, n.beschreibung, n.projects?.name, kunde, projectLabel(n)]
          .filter(Boolean)
          .some((v) => (v as string).toLowerCase().includes(q));
      });
    }
    return list;
  }, [nachtraege, projectFilter, search]);

  const openCreate = () => {
    setCreateProjectId(projectFilter !== "alle" ? projectFilter : "");
    setCreateOpen(true);
  };

  const openDetail = (n: Nachtrag) => {
    setDetail(n);
    setEditTitel(n.titel);
    setEditBeschreibung(n.beschreibung ?? "");
    setEditMaterials(
      n.nachtrag_materials.map((m) => ({
        key: nextKey(),
        material: m.material,
        menge: m.menge ?? "",
        einheit: m.einheit ?? "",
        material_id: m.material_id,
      }))
    );
    setSignMode(false);
    setSignature(null);
  };

  // Meldung + Refetch, wenn der Nachtrag zwischenzeitlich unterschrieben wurde (Race)
  const handleConcurrentlySigned = async () => {
    toast({
      variant: "destructive",
      title: "Fehler",
      description:
        "Nachtrag wurde zwischenzeitlich unterschrieben und kann nicht mehr geändert werden",
    });
    setDetail(null);
    await fetchNachtraege();
  };

  // Speichert Änderungen nur, solange der Nachtrag noch offen ist.
  // Gibt false zurück, wenn er zwischenzeitlich unterschrieben wurde.
  const saveEdits = async (nachtragId: string): Promise<boolean> => {
    const { data, error } = await supabase
      .from("nachtraege")
      .update({
        titel: editTitel.trim(),
        beschreibung: editBeschreibung.trim() || null,
      })
      .eq("id", nachtragId)
      .eq("status", "offen")
      .select("id");
    if (error) throw error;
    if (!data || data.length === 0) return false;

    const { error: delError } = await supabase
      .from("nachtrag_materials")
      .delete()
      .eq("nachtrag_id", nachtragId);
    if (delError) throw delError;

    const materialInserts = materialRowsToInserts(nachtragId, editMaterials);
    if (materialInserts.length > 0) {
      const { error: matError } = await supabase.from("nachtrag_materials").insert(materialInserts);
      if (matError) throw matError;
    }
    return true;
  };

  const handleSaveEdits = async () => {
    if (!detail) return;
    if (!editTitel.trim()) {
      toast({ variant: "destructive", title: "Fehler", description: "Bitte einen Titel eingeben" });
      return;
    }
    setSaving(true);
    try {
      const saved = await saveEdits(detail.id);
      if (!saved) {
        await handleConcurrentlySigned();
        return;
      }
      toast({ title: "Nachtrag gespeichert", description: editTitel.trim() });
      setDetail(null);
      await fetchNachtraege();
    } catch (error: unknown) {
      toast({
        variant: "destructive",
        title: "Fehler",
        description: error instanceof Error ? error.message : "Änderungen konnten nicht gespeichert werden",
      });
    } finally {
      setSaving(false);
    }
  };

  const handleSign = async () => {
    if (!detail) return;
    if (!signature) {
      toast({
        variant: "destructive",
        title: "Unterschrift fehlt",
        description: "Bitte lassen Sie den Kunden unterschreiben",
      });
      return;
    }
    setSigning(true);
    try {
      // Persist any pending edits first, then the signature
      const saved = await saveEdits(detail.id);
      if (!saved) {
        await handleConcurrentlySigned();
        return;
      }
      const { data: signedRows, error } = await supabase
        .from("nachtraege")
        .update({
          unterschrift_kunde: signature,
          status: "unterschrieben",
          unterschrieben_am: new Date().toISOString(),
        })
        .eq("id", detail.id)
        .eq("status", "offen")
        .select("id");
      if (error) throw error;
      if (!signedRows || signedRows.length === 0) {
        await handleConcurrentlySigned();
        return;
      }

      toast({
        title: "Nachtrag unterschrieben",
        description: "Die Unterschrift des Kunden wurde gespeichert.",
      });
      setDetail(null);
      await fetchNachtraege();
    } catch (error: unknown) {
      toast({
        variant: "destructive",
        title: "Fehler",
        description: error instanceof Error ? error.message : "Unterschrift konnte nicht gespeichert werden",
      });
    } finally {
      setSigning(false);
    }
  };

  const isSigned = detail?.status === "unterschrieben";
  const editMaterialsPreview: NachtragMaterial[] = editMaterials
    .filter((r) => r.material.trim())
    .map((r) => ({
      id: String(r.key),
      material: r.material.trim(),
      menge: r.menge.trim() || null,
      einheit: r.einheit.trim() || null,
      material_id: r.material_id,
    }));

  return (
    <div className="min-h-screen bg-background">
      <PageHeader title="Nachträge" backPath="/" />

      <main className="container mx-auto px-3 sm:px-4 lg:px-6 py-6 max-w-4xl space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-2xl font-bold flex items-center gap-2">
              <FileSignature className="h-6 w-6 text-primary" />
              Nachträge
              <Badge variant="secondary">{nachtraege.length}</Badge>
            </h2>
            <p className="text-sm text-muted-foreground">
              Zusatzaufträge erfassen und vom Kunden unterschreiben lassen
            </p>
          </div>
          <Button onClick={openCreate} className="gap-2">
            <Plus className="h-4 w-4" />
            <span className="hidden sm:inline">Neuer Nachtrag</span>
          </Button>
        </div>

        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Nachträge durchsuchen (Titel, Projekt, Kunde...)"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>
          <Select value={projectFilter} onValueChange={setProjectFilter}>
            <SelectTrigger className="w-full sm:w-[220px]">
              <SelectValue placeholder="Projekt" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="alle">Alle Projekte</SelectItem>
              {filterProjects.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {loading ? (
          <p className="text-center text-muted-foreground py-8">Lade Nachträge...</p>
        ) : filtered.length === 0 ? (
          <Card>
            <CardContent className="py-10 text-center text-muted-foreground">
              {nachtraege.length === 0
                ? "Noch keine Nachträge vorhanden. Lege den ersten Nachtrag an!"
                : "Keine Nachträge gefunden."}
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
            {filtered.map((n) => (
              <Card
                key={n.id}
                className="cursor-pointer hover:shadow-md transition-shadow"
                onClick={() => openDetail(n)}
              >
                <CardContent className="p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 space-y-1">
                      <div className="font-semibold text-base">{n.titel}</div>
                      <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
                        <MapPin className="h-3.5 w-3.5 shrink-0" />
                        <span className="truncate">{projectLabel(n)}</span>
                      </div>
                      {n.beschreibung && (
                        <p className="text-sm text-muted-foreground line-clamp-2 whitespace-pre-wrap">
                          {n.beschreibung}
                        </p>
                      )}
                      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground pt-1">
                        <span className="flex items-center gap-1">
                          <Package className="h-3.5 w-3.5" />
                          {n.nachtrag_materials.length}{" "}
                          {n.nachtrag_materials.length === 1 ? "Material" : "Materialien"}
                        </span>
                        <span>
                          Erstellt: {format(new Date(n.created_at), "dd.MM.yyyy", { locale: de })}
                        </span>
                      </div>
                    </div>
                    <div className="shrink-0">
                      <StatusBadge nachtrag={n} />
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </main>

      {/* Create dialog (shared) */}
      <NachtragDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        projectId={createProjectId || undefined}
        onCreated={fetchNachtraege}
      />

      {/* Detail / edit / sign dialog */}
      <Dialog open={!!detail} onOpenChange={(open) => !open && setDetail(null)}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          {detail && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <FileSignature className="h-5 w-5" />
                  {signMode ? "Nachtrag unterschreiben" : detail.titel}
                </DialogTitle>
                <DialogDescription>{projectLabel(detail)}</DialogDescription>
              </DialogHeader>

              {isSigned ? (
                /* Read-only view for signed Nachtrag */
                <div className="space-y-4">
                  <div className="flex items-center gap-2">
                    <StatusBadge nachtrag={detail} />
                  </div>
                  {detail.beschreibung && (
                    <div className="space-y-1">
                      <Label>Beschreibung</Label>
                      <p className="text-sm whitespace-pre-wrap">{detail.beschreibung}</p>
                    </div>
                  )}
                  {detail.nachtrag_materials.length > 0 && (
                    <div className="space-y-1">
                      <Label>Material</Label>
                      <MaterialSummaryList materials={detail.nachtrag_materials} />
                    </div>
                  )}
                  <Separator />
                  <div className="space-y-2">
                    <Label>Unterschrift des Kunden</Label>
                    {detail.unterschrift_kunde && (
                      <div className="border rounded-lg bg-white p-2">
                        <img
                          src={detail.unterschrift_kunde}
                          alt="Unterschrift des Kunden"
                          className="max-h-40 w-auto max-w-full"
                        />
                      </div>
                    )}
                    {detail.unterschrieben_am && (
                      <p className="text-sm text-muted-foreground">
                        Unterschrieben am{" "}
                        {format(new Date(detail.unterschrieben_am), "dd.MM.yyyy 'um' HH:mm 'Uhr'", {
                          locale: de,
                        })}
                      </p>
                    )}
                  </div>
                  <Button variant="outline" className="w-full" onClick={() => setDetail(null)}>
                    Schließen
                  </Button>
                </div>
              ) : signMode ? (
                /* Signature flow: customer-facing summary + SignaturePad */
                <div className="space-y-4">
                  <Card>
                    <CardContent className="p-4 space-y-3 text-sm">
                      <div>
                        <p className="text-xs text-muted-foreground mb-0.5">Nachtrag</p>
                        <p className="font-semibold">{editTitel}</p>
                      </div>
                      {editBeschreibung.trim() && (
                        <div>
                          <p className="text-xs text-muted-foreground mb-0.5">Beschreibung</p>
                          <p className="whitespace-pre-wrap">{editBeschreibung}</p>
                        </div>
                      )}
                      {editMaterialsPreview.length > 0 && (
                        <div>
                          <p className="text-xs text-muted-foreground mb-0.5">Material</p>
                          <MaterialSummaryList materials={editMaterialsPreview} />
                        </div>
                      )}
                    </CardContent>
                  </Card>
                  <div className="space-y-2">
                    <Label>Unterschrift des Kunden</Label>
                    <SignaturePad onSignatureChange={setSignature} />
                  </div>
                  <div className="flex flex-col-reverse sm:flex-row justify-end gap-2 pt-2 border-t">
                    <Button variant="outline" onClick={() => setSignMode(false)} disabled={signing}>
                      Zurück
                    </Button>
                    <Button onClick={handleSign} disabled={!signature || signing} className="gap-2">
                      {signing ? (
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
                /* Edit view while status = offen */
                <div className="space-y-4">
                  <div className="flex items-center gap-2">
                    <StatusBadge nachtrag={detail} />
                    <span className="text-xs text-muted-foreground">
                      Erstellt: {format(new Date(detail.created_at), "dd.MM.yyyy", { locale: de })}
                    </span>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="edit-titel">Titel *</Label>
                    <Input
                      id="edit-titel"
                      value={editTitel}
                      onChange={(e) => setEditTitel(e.target.value)}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="edit-beschreibung">Beschreibung</Label>
                    <Textarea
                      id="edit-beschreibung"
                      value={editBeschreibung}
                      onChange={(e) => setEditBeschreibung(e.target.value)}
                      rows={4}
                    />
                  </div>
                  <MaterialRowsEditor rows={editMaterials} setRows={setEditMaterials} nextKey={nextKey} />
                  <div className="flex flex-col sm:flex-row gap-2 pt-2 border-t">
                    <Button
                      variant="outline"
                      onClick={handleSaveEdits}
                      disabled={saving}
                      className="flex-1"
                    >
                      {saving ? "Speichern..." : "Änderungen speichern"}
                    </Button>
                    <Button
                      onClick={() => {
                        setSignature(null);
                        setSignMode(true);
                      }}
                      disabled={saving}
                      className="flex-1 gap-2"
                    >
                      <PenLine className="h-4 w-4" />
                      Vom Kunden unterschreiben lassen
                    </Button>
                  </div>
                </div>
              )}
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default Nachtraege;
