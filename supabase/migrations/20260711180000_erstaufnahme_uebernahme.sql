-- Erstaufnahme (vereinfachte Vor-Ort-Aufnahme) + Übernahmebestätigung

-- Konfigurierbare Checklisten-Punkte für die Erstaufnahme (vor Ort anpassbar)
CREATE TABLE public.erstaufnahme_checklist_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  text text NOT NULL,
  sort_order integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE public.erstaufnahme_checklist_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view checklist items"
ON public.erstaufnahme_checklist_items FOR SELECT TO authenticated USING (true);

CREATE POLICY "Authenticated users can manage checklist items"
ON public.erstaufnahme_checklist_items FOR ALL TO authenticated
USING (true) WITH CHECK (true);

CREATE TRIGGER update_erstaufnahme_checklist_items_updated_at
BEFORE UPDATE ON public.erstaufnahme_checklist_items
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Standard-Checkliste für Installateure (Wärme/Kälte/Regelung)
INSERT INTO public.erstaufnahme_checklist_items (text, sort_order) VALUES
  ('Bestehende Anlage (Typ, Hersteller, Baujahr)', 1),
  ('Aufstellort & Zugänglichkeit', 2),
  ('Elektroanschluss / Zählerkasten', 3),
  ('Wasser- & Abflussanschluss vorhanden', 4),
  ('Platzverhältnisse / Maße', 5),
  ('Kundenwunsch / gewünschte Lösung', 6),
  ('Besonderheiten / Material', 7);

-- Erstaufnahmen
CREATE TABLE public.erstaufnahmen (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid REFERENCES public.customers(id) ON DELETE SET NULL,
  project_id uuid REFERENCES public.projects(id) ON DELETE SET NULL,
  projekt_name text,
  notizen text,
  checklist jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE public.erstaufnahmen ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view erstaufnahmen"
ON public.erstaufnahmen FOR SELECT TO authenticated USING (true);

CREATE POLICY "Authenticated users can create erstaufnahmen"
ON public.erstaufnahmen FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "Authenticated users can update erstaufnahmen"
ON public.erstaufnahmen FOR UPDATE TO authenticated USING (true);

CREATE POLICY "Admins can delete erstaufnahmen"
ON public.erstaufnahmen FOR DELETE TO authenticated
USING (public.has_role(auth.uid(), 'administrator'));

CREATE TRIGGER update_erstaufnahmen_updated_at
BEFORE UPDATE ON public.erstaufnahmen
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX idx_erstaufnahmen_project_id ON public.erstaufnahmen(project_id);

-- Übernahmebestätigungen (Formular lt. Vorlage, PDF landet im Projektordner)
CREATE TABLE public.uebernahmen (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  kunde_name text NOT NULL,
  strasse text,
  plz_ort text,
  auftrag_nr text,
  zusatz_leistungen text,
  leistungsverzeichnis text,
  bedienungsanleitung boolean NOT NULL DEFAULT false,
  ort text,
  datum date NOT NULL DEFAULT CURRENT_DATE,
  unterschrift text,
  pdf_path text,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE public.uebernahmen ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view uebernahmen"
ON public.uebernahmen FOR SELECT TO authenticated USING (true);

CREATE POLICY "Authenticated users can create uebernahmen"
ON public.uebernahmen FOR INSERT TO authenticated WITH CHECK (true);

-- Nach Unterschrift unveränderlich: UPDATE nur solange keine Unterschrift gespeichert ist
-- (das Setzen der Unterschrift selbst startet von unterschrift IS NULL)
CREATE POLICY "Authenticated users can update unsigned uebernahmen"
ON public.uebernahmen FOR UPDATE TO authenticated
USING (unterschrift IS NULL);

CREATE POLICY "Admins can delete uebernahmen"
ON public.uebernahmen FOR DELETE TO authenticated
USING (public.has_role(auth.uid(), 'administrator'));

CREATE TRIGGER update_uebernahmen_updated_at
BEFORE UPDATE ON public.uebernahmen
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX idx_uebernahmen_project_id ON public.uebernahmen(project_id);
