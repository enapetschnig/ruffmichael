-- Unterschriebene Nachträge sind unveränderlich — auch auf DB-Ebene.
-- UPDATE nur solange der Nachtrag offen ist (der Unterschreiben-Übergang startet von 'offen').
DROP POLICY IF EXISTS "Authenticated users can update nachtraege" ON public.nachtraege;
CREATE POLICY "Authenticated users can update open nachtraege"
ON public.nachtraege FOR UPDATE TO authenticated
USING (status = 'offen');

-- Materialzeilen nur veränderbar, solange der zugehörige Nachtrag offen ist
DROP POLICY IF EXISTS "Authenticated users can update nachtrag materials" ON public.nachtrag_materials;
CREATE POLICY "Authenticated users can update open nachtrag materials"
ON public.nachtrag_materials FOR UPDATE TO authenticated
USING (nachtrag_id IN (SELECT id FROM public.nachtraege WHERE status = 'offen'));

DROP POLICY IF EXISTS "Authenticated users can delete nachtrag materials" ON public.nachtrag_materials;
CREATE POLICY "Authenticated users can delete open nachtrag materials"
ON public.nachtrag_materials FOR DELETE TO authenticated
USING (nachtrag_id IN (SELECT id FROM public.nachtraege WHERE status = 'offen'));

DROP POLICY IF EXISTS "Authenticated users can create nachtrag materials" ON public.nachtrag_materials;
CREATE POLICY "Authenticated users can create open nachtrag materials"
ON public.nachtrag_materials FOR INSERT TO authenticated
WITH CHECK (nachtrag_id IN (SELECT id FROM public.nachtraege WHERE status IN ('offen', 'unterschrieben')));
