import { WifiOff, RefreshCw, CheckCircle2 } from "lucide-react";
import { useOnlineStatus, usePendingCount } from "@/hooks/useOffline";
import { cn } from "@/lib/utils";

// Schmale Statusleiste am oberen Rand:
// - Offline: rot/orange "Kein Internet – wird gespeichert"
// - Online mit offenen Einträgen: "X werden synchronisiert…" + manueller Sync-Button
// - Online ohne offene Einträge: nichts anzeigen
export function OfflineBanner() {
  const online = useOnlineStatus();
  const { pending, sync } = usePendingCount();

  if (online && pending === 0) return null;

  return (
    <div
      className={cn(
        "w-full text-sm px-3 py-2 flex items-center justify-center gap-2 sticky top-0 z-[60]",
        online ? "bg-primary/10 text-primary" : "bg-amber-500/15 text-amber-700"
      )}
      role="status"
    >
      {!online ? (
        <>
          <WifiOff className="h-4 w-4 shrink-0" />
          <span>
            Kein Internet – Eingaben werden lokal gespeichert
            {pending > 0 ? ` (${pending} offen)` : ""} und automatisch gesendet, sobald wieder Netz da ist.
          </span>
        </>
      ) : (
        <>
          <RefreshCw className="h-4 w-4 shrink-0 animate-spin" />
          <span>{pending} {pending === 1 ? "Eintrag wird" : "Einträge werden"} synchronisiert…</span>
          <button
            type="button"
            onClick={sync}
            className="underline underline-offset-2 hover:opacity-80 ml-1"
          >
            Jetzt senden
          </button>
        </>
      )}
    </div>
  );
}

// Kleiner Erfolg-Hinweis (optional wiederverwendbar)
export function OfflineSavedHint() {
  return (
    <span className="inline-flex items-center gap-1 text-xs text-amber-700">
      <CheckCircle2 className="h-3.5 w-3.5" /> Offline gespeichert
    </span>
  );
}
