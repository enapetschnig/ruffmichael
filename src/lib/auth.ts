import { supabase } from "@/integrations/supabase/client";

// Offline-sicher: liest den angemeldeten Benutzer aus der LOKAL gespeicherten
// Session (kein Netz-Call). Im Gegensatz dazu validiert supabase.auth.getUser()
// den Token gegen den Server und schlägt OHNE Internet fehl – was jede
// Erfassung blockieren würde, bevor die Offline-Warteschlange greift.
// Daher in allen Erfassungs-/Erstell-Pfaden diesen Helfer statt getUser() nutzen.
export async function getSessionUser() {
  const { data: { session } } = await supabase.auth.getSession();
  return session?.user ?? null;
}
