-- Änderungswünsche: Mitarbeiter melden Wünsche/Fehler/Fragen direkt aus der App,
-- wahlweise getippt oder als Sprachnachricht, mit Bildschirmfoto zur Stelle.

CREATE TABLE IF NOT EXISTS public.aenderungswuensche (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  erstellt_von  UUID REFERENCES auth.users(id) ON DELETE SET NULL DEFAULT auth.uid(),
  -- Der getippte bzw. abgeschriebene Hinweis. Darf bei reiner Sprachnachricht
  -- zunächst leer sein — die Abschrift trägt ihn nach.
  text          TEXT NOT NULL DEFAULT '',
  art           TEXT NOT NULL DEFAULT 'wunsch'
                CHECK (art IN ('wunsch', 'fehler', 'frage')),
  seite         TEXT,                      -- wo war der Mensch, als es auffiel
  bild_pfad     TEXT,
  audio_pfad    TEXT,
  abschrift     TEXT NOT NULL DEFAULT 'fertig'
                CHECK (abschrift IN ('offen', 'laeuft', 'fertig', 'fehler')),
  abschrift_fehler TEXT,
  status        TEXT NOT NULL DEFAULT 'neu'
                CHECK (status IN ('neu', 'gesehen', 'umgesetzt', 'abgelehnt')),
  antwort       TEXT,
  -- Wann der Melder die Erledigung auf der Startseite zur Kenntnis genommen hat
  melder_gesehen_am TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS aenderungswuensche_status_idx ON public.aenderungswuensche (status);
CREATE INDEX IF NOT EXISTS aenderungswuensche_zeit_idx   ON public.aenderungswuensche (created_at DESC);

DROP TRIGGER IF EXISTS trg_aenderungswuensche_updated ON public.aenderungswuensche;
CREATE TRIGGER trg_aenderungswuensche_updated
  BEFORE UPDATE ON public.aenderungswuensche
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.aenderungswuensche ENABLE ROW LEVEL SECURITY;

-- Melden darf jeder Angemeldete, aber nur im eigenen Namen.
DROP POLICY IF EXISTS aenderungswuensche_anlegen ON public.aenderungswuensche;
CREATE POLICY aenderungswuensche_anlegen ON public.aenderungswuensche
  FOR INSERT TO authenticated
  WITH CHECK (erstellt_von = auth.uid());

-- Sehen: den eigenen Wunsch immer, alle nur als Administrator.
DROP POLICY IF EXISTS aenderungswuensche_lesen ON public.aenderungswuensche;
CREATE POLICY aenderungswuensche_lesen ON public.aenderungswuensche
  FOR SELECT TO authenticated
  USING (erstellt_von = auth.uid() OR public.has_role(auth.uid(), 'administrator'::app_role));

-- Ändern: der eigene Wunsch (die Abschrift trägt den Text nach) und alles
-- als Administrator (Status, Antwort).
DROP POLICY IF EXISTS aenderungswuensche_bearbeiten ON public.aenderungswuensche;
CREATE POLICY aenderungswuensche_bearbeiten ON public.aenderungswuensche
  FOR UPDATE TO authenticated
  USING      (erstellt_von = auth.uid() OR public.has_role(auth.uid(), 'administrator'::app_role))
  WITH CHECK (erstellt_von = auth.uid() OR public.has_role(auth.uid(), 'administrator'::app_role));

DROP POLICY IF EXISTS aenderungswuensche_loeschen ON public.aenderungswuensche;
CREATE POLICY aenderungswuensche_loeschen ON public.aenderungswuensche
  FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'administrator'::app_role));

-- ── Ablage für Bildschirmfotos und Sprachnachrichten ───────────────────────

INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('aenderungswuensche', 'aenderungswuensche', false, 26214400)
ON CONFLICT (id) DO UPDATE SET file_size_limit = EXCLUDED.file_size_limit;

-- WICHTIG: Ordnername = eigene user-id. Darauf bauen alle drei Policies.
DROP POLICY IF EXISTS aenderung_datei_hochladen ON storage.objects;
CREATE POLICY aenderung_datei_hochladen ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'aenderungswuensche'
              AND (storage.foldername(name))[1] = auth.uid()::text);

DROP POLICY IF EXISTS aenderung_datei_ansehen ON storage.objects;
CREATE POLICY aenderung_datei_ansehen ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'aenderungswuensche'
         AND ((storage.foldername(name))[1] = auth.uid()::text
              OR public.has_role(auth.uid(), 'administrator'::app_role)));

DROP POLICY IF EXISTS aenderung_datei_loeschen ON storage.objects;
CREATE POLICY aenderung_datei_loeschen ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'aenderungswuensche'
         AND ((storage.foldername(name))[1] = auth.uid()::text
              OR public.has_role(auth.uid(), 'administrator'::app_role)));

NOTIFY pgrst, 'reload schema';
