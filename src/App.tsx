import { useEffect, useState } from "react";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, useLocation } from "react-router-dom";
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
        <Route path="/" element={<Index />} />
        <Route path="/auth" element={<Auth />} />
        <Route path="/time-tracking" element={<TimeTracking />} />
        <Route path="/projects" element={<Projects />} />
        <Route path="/projects/:projectId" element={<ProjectOverview />} />
        <Route path="/projects/:projectId/files" element={<ProjectFiles />} />
        <Route path="/projects/:projectId/:type" element={<ProjectDetail />} />
        <Route path="/projects/:projectId/materials" element={<MaterialList />} />
        <Route path="/my-hours" element={<MyHours />} />
        <Route path="/my-documents" element={<MyDocuments />} />
        <Route path="/reports" element={<Reports />} />
        <Route path="/admin" element={<Admin />} />
        <Route path="/hours-report" element={<HoursReport />} />
        <Route path="/employees" element={<Employees />} />
        <Route path="/disturbances" element={<Disturbances />} />
        <Route path="/disturbances/:id" element={<DisturbanceDetail />} />
        <Route path="/customers" element={<Customers />} />
        <Route path="/materialien" element={<MaterialCatalog />} />
        <Route path="/nachtraege" element={<Nachtraege />} />
        <Route path="/uebernahmen" element={<Uebernahmen />} />
        <Route path="/belege" element={<Belege />} />
        <Route path="/belege/:belegId" element={<BelegDetail />} />
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
