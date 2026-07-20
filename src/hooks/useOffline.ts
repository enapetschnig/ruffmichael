import { useEffect, useState, useCallback } from "react";
import { count, onOutboxChange, processOutbox } from "@/lib/offlineQueue";

// Online/Offline-Status des Geräts
export function useOnlineStatus(): boolean {
  const [online, setOnline] = useState<boolean>(
    typeof navigator !== "undefined" ? navigator.onLine : true
  );
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);
  return online;
}

// Anzahl der noch nicht synchronisierten Einträge (Zeiten + Uploads)
export function usePendingCount(): { pending: number; sync: () => void } {
  const [pending, setPending] = useState(0);

  const refresh = useCallback(() => {
    count().then(setPending).catch(() => {});
  }, []);

  useEffect(() => {
    refresh();
    const unsub = onOutboxChange(refresh);
    return () => { unsub(); };
  }, [refresh]);

  const sync = useCallback(() => {
    processOutbox().then(refresh).catch(() => {});
  }, [refresh]);

  return { pending, sync };
}
