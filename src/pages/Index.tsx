import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Session, User } from "@supabase/supabase-js";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Clock, FolderKanban, Users, BarChart3, LogOut, FileText, Download, User as UserIcon, Package, FilePlus2, ClipboardList, FileCheck, Paintbrush, Receipt, Camera, Shield, BookUser, Banknote, HardHat, LayoutGrid, type LucideIcon } from "lucide-react";
import { KBButton, KBSectionHeader } from "@/components/kingbill";
import { ErstaufnahmeDialog, type ErstaufnahmePrefill } from "@/components/ErstaufnahmeDialog";
import { DashboardVoiceAssistant } from "@/components/DashboardVoiceAssistant";
import { DrawingEditor } from "@/components/DrawingEditor";
import { FotoAufnahme } from "@/components/FotoAufnahme";
import { cachedSelect } from "@/lib/offlineStore";
import { warmOfflineCache } from "@/lib/cachedQueries";
import { useToast } from "@/hooks/use-toast";
import { useOnboarding } from "@/contexts/OnboardingContext";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import ChangePasswordDialog from "@/components/ChangePasswordDialog";
import { AenderungswunschKnopf } from "@/components/aenderungswunsch/AenderungswunschKnopf";
import { ErledigteWuensche } from "@/components/aenderungswunsch/ErledigteWuensche";
import { NeuerungenBanner } from "@/components/neuerungen/NeuerungenBanner";

function Bereich({ icon, title, children }: { icon: LucideIcon; title: string; children: React.ReactNode }) {
  return <section className="flex flex-col gap-2"><KBSectionHeader icon={icon} title={title} />{children}</section>;
}

type Project = {
  id: string;
  name: string;
  status: string;
  updated_at: string;
};

type RecentTimeEntry = {
  id: string;
  datum: string;
  stunden: number;
  taetigkeit: string;
  disturbance_id: string | null;
  projects: { name: string } | null;
  profiles?: {
    vorname: string;
    nachname: string;
  } | null;
};

