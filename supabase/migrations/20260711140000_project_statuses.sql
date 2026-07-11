-- Projekt-Ampel: konfigurierbare Zustände mit Farben
CREATE TABLE public.project_statuses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  color text NOT NULL DEFAULT '#eab308',
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE public.project_statuses ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view project statuses"
ON public.project_statuses FOR SELECT TO authenticated USING (true);

CREATE POLICY "Admins can insert project statuses"
ON public.project_statuses FOR INSERT TO authenticated
WITH CHECK (public.has_role(auth.uid(), 'administrator'));

CREATE POLICY "Admins can update project statuses"
ON public.project_statuses FOR UPDATE TO authenticated
USING (public.has_role(auth.uid(), 'administrator'));

CREATE POLICY "Admins can delete project statuses"
ON public.project_statuses FOR DELETE TO authenticated
USING (public.has_role(auth.uid(), 'administrator'));

CREATE TRIGGER update_project_statuses_updated_at
BEFORE UPDATE ON public.project_statuses
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- Standard-Zustände (Ampel)
INSERT INTO public.project_statuses (name, color, sort_order) VALUES
  ('Angebot angenommen', '#22c55e', 1),
  ('Warte auf Angebotsbestätigung', '#eab308', 2),
  ('Angebot nicht angenommen', '#ef4444', 3),
  ('Projekt abgeschlossen', '#f97316', 4);

ALTER TABLE public.projects
ADD COLUMN status_id uuid REFERENCES public.project_statuses(id) ON DELETE SET NULL;
