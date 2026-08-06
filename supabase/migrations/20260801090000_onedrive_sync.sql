-- OneDrive-Synchronisation (Microsoft 365 / Graph API)
--
-- projects.onedrive_folder_id: die Graph-Item-ID des Projektordners in
-- OneDrive/SharePoint. Übersteht Umbenennungen auf beiden Seiten.
alter table public.projects
  add column if not exists onedrive_folder_id text;

-- Sync-Zustand pro Datei: merkt sich, welchen Stand beide Seiten beim letzten
-- Abgleich hatten. Nur so ist ein ECHTER Zwei-Wege-Sync möglich, ohne dass
-- Dateien endlos hin- und herkopiert werden (Ping-Pong) und ohne dass
-- Löschungen versehentlich "wiederhergestellt" werden.
create table if not exists public.onedrive_sync_state (
  bucket text not null,
  project_id uuid not null references public.projects(id) on delete cascade,
  rel_path text not null,               -- Pfad innerhalb des Projekts (Storage-Schreibweise)
  supa_updated timestamptz,             -- Stand der App-Datei beim letzten Sync
  od_modified timestamptz,              -- Stand der OneDrive-Datei beim letzten Sync
  od_item_id text,                      -- Graph-Item-ID (stabil bei Umbenennung)
  last_synced timestamptz not null default now(),
  primary key (bucket, project_id, rel_path)
);

-- Nur der Server (Service-Role in der Edge Function) arbeitet mit dieser
-- Tabelle; normale Nutzer haben keinen Zugriff.
alter table public.onedrive_sync_state enable row level security;