export default function Index() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [session, setSession] = useState<Session | null>(null);
  const [showErstaufnahme, setShowErstaufnahme] = useState(false);
  const [showDrawing, setShowDrawing] = useState(false);
  const [showFotos, setShowFotos] = useState(false);
  const [erstaufnahmePrefill, setErstaufnahmePrefill] = useState<ErstaufnahmePrefill | undefined>(undefined);
  const [user, setUser] = useState<User | null>(null);
  const [userRole, setUserRole] = useState<string | null>(null);
  const [userName, setUserName] = useState<string>("");
  const [projects, setProjects] = useState<Project[]>([]);
  const [recentEntries, setRecentEntries] = useState<RecentTimeEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [isActivated, setIsActivated] = useState<boolean | null>(null);
  const { handleRestartInstallGuide } = useOnboarding();

  const fetchProjects = async () => {
    // Offline-fähig (letzter bekannter Stand) — und gleichzeitig der zentrale
    // Moment, um die lokale Ablage für ALLE Seiten vorzuwärmen: Projekte,
    // Kunden, Status, Checkliste. So funktioniert z.B. die Projektauswahl in
    // der Zeiterfassung auch offline, selbst wenn sie auf diesem Gerät noch
    // nie geöffnet war.
    warmOfflineCache();
    const { data } = await cachedSelect<Project[]>("projects:index", () =>
      supabase
        .from("projects")
        .select("id, name, status, updated_at")
        .eq("status", "aktiv")
        .order("updated_at", { ascending: false })
        .limit(5) as unknown as PromiseLike<{ data: Project[] | null; error: { message: string } | null }>,
    );

    if (data) {
      setProjects(data);
    }
  };

  const fetchRecentEntries = async (userId: string, role: string | null) => {
    // For admins, fetch all entries. For employees, only their own
    let query = supabase
      .from("time_entries")
      .select("id, datum, stunden, taetigkeit, disturbance_id, projects(name)")
      .order("datum", { ascending: false })
      .limit(5);

    if (role === "mitarbeiter") {
      query = query.eq("user_id", userId);
    }

    const { data } = await query;

    if (data) {
      setRecentEntries(data as any);
    }
  };

  const loadForUser = async (userId: string) => {
    // 1) Activation + name
    const profileReq = supabase
      .from("profiles")
      .select("vorname, nachname, is_active")
      .eq("id", userId)
      .maybeSingle();

    // 2) Role
    const roleReq = supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", userId)
      .maybeSingle();

    const [{ data: profileData }, { data: roleData }] = await Promise.all([profileReq, roleReq]);

    const role = roleData?.role ?? null;
    setUserRole(role);
    const isAdminUser = role === "administrator";

    // Deaktivierte Benutzer sperren – Administratoren können sich niemals selbst aussperren.
    // Fehlende Profilzeile (Trigger noch nicht gelaufen, Erstanmeldung) wird als "nicht gesperrt" behandelt.
    const isBlocked = profileData ? profileData.is_active === false && !isAdminUser : false;
    setIsActivated(!isBlocked);

    if (profileData) {
      setUserName(`${profileData.vorname} ${profileData.nachname}`.trim());
    } else {
      // Fallback: User-Metadaten verwenden
      const { data: { user } } = await supabase.auth.getUser();
      if (user?.user_metadata) {
        setUserName(`${user.user_metadata.vorname || ''} ${user.user_metadata.nachname || ''}`.trim() || 'Neuer Benutzer');
      }
    }

    await Promise.all([
      fetchProjects(),
      fetchRecentEntries(userId, role),
    ]);

    setLoading(false);
  };

  useEffect(() => {
    let isMounted = true;

    const handleSession = async (nextSession: Session | null) => {
      if (!isMounted) return;

      setSession(nextSession);
      setUser(nextSession?.user ?? null);

      if (!nextSession?.user) {
        setIsActivated(null);
        setUserRole(null);
        setUserName("");
        setProjects([]);
        setRecentEntries([]);
        setLoading(false);
        navigate("/auth");
        return;
      }

      // Block any UI until activation is verified
      setLoading(true);
      setIsActivated(null);

      await loadForUser(nextSession.user.id);
    };

    // Listen for auth changes FIRST
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      // Never run async supabase calls inside this callback.
      window.setTimeout(() => {
        void handleSession(nextSession);
      }, 0);
    });

    // THEN check initial session
    supabase.auth.getSession().then(({ data: { session } }) => {
      window.setTimeout(() => {
        void handleSession(session);
      }, 0);
    });

    // Realtime subscription for projects
    const projectsChannel = supabase
      .channel("dashboard-projects")
      .on("postgres_changes", { event: "*", schema: "public", table: "projects" }, () => {
        fetchProjects();
      })
      .subscribe();

    return () => {
      isMounted = false;
      subscription.unsubscribe();
      supabase.removeChannel(projectsChannel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navigate]);

  // Realtime subscription for time entries – separater Effekt, damit die tatsächliche
  // (authentifizierte) User-ID verwendet und bei Wechsel neu abonniert wird.
  useEffect(() => {
    if (!user?.id) return;
    const isAdminUser = userRole === "administrator";
    const channel = supabase
      .channel(`dashboard-entries-${user.id}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "time_entries",
          // Admins sehen alle Buchungen, Mitarbeiter nur eigene.
          ...(isAdminUser ? {} : { filter: `user_id=eq.${user.id}` }),
        },
        () => {
          fetchRecentEntries(user.id, userRole);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, userRole]);

  const handleLogout = async () => {
    await supabase.auth.signOut({ scope: "local" });
    navigate("/auth");
  };

  useEffect(() => {
    if (!loading && !user) {
      navigate("/auth");
    }
  }, [loading, user, navigate]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p>Lädt...</p>
      </div>
    );
  }

  if (!user) {
    return null;
  }

  // Gesperrte (deaktivierte) Benutzer erhalten keinen Zugriff auf das Dashboard.
  if (isActivated === false) {
    return (
      <div className="min-h-screen flex items-center justify-center kb-page p-4">
        <Card className="max-w-md w-full">
          <CardHeader>
            <CardTitle>Zugang deaktiviert</CardTitle>
            <CardDescription>
              Dein Zugang wurde deaktiviert. Bitte wende dich an die Verwaltung.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button className="w-full" onClick={handleLogout}>
              <LogOut className="mr-2 h-4 w-4" />
              Abmelden
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const isAdmin = userRole === "administrator";
  const laeuftAlsApp = window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true;

  return (
    <div className="kb-page min-h-screen">
      <header data-seitenkopf className="kb-toolbar sticky top-0 z-40">
        <button type="button" className="kb-btn hidden shrink-0 sm:inline-flex" onClick={handleLogout} title="Abmelden">
          <LogOut className="h-4 w-4 text-kb-blue-dark" />
          <span className="hidden md:inline">Beenden</span>
        </button>
        {isAdmin && (
          <button type="button" className="kb-btn hidden shrink-0 sm:inline-flex" onClick={() => navigate("/admin")} title="Einstellungen ändern">
            <Shield className="h-4 w-4 text-kb-blue-dark" />
            <span className="hidden md:inline">Einstellungen ändern</span>
          </button>
        )}
        <span className="shrink-0" data-bildschirmfoto="aus"><AenderungswunschKnopf gestalt="kopf" /></span>
        <div className="flex items-center gap-2 sm:gap-3 min-w-0 flex-1 sm:flex-none sm:mx-auto">
          <div className="shrink-0 rounded bg-white/95 px-1.5 py-1 shadow-sm">
            <img src="/ruff-logo.png" alt="Ruff Michael" className="h-8 sm:h-9 w-auto" />
          </div>
          <div className="flex flex-col min-w-0">
            <h1 className="text-sm sm:text-base font-bold leading-tight truncate text-white [text-shadow:0_1px_2px_rgba(0,40,90,0.55)]">Ruff Michael</h1>
            <span className="text-xs sm:text-sm text-white/85 truncate">Hallo {userName || "Benutzer"}</span>
          </div>
        </div>
        <div className="ml-auto shrink-0 flex items-center gap-1 sm:gap-2">
          {!laeuftAlsApp && (
            <button type="button" className="kb-btn shrink-0" onClick={handleRestartInstallGuide} title="App auf diesem Gerät installieren" aria-label="App installieren">
              <Download className="h-4 w-4 text-kb-blue-dark" />
              <span className="hidden md:inline">App installieren</span>
            </button>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button type="button" className="kb-btn" aria-label="Mein Account">
                <UserIcon className="h-4 w-4 text-kb-blue-dark" />
                <span className="hidden sm:inline">Menü</span>
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuLabel>Mein Account</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={handleRestartInstallGuide}><Download className="mr-2 h-4 w-4" />App installieren</DropdownMenuItem>
              <DropdownMenuSeparator />
              <ChangePasswordDialog />
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={handleLogout}><LogOut className="mr-2 h-4 w-4" />Abmelden</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>

      <main className="mx-auto w-full max-w-[1600px] px-3 sm:px-4 lg:px-6 py-4 sm:py-6">
        <ErledigteWuensche />
        {user && isAdmin && <NeuerungenBanner userId={user.id} />}

        <div className="mb-4 grid grid-cols-3 gap-2 sm:hidden">
          <KBButton className="w-full min-h-[72px] flex-col gap-1.5 py-3 text-sm" icon={Clock} label="Zeit buchen" onClick={() => navigate("/time-tracking")} />
          <KBButton className="w-full min-h-[72px] flex-col gap-1.5 py-3 text-sm" icon={Camera} label="Foto" onClick={() => setShowFotos(true)} />
          <KBButton className="w-full min-h-[72px] flex-col gap-1.5 py-3 text-sm" icon={FileText} label="Regiebericht" onClick={() => navigate("/disturbances")} />
        </div>

        <nav aria-label="Hauptmenü" className="columns-1 md:columns-2 xl:columns-4 gap-3 sm:gap-4 [&>*]:mb-3 sm:[&>*]:mb-4 [&>*]:break-inside-avoid [&_.kb-btn]:min-h-[52px] sm:[&_.kb-btn]:min-h-[2.25rem]">
          <Bereich icon={FileText} title="Dokumente">
            {isAdmin && <>
              <KBButton className="w-full" icon={FileText} label="Angebote" onClick={() => navigate("/belege?tab=angebote")} />
              <KBButton className="w-full" icon={Receipt} label="Rechnungen" onClick={() => navigate("/belege?tab=rechnungen")} />
              <KBButton className="w-full" icon={LayoutGrid} label="Dokumentenliste" onClick={() => navigate("/belege")} />
            </>}
            <KBButton className="w-full" icon={FilePlus2} label="Nachträge" onClick={() => navigate("/nachtraege")} />
            <KBButton className="w-full" icon={FileCheck} label="Übernahmebestätigungen" onClick={() => navigate("/uebernahmen")} />
            <KBButton className="w-full" icon={FileText} label="Projektberichte & Dateien" onClick={() => navigate("/reports")} />
          </Bereich>
          <Bereich icon={BookUser} title="Kunden">
            <KBButton className="w-full" icon={BookUser} label="Kunden" onClick={() => navigate("/customers")} />
          </Bereich>
          <Bereich icon={Package} title="Artikel">
            <KBButton className="w-full" icon={Package} label="Artikel" onClick={() => navigate("/materialien")} />
          </Bereich>
          {isAdmin && <Bereich icon={Banknote} title="Finanzen">
            <KBButton className="w-full" icon={Receipt} label="Offene Posten" onClick={() => navigate("/belege?tab=offen")} />
          </Bereich>}
          {isAdmin && <Bereich icon={BarChart3} title="Auswertung">
            <KBButton className="w-full" icon={BarChart3} label="Stundenauswertung" onClick={() => navigate("/hours-report")} />
          </Bereich>}
          <Bereich icon={HardHat} title="Betrieb">
            <KBButton className="w-full" icon={Clock} label="Zeiterfassung" onClick={() => navigate("/time-tracking")} />
            <KBButton className="w-full" icon={FileText} label="Regieberichte" onClick={() => navigate("/disturbances")} />
            <KBButton className="w-full" icon={FolderKanban} label="Projekte" onClick={() => navigate("/projects")} />
            <KBButton className="w-full" icon={BarChart3} label="Meine Stunden" onClick={() => navigate("/my-hours")} />
            <KBButton className="w-full" icon={FileText} label="Meine Dokumente" onClick={() => navigate("/my-documents")} />
            <KBButton className="w-full" icon={ClipboardList} iconClassName="text-kb-green" label="Erstaufnahme erstellen" onClick={() => { setErstaufnahmePrefill(undefined); setShowErstaufnahme(true); }} />
            <KBButton className="w-full" icon={Paintbrush} label="Zeichnung erstellen" onClick={() => setShowDrawing(true)} />
            <KBButton className="w-full" icon={Camera} label="Fotos aufnehmen" onClick={() => setShowFotos(true)} />
          </Bereich>
          {isAdmin && <Bereich icon={Shield} title="Verwaltung">
            <KBButton className="w-full" icon={Shield} label="Admin-Bereich" onClick={() => navigate("/admin")} />
            <KBButton className="w-full" icon={HardHat} label="Mitarbeiter" onClick={() => navigate("/employees")} />
          </Bereich>}
        </nav>

        <div className="mt-4">
          <DashboardVoiceAssistant onErstaufnahme={(prefill) => { setErstaufnahmePrefill(prefill); setShowErstaufnahme(true); }} />
        </div>
        {projects.length > 0 && (
          <section className="mt-6 max-w-3xl">
            <KBSectionHeader icon={FolderKanban} title="Aktive Projekte" />
            <div className="mt-2 flex flex-col gap-2">
              {projects.map((project) => <KBButton key={project.id} className="w-full min-h-[44px]" icon={FolderKanban} label={project.name} onClick={() => navigate(`/projects/${project.id}`)} />)}
            </div>
          </section>
        )}
      </main>
      <ErstaufnahmeDialog open={showErstaufnahme} onOpenChange={setShowErstaufnahme} prefill={erstaufnahmePrefill} onFinished={(projectId) => navigate(`/projects/${projectId}`)} />
      <DrawingEditor open={showDrawing} onOpenChange={setShowDrawing} />
      <FotoAufnahme open={showFotos} onOpenChange={setShowFotos} />
    </div>
  );
}
