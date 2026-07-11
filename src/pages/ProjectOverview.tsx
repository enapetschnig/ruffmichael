import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { ArrowLeft, FileText, FileCheck, FolderOpen, Package, Camera, ImagePlus, Lock, FileSignature, Plus, CheckCircle2 } from "lucide-react";
import { format } from "date-fns";
import { de } from "date-fns/locale";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { projectLabel } from "@/lib/projectLabel";

type ProjectNachtrag = {
  id: string;
  titel: string;
  status: string;
  created_at: string;
  unterschrieben_am: string | null;
};

type DocumentCategory = {
  type: "plans" | "reports" | "photos" | "chef";
  title: string;
  description: string;
  icon: React.ReactNode;
  count: number;
  adminOnly?: boolean;
};

const ProjectOverview = () => {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const [projectName, setProjectName] = useState("");
  const [isAdmin, setIsAdmin] = useState(false);
  const [materialCount, setMaterialCount] = useState(0);
  const [nachtraege, setNachtraege] = useState<ProjectNachtrag[]>([]);
  const [categories, setCategories] = useState<DocumentCategory[]>([
    {
      type: "photos",
      title: "Fotos",
      description: "Baufortschritt und Dokumentationsfotos",
      icon: <Camera className="h-8 w-8" />,
      count: 0,
    },
    {
      type: "plans",
      title: "Pläne",
      description: "Baupläne und technische Zeichnungen",
      icon: <FileText className="h-8 w-8" />,
      count: 0,
    },
    {
      type: "reports",
      title: "Regieberichte",
      description: "Bautagebücher und Stundenberichte",
      icon: <FileCheck className="h-8 w-8" />,
      count: 0,
    },
    {
      type: "chef",
      title: "🔒 Chefordner",
      description: "Vertrauliche Chef-Dokumente",
      icon: <Lock className="h-8 w-8" />,
      count: 0,
      adminOnly: true,
    },
  ]);

  useEffect(() => {
    if (projectId) {
      checkAdminStatus();
      fetchProjectName();
      fetchNachtraege();
    }
  }, [projectId]);

  useEffect(() => {
    if (projectId) {
      fetchFileCounts();
      fetchMaterialCount();
    }
  }, [projectId, isAdmin]);

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

  const fetchProjectName = async () => {
    if (!projectId) return;
    
    const { data } = await supabase
      .from("projects")
      .select("name, adresse, customers(strasse, ort)")
      .eq("id", projectId)
      .single();

    if (data) {
      setProjectName(projectLabel(data));
    }
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

  const fetchMaterialCount = async () => {
    if (!projectId) return;

    const { count } = await supabase
      .from("material_entries")
      .select("*", { count: "exact", head: true })
      .eq("project_id", projectId);

    setMaterialCount(count || 0);
  };

  const fetchFileCounts = async () => {
    if (!projectId) return;

    const bucketMap: Record<string, string> = {
      plans: "project-plans",
      reports: "project-reports",
      photos: "project-photos",
      chef: "project-chef",
    };

    const updatedCategories = await Promise.all(
      categories.map(async (category) => {
        // Skip chef bucket for non-admins
        if (category.type === "chef" && !isAdmin) {
          return { ...category, count: 0 };
        }
        
        const bucket = bucketMap[category.type];
        const { data } = await supabase
          .storage
          .from(bucket)
          .list(projectId);

        return {
          ...category,
          count: data?.length || 0,
        };
      })
    );

    setCategories(updatedCategories);
  };

  const handleQuickPhotoUpload = () => {
    navigate(`/projects/${projectId}/photos`);
  };

  // Filter categories based on admin status
  const visibleCategories = categories.filter(
    (category) => !category.adminOnly || isAdmin
  );

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-card sticky top-0 z-50 shadow-sm">
        <div className="container mx-auto px-3 sm:px-4 lg:px-6 py-3 sm:py-4">
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={() => navigate("/projects")}>
              <ArrowLeft className="h-4 w-4 mr-2" />
              <span className="hidden sm:inline">Zurück</span>
            </Button>
            <img 
              src="/ruff-logo.png"
              alt="Ruff Michael Logo"
              className="h-8 w-8 sm:h-10 sm:w-10 cursor-pointer hover:opacity-80 transition-opacity object-contain" 
              onClick={() => navigate("/projects")}
            />
          </div>
        </div>
      </header>

      <main className="container mx-auto px-3 sm:px-4 lg:px-6 py-4 sm:py-6 max-w-4xl">
        <div className="mb-6">
          <h1 className="text-2xl sm:text-3xl font-bold mb-2">{projectName}</h1>
          <p className="text-muted-foreground">Dokumentation und Dateien</p>
        </div>

        {/* Nachträge - nur anzeigen, wenn das Projekt Nachträge hat */}
        {nachtraege.length > 0 && (
          <div className="mb-4 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-lg font-semibold flex items-center gap-2">
                <FileSignature className="h-5 w-5 text-primary" />
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
                    <div className="min-w-0">
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

        {/* Projektordner - freie Ordnerstruktur mit Dateien */}
        <Card
          className="cursor-pointer hover:shadow-lg transition-shadow mb-4 border-primary/40"
          onClick={() => navigate(`/projects/${projectId}/files`)}
        >
          <CardHeader>
            <div className="flex items-center justify-between">
              <div className="text-primary"><FolderOpen className="h-8 w-8" /></div>
            </div>
            <CardTitle className="text-xl">Projektordner</CardTitle>
            <CardDescription>
              Eigene Ordner &amp; Dateien — erstellen, verschieben, löschen
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button variant="outline" className="w-full">
              Öffnen
            </Button>
          </CardContent>
        </Card>

        <div className="grid gap-4 md:grid-cols-2">
          {visibleCategories.map((category) => (
            <Card 
              key={category.type}
              className="cursor-pointer hover:shadow-lg transition-shadow"
              onClick={() => navigate(`/projects/${projectId}/${category.type}`)}
            >
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div className="text-primary">{category.icon}</div>
                  <div className="text-2xl font-bold">{category.count}</div>
                </div>
                <CardTitle className="text-xl">{category.title}</CardTitle>
                <CardDescription>{category.description}</CardDescription>
              </CardHeader>
              <CardContent>
                <Button variant="outline" className="w-full">
                  Öffnen
                </Button>
              </CardContent>
            </Card>
          ))}

          {/* Materialliste - separate card with DB count */}
          <Card 
            className="cursor-pointer hover:shadow-lg transition-shadow"
            onClick={() => navigate(`/projects/${projectId}/materials`)}
          >
            <CardHeader>
              <div className="flex items-center justify-between">
                <div className="text-primary"><Package className="h-8 w-8" /></div>
                <div className="text-2xl font-bold">{materialCount}</div>
              </div>
              <CardTitle className="text-xl">Materialliste</CardTitle>
              <CardDescription>Verwendete Materialien dokumentieren</CardDescription>
            </CardHeader>
            <CardContent>
              <Button variant="outline" className="w-full">
                Öffnen
              </Button>
            </CardContent>
          </Card>
        </div>

        {/* Floating Action Button für Fotos */}
        <Button 
          className="fixed bottom-6 right-6 z-50 h-14 w-14 rounded-full shadow-lg"
          size="icon"
          onClick={handleQuickPhotoUpload}
        >
          <ImagePlus className="h-6 w-6" />
        </Button>
      </main>
    </div>
  );
};

export default ProjectOverview;
