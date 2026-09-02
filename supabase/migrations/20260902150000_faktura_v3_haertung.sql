-- ============================================================================
--  FAKTURA v3 — Härtung nach gegnerischer Prüfung
-- ============================================================================
--  1. Rechnungs-PDFs im Ordner „Anbote" nur für Administratoren (Preise!)
--  2. Stunden markieren/freigeben über SECURITY-DEFINER-Funktion (RLS auf
--     time_entries erlaubt Admins kein UPDATE fremder Zeilen — der Client-Weg
--     scheiterte still)
--  3. Verrechnete Zeitblöcke sind für Mitarbeiter unveränderbar
--  4. Schreibschutz als Whitelist (alles gesperrt außer Verlaufsfelder),
--     Storno unumkehrbar, Positions-Trigger sperrt die Belegzeile
--  5. Storno wirkt erst, wenn die Gutschrift festgeschrieben ist
--  6. Projekte mit Belegen nicht löschbar (klare Meldung)
--  7. Pflichtangaben (§ 11 UStG) und Datum beim Festschreiben prüfen
--  8. Nummer je Kreis eindeutig, lpad schneidet nie ab, Präfix ohne Sonderzeichen
--  9. Zahlungen nur auf festgeschriebene Rechnungen/Gutschriften, CHECKs
-- 10. Datum in Wiener Zeit statt UTC

-- ── 1. Storage: Ordner „Anbote" nur Admin ───────────────────────────────────
DROP POLICY IF EXISTS "Authenticated users can view project files"   ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can upload project files" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can update project files" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can delete project files" ON storage.objects;

CREATE POLICY "Projektdateien lesen" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'project-files'
         AND ((storage.foldername(name))[2] IS DISTINCT FROM 'Anbote'
              OR public.has_role(auth.uid(), 'administrator'::app_role)));
CREATE POLICY "Projektdateien hochladen" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'project-files'
         AND ((storage.foldername(name))[2] IS DISTINCT FROM 'Anbote'
              OR public.has_role(auth.uid(), 'administrator'::app_role)));
CREATE POLICY "Projektdateien ändern" ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'project-files'
         AND ((storage.foldername(name))[2] IS DISTINCT FROM 'Anbote'
              OR public.has_role(auth.uid(), 'administrator'::app_role)));
CREATE POLICY "Projektdateien löschen" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'project-files'
         AND ((storage.foldername(name))[2] IS DISTINCT FROM 'Anbote'
              OR public.has_role(auth.uid(), 'administrator'::app_role)));

-- ── 2. Stunden markieren / freigeben ────────────────────────────────────────
-- p_beleg = Beleg-ID → markieren (nur Entwurf, nur noch offene Stunden)
-- p_beleg = NULL     → freigeben
CREATE OR REPLACE FUNCTION public.faktura_stunden_markieren(p_beleg uuid, p_ids uuid[])
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE n integer; v_status text;
BEGIN
  IF NOT public.has_role(auth.uid(), 'administrator'::app_role) THEN
    RAISE EXCEPTION 'Nur Administratoren dürfen Stunden verrechnen.';
  END IF;
  IF p_beleg IS NOT NULL THEN
    SELECT status INTO v_status FROM public.belege WHERE id = p_beleg;
    IF v_status IS DISTINCT FROM 'entwurf' THEN RAISE EXCEPTION 'Beleg ist festgeschrieben.'; END IF;
    UPDATE public.time_entries SET abgerechnet_in = p_beleg
     WHERE id = ANY(p_ids) AND abgerechnet_in IS NULL;
    GET DIAGNOSTICS n = ROW_COUNT;
    IF n <> cardinality(p_ids) THEN
      RAISE EXCEPTION 'Einige dieser Stunden sind bereits verrechnet — bitte „Stunden holen“ erneut öffnen.';
    END IF;
  ELSE
    UPDATE public.time_entries SET abgerechnet_in = NULL WHERE id = ANY(p_ids);
    GET DIAGNOSTICS n = ROW_COUNT;
  END IF;
  RETURN n;
END $$;

