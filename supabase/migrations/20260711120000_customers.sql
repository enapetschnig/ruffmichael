-- Kundenverwaltung: Kunden wie im Anfrageformular (Vorname, Nachname, Straße, Ort,
-- Telefon, Mobil, Mail) plus Lieferadresse. Projekte können einem Kunden zugeordnet werden.

CREATE TABLE public.customers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vorname text NOT NULL DEFAULT '',
  nachname text NOT NULL,
  strasse text,
  ort text,
  telefon text,
  mobil text,
  email text,
  liefer_strasse text,
  liefer_ort text,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;

-- Alle angemeldeten Mitarbeiter dürfen Kunden sehen, anlegen und bearbeiten
CREATE POLICY "Authenticated users can view customers"
ON public.customers FOR SELECT
TO authenticated
USING (true);

CREATE POLICY "Authenticated users can create customers"
ON public.customers FOR INSERT
TO authenticated
WITH CHECK (true);

CREATE POLICY "Authenticated users can update customers"
ON public.customers FOR UPDATE
TO authenticated
USING (true);

-- Löschen nur für Administratoren
CREATE POLICY "Admins can delete customers"
ON public.customers FOR DELETE
TO authenticated
USING (public.has_role(auth.uid(), 'administrator'));

CREATE TRIGGER update_customers_updated_at
BEFORE UPDATE ON public.customers
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- Projekte optional einem Kunden zuordnen
ALTER TABLE public.projects
ADD COLUMN customer_id uuid REFERENCES public.customers(id) ON DELETE SET NULL;

CREATE INDEX idx_projects_customer_id ON public.projects(customer_id);
