import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { Plus, Trash2, Package, Edit2, Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/PageHeader";

type MaterialEntry = {
  id: string;
  project_id: string;
  user_id: string;
  material: string;
  menge: string | null;
  notizen: string | null;
  created_at: string;
  profiles?: {
    vorname: string;
    nachname: string;
  } | null;
};

const MaterialList = () => {
  const { projectId } = useParams<{ projectId: string }>();
  const { toast } = useToast();
  const [entries, setEntries] = useState<MaterialEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [projectName, setProjectName] = useState("");
  const [isAdmin, setIsAdmin] = useState(false);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);

  // New entry form
  const [showForm, setShowForm] = useState(false);
  const [newMaterial, setNewMaterial] = useState("");
  const [newMenge, setNewMenge] = useState("");
  const [newNotizen, setNewNotizen] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // Edit state
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editMaterial, setEditMaterial] = useState("");
  const [editMenge, setEditMenge] = useState("");
  const [editNotizen, setEditNotizen] = useState("");

  useEffect(() => {
    if (projectId) {
      checkUserAndFetchData();
    }
  }, [projectId]);

  const checkUserAndFetchData = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    setCurrentUserId(user.id);

    const { data: roleData } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", user.id)
      .single();

    setIsAdmin(roleData?.role === "administrator");

    await Promise.all([fetchProjectName(), fetchEntries()]);
    setLoading(false);
  };

  const fetchProjectName = async () => {
    if (!projectId) return;

    const { data } = await supabase
      .from("projects")
      .select("name")
      .eq("id", projectId)
      .single();

    if (data) {
      setProjectName(data.name);
    }
  };

  const fetchEntries = async () => {
    if (!projectId) return;

    const { data, error } = await supabase
      .from("material_entries")
      .select("*")
      .eq("project_id", projectId)
      .order("created_at", { ascending: false });

    if (!error && data) {
      // Fetch profile names separately
      const userIds = [...new Set(data.map(e => e.user_id))];
      const { data: profiles } = await supabase
        .from("profiles")
        .select("id, vorname, nachname")
        .in("id", userIds);
      
      const profileMap = new Map(profiles?.map(p => [p.id, p]) || []);
      
      const entriesWithProfiles = data.map(entry => ({
        ...entry,
        profiles: profileMap.get(entry.user_id) || null
      }));
      
      setEntries(entriesWithProfiles as MaterialEntry[]);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!projectId || !currentUserId || !newMaterial.trim()) return;

    setSubmitting(true);

    const { error } = await supabase
      .from("material_entries")
      .insert({
        project_id: projectId,
        user_id: currentUserId,
        material: newMaterial.trim(),
        menge: newMenge.trim() || null,
        notizen: newNotizen.trim() || null,
      });

    if (error) {
      toast({
        variant: "destructive",
        title: "Fehler",
        description: "Eintrag konnte nicht gespeichert werden",
      });
    } else {
      toast({
        title: "Gespeichert",
        description: "Material wurde hinzugefügt",
      });
      setNewMaterial("");
      setNewMenge("");
      setNewNotizen("");
      setShowForm(false);
      fetchEntries();
    }

    setSubmitting(false);
  };

  const handleDelete = async (id: string) => {
    const { error } = await supabase
      .from("material_entries")
      .delete()
      .eq("id", id);

    if (error) {
      toast({
        variant: "destructive",
        title: "Fehler",
        description: "Eintrag konnte nicht gelöscht werden",
      });
    } else {
      toast({
        title: "Gelöscht",
        description: "Eintrag wurde entfernt",
      });
      fetchEntries();
    }
  };

  const startEdit = (entry: MaterialEntry) => {
    setEditingId(entry.id);
    setEditMaterial(entry.material);
    setEditMenge(entry.menge || "");
    setEditNotizen(entry.notizen || "");
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditMaterial("");
    setEditMenge("");
    setEditNotizen("");
  };

  const saveEdit = async (id: string) => {
    if (!editMaterial.trim()) return;

    const { error } = await supabase
      .from("material_entries")
      .update({
        material: editMaterial.trim(),
        menge: editMenge.trim() || null,
        notizen: editNotizen.trim() || null,
      })
      .eq("id", id);

    if (error) {
      toast({
        variant: "destructive",
        title: "Fehler",
        description: "Änderung konnte nicht gespeichert werden",
      });
    } else {
      toast({
        title: "Gespeichert",
        description: "Eintrag wurde aktualisiert",
      });
      cancelEdit();
      fetchEntries();
    }
  };

  const canEditOrDelete = (entry: MaterialEntry) => {
    return isAdmin || entry.user_id === currentUserId;
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
      <PageHeader title={`${projectName} - Materialliste`} backPath={`/projects/${projectId}`} />

      <main className="container mx-auto px-4 py-6 max-w-3xl">
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <Package className="h-5 w-5" />
                  Materialliste
                </CardTitle>
                <CardDescription>
                  {entries.length} {entries.length === 1 ? "Eintrag" : "Einträge"}
                </CardDescription>
              </div>
              {!showForm && (
                <Button onClick={() => setShowForm(true)} size="sm">
                  <Plus className="h-4 w-4 mr-2" />
                  Hinzufügen
                </Button>
              )}
            </div>
          </CardHeader>

          <CardContent className="space-y-4">
            {/* Add new entry form */}
            {showForm && (
              <form onSubmit={handleSubmit} className="p-4 border rounded-lg bg-muted/30 space-y-3">
                <div>
                  <label className="text-sm font-medium">Material *</label>
                  <Input
                    value={newMaterial}
                    onChange={(e) => setNewMaterial(e.target.value)}
                    placeholder="z.B. Schrauben 4x40mm"
                    required
                  />
                </div>
                <div>
                  <label className="text-sm font-medium">Menge</label>
                  <Input
                    value={newMenge}
                    onChange={(e) => setNewMenge(e.target.value)}
                    placeholder="z.B. 100 Stück"
                  />
                </div>
                <div>
                  <label className="text-sm font-medium">Notizen</label>
                  <Textarea
                    value={newNotizen}
                    onChange={(e) => setNewNotizen(e.target.value)}
                    placeholder="Zusätzliche Infos..."
                    rows={2}
                  />
                </div>
                <div className="flex gap-2">
                  <Button type="submit" disabled={submitting || !newMaterial.trim()}>
                    {submitting ? "Speichert..." : "Speichern"}
                  </Button>
                  <Button type="button" variant="outline" onClick={() => setShowForm(false)}>
                    Abbrechen
                  </Button>
                </div>
              </form>
            )}

            {/* Entry list */}
            {entries.length === 0 ? (
              <div className="text-center py-12">
                <Package className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
                <p className="text-lg font-semibold mb-2">Keine Einträge</p>
                <p className="text-sm text-muted-foreground">
                  Füge das erste Material hinzu
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                {entries.map((entry) => (
                  <div
                    key={entry.id}
                    className="p-4 rounded-lg border bg-card"
                  >
                    {editingId === entry.id ? (
                      // Edit mode
                      <div className="space-y-3">
                        <Input
                          value={editMaterial}
                          onChange={(e) => setEditMaterial(e.target.value)}
                          placeholder="Material"
                        />
                        <Input
                          value={editMenge}
                          onChange={(e) => setEditMenge(e.target.value)}
                          placeholder="Menge"
                        />
                        <Textarea
                          value={editNotizen}
                          onChange={(e) => setEditNotizen(e.target.value)}
                          placeholder="Notizen"
                          rows={2}
                        />
                        <div className="flex gap-2">
                          <Button
                            size="sm"
                            onClick={() => saveEdit(entry.id)}
                            disabled={!editMaterial.trim()}
                          >
                            <Check className="h-4 w-4 mr-1" />
                            Speichern
                          </Button>
                          <Button size="sm" variant="outline" onClick={cancelEdit}>
                            <X className="h-4 w-4 mr-1" />
                            Abbrechen
                          </Button>
                        </div>
                      </div>
                    ) : (
                      // View mode
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex-1 min-w-0">
                          <p className="font-medium">{entry.material}</p>
                          {entry.menge && (
                            <p className="text-sm text-muted-foreground">
                              Menge: {entry.menge}
                            </p>
                          )}
                          {entry.notizen && (
                            <p className="text-sm text-muted-foreground mt-1">
                              {entry.notizen}
                            </p>
                          )}
                          <p className="text-xs text-muted-foreground mt-2">
                            {entry.profiles
                              ? `${entry.profiles.vorname} ${entry.profiles.nachname}`
                              : "Unbekannt"}{" "}
                            • {new Date(entry.created_at).toLocaleDateString("de-DE")}
                          </p>
                        </div>
                        {canEditOrDelete(entry) && (
                          <div className="flex gap-1">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => startEdit(entry)}
                            >
                              <Edit2 className="h-4 w-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleDelete(entry.id)}
                            >
                              <Trash2 className="h-4 w-4 text-destructive" />
                            </Button>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </main>
    </div>
  );
};

export default MaterialList;
