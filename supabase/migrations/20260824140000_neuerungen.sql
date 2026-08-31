-- ============================================================================
--  NEUERUNGEN — "was wurde umgesetzt" direkt auf der Startseite
-- ============================================================================
--
-- Kundenwunsch 26.08.2026: "wenn Änderungen eingebaut sind, dass man auf der
-- Startseite gleich eine Meldung bekommt — bitte die Seite 1-2x aktualisieren
-- — die dann wieder weg ist, und dass er sieht, welche Änderungen umgesetzt
-- wurden (kurz) und wie."
--
-- Eine Neuerung kann auf einen gemeldeten Änderungswunsch zeigen; dann
-- schliesst sich der Kreis: melden -> umsetzen -> Rueckmeldung sehen.
-- Gelesen wird JE BENUTZER vermerkt, damit die Meldung nur einmal erscheint
-- und auch am zweiten Geraet verschwindet.

CREATE TABLE IF NOT EXISTS public.neuerungen (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  titel                TEXT NOT NULL,
  /* Kurz: was ist neu und wie bedient man es. */
  text                 TEXT,
  aenderungswunsch_id  UUID REFERENCES public.aenderungswuensche(id) ON DELETE SET NULL,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS neuerungen_zeit_idx ON public.neuerungen (created_at DESC);

CREATE TABLE IF NOT EXISTS public.neuerungen_gelesen (
  neuerung_id  UUID NOT NULL REFERENCES public.neuerungen(id) ON DELETE CASCADE,
  user_id      UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  gelesen_am   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (neuerung_id, user_id)
);

ALTER TABLE public.neuerungen ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.neuerungen_gelesen ENABLE ROW LEVEL SECURITY;

-- Lesen darf jeder Angemeldete; anlegen/aendern nur Administratoren.
DROP POLICY IF EXISTS neuerungen_lesen ON public.neuerungen;
CREATE POLICY neuerungen_lesen ON public.neuerungen
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS neuerungen_pflegen ON public.neuerungen;
CREATE POLICY neuerungen_pflegen ON public.neuerungen
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'administrator'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'administrator'::app_role));

-- Den eigenen Gelesen-Vermerk setzen und sehen.
DROP POLICY IF EXISTS neuerungen_gelesen_eigene ON public.neuerungen_gelesen;
CREATE POLICY neuerungen_gelesen_eigene ON public.neuerungen_gelesen
  FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

NOTIFY pgrst, 'reload schema';
