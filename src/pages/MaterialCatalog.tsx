import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Package, Plus, Search, Pencil, Trash2 } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

interface Material {
  id: string;
  name: string;
  einheit: string | null;
  kategorie: string;
}

interface MaterialPrice {
  material_id: string;
  einkaufspreis: number | null;
  verkaufspreis: number | null;
}

const NEW_CATEGORY = "__neu__";
const DEFAULT_CATEGORIES = ["Material", "Stunden & Leistungen"];

const emptyForm = {
  name: "",
  einheit: "",
  kategorie: "Material",
  kategorieNeu: "",
  einkaufspreis: "",
  verkaufspreis: "",
};

type MaterialForm = typeof emptyForm;

const eurFormatter = new Intl.NumberFormat("de-AT", {
  style: "currency",
  currency: "EUR",
});

const formatPrice = (value: number | null | undefined) =>
  value == null ? "–" : eurFormatter.format(value);

const parsePrice = (value: string): number | null => {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const normalized = trimmed.includes(",")
    ? trimmed.replace(/\./g, "").replace(",", ".")
    : trimmed;
  const num = Number(normalized.replace(/[^0-9.-]/g, ""));
  return Number.isFinite(num) ? num : null;
};

const priceToInput = (value: number | null | undefined) =>
  value == null ? "" : String(value).replace(".", ",");

