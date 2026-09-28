-- Wartungen (Terminwartung / Wartungsintervalle) und Restarbeiten je Projekt.
--
-- Wartungen: nur Administratoren — sie hängen an Kunden, Mails und Rechnungen.
-- Wird eine Wartung mit Intervall abgeschlossen, legt die App die nächste an
-- (eine Zeile je Termin, damit die Geschichte sichtbar bleibt).
--
-- Restarbeiten: alle angemeldeten Benutzer (wie Projekte selbst), löschen nur Admins.

create table if not exists public.wartungen (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid references public.customers(id) on delete set null,
  project_id uuid references public.projects(id) on delete set null,
  bezeichnung text not null check (length(trim(bezeichnung)) > 0),
  faellig_am date not null,
  vorlauf_tage integer not null default 14 check (vorlauf_tage between 0 and 365),
  intervall_monate integer check (intervall_monate is null or intervall_monate between 1 and 120),
  preis numeric(12,2),
  notiz text,
  status text not null default 'offen' check (status in ('offen', 'erledigt')),
  erledigt_am date,
  erledigt_von uuid references auth.users(id) on delete set null,
  mail_gesendet_am timestamptz,
  beleg_id uuid references public.belege(id) on delete set null,
  vorgaenger_id uuid references public.wartungen(id) on delete set null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_wartungen_offen on public.wartungen (faellig_am) where status = 'offen';
create index if not exists idx_wartungen_customer on public.wartungen (customer_id);
create index if not exists idx_wartungen_project on public.wartungen (project_id);

alter table public.wartungen enable row level security;

drop policy if exists wartungen_admin on public.wartungen;
create policy wartungen_admin on public.wartungen
  for all to authenticated
  using (has_role(auth.uid(), 'administrator'::app_role))
  with check (has_role(auth.uid(), 'administrator'::app_role));

drop trigger if exists update_wartungen_updated_at on public.wartungen;
create trigger update_wartungen_updated_at before update on public.wartungen
  for each row execute function update_updated_at_column();


create table if not exists public.restarbeiten (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  beschreibung text not null check (length(trim(beschreibung)) > 0),
  faellig_am date,
  zustaendig text,
  erledigt boolean not null default false,
  erledigt_am timestamptz,
  erledigt_von uuid references auth.users(id) on delete set null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_restarbeiten_project on public.restarbeiten (project_id);

alter table public.restarbeiten enable row level security;

drop policy if exists restarbeiten_lesen on public.restarbeiten;
create policy restarbeiten_lesen on public.restarbeiten
  for select to authenticated using (auth.uid() is not null);
drop policy if exists restarbeiten_anlegen on public.restarbeiten;
create policy restarbeiten_anlegen on public.restarbeiten
  for insert to authenticated with check (auth.uid() is not null);
drop policy if exists restarbeiten_aendern on public.restarbeiten;
create policy restarbeiten_aendern on public.restarbeiten
  for update to authenticated using (auth.uid() is not null) with check (auth.uid() is not null);
drop policy if exists restarbeiten_loeschen on public.restarbeiten;
create policy restarbeiten_loeschen on public.restarbeiten
  for delete to authenticated using (has_role(auth.uid(), 'administrator'::app_role));

drop trigger if exists update_restarbeiten_updated_at on public.restarbeiten;
create trigger update_restarbeiten_updated_at before update on public.restarbeiten
  for each row execute function update_updated_at_column();

-- Projektliste aktualisiert sich live, wenn Restarbeiten dazukommen/erledigt werden
do $$ begin
  alter publication supabase_realtime add table public.restarbeiten;
exception when duplicate_object then null; end $$;

-- Standard-Mailvorlage für die Wartungserinnerung (in der App änderbar)
insert into public.app_settings (key, value, updated_at)
values ('wartung_mail_vorlage', E'Betreff: Wartung {wartung} – Terminvereinbarung\n\nSehr geehrte/r {kunde},\n\ndie nächste {wartung} ist am {faellig} fällig.\nBitte teilen Sie uns mit, wann ein Termin für Sie passt – wir kümmern uns um den Rest.\n\nMit freundlichen Grüßen\nMichael Ruff\nRuff Michael GmbH', now())
on conflict (key) do nothing;
