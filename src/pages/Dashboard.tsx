import { Building2, Clock, FileText, FolderOpen, Users, FileSpreadsheet, Zap, Receipt } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useNavigate } from "react-router-dom";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { VoiceInputButton } from "@/components/VoiceInputButton";


const Dashboard = () => {
  const navigate = useNavigate();
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    checkAdminStatus();
  }, []);

  const checkAdminStatus = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const { data } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", user.id)
      .single();

    setIsAdmin(data?.role === "administrator");
  };

  const features = [
    {
      title: "Zeiterfassung",
      description: "Stunden schnell und einfach erfassen",
      icon: Clock,
      action: () => navigate("/time-tracking"),
      color: "bg-primary/10 text-primary"
    },
    {
      title: "Regieberichte",
      description: "Service-Einsätze dokumentieren",
      icon: Zap,
      action: () => navigate("/disturbances"),
      color: "bg-amber-500/10 text-amber-600"
    },
    {
      title: "Projekte",
      description: "Bauvorhaben verwalten und dokumentieren",
      icon: FolderOpen,
      action: () => navigate("/projects"),
      color: "bg-accent/10 text-accent"
    },
    {
      title: "Baustellen",
      description: "Aktuelle Baustellenübersicht",
      icon: Building2,
      action: () => navigate("/construction-sites"),
      color: "bg-secondary text-secondary-foreground"
    },
  ];

  return (
    <div className="min-h-screen bg-background">
      <div className="container mx-auto px-4 py-8 max-w-6xl">
        <div className="mb-8">
          <div className="flex items-center gap-4 mb-4">
             <img src="/ruff-logo.png" alt="Ruff Michael Logo" className="h-16 w-16 object-contain" />
            <div>
              <h1 className="text-4xl font-bold text-foreground">Ruff Michael GmbH</h1>
              <p className="text-muted-foreground">Digitale Baustellendokumentation</p>
            </div>
          </div>
        </div>

        {/* Sprach-Schnelleingabe */}
        <Card className="mb-6 border-2 border-primary/30 bg-gradient-to-br from-primary/5 to-accent/5">
          <CardHeader>
            <CardTitle className="text-xl flex items-center gap-2">
              🎤 Schnell per Sprache
            </CardTitle>
            <CardDescription>
              Sag einfach was du gemacht hast – die AI erkennt automatisch, ob Zeiterfassung oder Regiebericht, und fuellt alles aus.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <VoiceInputButton
              mode="auto"
              onResult={(res) => {
                const mode = res.extracted?.mode;
                if (mode === "disturbance") {
                  sessionStorage.setItem("voicePrefill", JSON.stringify(res));
                  navigate("/disturbances?voice=1");
                } else {
                  sessionStorage.setItem("voicePrefill", JSON.stringify(res));
                  navigate("/time-tracking?voice=1");
                }
              }}
              label="Jetzt sprechen"
            />
          </CardContent>
        </Card>


        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {features.map((feature) => {
            const Icon = feature.icon;
            return (
              <Card key={feature.title} className="hover:shadow-lg transition-all duration-300 border-2 cursor-pointer" onClick={feature.action}>
                <CardHeader>
                  <div className={`w-14 h-14 rounded-xl ${feature.color} flex items-center justify-center mb-4`}>
                    <Icon className="w-7 h-7" />
                  </div>
                  <CardTitle className="text-2xl">{feature.title}</CardTitle>
                  <CardDescription className="text-base">{feature.description}</CardDescription>
                </CardHeader>
                <CardContent>
                  <Button className="w-full" size="lg">
                    Öffnen
                  </Button>
                </CardContent>
              </Card>
            );
          })}
        </div>

        {isAdmin && (
          <div className="mt-6">
            <h2 className="text-2xl font-bold mb-4">Admin-Bereich</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <Card className="hover:shadow-lg transition-all duration-300 border-2 border-orange-200 cursor-pointer" onClick={() => navigate("/hours-report")}>
                <CardHeader>
                  <div className="w-14 h-14 rounded-xl bg-orange-50 text-orange-600 flex items-center justify-center mb-4">
                    <FileSpreadsheet className="w-7 h-7" />
                  </div>
                  <CardTitle className="text-2xl">Stundenauswertung</CardTitle>
                  <CardDescription className="text-base">Monatsberichte mit Überstunden exportieren</CardDescription>
                </CardHeader>
                <CardContent>
                  <Button className="w-full" size="lg">
                    Öffnen
                  </Button>
                </CardContent>
              </Card>

              <Card className="hover:shadow-lg transition-all duration-300 border-2 border-blue-200 cursor-pointer" onClick={() => navigate("/employees")}>
                <CardHeader>
                  <div className="w-14 h-14 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center mb-4">
                    <Users className="w-7 h-7" />
                  </div>
                  <CardTitle className="text-2xl">Mitarbeiterverwaltung</CardTitle>
                  <CardDescription className="text-base">Stammdaten und Dokumente verwalten</CardDescription>
                </CardHeader>
                <CardContent>
                  <Button className="w-full" size="lg">
                    Öffnen
                  </Button>
                </CardContent>
              </Card>
            </div>
          </div>
        )}

        <Card className="mt-8 bg-primary/5 border-primary/20">
          <CardHeader>
            <CardTitle className="text-xl">Schnellzugriff</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Button variant="outline" className="h-24 flex-col gap-2" onClick={() => navigate("/time-tracking")}>
              <Clock className="w-6 h-6" />
              <span>Zeit eintragen</span>
            </Button>
            <Button variant="outline" className="h-24 flex-col gap-2" onClick={() => navigate("/projects")}>
              <FolderOpen className="w-6 h-6" />
              <span>Neues Projekt</span>
            </Button>
            <Button variant="outline" className="h-24 flex-col gap-2" onClick={() => navigate("/reports")}>
              <FileText className="w-6 h-6" />
              <span>Bericht erstellen</span>
            </Button>
            <Button variant="outline" className="h-24 flex-col gap-2" onClick={() => navigate("/construction-sites")}>
              <Building2 className="w-6 h-6" />
              <span>Baustelle öffnen</span>
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default Dashboard;
