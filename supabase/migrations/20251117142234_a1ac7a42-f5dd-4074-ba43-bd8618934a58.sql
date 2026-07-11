-- 1. DATENBEREINIGUNG: Alte Einträge mit Standardwerten füllen (mit korrektem Type Casting)
UPDATE time_entries
SET 
  start_time = '07:30:00'::time,
  end_time = CASE 
    WHEN EXTRACT(DOW FROM datum) = 5 THEN '12:30:00'::time  -- Freitag
    ELSE '17:00:00'::time  -- Montag-Donnerstag
  END,
  pause_minutes = CASE 
    WHEN EXTRACT(DOW FROM datum) = 5 THEN 0  -- Freitag
    ELSE 60  -- Montag-Donnerstag
  END
WHERE start_time IS NULL OR end_time IS NULL OR pause_minutes IS NULL;

-- 2. NOT NULL CONSTRAINTS hinzufügen
ALTER TABLE time_entries 
ALTER COLUMN start_time SET NOT NULL;

ALTER TABLE time_entries 
ALTER COLUMN end_time SET NOT NULL;

ALTER TABLE time_entries 
ALTER COLUMN pause_minutes SET DEFAULT 0;

ALTER TABLE time_entries 
ALTER COLUMN pause_minutes SET NOT NULL;

-- 3. CHECK CONSTRAINTS für logische Validierung
ALTER TABLE time_entries
ADD CONSTRAINT check_time_order 
CHECK (end_time > start_time);

ALTER TABLE time_entries
ADD CONSTRAINT check_pause_positive 
CHECK (pause_minutes >= 0);