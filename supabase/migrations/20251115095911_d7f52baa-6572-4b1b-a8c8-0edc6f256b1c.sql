-- PLZ als separates Pflichtfeld zur projects-Tabelle hinzufügen
ALTER TABLE public.projects 
ADD COLUMN plz text;

-- Für bestehende Projekte PLZ aus Adresse extrahieren (wenn möglich)
UPDATE public.projects 
SET plz = substring(adresse FROM '\d{4,5}')
WHERE adresse IS NOT NULL AND plz IS NULL;

-- Standardwert für Projekte ohne PLZ in der Adresse
UPDATE public.projects 
SET plz = '0000'
WHERE plz IS NULL;

-- PLZ für neue Projekte verpflichtend machen
ALTER TABLE public.projects 
ALTER COLUMN plz SET NOT NULL;