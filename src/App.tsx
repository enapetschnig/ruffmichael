import { useEffect, useState } from "react";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, useLocation, Navigate } from "react-router-dom";
import { OnboardingProvider } from "./contexts/OnboardingContext";
import { InstallPromptDialog } from "./components/InstallPromptDialog";
import { OfflineBanner } from "./components/OfflineBanner";
import { AenderungswunschKnopf } from "./components/aenderungswunsch/AenderungswunschKnopf";
import { useOnboarding } from "./contexts/OnboardingContext";
import { supabase } from "@/integrations/supabase/client";
import { startAutoSync } from "@/lib/offlineQueue";
import Index from "./pages/Index";
import Auth from "./pages/Auth";
import TimeTracking from "./pages/TimeTracking";
import Projects from "./pages/Projects";
import ProjectDetail from "./pages/ProjectDetail";
import ProjectOverview from "./pages/ProjectOverview";
import MyHours from "./pages/MyHours";
import MyDocuments from "./pages/MyDocuments";
import Reports from "./pages/Reports";
import Admin from "./pages/Admin";
import HoursReport from "./pages/HoursReport";
import Employees from "./pages/Employees";
import MaterialList from "./pages/MaterialList";
import Disturbances from "./pages/Disturbances";
import DisturbanceDetail from "./pages/DisturbanceDetail";
import Customers from "./pages/Customers";
import ProjectFiles from "./pages/ProjectFiles";
import MaterialCatalog from "./pages/MaterialCatalog";
import Nachtraege from "./pages/Nachtraege";
import Uebernahmen from "./pages/Uebernahmen";
import Belege from "./pages/Belege";
import BelegDetail from "./pages/BelegDetail";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

/**
 * Melde-Knopf für alle Seiten, die ihre Kopfzeile selbst bauen (Startseite,
 * Projekte, Admin …) und deshalb den Knopf aus dem PageHeader nicht bekommen.
 * Er blendet sich selbst aus, sobald auf der Seite ein [data-seitenkopf] steht.
 * Auf der Anmeldeseite und ohne Anmeldung gibt es ihn nicht — melden kann nur,
 * wer angemeldet ist (die RLS verlangt eine eigene Benutzerkennung).
 */
function SchwebenderMeldeKnopf() {
  const ort = useLocation();
  const [angemeldet, setAngemeldet] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setAngemeldet(!!data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, sitzung) =>
      setAngemeldet(!!sitzung),
    );
    return () => sub.subscription.unsubscribe();
  }, []);

  if (!angemeldet || ort.pathname === "/auth") return null;
  return <AenderungswunschKnopf gestalt="schwebend" />;
}

/**
 * Anmeldeschutz für alle Seiten außer der Anmeldeseite.
 *
 * Vorher brachten nur manche Seiten ihre eigene Prüfung mit — zehn Seiten
 * (Zeiterfassung, Projekte, Meine Stunden …) zeigten ihre Oberfläche auch
 * ohne Anmeldung. Daten kamen zwar keine (das verhindert die Datenbank),
 * aber die App wirkte kaputt und man konnte Formulare ins Leere ausfüllen.
 * Diese eine Stelle schützt jetzt alle Routen.
 */
function NurAngemeldet({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<"prueft" | "ja" | "nein">("prueft");

  useEffect(() => {
    let aktiv = true;
    supabase.auth.getSession().then(({ data }) => {
      if (aktiv) setStatus(data.session ? "ja" : "nein");
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, sitzung) => {
      if (aktiv) setStatus(sitzung ? "ja" : "nein");
    });
    return () => { aktiv = false; sub.subscription.unsubscribe(); };
  }, []);

  if (status === "prueft") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <p className="text-muted-foreground text-sm">Einen Moment…</p>
      </div>
    );
  }
  if (status === "nein") return <Navigate to="/auth" replace />;
  return <>{children}</>;
}

function AppContent() {
  const {
    showInstallDialog,
    setShowInstallDialog,
    handleInstallDialogClose,
  } = useOnboarding();

  // Ensure user profile exists (for users created via Cloud dashboard)
  useEffect(() => {
    const ensureProfile = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        await supabase.rpc('ensure_user_profile');
      }
    };
    ensureProfile();
  }, []);

  // Offline-Warteschlange automatisch abarbeiten (bei "online", App-Start, periodisch)
  useEffect(() => {
    startAutoSync();
  }, []);

  return (
    <>
      <OfflineBanner />
      <Routes>
        <Route path="/" element={<NurAngemeldet><Index /></NurAngemeldet>} />
        <Route path="/auth" element={<Auth />} />
        <Route path="/time-tracking" element={<NurAngemeldet><TimeTracking /></NurAngemeldet>} />
        <Route path="/projects" element={<NurAngemeldet><Projects /></NurAngemeldet>} />
        <Route path="/projects/:projectId" element={<NurAngemeldet><ProjectOverview /></NurAngemeldet>} />
        <Route path="/projects/:projectId/files" element={<NurAngemeldet><ProjectFiles /></NurAngemeldet>} />
        <Route path="/projects/:projectId/:type" element={<NurAngemeldet><ProjectDetail /></NurAngemeldet>} />
        <Route path="/projects/:projectId/materials" element={<NurAngemeldet><MaterialList /></NurAngemeldet>} />
        <Route path="/my-hours" element={<NurAngemeldet><MyHours /></NurAngemeldet>} />
        <Route path="/my-documents" element={<NurAngemeldet><MyDocuments /></NurAngemeldet>} />
        <Route path="/reports" element={<NurAngemeldet><Reports /></NurAngemeldet>} />
        <Route path="/admin" element={<NurAngemeldet><Admin /></NurAngemeldet>} />
        <Route path="/hours-report" element={<NurAngemeldet><HoursReport /></NurAngemeldet>} />
        <Route path="/employees" element={<NurAngemeldet><Employees /></NurAngemeldet>} />
        <Route path="/disturbances" element={<NurAngemeldet><Disturbances /></NurAngemeldet>} />
        <Route path="/disturbances/:id" element={<NurAngemeldet><DisturbanceDetail /></NurAngemeldet>} />
        <Route path="/customers" element={<NurAngemeldet><Customers /></NurAngemeldet>} />
        <Route path="/materialien" element={<NurAngemeldet><MaterialCatalog /></NurAngemeldet>} />
        <Route path="/nachtraege" element={<NurAngemeldet><Nachtraege /></NurAngemeldet>} />
        <Route path="/uebernahmen" element={<NurAngemeldet><Uebernahmen /></NurAngemeldet>} />
        <Route path="/belege" element={<NurAngemeldet><Belege /></NurAngemeldet>} />
        <Route path="/belege/:belegId" element={<NurAngemeldet><BelegDetail /></NurAngemeldet>} />
        <Route path="*" element={<NotFound />} />
      </Routes>

      {/* Melden auch auf Seiten ohne zentrale Kopfzeile */}
      <SchwebenderMeldeKnopf />

      {/* Install Prompt Dialog */}
      <InstallPromptDialog
        open={showInstallDialog}
        onClose={handleInstallDialogClose}
        onDismiss={() => setShowInstallDialog(false)}
      />
    </>
  );
}

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <OnboardingProvider>
          <AppContent />
        </OnboardingProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
