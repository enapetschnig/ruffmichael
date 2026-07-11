-- Tabelle für Mitarbeiter-Zuordnung bei Störungen/Regiearbeiten
CREATE TABLE public.disturbance_workers (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  disturbance_id UUID NOT NULL REFERENCES public.disturbances(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  is_main BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Unique constraint: Ein Mitarbeiter kann nur einmal pro Störung eingetragen sein
ALTER TABLE public.disturbance_workers 
  ADD CONSTRAINT unique_disturbance_worker UNIQUE (disturbance_id, user_id);

-- Enable RLS
ALTER TABLE public.disturbance_workers ENABLE ROW LEVEL SECURITY;

-- RLS Policies für disturbance_workers
CREATE POLICY "Authenticated users can view disturbance workers"
  ON public.disturbance_workers FOR SELECT
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "Users can insert disturbance workers for own disturbances"
  ON public.disturbance_workers FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.disturbances 
      WHERE id = disturbance_id AND user_id = auth.uid()
    )
    OR has_role(auth.uid(), 'administrator'::app_role)
  );

CREATE POLICY "Users can update disturbance workers for own disturbances"
  ON public.disturbance_workers FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.disturbances 
      WHERE id = disturbance_id AND user_id = auth.uid()
    )
    OR has_role(auth.uid(), 'administrator'::app_role)
  );

CREATE POLICY "Users can delete disturbance workers for own disturbances"
  ON public.disturbance_workers FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM public.disturbances 
      WHERE id = disturbance_id AND user_id = auth.uid()
    )
    OR has_role(auth.uid(), 'administrator'::app_role)
  );

-- Tabelle für Mitarbeiter-Zuordnung bei Projekt-Zeiteinträgen
CREATE TABLE public.time_entry_workers (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  source_entry_id UUID NOT NULL REFERENCES public.time_entries(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  target_entry_id UUID NOT NULL REFERENCES public.time_entries(id) ON DELETE CASCADE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Unique constraint
ALTER TABLE public.time_entry_workers 
  ADD CONSTRAINT unique_time_entry_worker UNIQUE (source_entry_id, user_id);

-- Enable RLS
ALTER TABLE public.time_entry_workers ENABLE ROW LEVEL SECURITY;

-- RLS Policies für time_entry_workers
CREATE POLICY "Users can view own time entry workers"
  ON public.time_entry_workers FOR SELECT
  USING (
    user_id = auth.uid() 
    OR EXISTS (
      SELECT 1 FROM public.time_entries 
      WHERE id = source_entry_id AND user_id = auth.uid()
    )
    OR has_role(auth.uid(), 'administrator'::app_role)
  );

CREATE POLICY "Users can insert time entry workers for own entries"
  ON public.time_entry_workers FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.time_entries 
      WHERE id = source_entry_id AND user_id = auth.uid()
    )
    OR has_role(auth.uid(), 'administrator'::app_role)
  );

CREATE POLICY "Users can delete time entry workers for own entries"
  ON public.time_entry_workers FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM public.time_entries 
      WHERE id = source_entry_id AND user_id = auth.uid()
    )
    OR has_role(auth.uid(), 'administrator'::app_role)
  );