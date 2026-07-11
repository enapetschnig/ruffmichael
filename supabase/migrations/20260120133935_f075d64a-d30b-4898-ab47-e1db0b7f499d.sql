-- Tabelle für Störungen/Service-Einsätze
CREATE TABLE public.disturbances (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  
  -- Einsatzdaten
  datum DATE NOT NULL,
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  pause_minutes INTEGER NOT NULL DEFAULT 0,
  stunden NUMERIC NOT NULL,
  
  -- Kundendaten
  kunde_name TEXT NOT NULL,
  kunde_email TEXT,
  kunde_adresse TEXT,
  kunde_telefon TEXT,
  
  -- Arbeitsdetails
  beschreibung TEXT NOT NULL,
  notizen TEXT,
  
  -- Status für PDF-Generierung (N8N)
  status TEXT NOT NULL DEFAULT 'offen',
  pdf_gesendet_am TIMESTAMPTZ
);

-- Tabelle für verwendete Materialien bei Störungen
CREATE TABLE public.disturbance_materials (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  disturbance_id UUID NOT NULL REFERENCES public.disturbances(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  material TEXT NOT NULL,
  menge TEXT,
  notizen TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Erweiterung time_entries um disturbance_id
ALTER TABLE public.time_entries 
ADD COLUMN disturbance_id UUID REFERENCES public.disturbances(id) ON DELETE SET NULL;

-- RLS aktivieren
ALTER TABLE public.disturbances ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.disturbance_materials ENABLE ROW LEVEL SECURITY;

-- RLS Policies für disturbances
CREATE POLICY "Users can view own disturbances"
ON public.disturbances FOR SELECT
USING (auth.uid() = user_id);

CREATE POLICY "Admins can view all disturbances"
ON public.disturbances FOR SELECT
USING (has_role(auth.uid(), 'administrator'::app_role));

CREATE POLICY "Users can insert own disturbances"
ON public.disturbances FOR INSERT
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own disturbances"
ON public.disturbances FOR UPDATE
USING (auth.uid() = user_id);

CREATE POLICY "Admins can update all disturbances"
ON public.disturbances FOR UPDATE
USING (has_role(auth.uid(), 'administrator'::app_role));

CREATE POLICY "Users can delete own disturbances"
ON public.disturbances FOR DELETE
USING (auth.uid() = user_id);

CREATE POLICY "Admins can delete all disturbances"
ON public.disturbances FOR DELETE
USING (has_role(auth.uid(), 'administrator'::app_role));

-- RLS Policies für disturbance_materials
CREATE POLICY "Authenticated users can view disturbance materials"
ON public.disturbance_materials FOR SELECT
USING (auth.uid() IS NOT NULL);

CREATE POLICY "Users can insert own disturbance materials"
ON public.disturbance_materials FOR INSERT
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own disturbance materials"
ON public.disturbance_materials FOR UPDATE
USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own disturbance materials"
ON public.disturbance_materials FOR DELETE
USING (auth.uid() = user_id);

CREATE POLICY "Admins can delete any disturbance materials"
ON public.disturbance_materials FOR DELETE
USING (has_role(auth.uid(), 'administrator'::app_role));

-- Trigger für updated_at
CREATE TRIGGER update_disturbances_updated_at
BEFORE UPDATE ON public.disturbances
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_disturbance_materials_updated_at
BEFORE UPDATE ON public.disturbance_materials
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();