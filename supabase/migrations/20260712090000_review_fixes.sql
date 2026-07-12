-- Fixes aus dem flächendeckenden Review

-- 1) Nachtrag unterschreiben war komplett kaputt: die UPDATE-Policy hatte kein
--    WITH CHECK, wodurch Postgres den USING-Ausdruck (status='offen') auch auf
--    die NEUE Zeile anwendet -> der Übergang offen->unterschrieben schlug immer fehl.
DROP POLICY IF EXISTS "Authenticated users can update open nachtraege" ON public.nachtraege;
CREATE POLICY "Authenticated users can update open nachtraege"
ON public.nachtraege FOR UPDATE TO authenticated
USING (status = 'offen')
WITH CHECK (true);

-- Analog für Übernahmebestätigungen (unsigniert -> signiert erlauben, danach gesperrt)
DROP POLICY IF EXISTS "Authenticated users can update unsigned uebernahmen" ON public.uebernahmen;
CREATE POLICY "Authenticated users can update unsigned uebernahmen"
ON public.uebernahmen FOR UPDATE TO authenticated
USING (unterschrift IS NULL)
WITH CHECK (true);

-- 2) Projekt-Ampel: Mitarbeiter (nicht nur Admins) dürfen den Status setzen.
--    Bisher gab es nur eine Admin-UPDATE-Policy -> Klick verpuffte lautlos.
DROP POLICY IF EXISTS "Authenticated users can update projects" ON public.projects;
CREATE POLICY "Authenticated users can update projects"
ON public.projects FOR UPDATE TO authenticated
USING (true) WITH CHECK (true);

-- 3) Admin konnte Materialzeilen eines Regieberichts nicht bearbeiten
--    (nur eigene per user_id). Admin-UPDATE-Policy ergänzen.
DROP POLICY IF EXISTS "Admins can update disturbance materials" ON public.disturbance_materials;
CREATE POLICY "Admins can update disturbance materials"
ON public.disturbance_materials FOR UPDATE TO authenticated
USING (public.has_role(auth.uid(), 'administrator'))
WITH CHECK (public.has_role(auth.uid(), 'administrator'));
