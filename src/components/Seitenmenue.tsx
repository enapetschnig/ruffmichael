import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  Home, Clock, FolderKanban, Contact, Receipt, FileText, FilePlus2, FileCheck, Package,
  BarChart3, Users, Settings, LogOut, User as UserIcon,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";

type Eintrag = { pfad: string; label: string; icon: React.ReactNode; nurAdmin?: boolean; nurMitarbeiter?: boolean };

const EINTRAEGE: Eintrag[] = [
  { pfad: "/", label: "Startseite", icon: <Home className="h-4 w-4" /> },
  { pfad: "/time-tracking", label: "Zeiterfassung", icon: <Clock className="h-4 w-4" /> },
  { pfad: "/projects", label: "Projekte", icon: <FolderKanban className="h-4 w-4" /> },
  { pfad: "/customers", label: "Kunden", icon: <Contact className="h-4 w-4" /> },
  { pfad: "/belege", label: "Angebote & Rechnungen", icon: <Receipt className="h-4 w-4" />, nurAdmin: true },
  { pfad: "/disturbances", label: "Regieberichte", icon: <FileText className="h-4 w-4" /> },
  { pfad: "/nachtraege", label: "Nachträge", icon: <FilePlus2 className="h-4 w-4" /> },
  { pfad: "/uebernahmen", label: "Übernahmen", icon: <FileCheck className="h-4 w-4" /> },
  { pfad: "/materialien", label: "Materialkatalog", icon: <Package className="h-4 w-4" /> },
  { pfad: "/my-hours", label: "Meine Stunden", icon: <Clock className="h-4 w-4" /> },
  { pfad: "/my-documents", label: "Meine Dokumente", icon: <FileText className="h-4 w-4" />, nurMitarbeiter: true },
  { pfad: "/hours-report", label: "Stundenauswertung", icon: <BarChart3 className="h-4 w-4" />, nurAdmin: true },
  { pfad: "/employees", label: "Mitarbeiter", icon: <Users className="h-4 w-4" />, nurAdmin: true },
  { pfad: "/admin", label: "Admin-Bereich", icon: <Settings className="h-4 w-4" />, nurAdmin: true },
];

/** Breite des Menüs in Tailwind-Einheiten — der Seiteninhalt rückt um genau so viel nach rechts. */
export const MENUE_BREITE = "w-60";
export const INHALT_ABSTAND = "lg:pl-60";

/**
 * Seitenmenü für große Bildschirme (ab lg). Am Handy und Tablet bleibt alles
 * wie gehabt — dort führen die Kacheln der Startseite. Am PC steht das Menü
 * links fest, damit man nicht für jeden Wechsel zur Startseite zurück muss.
 */
export function Seitenmenue() {
  const ort = useLocation();
  const navigate = useNavigate();
  const [status, setStatus] = useState<{ angemeldet: boolean; admin: boolean; name: string } | null>(null);

  useEffect(() => {
    let aktiv = true;
    const laden = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { if (aktiv) setStatus({ angemeldet: false, admin: false, name: "" }); return; }
      const [{ data: rolle }, { data: profil }] = await Promise.all([
        supabase.from("user_roles").select("role").eq("user_id", session.user.id).eq("role", "administrator").maybeSingle(),
        supabase.from("profiles").select("vorname, nachname").eq("id", session.user.id).maybeSingle(),
      ]);
      if (!aktiv) return;
      setStatus({
        angemeldet: true,
        admin: !!rolle,
        name: [profil?.vorname, profil?.nachname].filter(Boolean).join(" ") || session.user.email || "",
      });
    };
    laden();
    const { data: sub } = supabase.auth.onAuthStateChange(() => { laden(); });
    return () => { aktiv = false; sub.subscription.unsubscribe(); };
  }, []);

  if (ort.pathname === "/auth" || !status?.angemeldet) return null;

  const aktiv = (pfad: string) => (pfad === "/" ? ort.pathname === "/" : ort.pathname === pfad || ort.pathname.startsWith(pfad + "/"));
  const sichtbar = EINTRAEGE.filter((e) => (!e.nurAdmin || status.admin) && (!e.nurMitarbeiter || !status.admin));

  const abmelden = async () => {
    await supabase.auth.signOut();
    navigate("/auth");
  };

  return (
    <aside
      className={cn("hidden lg:flex fixed inset-y-0 left-0 z-40 flex-col border-r bg-card", MENUE_BREITE)}
      aria-label="Hauptmenü"
      data-bildschirmfoto="aus"
    >
      <button type="button" className="flex items-center gap-3 px-4 py-4 border-b text-left hover:bg-accent/40" onClick={() => navigate("/")}>
        <img src="/ruff-logo.png" alt="Ruff Michael" className="h-10 w-10 object-contain" />
        <div className="min-w-0">
          <div className="font-semibold leading-tight">Ruff Michael</div>
          <div className="text-xs text-muted-foreground">Installateur</div>
        </div>
      </button>
      <nav className="flex-1 overflow-y-auto py-2">
        {sichtbar.map((e) => (
          <button
            key={e.pfad}
            type="button"
            onClick={() => navigate(e.pfad)}
            aria-current={aktiv(e.pfad) ? "page" : undefined}
            className={cn(
              "w-full flex items-center gap-3 px-4 py-2.5 text-sm text-left transition-colors",
              aktiv(e.pfad) ? "bg-primary/10 text-primary font-medium border-r-2 border-primary" : "text-foreground/80 hover:bg-accent/50 hover:text-foreground",
            )}
          >
            <span className={cn("shrink-0", aktiv(e.pfad) ? "text-primary" : "text-muted-foreground")}>{e.icon}</span>
            <span className="truncate">{e.label}</span>
          </button>
        ))}
      </nav>
      <div className="border-t px-4 py-3 flex items-center gap-2">
        <UserIcon className="h-4 w-4 text-muted-foreground shrink-0" />
        <div className="min-w-0 flex-1">
          <div className="text-sm truncate">{status.name}</div>
          <div className="text-xs text-muted-foreground">{status.admin ? "Administrator" : "Mitarbeiter"}</div>
        </div>
        <button type="button" onClick={abmelden} title="Abmelden" aria-label="Abmelden" className="p-2 rounded-md hover:bg-accent/60 text-muted-foreground">
          <LogOut className="h-4 w-4" />
        </button>
      </div>
    </aside>
  );
}