-- ── 3. Verrechnete Zeitblöcke: Mitarbeiter dürfen sie nicht mehr anfassen ──
CREATE OR REPLACE FUNCTION public.trg_time_entries_abgerechnet()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'administrator'::app_role) THEN
    IF OLD.abgerechnet_in IS NOT NULL THEN
      RAISE EXCEPTION 'Dieser Zeitblock ist bereits verrechnet und kann nicht mehr geändert werden.';
    END IF;
    IF TG_OP = 'UPDATE' AND NEW.abgerechnet_in IS DISTINCT FROM OLD.abgerechnet_in THEN
      RAISE EXCEPTION 'Nur Administratoren dürfen den Abrechnungsstatus ändern.';
    END IF;
  END IF;
  RETURN COALESCE(NEW, OLD);
END $$;
DROP TRIGGER IF EXISTS trg_time_entries_abgerechnet ON public.time_entries;
CREATE TRIGGER trg_time_entries_abgerechnet BEFORE UPDATE OR DELETE ON public.time_entries
  FOR EACH ROW EXECUTE FUNCTION public.trg_time_entries_abgerechnet();

-- ── 4. Schreibschutz als Whitelist ──────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.trg_beleg_schreibschutz()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE o public.belege; n public.belege;
BEGIN
  IF OLD.nummer IS NOT NULL AND (NEW.nummer IS DISTINCT FROM OLD.nummer OR NEW.typ IS DISTINCT FROM OLD.typ) THEN
    RAISE EXCEPTION 'Nummer und Belegart eines vergebenen Belegs können nicht geändert werden.';
  END IF;
  IF OLD.status <> 'entwurf' AND OLD.typ IN ('rechnung','teilrechnung','schlussrechnung','gutschrift') THEN
    IF NEW.status = 'entwurf' THEN
      RAISE EXCEPTION 'Rechnung % ist festgeschrieben. Korrektur nur per Gutschrift.', OLD.nummer;
    END IF;
    IF OLD.status = 'storniert' AND (NEW.status <> 'storniert' OR NEW.storniert_durch IS DISTINCT FROM OLD.storniert_durch) THEN
      RAISE EXCEPTION 'Storno von % kann nicht rückgängig gemacht werden.', OLD.nummer;
    END IF;
    o := OLD; n := NEW;
    -- Nur Verlaufsfelder sind frei — alles andere muss identisch bleiben
    o.status := NULL;          n.status := NULL;
    o.bezahlt := NULL;         n.bezahlt := NULL;
    o.pdf_pfad := NULL;        n.pdf_pfad := NULL;
    o.gesendet_am := NULL;     n.gesendet_am := NULL;
    o.storniert_durch := NULL; n.storniert_durch := NULL;
    o.notizen := NULL;         n.notizen := NULL;
    o.updated_at := NULL;      n.updated_at := NULL;
    o.vorgaenger_id := NULL;   n.vorgaenger_id := NULL;   -- FK SET NULL beim Löschen eines Angebots-Entwurfs
    IF o IS DISTINCT FROM n THEN
      RAISE EXCEPTION 'Rechnung % ist festgeschrieben und kann nicht mehr geändert werden. Korrektur nur per Gutschrift.', OLD.nummer;
    END IF;
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.trg_positionen_schreibschutz()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_status text; v_nummer text; v_typ text;
BEGIN
  -- Belegzeile sperren: eine parallel laufende Festschreibung wird abgewartet
  SELECT status, nummer, typ INTO v_status, v_nummer, v_typ
    FROM public.belege WHERE id = COALESCE(NEW.beleg_id, OLD.beleg_id) FOR UPDATE;
  IF v_status IS NOT NULL AND v_status <> 'entwurf' AND v_typ IN ('rechnung','teilrechnung','schlussrechnung','gutschrift') THEN
    RAISE EXCEPTION 'Rechnung % ist festgeschrieben — Positionen sind unveränderbar.', v_nummer;
  END IF;
  RETURN COALESCE(NEW, OLD);
END $$;

-- ── 8. Nummer je Kreis eindeutig; Präfix/Trenner ohne Sonderzeichen ─────────
ALTER TABLE public.belege
  ADD COLUMN IF NOT EXISTS kreis text GENERATED ALWAYS AS (
    CASE WHEN typ IN ('angebot','auftragsbestaetigung') THEN 'angebot'
         WHEN typ = 'gutschrift' THEN 'gutschrift' ELSE 'rechnung' END) STORED;
