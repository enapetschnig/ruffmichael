-- Phase 1: Storage Bucket Limits auf 50 MB erhöhen
UPDATE storage.buckets 
SET file_size_limit = 52428800 
WHERE id IN ('project-plans', 'project-reports', 'project-photos', 'project-materials');

-- Phase 3: Mitarbeiter-Stammdaten Tabelle
CREATE TABLE IF NOT EXISTS public.employees (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  
  -- Persönliche Daten
  vorname text NOT NULL,
  nachname text NOT NULL,
  geburtsdatum date,
  
  -- Kontaktdaten
  adresse text,
  plz text,
  ort text,
  land text DEFAULT 'Österreich',
  telefon text,
  email text,
  
  -- Arbeitsrechtliche Daten
  sv_nummer text,
  eintritt_datum date,
  austritt_datum date,
  position text DEFAULT 'Mitarbeiter',
  beschaeftigung_art text,
  stundenlohn numeric(10, 2),
  
  -- Bankverbindung
  iban text,
  bic text,
  bank_name text,
  
  -- Arbeitskleidung
  kleidungsgroesse text,
  schuhgroesse text,
  
  -- Sonstiges
  notizen text,
  
  -- Metadaten
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now()
);

-- RLS aktivieren
ALTER TABLE public.employees ENABLE ROW LEVEL SECURITY;

-- Admins können alles sehen und bearbeiten
CREATE POLICY "Admins can view all employees"
  ON public.employees FOR SELECT
  USING (has_role(auth.uid(), 'administrator'));

CREATE POLICY "Admins can insert employees"
  ON public.employees FOR INSERT
  WITH CHECK (has_role(auth.uid(), 'administrator'));

CREATE POLICY "Admins can update employees"
  ON public.employees FOR UPDATE
  USING (has_role(auth.uid(), 'administrator'));

CREATE POLICY "Admins can delete employees"
  ON public.employees FOR DELETE
  USING (has_role(auth.uid(), 'administrator'));

-- Mitarbeiter können nur ihre eigenen Daten lesen
CREATE POLICY "Users can view own employee data"
  ON public.employees FOR SELECT
  USING (auth.uid() = user_id);

-- Trigger für updated_at
CREATE TRIGGER update_employees_updated_at
  BEFORE UPDATE ON public.employees
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Storage Bucket für Mitarbeiter-Dokumente
INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('employee-documents', 'employee-documents', false, 52428800)
ON CONFLICT (id) DO NOTHING;

-- RLS Policies für employee-documents
CREATE POLICY "Admins can upload employee documents"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'employee-documents' 
    AND has_role(auth.uid(), 'administrator')
  );

CREATE POLICY "Admins can view all employee documents"
  ON storage.objects FOR SELECT
  USING (
    bucket_id = 'employee-documents' 
    AND has_role(auth.uid(), 'administrator')
  );

CREATE POLICY "Users can view own documents"
  ON storage.objects FOR SELECT
  USING (
    bucket_id = 'employee-documents' 
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

CREATE POLICY "Admins can delete employee documents"
  ON storage.objects FOR DELETE
  USING (
    bucket_id = 'employee-documents' 
    AND has_role(auth.uid(), 'administrator')
  );