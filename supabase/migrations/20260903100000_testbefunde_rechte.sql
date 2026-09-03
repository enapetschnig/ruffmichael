-- ============================================================================
--  Befunde aus dem Funktionstest vom 03.09.2026 — Rechte
-- ============================================================================

-- B1: Mitarbeiternamen waren ohne Anmeldung lesbar.
-- Die Leseregel galt für die Rolle „public" — die schließt nicht angemeldete
-- Besucher mit ein, und der öffentliche App-Schlüssel steht in jedem Browser.
-- Ab jetzt: nur angemeldete Benutzer. (Angemeldete brauchen einander weiterhin
-- zu sehen: Team-Buchung, Mitarbeiterauswahl, „Erfasst von" im Regiebericht.)
DROP POLICY IF EXISTS "Users can view all profiles" ON public.profiles;
CREATE POLICY "Angemeldete sehen Profile" ON public.profiles
  FOR SELECT TO authenticated USING (true);

-- Auch die Schreibregeln standen auf „public" statt „authenticated".
DROP POLICY IF EXISTS "Users can insert own profile" ON public.profiles;
CREATE POLICY "Eigenes Profil anlegen" ON public.profiles
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = id);

DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;
CREATE POLICY "Eigenes Profil ändern" ON public.profiles
  FOR UPDATE TO authenticated USING (auth.uid() = id) WITH CHECK (auth.uid() = id);

DROP POLICY IF EXISTS "Admins can update all profiles" ON public.profiles;
CREATE POLICY "Administratoren ändern alle Profile" ON public.profiles
  FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'administrator'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'administrator'::app_role));

-- B3: Die Erstaufnahme-Checkliste ist eine GLOBALE Vorlage für alle künftigen
-- Erstaufnahmen. Bisher durfte jeder Angemeldete sie umschreiben, umbenennen
-- oder Punkte deaktivieren. Lesen dürfen weiterhin alle (die Checkliste wird
-- ja ausgefüllt), ändern nur Administratoren.
DROP POLICY IF EXISTS "Authenticated users can manage checklist items" ON public.erstaufnahme_checklist_items;
DROP POLICY IF EXISTS "Authenticated users can view checklist items" ON public.erstaufnahme_checklist_items;

CREATE POLICY "Angemeldete sehen die Checkliste" ON public.erstaufnahme_checklist_items
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "Administratoren pflegen die Checkliste" ON public.erstaufnahme_checklist_items
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'administrator'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'administrator'::app_role));

NOTIFY pgrst, 'reload schema';