ALTER TABLE public.belege DROP CONSTRAINT IF EXISTS belege_nummer_key;
CREATE UNIQUE INDEX IF NOT EXISTS belege_kreis_nummer_uniq ON public.belege (kreis, nummer) WHERE nummer IS NOT NULL;

ALTER TABLE public.faktura_nummernkreise DROP CONSTRAINT IF EXISTS faktura_nummernkreise_praefix_chk;
ALTER TABLE public.faktura_nummernkreise ADD CONSTRAINT faktura_nummernkreise_praefix_chk
  CHECK (praefix ~ '^[A-Za-z0-9_.-]{0,10}$' AND trenner ~ '^[A-Za-z0-9_./ -]{0,3}$' AND breite BETWEEN 1 AND 8);

CREATE OR REPLACE FUNCTION public.faktura_nummer_bauen(p_kreis text, p_nummer integer, p_datum date)
RETURNS text LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT k.praefix
      || CASE k.jahr_format
           WHEN 'JJJJ' THEN to_char(p_datum, 'YYYY') || k.trenner
           WHEN 'JJ'   THEN to_char(p_datum, 'YY')   || k.trenner
           ELSE '' END
      || lpad(p_nummer::text, GREATEST(k.breite, length(p_nummer::text)), '0')
    FROM public.faktura_nummernkreise k WHERE k.kreis = p_kreis;
$$;

-- ── 10. Datum in Wiener Zeit ────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.heute_wien() RETURNS date LANGUAGE sql STABLE AS $$
  SELECT (now() AT TIME ZONE 'Europe/Vienna')::date
$$;
ALTER TABLE public.belege ALTER COLUMN datum SET DEFAULT public.heute_wien();
ALTER TABLE public.beleg_zahlungen ALTER COLUMN datum SET DEFAULT public.heute_wien();

-- ── 5 + 7. Festschreiben: Pflichtangaben, Datum, Storno-Wirkung ─────────────
CREATE OR REPLACE FUNCTION public.beleg_festschreiben(p_beleg uuid)
RETURNS public.belege LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v public.belege%ROWTYPE; v_kreis text; v_nr integer; v_jahr integer; v_nummer text; v_letzt date;
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
  IF COALESCE(v.kunde_name,'') = '' THEN RAISE EXCEPTION 'Empfänger fehlt.'; END IF;
  IF v.reverse_charge AND COALESCE(v.kunde_uid,'') = '' THEN
    RAISE EXCEPTION 'Reverse Charge verlangt die UID des Kunden.';
  END IF;
  IF v.datum > public.heute_wien() THEN RAISE EXCEPTION 'Belegdatum liegt in der Zukunft.'; END IF;
  IF v.typ IN ('rechnung','teilrechnung','schlussrechnung','gutschrift') THEN
    IF v.leistung_von IS NULL AND v.leistung_bis IS NULL THEN
      RAISE EXCEPTION 'Leistungszeitraum fehlt (Pflichtangabe auf der Rechnung, § 11 UStG).';
    END IF;
  END IF;
  IF v.typ IN ('rechnung','teilrechnung','schlussrechnung') AND v.faellig_am IS NULL THEN
    RAISE EXCEPTION 'Zahlungsziel („Zahlbar bis“) fehlt.';
  END IF;
  IF v.skonto_prozent IS NOT NULL AND v.skonto_prozent > 0 AND COALESCE(v.skonto_tage,0) <= 0 THEN
    RAISE EXCEPTION 'Skonto ohne Skonto-Frist (Tage).';
  END IF;

  v_jahr := EXTRACT(YEAR FROM v.datum)::integer;

  IF v.nummer IS NOT NULL THEN
    -- Angebot, das nach dem Bearbeiten erneut festgeschrieben wird: Nummer bleibt.
    UPDATE public.belege SET status = 'festgeschrieben', festgeschrieben_am = now()
     WHERE id = p_beleg RETURNING * INTO v;
    RETURN v;
  END IF;

  v_kreis := v.kreis;
  -- Reihenfolge: kein Beleg darf vor dem zuletzt vergebenen desselben Kreises datiert sein
  SELECT MAX(datum) INTO v_letzt FROM public.belege WHERE kreis = v_kreis AND nummer IS NOT NULL AND id <> p_beleg;
  IF v_letzt IS NOT NULL AND v.datum < v_letzt THEN
    RAISE EXCEPTION 'Belegdatum % liegt vor dem zuletzt festgeschriebenen Beleg (%). Bitte Datum anpassen.',
      to_char(v.datum,'DD.MM.YYYY'), to_char(v_letzt,'DD.MM.YYYY');
  END IF;

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

  -- Gutschrift festgeschrieben → jetzt gilt die Rechnung als storniert
  IF v.typ = 'gutschrift' AND v.vorgaenger_id IS NOT NULL THEN
    UPDATE public.belege SET status = 'storniert', storniert_durch = p_beleg
     WHERE id = v.vorgaenger_id AND storniert_durch IS NULL;
    UPDATE public.time_entries SET abgerechnet_in = NULL WHERE abgerechnet_in = v.vorgaenger_id;
  END IF;
  RETURN v;
