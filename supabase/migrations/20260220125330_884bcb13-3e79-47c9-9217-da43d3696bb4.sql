
-- Tabelle für Rechnungen und Angebote
CREATE TABLE public.invoices (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  project_id UUID REFERENCES public.projects(id),
  typ TEXT NOT NULL DEFAULT 'rechnung' CHECK (typ IN ('rechnung', 'angebot')),
  nummer TEXT NOT NULL UNIQUE,
  laufnummer INTEGER NOT NULL,
  jahr INTEGER NOT NULL DEFAULT EXTRACT(YEAR FROM now()),
  status TEXT NOT NULL DEFAULT 'entwurf' CHECK (status IN ('entwurf', 'gesendet', 'bezahlt', 'storniert', 'abgelehnt', 'angenommen')),
  
  -- Kundendaten
  kunde_name TEXT NOT NULL,
  kunde_adresse TEXT,
  kunde_plz TEXT,
  kunde_ort TEXT,
  kunde_land TEXT DEFAULT 'Österreich',
  kunde_email TEXT,
  kunde_telefon TEXT,
  kunde_uid TEXT,
  
  -- Rechnungsdetails
  datum DATE NOT NULL DEFAULT CURRENT_DATE,
  faellig_am DATE,
  leistungsdatum DATE,
  zahlungsbedingungen TEXT DEFAULT '14 Tage netto',
  notizen TEXT,
  
  -- Beträge (werden aus Positionen berechnet, hier als Cache)
  netto_summe NUMERIC NOT NULL DEFAULT 0,
  mwst_satz NUMERIC NOT NULL DEFAULT 20,
  mwst_betrag NUMERIC NOT NULL DEFAULT 0,
  brutto_summe NUMERIC NOT NULL DEFAULT 0,
  
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Positionen / Zeilen
CREATE TABLE public.invoice_items (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  invoice_id UUID NOT NULL REFERENCES public.invoices(id) ON DELETE CASCADE,
  position INTEGER NOT NULL DEFAULT 1,
  beschreibung TEXT NOT NULL,
  menge NUMERIC NOT NULL DEFAULT 1,
  einheit TEXT DEFAULT 'Stk.',
  einzelpreis NUMERIC NOT NULL DEFAULT 0,
  gesamtpreis NUMERIC NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- RLS aktivieren
ALTER TABLE public.invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invoice_items ENABLE ROW LEVEL SECURITY;

-- RLS Policies für invoices
CREATE POLICY "Users can view own invoices" ON public.invoices FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Admins can view all invoices" ON public.invoices FOR SELECT USING (has_role(auth.uid(), 'administrator'::app_role));
CREATE POLICY "Users can insert own invoices" ON public.invoices FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own invoices" ON public.invoices FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Admins can update all invoices" ON public.invoices FOR UPDATE USING (has_role(auth.uid(), 'administrator'::app_role));
CREATE POLICY "Users can delete own invoices" ON public.invoices FOR DELETE USING (auth.uid() = user_id);
CREATE POLICY "Admins can delete all invoices" ON public.invoices FOR DELETE USING (has_role(auth.uid(), 'administrator'::app_role));

-- RLS Policies für invoice_items (über parent invoice)
CREATE POLICY "Users can view own invoice items" ON public.invoice_items FOR SELECT 
  USING (EXISTS (SELECT 1 FROM public.invoices WHERE invoices.id = invoice_items.invoice_id AND (invoices.user_id = auth.uid() OR has_role(auth.uid(), 'administrator'::app_role))));
CREATE POLICY "Users can insert own invoice items" ON public.invoice_items FOR INSERT 
  WITH CHECK (EXISTS (SELECT 1 FROM public.invoices WHERE invoices.id = invoice_items.invoice_id AND (invoices.user_id = auth.uid() OR has_role(auth.uid(), 'administrator'::app_role))));
CREATE POLICY "Users can update own invoice items" ON public.invoice_items FOR UPDATE 
  USING (EXISTS (SELECT 1 FROM public.invoices WHERE invoices.id = invoice_items.invoice_id AND (invoices.user_id = auth.uid() OR has_role(auth.uid(), 'administrator'::app_role))));
CREATE POLICY "Users can delete own invoice items" ON public.invoice_items FOR DELETE 
  USING (EXISTS (SELECT 1 FROM public.invoices WHERE invoices.id = invoice_items.invoice_id AND (invoices.user_id = auth.uid() OR has_role(auth.uid(), 'administrator'::app_role))));

-- Funktion für fortlaufende Nummer
CREATE OR REPLACE FUNCTION public.next_invoice_number(p_typ TEXT, p_jahr INTEGER DEFAULT EXTRACT(YEAR FROM now())::INTEGER)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  prefix TEXT;
  next_num INTEGER;
  result TEXT;
BEGIN
  IF p_typ = 'rechnung' THEN prefix := 'RE';
  ELSIF p_typ = 'angebot' THEN prefix := 'AN';
  ELSE RAISE EXCEPTION 'Ungültiger Typ: %', p_typ;
  END IF;

  SELECT COALESCE(MAX(laufnummer), 0) + 1 INTO next_num
  FROM public.invoices
  WHERE typ = p_typ AND jahr = p_jahr;

  result := prefix || '-' || p_jahr || '-' || LPAD(next_num::TEXT, 3, '0');
  RETURN result;
END;
$$;

-- Updated_at Trigger
CREATE TRIGGER update_invoices_updated_at
  BEFORE UPDATE ON public.invoices
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();
