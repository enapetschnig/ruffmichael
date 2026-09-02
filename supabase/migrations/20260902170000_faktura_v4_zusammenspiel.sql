-- ============================================================================
--  FAKTURA v4 — Zusammenspiel mit dem Rest der App
-- ============================================================================

-- 1. Leiche aus dem alten Rechnungs-Anlauf: liest aus der gedroppten Tabelle invoices
DROP FUNCTION IF EXISTS public.next_invoice_number(text, integer);

-- 2. Rechnungsdaten am Kunden (Firma, UID, Unternehmer, Reverse Charge,
--    Zahlungsziel) dürfen nur Administratoren ändern. Die Kundenverwaltung
--    blendet die Felder für Mitarbeiter aus; dieser Trigger sichert es auch
--    gegen direkte Aufrufe ab. Neue Kunden durch Mitarbeiter bekommen die
--    Standardwerte (kein Reverse Charge).
CREATE OR REPLACE FUNCTION public.trg_kunde_rechnungsdaten()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.has_role(auth.uid(), 'administrator'::app_role) THEN
    IF TG_OP = 'UPDATE' AND (
         NEW.firma IS DISTINCT FROM OLD.firma
      OR NEW.uid IS DISTINCT FROM OLD.uid
      OR NEW.ist_unternehmer IS DISTINCT FROM OLD.ist_unternehmer
      OR NEW.reverse_charge IS DISTINCT FROM OLD.reverse_charge
      OR NEW.zahlungsziel_tage IS DISTINCT FROM OLD.zahlungsziel_tage
      OR NEW.kundennr IS DISTINCT FROM OLD.kundennr
    ) THEN
      RAISE EXCEPTION 'Rechnungsdaten des Kunden (Firma, UID, Reverse Charge, Zahlungsziel) können nur Administratoren ändern.';
    END IF;
    IF TG_OP = 'INSERT' THEN
      NEW.reverse_charge := false;
      NEW.ist_unternehmer := COALESCE(NEW.ist_unternehmer, false);
      NEW.zahlungsziel_tage := NULL;
      NEW.kundennr := NULL;
    END IF;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_kunde_rechnungsdaten ON public.customers;
CREATE TRIGGER trg_kunde_rechnungsdaten BEFORE INSERT OR UPDATE ON public.customers
  FOR EACH ROW EXECUTE FUNCTION public.trg_kunde_rechnungsdaten();

NOTIFY pgrst, 'reload schema';