END $$;

CREATE OR REPLACE FUNCTION public.beleg_stornieren(p_beleg uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v public.belege%ROWTYPE; v_neu uuid; v_hinweis text;
BEGIN
  IF NOT public.has_role(auth.uid(), 'administrator'::app_role) THEN
    RAISE EXCEPTION 'Nur Administratoren dürfen stornieren.';
  END IF;
  SELECT * INTO v FROM public.belege WHERE id = p_beleg FOR UPDATE;
  IF v.id IS NULL THEN RAISE EXCEPTION 'Beleg nicht gefunden.'; END IF;
  IF v.status = 'entwurf' THEN RAISE EXCEPTION 'Entwürfe werden gelöscht, nicht storniert.'; END IF;
  IF v.typ NOT IN ('rechnung','teilrechnung','schlussrechnung') THEN RAISE EXCEPTION 'Nur Rechnungen können storniert werden.'; END IF;
  IF v.storniert_durch IS NOT NULL THEN RAISE EXCEPTION 'Beleg ist bereits storniert.'; END IF;
  IF EXISTS (SELECT 1 FROM public.belege WHERE vorgaenger_id = v.id AND typ = 'gutschrift') THEN
    RAISE EXCEPTION 'Zu dieser Rechnung gibt es bereits eine Gutschrift (Entwurf oder festgeschrieben).';
  END IF;

  v_hinweis := 'Wir schreiben Ihnen zu Rechnung ' || v.nummer || ' vom ' || to_char(v.datum, 'DD.MM.YYYY') || ' gut:';
  IF v.bezahlt > 0 THEN
    v_hinweis := v_hinweis || ' (Bereits bezahlt: ' || to_char(v.bezahlt, 'FM999G999G990D00') || ' € — wird rücküberwiesen bzw. mit der Ersatzrechnung verrechnet.)';
  END IF;

  INSERT INTO public.belege (typ, status, project_id, customer_id, vorgaenger_id,
    kunde_name, kunde_zusatz, kunde_strasse, kunde_plz_ort, kunde_uid, kunde_email,
    datum, leistung_von, leistung_bis, betreff, einleitung, schlusstext, reverse_charge, ust_satz, created_by, notizen)
  VALUES ('gutschrift', 'entwurf', v.project_id, v.customer_id, v.id,
    v.kunde_name, v.kunde_zusatz, v.kunde_strasse, v.kunde_plz_ort, v.kunde_uid, v.kunde_email,
    public.heute_wien(), v.leistung_von, v.leistung_bis,
    'Gutschrift zu Rechnung ' || v.nummer, v_hinweis, NULL, v.reverse_charge, v.ust_satz, auth.uid(),
    CASE WHEN v.bezahlt > 0 THEN 'Auf der stornierten Rechnung waren bereits ' || to_char(v.bezahlt, 'FM999G999G990D00') || ' € bezahlt.' ELSE NULL END)
  RETURNING id INTO v_neu;

  INSERT INTO public.beleg_positionen (beleg_id, pos, art, text, beschreibung, menge, einheit, einzelpreis, rabatt_prozent, quelle_typ, quelle_ids)
  SELECT v_neu, pos, art, text, beschreibung, menge, einheit, einzelpreis, rabatt_prozent, 'manuell', '{}'
    FROM public.beleg_positionen WHERE beleg_id = v.id ORDER BY pos;
  -- Die Rechnung bleibt bis zum Festschreiben der Gutschrift unverändert gültig.
  RETURN v_neu;
END $$;

-- ── 6. Projekte mit Belegen nicht löschbar ──────────────────────────────────
CREATE OR REPLACE FUNCTION public.trg_projekt_loeschschutz()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE n integer;
BEGIN
  SELECT COUNT(*) INTO n FROM public.belege WHERE project_id = OLD.id AND (status <> 'entwurf' OR nummer IS NOT NULL);
  IF n > 0 THEN
    RAISE EXCEPTION 'Projekt hat % Beleg(e) (Angebote/Rechnungen) und kann deshalb nicht gelöscht werden.', n;
  END IF;
  RETURN OLD;
END $$;
DROP TRIGGER IF EXISTS trg_projekt_loeschschutz ON public.projects;
CREATE TRIGGER trg_projekt_loeschschutz BEFORE DELETE ON public.projects
  FOR EACH ROW EXECUTE FUNCTION public.trg_projekt_loeschschutz();

-- ── 9. Zahlungen und CHECKs ─────────────────────────────────────────────────
ALTER TABLE public.beleg_positionen DROP CONSTRAINT IF EXISTS beleg_positionen_rabatt_chk;
ALTER TABLE public.beleg_positionen ADD CONSTRAINT beleg_positionen_rabatt_chk CHECK (rabatt_prozent >= 0 AND rabatt_prozent <= 100);
ALTER TABLE public.beleg_zahlungen DROP CONSTRAINT IF EXISTS beleg_zahlungen_betrag_chk;
ALTER TABLE public.beleg_zahlungen ADD CONSTRAINT beleg_zahlungen_betrag_chk CHECK (betrag <> 0);

CREATE OR REPLACE FUNCTION public.trg_zahlung_erlaubt()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_status text; v_typ text;
BEGIN
  SELECT status, typ INTO v_status, v_typ FROM public.belege WHERE id = NEW.beleg_id;
  IF v_status IS NULL OR v_status = 'entwurf' OR v_typ NOT IN ('rechnung','teilrechnung','schlussrechnung','gutschrift') THEN
    RAISE EXCEPTION 'Zahlungen können nur auf festgeschriebene Rechnungen oder Gutschriften erfasst werden.';
  END IF;
  IF v_status = 'storniert' THEN
    RAISE EXCEPTION 'Auf eine stornierte Rechnung können keine Zahlungen mehr erfasst werden.';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_zahlung_erlaubt ON public.beleg_zahlungen;
CREATE TRIGGER trg_zahlung_erlaubt BEFORE INSERT OR UPDATE ON public.beleg_zahlungen
  FOR EACH ROW EXECUTE FUNCTION public.trg_zahlung_erlaubt();

CREATE OR REPLACE FUNCTION public.trg_beleg_zahlungen()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid := COALESCE(NEW.beleg_id, OLD.beleg_id); v_bez numeric(12,2); v_brutto numeric(12,2); v_status text; v_gesendet timestamptz;
BEGIN
  SELECT COALESCE(SUM(betrag),0) INTO v_bez FROM public.beleg_zahlungen WHERE beleg_id = v_id;
  SELECT brutto, status, gesendet_am INTO v_brutto, v_status, v_gesendet FROM public.belege WHERE id = v_id;
  UPDATE public.belege SET
    bezahlt = v_bez,
    status  = CASE
                WHEN v_status IN ('entwurf','storniert') THEN v_status
                WHEN v_bez >= v_brutto AND v_bez > 0 THEN 'bezahlt'
                WHEN v_bez > 0 THEN 'teilbezahlt'
                WHEN v_status IN ('bezahlt','teilbezahlt') THEN CASE WHEN v_gesendet IS NULL THEN 'festgeschrieben' ELSE 'gesendet' END
                ELSE v_status END
  WHERE id = v_id;
  RETURN COALESCE(NEW, OLD);
END $$;

-- Interne Hilfsfunktion nicht per RPC aufrufbar
REVOKE EXECUTE ON FUNCTION public.beleg_summen_neu(uuid) FROM PUBLIC, anon, authenticated;

NOTIFY pgrst, 'reload schema';

-- ── 11. Positionsnummer serverseitig vergeben (Doppeltipp am Handy) ─────────
-- Client schickt pos = NULL → nächste freie Nummer unterhalb der Abzugszeilen (≥ 900)
ALTER TABLE public.beleg_positionen ALTER COLUMN pos DROP NOT NULL;
CREATE OR REPLACE FUNCTION public.trg_pos_default()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.pos IS NULL THEN
    SELECT COALESCE(MAX(pos), 0) + 1 INTO NEW.pos
      FROM public.beleg_positionen WHERE beleg_id = NEW.beleg_id AND pos < 900;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_pos_default ON public.beleg_positionen;
CREATE TRIGGER trg_pos_default BEFORE INSERT ON public.beleg_positionen
  FOR EACH ROW EXECUTE FUNCTION public.trg_pos_default();
-- Läuft VOR dem Schreibschutz-Trigger (alphabetisch: trg_pos_default < trg_pos_schreibschutz)

NOTIFY pgrst, 'reload schema';

-- Korrektur: generierte Spalte `kreis` ist in BEFORE-Triggern in NEW noch nicht
-- berechnet (NULL) und ließ den Vergleich OLD/NEW immer fehlschlagen.
CREATE OR REPLACE FUNCTION public.trg_beleg_schreibschutz()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE o public.belege; n public.belege;
BEGIN
  IF OLD.nummer IS NOT NULL AND (NEW.nummer IS DISTINCT FROM OLD.nummer OR NEW.typ IS DISTINCT FROM OLD.typ) THEN
    RAISE EXCEPTION 'Nummer und Belegart eines vergebenen Belegs können nicht geändert werden.';
  END IF;
  IF OLD.status <> 'entwurf' AND OLD.typ IN ('rechnung','teilrechnung','schlussrechnung','gutschrift') THEN
    IF NEW.status = 'entwurf' THEN
      RAISE EXCEPTION 'Rechnung % ist festgeschrieben. Korrektur nur per Gutschrift.', OLD.nummer;
    END IF;
    IF OLD.status = 'storniert' AND (NEW.status <> 'storniert' OR NEW.storniert_durch IS DISTINCT FROM OLD.storniert_durch) THEN
      RAISE EXCEPTION 'Storno von % kann nicht rückgängig gemacht werden.', OLD.nummer;
    END IF;
    o := OLD; n := NEW;
    -- Nur Verlaufsfelder sind frei — alles andere muss identisch bleiben
    o.status := NULL;          n.status := NULL;
    o.bezahlt := NULL;         n.bezahlt := NULL;
    o.pdf_pfad := NULL;        n.pdf_pfad := NULL;
    o.gesendet_am := NULL;     n.gesendet_am := NULL;
    o.storniert_durch := NULL; n.storniert_durch := NULL;
    o.notizen := NULL;         n.notizen := NULL;
    o.updated_at := NULL;      n.updated_at := NULL;
    o.vorgaenger_id := NULL;   n.vorgaenger_id := NULL;
    o.kreis := NULL;           n.kreis := NULL;   -- generiert, in NEW noch nicht berechnet
    IF o IS DISTINCT FROM n THEN
      RAISE EXCEPTION 'Rechnung % ist festgeschrieben und kann nicht mehr geändert werden. Korrektur nur per Gutschrift.', OLD.nummer;
    END IF;
  END IF;
  RETURN NEW;
END $$;

-- Korrektur: Wartungs-/Service-Kontext (kein angemeldeter Benutzer, z. B.
-- FK-Kaskade beim Löschen eines Entwurfs über den Service-Schlüssel) darf den
-- Abrechnungsstatus setzen. Für angemeldete Mitarbeiter bleibt alles gesperrt.
CREATE OR REPLACE FUNCTION public.trg_time_entries_abgerechnet()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.has_role(auth.uid(), 'administrator'::app_role) THEN
    IF OLD.abgerechnet_in IS NOT NULL THEN
      RAISE EXCEPTION 'Dieser Zeitblock ist bereits verrechnet und kann nicht mehr geändert werden.';
    END IF;
    IF TG_OP = 'UPDATE' AND NEW.abgerechnet_in IS DISTINCT FROM OLD.abgerechnet_in THEN
      RAISE EXCEPTION 'Nur Administratoren dürfen den Abrechnungsstatus ändern.';
    END IF;
  END IF;
  RETURN COALESCE(NEW, OLD);
END $$;
