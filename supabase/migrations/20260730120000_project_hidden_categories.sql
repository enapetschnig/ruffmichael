-- Pro-Projekt konfigurierbare Kategorie-Ordner.
-- Speichert, welche der festen Ordner (photos, plans, reports, materials) in
-- einem Projekt AUSGEBLENDET sind. Leeres Array (Default) = alle sichtbar,
-- damit bestehende Projekte unverändert bleiben. Der Chef-Ordner ist NICHT
-- konfigurierbar (immer vorhanden, nur für Admins).
alter table public.projects
  add column if not exists hidden_categories text[] not null default '{}';

comment on column public.projects.hidden_categories is
  'Ausgeblendete Kategorie-Ordner dieses Projekts (Teilmenge von photos/plans/reports/materials). Dateien bleiben erhalten; nur Anzeige/Upload werden ausgeblendet. Chef ist nie enthalten.';
