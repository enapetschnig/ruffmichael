-- ============================================================================
--  FAKTURA v2 — Nummernformat, Angebote nachbearbeiten, Kunden-Verknüpfung
-- ============================================================================

-- ── Nummernkreise: Format frei einstellbar ──────────────────────────────────
-- Beispiel Michael: „2026-2584"  → praefix '', jahr_format 'JJJJ', trenner '-', breite 4
-- Alternativen:     „RE26-0001", „R-2584" …
ALTER TABLE public.faktura_nummernkreise
  ADD COLUMN IF NOT EXISTS praefix     text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS jahr_format text NOT NULL DEFAULT 'JJJJ' CHECK (jahr_format IN ('JJJJ','JJ','')),
  ADD COLUMN IF NOT EXISTS trenner     text NOT NULL DEFAULT '-';

CREATE OR REPLACE FUNCTION public.faktura_nummer_bauen(p_kreis text, p_nummer integer, p_datum date)
RETURNS text LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT k.praefix
      || CASE k.jahr_format
           WHEN 'JJJJ' THEN to_char(p_datum, 'YYYY') || k.trenner
           WHEN 'JJ'   THEN to_char(p_datum, 'YY')   || k.trenner
           ELSE '' END
      || lpad(p_nummer::text, k.breite, '0')
    FROM public.faktura_nummernkreise k WHERE k.kreis = p_kreis;
$$;

-- ── Festschreiben: Format anwenden; Angebote behalten ihre Nummer ───────────
CREATE OR REPLACE FUNCTION public.beleg_festschreiben(p_beleg uuid)
RETURNS public.belege LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v public.belege%ROWTYPE; v_kreis text; v_nr integer; v_jahr integer; v_nummer text;
BEGIN
  IF NOT public.has_role(auth.uid(), 'administrator'::app_role) THEN
    RAISE EXCEPTION 'Nur Administratoren dürfen Belege festschreiben.';
  END IF;
  SELECT * INTO v FROM public.belege WHERE id = p_beleg FOR UPDATE;
  IF v.id IS NULL THEN RAISE EXCEPTION 'Beleg nicht gefunden.'; END IF;
  IF v.status <> 'entwurf' THEN RAISE EXCEPTION 'Beleg ist bereits festgeschrieben (%).', v.nummer; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.beleg_positionen WHERE beleg_id = p_beleg AND art = 'position') THEN
    RAISE EXCEPTION 'Ein Beleg ohne Positionen kann nicht festgeschrieben werden.';
  END IF;
  IF v.reverse_charge AND COALESCE(v.kunde_uid,'') = '' THEN
    RAISE EXCEPTION 'Reverse Charge verlangt die UID des Kunden.';
  END IF;
  IF COALESCE(v.kunde_name,'') = '' THEN RAISE EXCEPTION 'Empfänger fehlt.'; END IF;

  v_jahr := EXTRACT(YEAR FROM v.datum)::integer;

  IF v.nummer IS NOT NULL THEN
    -- Angebot, das nach dem Bearbeiten erneut festgeschrieben wird: Nummer bleibt.
    UPDATE public.belege SET status = 'festgeschrieben', festgeschrieben_am = now()
     WHERE id = p_beleg RETURNING * INTO v;
    RETURN v;
  END IF;

  v_kreis := CASE v.typ WHEN 'angebot' THEN 'angebot' WHEN 'auftragsbestaetigung' THEN 'angebot'
                        WHEN 'gutschrift' THEN 'gutschrift' ELSE 'rechnung' END;

  -- Zähler sperren und hochzählen — nie eine Lücke, nie doppelt
  UPDATE public.faktura_nummernkreise
     SET naechste_nummer = naechste_nummer + 1, updated_at = now()
   WHERE kreis = v_kreis
   RETURNING naechste_nummer - 1 INTO v_nr;
  IF v_nr IS NULL THEN RAISE EXCEPTION 'Nummernkreis % fehlt.', v_kreis; END IF;
  v_nummer := public.faktura_nummer_bauen(v_kreis, v_nr, v.datum);

  UPDATE public.belege SET
    nummer = v_nummer, jahr = v_jahr, laufnummer = v_nr,
    status = 'festgeschrieben', festgeschrieben_am = now()
  WHERE id = p_beleg
  RETURNING * INTO v;
  RETURN v;
END $$;

