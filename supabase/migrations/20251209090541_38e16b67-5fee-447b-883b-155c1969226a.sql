-- Entferne die UNIQUE Constraint für (user_id, datum) um mehrere Einträge pro Tag zu ermöglichen
ALTER TABLE public.time_entries 
DROP CONSTRAINT IF EXISTS time_entries_user_datum_unique;

-- Erstelle einen Index für schnellere Abfragen auf user_id + datum
CREATE INDEX IF NOT EXISTS idx_time_entries_user_datum 
ON public.time_entries(user_id, datum);