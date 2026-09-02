-- ============================================================================
--  FAKTURA — Angebote und Rechnungen direkt in der App (Stufe 1)
-- ============================================================================
--
-- Grundsätze:
--  * Nur Administratoren sehen und bearbeiten Belege, Preise, Stundensätze.
--    Mitarbeiter sehen weiterhin keine Preise (Regel „Preise nur Admin").
--  * Eine Belegnummer wird erst beim FESTSCHREIBEN vergeben (fortlaufend,
--    lückenlos, § 11 UStG). Entwürfe haben keine Nummer.
--  * Ein festgeschriebener Beleg ist unveränderbar. Korrektur nur per
--    Gutschrift (Storno) und neuem Beleg. 7 Jahre Aufbewahrung.
--  * Kundendaten werden in den Beleg KOPIERT (Snapshot) — eine Rechnung darf
--    sich nicht ändern, wenn der Kunde später umzieht.
--  * Jede Position weiß, woher sie stammt (Zeitblöcke, Material, Teilrechnung…),
--    Stunden werden als abgerechnet markiert → keine Doppelverrechnung.
--  * Nummernkreise laufen wie bei Michael bisher: getrennt je Belegart, über
--    die Jahre fortlaufend, Jahr nur als Präfix („2026-2584").

-- ── Aufräumen: alter, nie verlinkter Rechnungs-Anlauf (0 Datensätze) ────────
DROP TABLE IF EXISTS public.invoice_items;
DROP TABLE IF EXISTS public.invoices;

-- ── Firmendaten (genau eine Zeile) ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.faktura_firmendaten (
  einzig            boolean PRIMARY KEY DEFAULT true CHECK (einzig),
  firma             text NOT NULL DEFAULT 'Ruff Michael GmbH',
  zusatz            text DEFAULT 'Installationen · Heizung · Sanitär',
  strasse           text,
  plz_ort           text,
  telefon           text,
  email             text,
  web               text,
  uid               text,             -- ATU…
  firmenbuch        text,             -- FN …
  gericht           text,             -- Firmenbuchgericht
  bank              text,
  iban              text,
  bic               text,
  zahlungsziel_tage integer NOT NULL DEFAULT 14,
  skonto_prozent    numeric(5,2),
  skonto_tage       integer,
  angebot_gueltig_tage integer NOT NULL DEFAULT 30,
  ust_satz          numeric(5,2) NOT NULL DEFAULT 20,
  angebot_einleitung text DEFAULT 'Vielen Dank für Ihre Anfrage. Wir bieten Ihnen wie folgt an:',
  angebot_schluss    text DEFAULT 'Wir hoffen, Ihnen ein passendes Angebot gemacht zu haben, und freuen uns auf Ihren Auftrag.',
  rechnung_einleitung text DEFAULT 'Für die erbrachten Leistungen erlauben wir uns zu verrechnen:',
  rechnung_schluss   text DEFAULT 'Wir bedanken uns für Ihren Auftrag.',
  fusstext          text,
  updated_at        timestamptz NOT NULL DEFAULT now()
);
INSERT INTO public.faktura_firmendaten (einzig) VALUES (true) ON CONFLICT DO NOTHING;

-- ── Stundensätze (Mitarbeitergruppen) ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.faktura_stundensaetze (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bezeichnung text NOT NULL,          -- „Meister", „Geselle", „Lehrling"
  satz        numeric(10,2) NOT NULL, -- netto je Stunde
  sort_order  integer NOT NULL DEFAULT 0,
  is_active   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
-- Startwerte: BEISPIELE, in den Einstellungen anzupassen. Beim Stundenholen
-- wird der Satz je Zeile noch einmal angezeigt und ist dort änderbar.
INSERT INTO public.faktura_stundensaetze (bezeichnung, satz, sort_order)
SELECT * FROM (VALUES ('Meister', 85.00, 1), ('Geselle', 68.00, 2), ('Lehrling', 38.00, 3)) v(b, s, o)
WHERE NOT EXISTS (SELECT 1 FROM public.faktura_stundensaetze);

-- Mitarbeiter → Stundensatzgruppe
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS stundensatz_id uuid REFERENCES public.faktura_stundensaetze(id) ON DELETE SET NULL;

-- ── Kunden: Rechnungsdaten ──────────────────────────────────────────────────
ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS firma           text,      -- Firmenname (bei Firmenkunden)
  ADD COLUMN IF NOT EXISTS uid             text,      -- ATU…
  ADD COLUMN IF NOT EXISTS ist_unternehmer boolean NOT NULL DEFAULT false,
  -- Bauleistung an Unternehmer → Übergang der Steuerschuld (§ 19 Abs. 1a UStG)
  ADD COLUMN IF NOT EXISTS reverse_charge  boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS zahlungsziel_tage integer;  -- NULL = Firmenstandard

-- ── Nummernkreise ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.faktura_nummernkreise (
  kreis           text PRIMARY KEY,   -- 'angebot' | 'rechnung' | 'gutschrift'
  naechste_nummer integer NOT NULL,
  breite          integer NOT NULL DEFAULT 4,
  updated_at      timestamptz NOT NULL DEFAULT now()
);
-- Fortsetzung von Michaels bisherigen Zählern (aus seinen PDFs ermittelt):
-- Rechnungen zuletzt 2583, Angebote/Kostenschätzungen zuletzt 1150.
-- In den Einstellungen VOR dem ersten Festschreiben gegenprüfen!
INSERT INTO public.faktura_nummernkreise (kreis, naechste_nummer) VALUES
  ('angebot', 1151), ('rechnung', 2584), ('gutschrift', 1)
ON CONFLICT (kreis) DO NOTHING;

-- ── Belege ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.belege (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  typ             text NOT NULL CHECK (typ IN (
                    'angebot','auftragsbestaetigung',
                    'rechnung','teilrechnung','schlussrechnung','gutschrift')),
  status          text NOT NULL DEFAULT 'entwurf' CHECK (status IN (
                    'entwurf','festgeschrieben','gesendet',
                    'angenommen','abgelehnt',          -- Angebote
                    'teilbezahlt','bezahlt','storniert')),
  nummer          text UNIQUE,                        -- „2026-2584", erst beim Festschreiben
  jahr            integer,
  laufnummer      integer,
  project_id      uuid REFERENCES public.projects(id) ON DELETE SET NULL,
  customer_id     uuid REFERENCES public.customers(id) ON DELETE SET NULL,
  vorgaenger_id   uuid REFERENCES public.belege(id) ON DELETE SET NULL,  -- Angebot → Rechnung, Rechnung → Gutschrift
  -- Kunden-Snapshot
  kunde_name      text NOT NULL,
  kunde_zusatz    text,
  kunde_strasse   text,
  kunde_plz_ort   text,
  kunde_uid       text,
  kunde_email     text,
  -- Belegdaten
  datum           date NOT NULL DEFAULT CURRENT_DATE,
  leistung_von    date,
  leistung_bis    date,
  faellig_am      date,
  gueltig_bis     date,
  betreff         text,
  einleitung      text,
  schlusstext     text,
  reverse_charge  boolean NOT NULL DEFAULT false,
  ust_satz        numeric(5,2) NOT NULL DEFAULT 20,
  skonto_prozent  numeric(5,2),
  skonto_tage     integer,
  -- Summen (aus den Positionen berechnet, per Trigger gepflegt)
  netto           numeric(12,2) NOT NULL DEFAULT 0,
  ust             numeric(12,2) NOT NULL DEFAULT 0,
  brutto          numeric(12,2) NOT NULL DEFAULT 0,
  bezahlt         numeric(12,2) NOT NULL DEFAULT 0,
  -- Ablage / Verlauf
  pdf_pfad        text,                 -- project-files/{project}/Anbote/… (→ OneDrive)
  festgeschrieben_am timestamptz,
  gesendet_am     timestamptz,
  storniert_durch uuid REFERENCES public.belege(id) ON DELETE SET NULL,
  notizen         text,                 -- intern, nie am PDF
  created_by      uuid REFERENCES auth.users(id) ON DELETE SET NULL DEFAULT auth.uid(),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS belege_projekt_idx ON public.belege (project_id);
CREATE INDEX IF NOT EXISTS belege_kunde_idx   ON public.belege (customer_id);
CREATE INDEX IF NOT EXISTS belege_status_idx  ON public.belege (status);
CREATE INDEX IF NOT EXISTS belege_datum_idx   ON public.belege (datum DESC);

CREATE TABLE IF NOT EXISTS public.beleg_positionen (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  beleg_id      uuid NOT NULL REFERENCES public.belege(id) ON DELETE CASCADE,
  pos           integer NOT NULL DEFAULT 1,
  art           text NOT NULL DEFAULT 'position' CHECK (art IN ('position','ueberschrift','text')),
  text          text NOT NULL,
  beschreibung  text,
  menge         numeric(12,3) NOT NULL DEFAULT 1,
  einheit       text NOT NULL DEFAULT 'Stk',
  einzelpreis   numeric(12,2) NOT NULL DEFAULT 0,
  rabatt_prozent numeric(5,2) NOT NULL DEFAULT 0,
  gesamt        numeric(12,2) GENERATED ALWAYS AS
                  (CASE WHEN art = 'position'
                        THEN round(menge * einzelpreis * (1 - rabatt_prozent / 100), 2)
                        ELSE 0 END) STORED,
  -- Herkunft: 'stunden' | 'material' | 'artikel' | 'nachtrag' | 'teilrechnung' | 'manuell'
  quelle_typ    text NOT NULL DEFAULT 'manuell',
  quelle_ids    uuid[] NOT NULL DEFAULT '{}',
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS beleg_positionen_beleg_idx ON public.beleg_positionen (beleg_id, pos);

CREATE TABLE IF NOT EXISTS public.beleg_zahlungen (
  id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  beleg_id  uuid NOT NULL REFERENCES public.belege(id) ON DELETE CASCADE,
  betrag    numeric(12,2) NOT NULL,
  datum     date NOT NULL DEFAULT CURRENT_DATE,
  art       text NOT NULL DEFAULT 'ueberweisung' CHECK (art IN ('ueberweisung','bar','skonto','sonstiges')),
  notiz     text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Stunden: in welchem Beleg abgerechnet (NULL = noch offen)
ALTER TABLE public.time_entries
  ADD COLUMN IF NOT EXISTS abgerechnet_in uuid REFERENCES public.belege(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS time_entries_offen_idx ON public.time_entries (project_id) WHERE abgerechnet_in IS NULL;

-- ── updated_at ──────────────────────────────────────────────────────────────
DROP TRIGGER IF EXISTS trg_belege_updated ON public.belege;
CREATE TRIGGER trg_belege_updated BEFORE UPDATE ON public.belege
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
DROP TRIGGER IF EXISTS trg_firmendaten_updated ON public.faktura_firmendaten;
CREATE TRIGGER trg_firmendaten_updated BEFORE UPDATE ON public.faktura_firmendaten
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
DROP TRIGGER IF EXISTS trg_stundensaetze_updated ON public.faktura_stundensaetze;
CREATE TRIGGER trg_stundensaetze_updated BEFORE UPDATE ON public.faktura_stundensaetze
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ── Summen aus Positionen (Trigger) ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.beleg_summen_neu(p_beleg uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_netto numeric(12,2); v_rc boolean; v_satz numeric(5,2); v_ust numeric(12,2);
BEGIN
  SELECT COALESCE(SUM(gesamt),0) INTO v_netto FROM public.beleg_positionen WHERE beleg_id = p_beleg;
  SELECT reverse_charge, ust_satz INTO v_rc, v_satz FROM public.belege WHERE id = p_beleg;
  v_ust := CASE WHEN v_rc THEN 0 ELSE round(v_netto * v_satz / 100, 2) END;
  UPDATE public.belege SET netto = v_netto, ust = v_ust, brutto = v_netto + v_ust WHERE id = p_beleg;
END $$;

CREATE OR REPLACE FUNCTION public.trg_beleg_positionen_summen()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.beleg_summen_neu(COALESCE(NEW.beleg_id, OLD.beleg_id));
  RETURN COALESCE(NEW, OLD);
END $$;
DROP TRIGGER IF EXISTS trg_positionen_summen ON public.beleg_positionen;
CREATE TRIGGER trg_positionen_summen AFTER INSERT OR UPDATE OR DELETE ON public.beleg_positionen
  FOR EACH ROW EXECUTE FUNCTION public.trg_beleg_positionen_summen();

-- Reverse-Charge-/USt-Änderung am Beleg → Summen neu
CREATE OR REPLACE FUNCTION public.trg_beleg_kopf_summen()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.reverse_charge IS DISTINCT FROM OLD.reverse_charge OR NEW.ust_satz IS DISTINCT FROM OLD.ust_satz THEN
    NEW.ust := CASE WHEN NEW.reverse_charge THEN 0 ELSE round(NEW.netto * NEW.ust_satz / 100, 2) END;
    NEW.brutto := NEW.netto + NEW.ust;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_beleg_kopf ON public.belege;
CREATE TRIGGER trg_beleg_kopf BEFORE UPDATE ON public.belege
  FOR EACH ROW EXECUTE FUNCTION public.trg_beleg_kopf_summen();

-- Zahlungen → bezahlt-Summe + Status
CREATE OR REPLACE FUNCTION public.trg_beleg_zahlungen()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid := COALESCE(NEW.beleg_id, OLD.beleg_id); v_bez numeric(12,2); v_brutto numeric(12,2); v_status text;
BEGIN
  SELECT COALESCE(SUM(betrag),0) INTO v_bez FROM public.beleg_zahlungen WHERE beleg_id = v_id;
  SELECT brutto, status INTO v_brutto, v_status FROM public.belege WHERE id = v_id;
  UPDATE public.belege SET
    bezahlt = v_bez,
    status  = CASE
                WHEN v_status IN ('entwurf','storniert') THEN v_status
                WHEN v_bez >= v_brutto AND v_brutto > 0 THEN 'bezahlt'
                WHEN v_bez > 0 THEN 'teilbezahlt'
                WHEN v_status IN ('bezahlt','teilbezahlt') THEN 'gesendet'
                ELSE v_status END
  WHERE id = v_id;
  RETURN COALESCE(NEW, OLD);
END $$;
DROP TRIGGER IF EXISTS trg_zahlungen ON public.beleg_zahlungen;
CREATE TRIGGER trg_zahlungen AFTER INSERT OR UPDATE OR DELETE ON public.beleg_zahlungen
  FOR EACH ROW EXECUTE FUNCTION public.trg_beleg_zahlungen();

-- ── Unveränderbarkeit nach dem Festschreiben ────────────────────────────────
-- Erlaubt bleiben nur Verlaufs-/Ablagefelder (Status, PDF, Versand, Zahlung, Notizen).
CREATE OR REPLACE FUNCTION public.trg_beleg_schreibschutz()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status <> 'entwurf' AND (
       NEW.typ IS DISTINCT FROM OLD.typ OR NEW.nummer IS DISTINCT FROM OLD.nummer
    OR NEW.kunde_name IS DISTINCT FROM OLD.kunde_name OR NEW.kunde_strasse IS DISTINCT FROM OLD.kunde_strasse
    OR NEW.kunde_plz_ort IS DISTINCT FROM OLD.kunde_plz_ort OR NEW.kunde_uid IS DISTINCT FROM OLD.kunde_uid
    OR NEW.datum IS DISTINCT FROM OLD.datum OR NEW.leistung_von IS DISTINCT FROM OLD.leistung_von
    OR NEW.leistung_bis IS DISTINCT FROM OLD.leistung_bis OR NEW.reverse_charge IS DISTINCT FROM OLD.reverse_charge
    OR NEW.ust_satz IS DISTINCT FROM OLD.ust_satz OR NEW.betreff IS DISTINCT FROM OLD.betreff
    OR NEW.einleitung IS DISTINCT FROM OLD.einleitung OR NEW.schlusstext IS DISTINCT FROM OLD.schlusstext
    OR NEW.skonto_prozent IS DISTINCT FROM OLD.skonto_prozent OR NEW.skonto_tage IS DISTINCT FROM OLD.skonto_tage
    OR NEW.faellig_am IS DISTINCT FROM OLD.faellig_am OR NEW.gueltig_bis IS DISTINCT FROM OLD.gueltig_bis
    OR NEW.project_id IS DISTINCT FROM OLD.project_id OR NEW.customer_id IS DISTINCT FROM OLD.customer_id
  ) THEN
    RAISE EXCEPTION 'Beleg % ist festgeschrieben und kann nicht mehr geändert werden. Korrektur nur per Gutschrift.', OLD.nummer;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_schreibschutz ON public.belege;
CREATE TRIGGER trg_schreibschutz BEFORE UPDATE ON public.belege
  FOR EACH ROW EXECUTE FUNCTION public.trg_beleg_schreibschutz();

CREATE OR REPLACE FUNCTION public.trg_positionen_schreibschutz()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_status text; v_nummer text;
BEGIN
  SELECT status, nummer INTO v_status, v_nummer FROM public.belege WHERE id = COALESCE(NEW.beleg_id, OLD.beleg_id);
  IF v_status IS NOT NULL AND v_status <> 'entwurf' THEN
    RAISE EXCEPTION 'Beleg % ist festgeschrieben — Positionen sind unveränderbar.', v_nummer;
  END IF;
  RETURN COALESCE(NEW, OLD);
END $$;
DROP TRIGGER IF EXISTS trg_pos_schreibschutz ON public.beleg_positionen;
CREATE TRIGGER trg_pos_schreibschutz BEFORE INSERT OR UPDATE OR DELETE ON public.beleg_positionen
  FOR EACH ROW EXECUTE FUNCTION public.trg_positionen_schreibschutz();

-- Löschen: nur Entwürfe. Festgeschriebene Belege bleiben 7 Jahre.
CREATE OR REPLACE FUNCTION public.trg_beleg_loeschschutz()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status <> 'entwurf' THEN
    RAISE EXCEPTION 'Beleg % ist festgeschrieben und darf nicht gelöscht werden (Aufbewahrungspflicht).', OLD.nummer;
  END IF;
  -- Stunden wieder freigeben
  UPDATE public.time_entries SET abgerechnet_in = NULL WHERE abgerechnet_in = OLD.id;
  RETURN OLD;
END $$;
DROP TRIGGER IF EXISTS trg_loeschschutz ON public.belege;
CREATE TRIGGER trg_loeschschutz BEFORE DELETE ON public.belege
  FOR EACH ROW EXECUTE FUNCTION public.trg_beleg_loeschschutz();

-- ── Festschreiben: Nummer vergeben (atomar, lückenlos) ─────────────────────
CREATE OR REPLACE FUNCTION public.beleg_festschreiben(p_beleg uuid)
RETURNS public.belege LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v public.belege%ROWTYPE; v_kreis text; v_nr integer; v_breite integer; v_jahr integer; v_status text;
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

  v_kreis := CASE v.typ WHEN 'angebot' THEN 'angebot' WHEN 'auftragsbestaetigung' THEN 'angebot'
                        WHEN 'gutschrift' THEN 'gutschrift' ELSE 'rechnung' END;
  v_jahr  := EXTRACT(YEAR FROM v.datum)::integer;

  -- Zähler sperren und hochzählen — nie eine Lücke, nie doppelt
  UPDATE public.faktura_nummernkreise
     SET naechste_nummer = naechste_nummer + 1, updated_at = now()
   WHERE kreis = v_kreis
   RETURNING naechste_nummer - 1, breite INTO v_nr, v_breite;
  IF v_nr IS NULL THEN RAISE EXCEPTION 'Nummernkreis % fehlt.', v_kreis; END IF;

  v_status := CASE WHEN v.typ IN ('angebot','auftragsbestaetigung') THEN 'festgeschrieben' ELSE 'festgeschrieben' END;

  UPDATE public.belege SET
    nummer = v_jahr::text || '-' || lpad(v_nr::text, v_breite, '0'),
    jahr = v_jahr, laufnummer = v_nr,
    status = v_status, festgeschrieben_am = now()
  WHERE id = p_beleg
  RETURNING * INTO v;
  RETURN v;
END $$;

-- ── Stornieren per Gutschrift ───────────────────────────────────────────────
-- Legt eine Gutschrift mit denselben Positionen an (als Entwurf, zum Prüfen und
-- Festschreiben), verknüpft beide und setzt die Rechnung auf 'storniert'.
CREATE OR REPLACE FUNCTION public.beleg_stornieren(p_beleg uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v public.belege%ROWTYPE; v_neu uuid;
BEGIN
  IF NOT public.has_role(auth.uid(), 'administrator'::app_role) THEN
    RAISE EXCEPTION 'Nur Administratoren dürfen stornieren.';
  END IF;
  SELECT * INTO v FROM public.belege WHERE id = p_beleg FOR UPDATE;
  IF v.status = 'entwurf' THEN RAISE EXCEPTION 'Entwürfe werden gelöscht, nicht storniert.'; END IF;
  IF v.typ NOT IN ('rechnung','teilrechnung','schlussrechnung') THEN RAISE EXCEPTION 'Nur Rechnungen können storniert werden.'; END IF;
  IF v.storniert_durch IS NOT NULL THEN RAISE EXCEPTION 'Beleg ist bereits storniert.'; END IF;

  INSERT INTO public.belege (typ, status, project_id, customer_id, vorgaenger_id,
    kunde_name, kunde_zusatz, kunde_strasse, kunde_plz_ort, kunde_uid, kunde_email,
    datum, leistung_von, leistung_bis, betreff, einleitung, schlusstext, reverse_charge, ust_satz, created_by)
  VALUES ('gutschrift', 'entwurf', v.project_id, v.customer_id, v.id,
    v.kunde_name, v.kunde_zusatz, v.kunde_strasse, v.kunde_plz_ort, v.kunde_uid, v.kunde_email,
    CURRENT_DATE, v.leistung_von, v.leistung_bis,
    'Gutschrift zu Rechnung ' || v.nummer,
    'Wir schreiben Ihnen zu Rechnung ' || v.nummer || ' vom ' || to_char(v.datum, 'DD.MM.YYYY') || ' gut:',
    NULL, v.reverse_charge, v.ust_satz, auth.uid())
  RETURNING id INTO v_neu;

  INSERT INTO public.beleg_positionen (beleg_id, pos, art, text, beschreibung, menge, einheit, einzelpreis, rabatt_prozent, quelle_typ, quelle_ids)
  SELECT v_neu, pos, art, text, beschreibung, menge, einheit, einzelpreis, rabatt_prozent, 'manuell', '{}'
    FROM public.beleg_positionen WHERE beleg_id = v.id ORDER BY pos;

  -- Stunden der stornierten Rechnung wieder freigeben (sie kommen auf die neue Rechnung)
  UPDATE public.time_entries SET abgerechnet_in = NULL WHERE abgerechnet_in = v.id;

  UPDATE public.belege SET status = 'storniert', storniert_durch = v_neu WHERE id = v.id;
  RETURN v_neu;
END $$;

-- ── Offene Stunden eines Projekts (für „Stunden holen") ─────────────────────
-- Nur Baustellen-/Arbeitszeit, keine Abwesenheiten, keine schon abgerechneten.
CREATE OR REPLACE FUNCTION public.faktura_offene_stunden(p_projekt uuid)
RETURNS TABLE (
  user_id uuid, mitarbeiter text, stundensatz_id uuid, gruppe text, satz numeric,
  von date, bis date, bloecke integer, stunden numeric, entry_ids uuid[]
) LANGUAGE sql SECURITY DEFINER SET search_path = public STABLE AS $$
  SELECT t.user_id,
         COALESCE(NULLIF(TRIM(CONCAT(p.vorname,' ',p.nachname)),''),'Unbekannt') AS mitarbeiter,
         p.stundensatz_id, s.bezeichnung, s.satz,
         MIN(t.datum), MAX(t.datum), COUNT(*)::integer, ROUND(SUM(t.stunden)::numeric, 2),
         array_agg(t.id ORDER BY t.datum)
    FROM public.time_entries t
    LEFT JOIN public.profiles p ON p.id = t.user_id
    LEFT JOIN public.faktura_stundensaetze s ON s.id = p.stundensatz_id
   WHERE t.project_id = p_projekt
     AND t.abgerechnet_in IS NULL
     AND t.stunden > 0
     AND COALESCE(t.taetigkeit,'') NOT IN ('Urlaub','Krankenstand','Weiterbildung','Feiertag','Zeitausgleich')
     AND public.has_role(auth.uid(), 'administrator'::app_role)
   GROUP BY t.user_id, p.vorname, p.nachname, p.stundensatz_id, s.bezeichnung, s.satz
   ORDER BY 2;
$$;

-- ── RLS: alles nur für Administratoren ──────────────────────────────────────
ALTER TABLE public.faktura_firmendaten   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.faktura_stundensaetze ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.faktura_nummernkreise ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.belege                ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.beleg_positionen      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.beleg_zahlungen       ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['faktura_firmendaten','faktura_stundensaetze','faktura_nummernkreise','belege','beleg_positionen','beleg_zahlungen'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_admin', t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR ALL TO authenticated USING (public.has_role(auth.uid(), ''administrator''::app_role)) WITH CHECK (public.has_role(auth.uid(), ''administrator''::app_role))',
      t || '_admin', t);
  END LOOP;
END $$;

-- Ablage der PDFs: Bucket project-files, Ordner „Anbote" (Michaels Ordnername) —
-- der bestehende OneDrive-Sync trägt sie in den Projektordner hinüber.

NOTIFY pgrst, 'reload schema';