-- ── Schreibschutz nur für Rechnungen und Gutschriften ──────────────────────
-- Angebote dürfen nach dem Festschreiben wieder in Bearbeitung genommen werden
-- (Status → entwurf), die Nummer bleibt. Rechnungen bleiben unveränderbar.
CREATE OR REPLACE FUNCTION public.trg_beleg_schreibschutz()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status <> 'entwurf'
     AND OLD.typ IN ('rechnung','teilrechnung','schlussrechnung','gutschrift')
     AND (
       NEW.typ IS DISTINCT FROM OLD.typ OR NEW.nummer IS DISTINCT FROM OLD.nummer
    OR NEW.status = 'entwurf'
    OR NEW.kunde_name IS DISTINCT FROM OLD.kunde_name OR NEW.kunde_strasse IS DISTINCT FROM OLD.kunde_strasse
    OR NEW.kunde_plz_ort IS DISTINCT FROM OLD.kunde_plz_ort OR NEW.kunde_uid IS DISTINCT FROM OLD.kunde_uid
    OR NEW.datum IS DISTINCT FROM OLD.datum OR NEW.leistung_von IS DISTINCT FROM OLD.leistung_von
    OR NEW.leistung_bis IS DISTINCT FROM OLD.leistung_bis OR NEW.reverse_charge IS DISTINCT FROM OLD.reverse_charge
    OR NEW.ust_satz IS DISTINCT FROM OLD.ust_satz OR NEW.betreff IS DISTINCT FROM OLD.betreff
    OR NEW.einleitung IS DISTINCT FROM OLD.einleitung OR NEW.schlusstext IS DISTINCT FROM OLD.schlusstext
    OR NEW.skonto_prozent IS DISTINCT FROM OLD.skonto_prozent OR NEW.skonto_tage IS DISTINCT FROM OLD.skonto_tage
    OR NEW.faellig_am IS DISTINCT FROM OLD.faellig_am
    OR NEW.project_id IS DISTINCT FROM OLD.project_id OR NEW.customer_id IS DISTINCT FROM OLD.customer_id
  ) THEN
    RAISE EXCEPTION 'Rechnung % ist festgeschrieben und kann nicht mehr geändert werden. Korrektur nur per Gutschrift.', OLD.nummer;
  END IF;
  -- Angebote: Nummer und Typ bleiben auch beim Nachbearbeiten fest
  IF OLD.nummer IS NOT NULL AND (NEW.nummer IS DISTINCT FROM OLD.nummer OR NEW.typ IS DISTINCT FROM OLD.typ) THEN
    RAISE EXCEPTION 'Nummer und Belegart eines vergebenen Belegs können nicht geändert werden.';
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.trg_positionen_schreibschutz()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_status text; v_nummer text; v_typ text;
BEGIN
  SELECT status, nummer, typ INTO v_status, v_nummer, v_typ FROM public.belege WHERE id = COALESCE(NEW.beleg_id, OLD.beleg_id);
  IF v_status IS NOT NULL AND v_status <> 'entwurf' AND v_typ IN ('rechnung','teilrechnung','schlussrechnung','gutschrift') THEN
    RAISE EXCEPTION 'Rechnung % ist festgeschrieben — Positionen sind unveränderbar.', v_nummer;
  END IF;
  RETURN COALESCE(NEW, OLD);
END $$;

-- Löschschutz: nur Entwürfe OHNE Nummer sind löschbar (auch Angebote behalten
-- ihre vergebene Nummer — sonst entstünden Lücken in seinem Nummernkreis).
CREATE OR REPLACE FUNCTION public.trg_beleg_loeschschutz()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status <> 'entwurf' OR OLD.nummer IS NOT NULL THEN
    RAISE EXCEPTION 'Beleg % hat eine Nummer und darf nicht gelöscht werden. Angebote auf „abgelehnt“ setzen, Rechnungen per Gutschrift stornieren.', OLD.nummer;
  END IF;
  UPDATE public.time_entries SET abgerechnet_in = NULL WHERE abgerechnet_in = OLD.id;
  RETURN OLD;
END $$;

-- ── Kunden: Belege je Kunde (für die Kundenliste) ───────────────────────────
CREATE OR REPLACE FUNCTION public.faktura_kunden_summen()
RETURNS TABLE (customer_id uuid, belege integer, offen numeric, letzter date)
LANGUAGE sql SECURITY DEFINER SET search_path = public STABLE AS $$
  SELECT b.customer_id,
         COUNT(*)::integer,
         COALESCE(SUM(CASE WHEN b.typ IN ('rechnung','teilrechnung','schlussrechnung')
                            AND b.status NOT IN ('entwurf','storniert')
                           THEN GREATEST(b.brutto - b.bezahlt, 0) ELSE 0 END), 0),
         MAX(b.datum)
    FROM public.belege b
   WHERE b.customer_id IS NOT NULL
     AND public.has_role(auth.uid(), 'administrator'::app_role)
   GROUP BY b.customer_id;
$$;

-- Kunde mit Belegen kann nicht gelöscht werden — klare Meldung statt FK-Fehler.
CREATE OR REPLACE FUNCTION public.trg_kunde_loeschschutz()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE n integer;
BEGIN
  SELECT COUNT(*) INTO n FROM public.belege WHERE customer_id = OLD.id AND (status <> 'entwurf' OR nummer IS NOT NULL);
  IF n > 0 THEN
    RAISE EXCEPTION 'Kunde hat % Beleg(e) (Angebote/Rechnungen) und kann deshalb nicht gelöscht werden.', n;
  END IF;
  RETURN OLD;
END $$;
DROP TRIGGER IF EXISTS trg_kunde_loeschschutz ON public.customers;
CREATE TRIGGER trg_kunde_loeschschutz BEFORE DELETE ON public.customers
  FOR EACH ROW EXECUTE FUNCTION public.trg_kunde_loeschschutz();

NOTIFY pgrst, 'reload schema';
