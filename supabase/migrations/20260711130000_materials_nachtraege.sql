-- Materialdatenbank + Nachträge
-- WICHTIG: Preise liegen in einer eigenen Tabelle (material_prices) mit Admin-only-RLS.
-- Mitarbeiter können Preise dadurch technisch nicht lesen — nicht nur ausgeblendet.

CREATE TABLE public.materials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  einheit text,
  kategorie text NOT NULL DEFAULT 'Material',
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE public.materials ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view materials"
ON public.materials FOR SELECT
TO authenticated
USING (true);

CREATE POLICY "Admins can insert materials"
ON public.materials FOR INSERT
TO authenticated
WITH CHECK (public.has_role(auth.uid(), 'administrator'));

CREATE POLICY "Admins can update materials"
ON public.materials FOR UPDATE
TO authenticated
USING (public.has_role(auth.uid(), 'administrator'));

CREATE POLICY "Admins can delete materials"
ON public.materials FOR DELETE
TO authenticated
USING (public.has_role(auth.uid(), 'administrator'));

CREATE TRIGGER update_materials_updated_at
BEFORE UPDATE ON public.materials
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- Preise: NUR Administratoren (SELECT/INSERT/UPDATE/DELETE)
CREATE TABLE public.material_prices (
  material_id uuid PRIMARY KEY REFERENCES public.materials(id) ON DELETE CASCADE,
  einkaufspreis numeric(12,2),
  verkaufspreis numeric(12,2),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE public.material_prices ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage material prices"
ON public.material_prices FOR ALL
TO authenticated
USING (public.has_role(auth.uid(), 'administrator'))
WITH CHECK (public.has_role(auth.uid(), 'administrator'));

CREATE TRIGGER update_material_prices_updated_at
BEFORE UPDATE ON public.material_prices
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- Nachträge: immer projektbezogen, mit Kundenunterschrift
CREATE TABLE public.nachtraege (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  titel text NOT NULL,
  beschreibung text,
  status text NOT NULL DEFAULT 'offen' CHECK (status IN ('offen', 'unterschrieben')),
  unterschrift_kunde text,
  unterschrieben_am timestamp with time zone,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE public.nachtraege ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view nachtraege"
ON public.nachtraege FOR SELECT TO authenticated USING (true);

CREATE POLICY "Authenticated users can create nachtraege"
ON public.nachtraege FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "Authenticated users can update nachtraege"
ON public.nachtraege FOR UPDATE TO authenticated USING (true);

CREATE POLICY "Admins can delete nachtraege"
ON public.nachtraege FOR DELETE TO authenticated
USING (public.has_role(auth.uid(), 'administrator'));

CREATE TRIGGER update_nachtraege_updated_at
BEFORE UPDATE ON public.nachtraege
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX idx_nachtraege_project_id ON public.nachtraege(project_id);

-- Materialpositionen eines Nachtrags (Name als Snapshot, optional Katalog-Referenz)
CREATE TABLE public.nachtrag_materials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nachtrag_id uuid NOT NULL REFERENCES public.nachtraege(id) ON DELETE CASCADE,
  material_id uuid REFERENCES public.materials(id) ON DELETE SET NULL,
  material text NOT NULL,
  menge text,
  einheit text,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE public.nachtrag_materials ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view nachtrag materials"
ON public.nachtrag_materials FOR SELECT TO authenticated USING (true);

CREATE POLICY "Authenticated users can create nachtrag materials"
ON public.nachtrag_materials FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "Authenticated users can update nachtrag materials"
ON public.nachtrag_materials FOR UPDATE TO authenticated USING (true);

CREATE POLICY "Authenticated users can delete nachtrag materials"
ON public.nachtrag_materials FOR DELETE TO authenticated USING (true);

CREATE INDEX idx_nachtrag_materials_nachtrag_id ON public.nachtrag_materials(nachtrag_id);
