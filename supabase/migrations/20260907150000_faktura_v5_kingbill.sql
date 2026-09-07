-- Faktura v5: Belege im Aufbau von Michaels bisherigen KingBill-Dokumenten,
-- Regieberichte direkt auf die Rechnung holen, Angebotstexte (Auftrags-
-- bedingungen, Zahlung, Widerrufsbelehrung) als Firmendaten pflegbar.

-- ── 1. Firmendaten: zusätzliche Felder + Texte aus dem bisherigen Angebot ──
ALTER TABLE public.faktura_firmendaten
  ADD COLUMN IF NOT EXISTS fax text,
  ADD COLUMN IF NOT EXISTS bearbeiter text,
  ADD COLUMN IF NOT EXISTS angebot_zahlung text,
  ADD COLUMN IF NOT EXISTS angebot_bedingungen text,
  ADD COLUMN IF NOT EXISTS angebot_widerruf text,
  ADD COLUMN IF NOT EXISTS angebot_widerruf_zeigen boolean NOT NULL DEFAULT true;

UPDATE public.faktura_firmendaten SET
  fax = COALESCE(fax, '+43 2628 611022'),
  bearbeiter = COALESCE(bearbeiter, 'Michael Ruff'),
  fusstext = CASE WHEN fusstext LIKE 'Mitglied der WKO%Fax%' THEN 'Mitglied der WKO Niederösterreich' ELSE fusstext END,
  angebot_zahlung = COALESCE(angebot_zahlung,
    'Das Entgelt wird in bar oder durch Zahlung per Kredit- oder Bankomatkarte auf das im Anbot bzw auf der Rechnung angeführte Bankkonto der RUFF Michael GmbH fällig.'),
  angebot_bedingungen = COALESCE(angebot_bedingungen, $t$1. Die Ausführung dieses Angebots erfolgt mit Unterfertigung durch den Auftraggeber.
2. Die RUFF Michael GmbH als Auftragnehmerin erklärt ausdrücklich, dass das unverbindliche Angebot nicht mit einer Richtigkeitsgewähr verbunden ist. Unbeträchtliche Überschreitungen der Anbotssumme sind vom Auftraggeber auch ohne Vorwarnung zu akzeptieren.
3. Beträchtliche Überschreitungen der Anbotssumme zeigt die Auftragnehmerin mit Auftrags- und Arbeitsbestätigung für Regieleistungen an. Mit Unterfertigung dieser Auftrags- und Arbeitsbestätigung für Regieleistungen stimmt der Auftraggeber einer Überschreitung des ursprünglichen unverbindlichen Anbots zu und hat den höheren Werklohn zu bezahlen. Alternativ kann der Auftraggeber vom Werkvertrag zurücktreten, hat jedoch die bisher geleisteten Arbeiten der RUFF Michael GmbH angemessen zu vergüten.
4. Änderungen, Erweiterungen, Nebenaufträge sowie über das unverbindliche Anbot hinausgehende Leistungen werden mit Auftrags- und Arbeitsbestätigung für Regieleistungen ausgeführt und zu den unten angeführten Regiesätzen verrechnet. Materialkosten werden zu dem im Zeitpunkt der Rechnungslegung geltenden Großhandelspreisen nach tatsächlichem Aufwand verrechnet.
5. Sämtliche gelieferten und montierten Waren bleiben bis zur vollständigen Bezahlung des Werklohns im Alleineigentum der RUFF Michael GmbH.
6. Gerät der Auftraggeber in Zahlungsverzug, ist die Auftragnehmerin berechtigt, die unter Eigentumsvorbehalt stehenden Waren zurückzunehmen, ohne damit vom Werkvertrag zurückzutreten.
7. Bei Zahlungsverzug ist die Auftragnehmerin berechtigt, Verzugszinsen von 10 %, bei Verbrauchergeschäften von 4 % pro Jahr, zu berechnen. Mit dem Zahlungsverzug verbundene Mahnspesen gehen zu Lasten des Auftraggebers.
8. Sofern im Anbot nichts Gegenteiliges angeführt ist, erfolgt die Abrechnung der erbrachten Leistungen zu den unten angeführten Zahlungsbedingungen nach Baufortschritt in Form von Teilrechnungen ohne Deckungsrücklass.
9. Für beigestellte Geräte, Armaturen, Ausstattungsartikel und sonstiges Material werden allfällige Gewährleistungsansprüche in und mit Verbindung der hergestellten Anlage, sofern es sich bei dem Auftraggeber um keinen Verbraucher handelt, ausgeschlossen.
10. Sofern der Auftraggeber die RUFF Michael GmbH mit der Errichtung, Reparatur oder Instandsetzung bzw Instandhaltung einer Sanitär-, Heizungs-, Lüftungs- oder Kälteanlage beauftragt hat, erfolgt die Programmierung der Anlage zu dem im Anbot angeführten Pauschalpreis. Für den Fall der Überschreitung dieses Pauschalpreises gelten die Punkte 3. und 4. der Auftragsbedingungen.
11. Das installierte Programm steht im geistigen Eigentum der RUFF Michael GmbH („Ruff-Regler“). Auf Wunsch des Auftraggebers kann dieser nach vollständiger Bezahlung des Werklohns die Zurücksetzung auf die Werkseinstellungen verlangen. Der Auftraggeber stimmt ausdrücklich zu, dass die auftragsgegenständliche Anlage ab Arbeitsbeginn bis zur Fertigstellung des Werks und vollständiger Bezahlung des Werklohns mittels LAN-Verbindung durch den Auftraggeber gesteuert und gewartet werden kann.
12. Als Gerichtsstand vereinbaren die Vertragsparteien das sachlich zuständige Gericht in 2700 Wiener Neustadt.
13. Die Auftragnehmerin weist den Auftraggeber ausdrücklich vor Vertragsabschluss darauf hin, dass die Allgemeinen Geschäftsbedingungen (AGB) der RUFF Michael GmbH zur Einsicht auf deren Website unter https://www.ruffinstallateur.at/agb aufruf- und downloadbar sind. Mit Auftragserteilung anerkennt der Auftraggeber die Auftragsbedingungen und die AGB der Auftragnehmerin und werden diese einvernehmlich dem Vertragsverhältnis zu Grunde gelegt.
14. Regiestundensätze:
   - Monteur: € 82,00 pro Stunde zzgl. MwSt.
   - Service Monteur: € 97,00 pro Stunde zzgl. MwSt.
   - Partie (2 Monteure): € 164,00 pro Stunde zzgl. MwSt.
15. Zahlungsbedingungen:
   - 40 % der Anbotssumme unverzüglich nach Auftragserteilung.
   - 40 % der Anbotssumme unverzüglich nach Arbeitsbeginn.
   - offener Restbetrag unverzüglich nach Fertigstellung.$t$),
  angebot_widerruf = COALESCE(angebot_widerruf, $t$Sie haben das Recht, binnen 14 Tagen ohne Angaben von Gründen diesen Vertrag zu widerrufen. Die Widerrufsfrist beträgt 14 Tage ab dem Tag des Vertragsabschlusses. Um Ihr Widerrufsrecht auszuüben, müssen Sie die RUFF Michael GmbH, Maria Theresienstraße 21-23, 2601 Eggendorf / Mt, Tel: 0699/14330708, Fax: 02628/611022, E-Mail: office@ruffinstallateur.at, mittels einer eindeutigen Erklärung (zB Brief, E-Mail, Telefax) über Ihren Entschluss, diesen Vertrag zu widerrufen, informieren. Zu diesem Behelf steht es Ihnen frei, das Muster-Widerrufsformular (gem. Anhang I zu BGBl. I 2014/33) zu verwenden. Zur Wahrung der Widerrufsfrist genügt es, wenn Sie die Mitteilung über die Ausübung des Widerrufsrechts vor Ablauf der Widerrufsfrist absenden. Bei fristgerechtem Widerruf erfolgt die Rückzahlung eines allfälligen zu diesem Zeitpunkt bereits geleisteten Entgelts an ein von Ihnen bekanntzugebendes inländisches Bankkonto binnen 14 Tagen ab Einlangen der Widerrufserklärung. Hat die RUFF Michael GmbH mit der Erfüllung ihrer Dienstleistung bereits vor Ablauf der Rücktrittsfrist begonnen, ist diese aber noch nicht vollendet, werden Sie im Fall der Ausübung des Rücktrittsrechts für die bereits erhaltene Teilleistung anteilig zahlungspflichtig, wenn Sie die vorzeitige Vertragserfüllung ausdrücklich verlangt haben. Ihnen steht kein Rücktrittsrecht zu, wenn die RUFF Michael GmbH ihre Dienstleistung bereits vollständig erbracht hat, Sie einem Beginn der Vertragserfüllung vor Ablauf der Widerrufsfrist ausdrücklich zugestimmt haben und Sie entweder vor Beginn der Dienstleistungserbringung bestätigt haben, dass Sie Ihr Rücktrittsrecht mit vollständiger Vertragserfüllung verlieren oder die RUFF Michael GmbH ausdrücklich zu einem Besuch aufgefordert haben, um Reparaturarbeiten vornehmen zu lassen. Kein Rücktrittsrecht besteht zudem bei Waren, die nach Kundenspezifikationen angefertigt werden oder eindeutig auf die persönlichen Bedürfnisse des Kunden zugeschnitten sind. Weiters steht Ihnen kein Rücktrittsrecht bei Verträgen über dringende Reparatur- oder Instandhaltungsarbeiten zu, bei denen Sie die RUFF Michael GmbH ausdrücklich zu einem Besuch zur Ausführung dieser Arbeiten aufgefordert haben. Davon sind jedoch weitere Dienstleistungen, die Sie nicht ausdrücklich verlangt haben oder gelieferte Waren, die bei der Instandhaltung oder Reparatur nicht unbedingt als Ersatzteile benötigt werden, nicht umfasst.

Ich erkläre hiermit ausdrücklich, die RUFF Michael GmbH zur Erfüllung der beauftragten Dienstleistung noch vor Ablauf der Rücktrittsfrist aufgefordert zu haben und nehme den Verlust des Rücktrittsrechts bei vollständiger Vertragserfüllung bzw die anteilige Zahlungspflicht bei begonnener aber noch nicht vollendeter Vertragserfüllung zur Kenntnis. Weiters erkläre ich ausdrücklich, die RUFF Michael GmbH zu einem Besuch zur Ausführung von dringenden Reparatur- oder Instandhaltungsarbeiten aufgefordert zu haben.$t$)
WHERE einzig;

