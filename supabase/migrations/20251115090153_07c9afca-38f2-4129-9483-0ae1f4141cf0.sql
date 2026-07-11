-- Erweitere time_entries Tabelle für detaillierte Zeiterfassung
ALTER TABLE time_entries
ADD COLUMN start_time time,
ADD COLUMN end_time time,
ADD COLUMN pause_minutes integer DEFAULT 0,
ADD COLUMN location_type text DEFAULT 'baustelle' CHECK (location_type IN ('baustelle', 'werkstatt'));

-- Mache project_id optional für Werkstatt-Einträge
ALTER TABLE time_entries
ALTER COLUMN project_id DROP NOT NULL;

-- Kommentar für Dokumentation
COMMENT ON COLUMN time_entries.start_time IS 'Startzeit der Arbeit';
COMMENT ON COLUMN time_entries.end_time IS 'Endzeit der Arbeit';
COMMENT ON COLUMN time_entries.pause_minutes IS 'Pausenzeit in Minuten';
COMMENT ON COLUMN time_entries.location_type IS 'Arbeitsort: baustelle oder werkstatt (für Diätenberechnung)';