const MaterialCatalog = () => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [materials, setMaterials] = useState<Material[]>([]);
  const [prices, setPrices] = useState<Map<string, MaterialPrice>>(new Map());
  const [loading, setLoading] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);
  const [search, setSearch] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Material | null>(null);
  const [form, setForm] = useState<MaterialForm>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Material | null>(null);

  useEffect(() => {
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        navigate("/auth");
        return;
      }
      const { data: roleData } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", session.user.id)
        .maybeSingle();
      const admin = roleData?.role === "administrator";
      setIsAdmin(admin);
      await fetchMaterials(admin);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fetchMaterials = async (admin: boolean) => {
    setLoading(true);
    const { data, error } = await supabase
      .from("materials")
      .select("id, name, einheit, kategorie")
      .eq("is_active", true)
      .order("kategorie")
      .order("name");
    if (error) {
      toast({
        variant: "destructive",
        title: "Fehler",
        description: "Materialien konnten nicht geladen werden",
      });
    } else {
      setMaterials(data ?? []);
    }

    // WICHTIG: Preise nur für Administratoren laden (RLS blockt sie ohnehin,
    // aber Mitarbeiter dürfen nicht einmal die Abfrage sehen).
    if (admin) {
      const { data: priceData } = await supabase
        .from("material_prices")
        .select("material_id, einkaufspreis, verkaufspreis");
      const map = new Map<string, MaterialPrice>();
      (priceData ?? []).forEach((p) => map.set(p.material_id, p));
      setPrices(map);
    }
    setLoading(false);
  };

  const categories = useMemo(() => {
    const set = new Set<string>(DEFAULT_CATEGORIES);
    materials.forEach((m) => m.kategorie && set.add(m.kategorie));
    return Array.from(set);
  }, [materials]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return materials;
    return materials.filter((m) =>
      [m.name, m.kategorie, m.einheit]
        .filter(Boolean)
        .some((v) => (v as string).toLowerCase().includes(q))
    );
  }, [materials, search]);

  const grouped = useMemo(() => {
    const map = new Map<string, Material[]>();
    filtered.forEach((m) => {
      const key = m.kategorie || "Sonstiges";
      const list = map.get(key);
      if (list) list.push(m);
      else map.set(key, [m]);
    });
    return Array.from(map.entries());
  }, [filtered]);

  const openCreate = () => {
    setEditing(null);
    setForm(emptyForm);
    setDialogOpen(true);
  };

  const openEdit = (m: Material) => {
    const price = prices.get(m.id);
    setEditing(m);
    setForm({
      name: m.name,
      einheit: m.einheit ?? "",
      kategorie: categories.includes(m.kategorie) ? m.kategorie : NEW_CATEGORY,
      kategorieNeu: categories.includes(m.kategorie) ? "" : m.kategorie,
      einkaufspreis: priceToInput(price?.einkaufspreis),
      verkaufspreis: priceToInput(price?.verkaufspreis),
    });
    setDialogOpen(true);
  };

  const handleSave = async () => {
    const name = form.name.trim();
    if (!name) {
      toast({ variant: "destructive", title: "Fehler", description: "Bitte Namen eingeben" });
      return;
    }
    const kategorie =
      form.kategorie === NEW_CATEGORY ? form.kategorieNeu.trim() : form.kategorie;
    if (!kategorie) {
      toast({ variant: "destructive", title: "Fehler", description: "Bitte Kategorie angeben" });
      return;
    }

    setSaving(true);
    const row = {
      name,
      einheit: form.einheit.trim() || null,
      kategorie,
    };
    const einkaufspreis = parsePrice(form.einkaufspreis);
    const verkaufspreis = parsePrice(form.verkaufspreis);

    let materialId = editing?.id ?? null;
    let error = null as { message: string } | null;

    if (editing) {
      ({ error } = await supabase.from("materials").update(row).eq("id", editing.id));
    } else {
      const { data, error: insertError } = await supabase
        .from("materials")
        .insert(row)
        .select("id")
        .single();
      error = insertError;
      materialId = data?.id ?? null;
    }

    if (error || !materialId) {
      toast({
        variant: "destructive",
        title: "Fehler",
        description: error?.message ?? "Material konnte nicht gespeichert werden",
      });
      setSaving(false);
      return;
    }

    // Preise nur schreiben, wenn welche angegeben sind oder bereits existieren
    if (einkaufspreis !== null || verkaufspreis !== null || prices.has(materialId)) {
      const { error: priceError } = await supabase
        .from("material_prices")
        .upsert({ material_id: materialId, einkaufspreis, verkaufspreis });
      if (priceError) {
        toast({
          variant: "destructive",
          title: "Fehler",
          description: "Preise konnten nicht gespeichert werden: " + priceError.message,
        });
      }
    }

    toast({
      title: editing ? "Material aktualisiert" : "Material angelegt",
      description: name,
    });
    setDialogOpen(false);
    setSaving(false);
    await fetchMaterials(true);
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    const target = deleteTarget;
    setDeleteTarget(null);

    const { error } = await supabase.from("materials").delete().eq("id", target.id);
    if (!error) {
      toast({ title: "Material gelöscht", description: target.name });
      await fetchMaterials(true);
      return;
    }

    if (error.code === "23503") {
      // FK-Verletzung: Material wird bereits referenziert → nur deaktivieren
      const { error: updateError } = await supabase
        .from("materials")
        .update({ is_active: false })
        .eq("id", target.id);
      if (updateError) {
        toast({ variant: "destructive", title: "Fehler", description: updateError.message });
      } else {
        toast({
          title: "Material deaktiviert",
          description: `„${target.name}" wird bereits in Berichten verwendet und wurde deshalb nur deaktiviert statt gelöscht.`,
        });
        await fetchMaterials(true);
      }
    } else {
      toast({ variant: "destructive", title: "Fehler", description: error.message });
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <PageHeader title="Materialdatenbank" backPath="/" />

      <main className="container mx-auto px-3 sm:px-4 lg:px-6 py-6 max-w-4xl space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-2xl font-bold flex items-center gap-2">
              <Package className="h-6 w-6 text-primary" />
              Materialien
              <Badge variant="secondary">{materials.length}</Badge>
            </h2>
            <p className="text-sm text-muted-foreground">
              {isAdmin
                ? "Materialien und Preise verwalten"
                : "Materialkatalog durchsuchen"}
            </p>
          </div>
          {isAdmin && (
            <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
              <DialogTrigger asChild>
                <Button onClick={openCreate} className="gap-2">
                  <Plus className="h-4 w-4" />
                  <span className="hidden sm:inline">Neues Material</span>
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
                <DialogHeader>
                  <DialogTitle>
                    {editing ? "Material bearbeiten" : "Neues Material anlegen"}
                  </DialogTitle>
                </DialogHeader>
                <div className="space-y-4">
                  <div className="space-y-1.5">
                    <Label htmlFor="material-name">Name *</Label>
                    <Input
                      id="material-name"
                      value={form.name}
                      onChange={(e) => setForm({ ...form, name: e.target.value })}
                    />
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label htmlFor="material-einheit">Einheit</Label>
                      <Input
                        id="material-einheit"
                        placeholder="z. B. m3, Std, Stk"
                        value={form.einheit}
                        onChange={(e) => setForm({ ...form, einheit: e.target.value })}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label>Kategorie</Label>
                      <Select
                        value={form.kategorie}
                        onValueChange={(value) => setForm({ ...form, kategorie: value })}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Kategorie wählen" />
                        </SelectTrigger>
                        <SelectContent>
                          {categories.map((k) => (
                            <SelectItem key={k} value={k}>
                              {k}
                            </SelectItem>
                          ))}
                          <SelectItem value={NEW_CATEGORY}>Neue Kategorie…</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  {form.kategorie === NEW_CATEGORY && (
                    <div className="space-y-1.5">
                      <Label htmlFor="material-kategorie-neu">Neue Kategorie</Label>
                      <Input
                        id="material-kategorie-neu"
                        placeholder="Name der neuen Kategorie"
                        value={form.kategorieNeu}
                        onChange={(e) => setForm({ ...form, kategorieNeu: e.target.value })}
                      />
                    </div>
                  )}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label htmlFor="material-ek">Einkaufspreis (€)</Label>
                      <Input
                        id="material-ek"
                        inputMode="decimal"
                        placeholder="z. B. 640,00"
                        value={form.einkaufspreis}
                        onChange={(e) => setForm({ ...form, einkaufspreis: e.target.value })}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="material-vk">Verkaufspreis (€)</Label>
                      <Input
                        id="material-vk"
                        inputMode="decimal"
                        placeholder="z. B. 810,00"
                        value={form.verkaufspreis}
                        onChange={(e) => setForm({ ...form, verkaufspreis: e.target.value })}
                      />
                    </div>
                  </div>
                  <Button onClick={handleSave} disabled={saving} className="w-full">
                    {saving
                      ? "Speichern..."
                      : editing
                        ? "Änderungen speichern"
                        : "Material anlegen"}
                  </Button>
                </div>
              </DialogContent>
            </Dialog>
          )}
        </div>

        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Suchen (Name, Kategorie, Einheit...)"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>

        {loading ? (
          <p className="text-center text-muted-foreground py-8">Lade Materialien...</p>
        ) : grouped.length === 0 ? (
          <Card>
            <CardContent className="py-10 text-center text-muted-foreground">
              {materials.length === 0
                ? "Noch keine Materialien vorhanden."
                : "Keine Materialien gefunden."}
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-6">
            {grouped.map(([kategorie, items]) => (
              <section key={kategorie}>
                <div className="sticky top-[60px] sm:top-[72px] z-10 bg-background/95 backdrop-blur py-2">
                  <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-2">
                    {kategorie}
                    <Badge variant="outline">{items.length}</Badge>
                  </h3>
                </div>
                <Card>
                  <CardContent className="p-0 divide-y">
                    {items.map((m) => {
                      const price = prices.get(m.id);
                      return (
                        <div
                          key={m.id}
                          className="flex items-center gap-3 px-3 sm:px-4 py-2.5"
                        >
                          <div className="min-w-0 flex-1">
                            <div className="font-medium truncate">{m.name}</div>
                            {isAdmin && (
                              <div className="text-xs text-muted-foreground tabular-nums sm:hidden">
                                EK {formatPrice(price?.einkaufspreis)} · VK{" "}
                                {formatPrice(price?.verkaufspreis)}
                              </div>
                            )}
                          </div>
                          {isAdmin && (
                            <div className="hidden sm:flex flex-col items-end text-sm tabular-nums shrink-0 w-36">
                              <span>
                                <span className="text-xs text-muted-foreground mr-1">EK</span>
                                {formatPrice(price?.einkaufspreis)}
                              </span>
                              <span>
                                <span className="text-xs text-muted-foreground mr-1">VK</span>
                                {formatPrice(price?.verkaufspreis)}
                              </span>
                            </div>
                          )}
                          {m.einheit && (
                            <Badge variant="secondary" className="shrink-0">
                              {m.einheit}
                            </Badge>
                          )}
                          {isAdmin && (
                            <div className="flex gap-1 shrink-0">
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => openEdit(m)}
                                title="Bearbeiten"
                              >
                                <Pencil className="h-4 w-4" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => setDeleteTarget(m)}
                                title="Löschen"
                                className="text-destructive hover:text-destructive"
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </CardContent>
                </Card>
              </section>
            ))}
          </div>
        )}
      </main>

      <AlertDialog
        open={!!deleteTarget}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Material löschen?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTarget ? `„${deleteTarget.name}" wird gelöscht. ` : ""}
              Wird das Material bereits in Berichten verwendet, wird es stattdessen
              deaktiviert und bleibt in bestehenden Einträgen erhalten.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Abbrechen</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Löschen
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default MaterialCatalog;
