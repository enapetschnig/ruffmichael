import * as React from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Home } from "lucide-react";
import { cn } from "@/lib/utils";
import { AenderungswunschKnopf } from "@/components/aenderungswunsch/AenderungswunschKnopf";

export interface KBToolbarProps {
  onBack?: () => void;
  backLabel?: string;
  title?: string;
  children?: React.ReactNode;
  rightActions?: React.ReactNode;
  className?: string;
  sticky?: boolean;
  showHome?: boolean;
  onHome?: () => void;
}

export function KBToolbar({
  onBack,
  backLabel = "Zurück",
  title,
  children,
  rightActions,
  className,
  sticky = true,
  showHome,
  onHome,
}: KBToolbarProps) {
  const navigate = useNavigate();
  // „Zurück" ist Browser-Verlauf und kann beliebig viele Schritte von der
  // Startmaske entfernt sein — der Haus-Knopf ist der garantierte Heimweg.
  const homeSichtbar = showHome ?? sticky;
  return (
    <header data-seitenkopf className={cn("kb-toolbar flex-wrap", sticky && "sticky top-0 z-40", className)}>
      {onBack && (
        <button
          type="button"
          onClick={onBack}
          aria-label={backLabel}
          title={backLabel}
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-kb-blue-dark bg-gradient-to-b from-white to-[hsl(213_30%_88%)] shadow-md transition-transform hover:brightness-105 active:translate-y-px"
        >
          <ArrowLeft className="h-5 w-5 text-kb-blue-dark" strokeWidth={3} />
        </button>
      )}
      {title && (
        <h1 className="mr-2 min-w-0 flex-1 truncate text-base font-bold text-white sm:flex-none sm:max-w-[50%] [text-shadow:0_1px_2px_rgba(0,40,90,0.55)]">
          {title}
        </h1>
      )}
      {children && (
        <div className="order-last flex w-full min-w-0 flex-wrap items-center gap-2 sm:order-none sm:w-auto sm:flex-1 sm:basis-80">
          {children}
        </div>
      )}
      <div className="ml-auto flex shrink-0 items-center gap-2">
          {/* Änderung melden — auf jeder Maske mit Toolbar erreichbar
              (Kundenwunsch 26.08.2026, wie bei CS Powermetall). */}
          <span data-bildschirmfoto="aus"><AenderungswunschKnopf gestalt="kopf" /></span>
          {rightActions}
          {homeSichtbar && (
            <button
              type="button"
              data-bildschirmfoto="aus"
              onClick={onHome || (() => navigate("/"))}
              aria-label="Zum Hauptmenü"
              title="Zum Hauptmenü"
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-kb-blue-dark bg-gradient-to-b from-white to-[hsl(213_30%_88%)] shadow-md transition-transform hover:brightness-105 active:translate-y-px"
            >
              <Home className="h-5 w-5 text-kb-blue-dark" strokeWidth={2.5} />
            </button>
          )}
      </div>
    </header>
  );
}