-- ── 2. Regieberichte auf Rechnungen ─────────────────────────────────────
ALTER TABLE public.disturbances
  ADD COLUMN IF NOT EXISTS abgerechnet_in uuid REFERENCES public.belege(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS disturbances_abgerechnet_in_idx ON public.disturbances(abgerechnet_in);

-- Verrechnung nur durch Administratoren; is_verrechnet folgt der Zuordnung.
-- Ein Regiebericht, der auf einer Rechnung liegt, lässt sich nicht löschen
-- oder von Hand auf „nicht verrechnet“ stellen — zuerst von der Rechnung nehmen.
CREATE OR REPLACE FUNCTION public.trg_disturbance_abgerechnet()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.abgerechnet_in IS NOT NULL AND auth.uid() IS NOT NULL THEN
      RAISE EXCEPTION 'Dieser Regiebericht ist auf einer Rechnung — zuerst dort entfernen.';
    END IF;
    RETURN OLD;
  END IF;
  IF NEW.abgerechnet_in IS DISTINCT FROM OLD.abgerechnet_in THEN
    IF auth.uid() IS NOT NULL AND NOT public.has_role(auth.uid(), 'administrator'::app_role) THEN
      RAISE EXCEPTION 'Die Verrechnung eines Regieberichts ändert nur der Administrator.';
    END IF;
    NEW.is_verrechnet := NEW.abgerechnet_in IS NOT NULL;
  ELSIF OLD.abgerechnet_in IS NOT NULL AND COALESCE(NEW.is_verrechnet, false) = false THEN
    RAISE EXCEPTION 'Dieser Regiebericht ist auf einer Rechnung — zuerst dort entfernen.';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_disturbance_abgerechnet ON public.disturbances;
CREATE TRIGGER trg_disturbance_abgerechnet
  BEFORE UPDATE OR DELETE ON public.disturbances
  FOR EACH ROW EXECUTE FUNCTION public.trg_disturbance_abgerechnet();

-- Offene (noch nicht verrechnete) Regieberichte inkl. Material und Stundensatz
CREATE OR REPLACE FUNCTION public.faktura_offene_regieberichte()
RETURNS TABLE(id uuid, datum date, kunde_name text, beschreibung text, stunden numeric, user_id uuid,
              mitarbeiter text, satz numeric, gruppe text, unterschrieben boolean, materialien jsonb)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT d.id, d.datum, d.kunde_name, d.beschreibung, COALESCE(d.stunden, 0), d.user_id,
         COALESCE(NULLIF(TRIM(CONCAT(p.vorname, ' ', p.nachname)), ''), 'Unbekannt'),
         s.satz, s.bezeichnung, d.unterschrift_kunde IS NOT NULL,
         COALESCE((SELECT jsonb_agg(jsonb_build_object('material', m.material, 'menge', m.menge, 'notizen', m.notizen) ORDER BY m.created_at)
                     FROM public.disturbance_materials m WHERE m.disturbance_id = d.id), '[]'::jsonb)
    FROM public.disturbances d
    LEFT JOIN public.profiles p ON p.id = d.user_id
    LEFT JOIN public.faktura_stundensaetze s ON s.id = p.stundensatz_id
   WHERE d.abgerechnet_in IS NULL
     AND COALESCE(d.is_verrechnet, false) = false
     AND public.has_role(auth.uid(), 'administrator'::app_role)
   ORDER BY d.datum DESC, d.created_at DESC;
$$;

-- Regieberichte einem Beleg zuordnen (p_beleg) oder wieder freigeben (NULL).
-- Die automatisch aus dem Regiebericht entstandenen Zeiteinträge gelten mit.
CREATE OR REPLACE FUNCTION public.faktura_regieberichte_markieren(p_beleg uuid, p_ids uuid[])
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE n integer; v_status text;
BEGIN
  IF NOT public.has_role(auth.uid(), 'administrator'::app_role) THEN
    RAISE EXCEPTION 'Nur Administratoren dürfen Regieberichte verrechnen.';
  END IF;
  IF p_beleg IS NOT NULL THEN
    SELECT status INTO v_status FROM public.belege WHERE id = p_beleg;
    IF v_status IS DISTINCT FROM 'entwurf' THEN RAISE EXCEPTION 'Beleg ist festgeschrieben.'; END IF;
    UPDATE public.disturbances SET abgerechnet_in = p_beleg
     WHERE id = ANY(p_ids) AND abgerechnet_in IS NULL AND COALESCE(is_verrechnet, false) = false;
    GET DIAGNOSTICS n = ROW_COUNT;
    IF n <> cardinality(p_ids) THEN
      RAISE EXCEPTION 'Einige Regieberichte sind bereits verrechnet — bitte „Regieberichte holen“ erneut öffnen.';
    END IF;
    UPDATE public.time_entries SET abgerechnet_in = p_beleg
     WHERE disturbance_id = ANY(p_ids) AND abgerechnet_in IS NULL;
  ELSE
    UPDATE public.disturbances SET abgerechnet_in = NULL WHERE id = ANY(p_ids);
    GET DIAGNOSTICS n = ROW_COUNT;
    UPDATE public.time_entries SET abgerechnet_in = NULL WHERE disturbance_id = ANY(p_ids);
  END IF;
  RETURN n;
END $$;

-- Storno per Gutschrift gibt auch die Regieberichte der Rechnung wieder frei
CREATE OR REPLACE FUNCTION public.beleg_festschreiben(p_beleg uuid)
RETURNS belege LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
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
    UPDATE public.belege SET status = 'festgeschrieben', festgeschrieben_am = now()
     WHERE id = p_beleg RETURNING * INTO v;
    RETURN v;
  END IF;

  v_kreis := v.kreis;
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

  IF v.typ = 'gutschrift' AND v.vorgaenger_id IS NOT NULL THEN
    UPDATE public.belege SET status = 'storniert', storniert_durch = p_beleg
     WHERE id = v.vorgaenger_id AND storniert_durch IS NULL;
    UPDATE public.time_entries SET abgerechnet_in = NULL WHERE abgerechnet_in = v.vorgaenger_id;
    UPDATE public.disturbances SET abgerechnet_in = NULL WHERE abgerechnet_in = v.vorgaenger_id;
  END IF;
  RETURN v;
END $function$;
