import { useState, useEffect } from "react";
import { Package, Plus, Edit, Trash2, Save, X } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { supabase } from "@/integrations/supabase/client";
import { newId, isOffline, saveInsert } from "@/lib/offlineData";
import { getSessionUser } from "@/lib/auth";
import { MaterialPicker } from "@/components/MaterialPicker";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";
import { de } from "date-fns/locale";

type Material = {
  id: string;
  material: string;
  menge: string | null;
  notizen: string | null;
  created_at: string;
};

type DisturbanceMaterialsProps = {
  disturbanceId: string;
  canEdit: boolean;
};

export const DisturbanceMaterials = ({ disturbanceId, canEdit }: DisturbanceMaterialsProps) => {
  const { toast } = useToast();
  const [materials, setMaterials] = useState<Material[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingMaterial, setEditingMaterial] = useState<Material | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);

  const [formData, setFormData] = useState({
    material: "",
    menge: "",
    notizen: "",
  });

  useEffect(() => {
    fetchMaterials();
  }, [disturbanceId]);

  const fetchMaterials = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("disturbance_materials")
      .select("*")
      .eq("disturbance_id", disturbanceId)
      .order("created_at", { ascending: true });

    if (error) {
      toast({
        variant: "destructive",
        title: "Fehler",
        description: "Materialien konnten nicht geladen werden",
      });
    } else {
      setMaterials(data || []);
    }
    setLoading(false);
  };

  const openAddForm = () => {
    setEditingMaterial(null);
    setFormData({ material: "", menge: "", notizen: "" });
    setShowForm(true);
  };

  const openEditForm = (material: Material) => {
    setEditingMaterial(material);
    setFormData({
      material: material.material,
      menge: material.menge || "",
      notizen: material.notizen || "",
    });
    setShowForm(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!formData.material.trim()) {
      toast({ variant: "destructive", title: "Fehler", description: "Material ist erforderlich" });
      return;
    }

    setSaving(true);

    const user = await getSessionUser();
    if (!user) {
      toast({ variant: "destructive", title: "Fehler", description: "Sie müssen angemeldet sein" });
      setSaving(false);
      return;
    }

    const materialData = {
      disturbance_id: disturbanceId,
      user_id: user.id,
      material: formData.material.trim(),
      menge: formData.menge.trim() || null,
      notizen: formData.notizen.trim() || null,
    };

    if (editingMaterial) {
      // Bearbeiten eines bestehenden Materials bleibt online-only.
      if (isOffline()) {
        toast({ variant: "destructive", title: "Nur mit Internet möglich", description: "Bitte später erneut versuchen." });
        setSaving(false);
        return;
      }

      const { error } = await supabase
        .from("disturbance_materials")
        .update({
          material: materialData.material,
          menge: materialData.menge,
          notizen: materialData.notizen,
        })
        .eq("id", editingMaterial.id);

      if (error) {
        toast({ variant: "destructive", title: "Fehler", description: "Material konnte nicht aktualisiert werden" });
      } else {
        toast({ title: "Erfolg", description: "Material wurde aktualisiert" });
        setShowForm(false);
        fetchMaterials();
      }
    } else {
      // Neues Material anlegen → offline-fähig. disturbance_id existiert bereits
      // (bestehender Regiebericht); die id wird clientseitig erzeugt.
      const res = await saveInsert(
        "disturbance_materials",
        { ...materialData, id: newId() },
        `Material: ${materialData.material}`
      );

      if (res.error) {
        toast({ variant: "destructive", title: "Fehler", description: "Material konnte nicht hinzugefügt werden" });
      } else {
        toast(res.queued
          ? { title: "Offline gespeichert", description: "Wird automatisch gesendet, sobald wieder Internet da ist." }
          : { title: "Erfolg", description: "Material wurde hinzugefügt" });
        setShowForm(false);
        fetchMaterials();
      }
    }

    setSaving(false);
  };

  const handleDelete = async (materialId: string) => {
    // Löschen eines bestehenden Materials bleibt online-only.
    if (isOffline()) {
      toast({ variant: "destructive", title: "Nur mit Internet möglich", description: "Bitte später erneut versuchen." });
      return;
    }

    setDeleting(materialId);

    const { error } = await supabase
      .from("disturbance_materials")
      .delete()
      .eq("id", materialId);

    if (error) {
      toast({ variant: "destructive", title: "Fehler", description: "Material konnte nicht gelöscht werden" });
    } else {
      toast({ title: "Erfolg", description: "Material wurde gelöscht" });
      fetchMaterials();
    }

    setDeleting(null);
  };

  return (
    <>
      <Card>
        {/* flex-wrap statt starrer Zeile: am Handy rutscht der Button unter den Titel */}
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 px-4 sm:px-6">
          <CardTitle className="text-base sm:text-lg flex items-center gap-2 min-w-0">
            <Package className="h-5 w-5 flex-shrink-0" />
            Verwendete Materialien
          </CardTitle>
          {canEdit && (
            <Button size="sm" onClick={openAddForm}>
              <Plus className="h-4 w-4 mr-1" />
              Material hinzufügen
            </Button>
          )}
        </CardHeader>
        <CardContent className="px-4 sm:px-6">
          {loading ? (
            <div className="text-center py-4">
              <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary mx-auto"></div>
            </div>
          ) : materials.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <Package className="h-12 w-12 mx-auto mb-2 opacity-50" />
              <p>Keine Materialien erfasst</p>
              {canEdit && (
                <Button variant="outline" size="sm" className="mt-2" onClick={openAddForm}>
                  <Plus className="h-4 w-4 mr-1" />
                  Erstes Material hinzufügen
                </Button>
              )}
            </div>
          ) : (
            // Der Table-Wrapper scrollt bei Bedarf für sich; am Handy wandern die
            // Notizen unter das Material, damit die Spalte entfallen kann
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="h-10 px-2 sm:h-12 sm:px-4">Material</TableHead>
                  <TableHead className="h-10 px-2 sm:h-12 sm:px-4">Menge</TableHead>
                  <TableHead className="hidden sm:table-cell">Notizen</TableHead>
                  {canEdit && <TableHead className="h-10 px-2 sm:h-12 sm:px-4 w-[100px]">Aktionen</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {materials.map((material) => (
                  <TableRow key={material.id}>
                    <TableCell className="p-2 sm:p-4 align-top font-medium break-words">
                      {material.material}
                      {material.notizen && (
                        <span className="mt-1 block text-xs font-normal text-muted-foreground break-words sm:hidden">
                          {material.notizen}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="p-2 sm:p-4 align-top break-words">{material.menge || "-"}</TableCell>
                    <TableCell className="hidden sm:table-cell align-top">
                      <div className="max-w-[200px] truncate">{material.notizen || "-"}</div>
                    </TableCell>
                    {canEdit && (
                      <TableCell className="p-2 sm:p-4 align-top">
                        <div className="flex gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => openEditForm(material)}
                          >
                            <Edit className="h-4 w-4" />
                          </Button>
                          <AlertDialog>
                            <AlertDialogTrigger asChild>
                              <Button
                                variant="ghost"
                                size="icon"
                                disabled={deleting === material.id}
                              >
                                <Trash2 className="h-4 w-4 text-destructive" />
                              </Button>
                            </AlertDialogTrigger>
                            <AlertDialogContent className="max-w-[calc(100vw-1.5rem)] sm:max-w-lg max-h-[90vh] overflow-y-auto">
                              <AlertDialogHeader>
                                <AlertDialogTitle>Material löschen?</AlertDialogTitle>
                                <AlertDialogDescription className="break-words">
                                  Möchten Sie "{material.material}" wirklich löschen?
                                </AlertDialogDescription>
                              </AlertDialogHeader>
                              <AlertDialogFooter>
                                <AlertDialogCancel>Abbrechen</AlertDialogCancel>
                                <AlertDialogAction
                                  onClick={() => handleDelete(material.id)}
                                  className="bg-destructive text-destructive-foreground"
                                >
                                  Löschen
                                </AlertDialogAction>
                              </AlertDialogFooter>
                            </AlertDialogContent>
                          </AlertDialog>
                        </div>
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Add/Edit Material Dialog */}
      <Dialog open={showForm} onOpenChange={setShowForm}>
        <DialogContent className="max-w-[calc(100vw-1.5rem)] sm:max-w-lg max-h-[90vh] overflow-y-auto p-4 sm:p-6">
          <DialogHeader className="pr-8">
            <DialogTitle className="text-base sm:text-lg">
              {editingMaterial ? "Material bearbeiten" : "Material hinzufügen"}
            </DialogTitle>
            <DialogDescription className="text-xs sm:text-sm">
              Erfassen Sie das verwendete Material für diesen Einsatz.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <Label htmlFor="material">Material *</Label>
                <MaterialPicker
                  triggerLabel="Aus Katalog"
                  onSelect={(m) =>
                    setFormData((f) => ({
                      ...f,
                      material: m.einheit ? `${m.name} (${m.einheit})` : m.name,
                    }))
                  }
                />
              </div>
              <Input
                id="material"
                value={formData.material}
                onChange={(e) => setFormData({ ...formData, material: e.target.value })}
                placeholder="z.B. Sicherungsautomat 16A"
                required
              />
            </div>
            <div>
              <Label htmlFor="menge">Menge</Label>
              <Input
                id="menge"
                value={formData.menge}
                onChange={(e) => setFormData({ ...formData, menge: e.target.value })}
                placeholder="z.B. 2 Stück, 5m, 1 Karton"
              />
            </div>
            <div>
              <Label htmlFor="notizen">Notizen</Label>
              <Textarea
                id="notizen"
                value={formData.notizen}
                onChange={(e) => setFormData({ ...formData, notizen: e.target.value })}
                placeholder="Zusätzliche Bemerkungen..."
                rows={2}
              />
            </div>

            <div className="flex flex-wrap gap-2 sm:gap-3 justify-end pt-2">
              <Button type="button" variant="outline" onClick={() => setShowForm(false)} className="flex-1 sm:flex-none">
                Abbrechen
              </Button>
              <Button type="submit" disabled={saving} className="flex-1 sm:flex-none">
                {saving ? "Speichern..." : editingMaterial ? "Aktualisieren" : "Hinzufügen"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
};
