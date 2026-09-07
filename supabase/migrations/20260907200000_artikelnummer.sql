-- Artikelkatalog: Artikelnummer (wie in den bisherigen KingBill-Belegen, z. B. „0021“)
-- und Herkunft des Eintrags („import“ = aus alten Angeboten/Rechnungen übernommen).
ALTER TABLE public.materials
  ADD COLUMN IF NOT EXISTS artikelnummer text,
  ADD COLUMN IF NOT EXISTS quelle text;
CREATE INDEX IF NOT EXISTS materials_artikelnummer_idx ON public.materials (artikelnummer);
CREATE INDEX IF NOT EXISTS materials_name_idx ON public.materials (lower(name));
