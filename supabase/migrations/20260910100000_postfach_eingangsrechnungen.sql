-- Postfach (Outlook/Microsoft 365) + Eingangsrechnungen
--
-- Die App holt die Mails aus office@ruffinstallateur.at über Microsoft Graph
-- (dieselbe App-Registrierung wie der OneDrive-Sync, zusätzlich Mail.Read).
-- Was wie eine Lieferantenrechnung aussieht, wird erkannt und landet als
-- Eingangsrechnung zum Prüfen. Alles ist streng auf Administratoren begrenzt —
-- Mitarbeiter haben mit dem Firmenpostfach nichts zu tun.

-- ── Mails ────────────────────────────────────────────────────────────────
create table if not exists public.mails (
  id uuid primary key default gen_random_uuid(),
  graph_id text not null unique,                 -- Message-ID bei Microsoft
  internet_message_id text,
  konversation_id text,
  ordner text not null default 'Posteingang',
  richtung text not null default 'eingang',      -- eingang | ausgang
  von_name text,
  von_adresse text,
  an_adressen jsonb not null default '[]'::jsonb,
  cc_adressen jsonb not null default '[]'::jsonb,
  betreff text,
  vorschau text,
  koerper_text text,
  empfangen_am timestamptz not null,
  gelesen boolean not null default false,
  wichtig boolean not null default false,
  hat_anhang boolean not null default false,
  -- eingangsrechnung | mahnung | angebot | bestellung | lieferschein
  -- | kundenanfrage | behoerde | werbung | sonstiges
  kategorie text not null default 'sonstiges',
  kategorie_quelle text,                         -- regel | ki | manuell
  kategorie_sicherheit numeric(4,3),
  kategorie_grund text,
  kunde_id uuid references public.customers(id) on delete set null,
  project_id uuid references public.projects(id) on delete set null,
  erledigt boolean not null default false,
  notiz text,
  web_link text,                                 -- direkt in Outlook öffnen
  geholt_am timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists mails_empfangen_idx on public.mails (empfangen_am desc);
create index if not exists mails_kategorie_idx on public.mails (kategorie, empfangen_am desc);
create index if not exists mails_kunde_idx on public.mails (kunde_id) where kunde_id is not null;
create index if not exists mails_projekt_idx on public.mails (project_id) where project_id is not null;
create index if not exists mails_von_idx on public.mails (von_adresse);

-- ── Anhänge ──────────────────────────────────────────────────────────────
create table if not exists public.mail_anhaenge (
  id uuid primary key default gen_random_uuid(),
  mail_id uuid not null references public.mails(id) on delete cascade,
  graph_id text,
  name text not null,
  mime text,
  groesse bigint,
  pfad text,                                     -- Bucket mail-anhaenge
  ist_beleg boolean not null default false,      -- PDF/Bild, kein Logo aus der Signatur
  created_at timestamptz not null default now(),
  unique (mail_id, graph_id)
);
create index if not exists mail_anhaenge_mail_idx on public.mail_anhaenge (mail_id);

-- ── Eingangsrechnungen ───────────────────────────────────────────────────
create table if not exists public.eingangsrechnungen (
  id uuid primary key default gen_random_uuid(),
  mail_id uuid references public.mails(id) on delete set null,
  anhang_id uuid references public.mail_anhaenge(id) on delete set null,
  lieferant text not null,
  lieferant_uid text,
  nummer text,
  datum date,
  faellig_am date,
  netto numeric(12,2),
  ust numeric(12,2),
  brutto numeric(12,2),
  waehrung text not null default 'EUR',
  iban text,
  verwendungszweck text,
  skonto_prozent numeric(5,2),
  skonto_bis date,
  -- offen: noch nicht geprüft | geprueft: sachlich richtig | bezahlt | abgelehnt
  status text not null default 'offen',
  bezahlt_am date,
  project_id uuid references public.projects(id) on delete set null,
  pdf_pfad text,
  quelle text not null default 'mail',           -- mail | manuell
  erkannt_von text,                              -- ki | regel | manuell
  sicherheit numeric(4,3),
  notiz text,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists eingangsrechnungen_status_idx on public.eingangsrechnungen (status, faellig_am);
create index if not exists eingangsrechnungen_datum_idx on public.eingangsrechnungen (datum desc);
create index if not exists eingangsrechnungen_mail_idx on public.eingangsrechnungen (mail_id);
-- Eine Mail-Anlage wird nur einmal zur Eingangsrechnung
create unique index if not exists eingangsrechnungen_anhang_uniq on public.eingangsrechnungen (anhang_id) where anhang_id is not null;

-- ── Sync-Zustand ─────────────────────────────────────────────────────────
create table if not exists public.mail_sync_state (
  id text primary key default 'postfach',
  delta_link text,
  letzter_lauf timestamptz,
  letzter_fehler text,
  anzahl_gesamt integer not null default 0,
  updated_at timestamptz not null default now()
);
insert into public.mail_sync_state (id) values ('postfach') on conflict (id) do nothing;

-- ── updated_at ───────────────────────────────────────────────────────────
drop trigger if exists trg_mails_updated on public.mails;
create trigger trg_mails_updated before update on public.mails
  for each row execute function public.touch_updated_at();
drop trigger if exists trg_eingangsrechnungen_updated on public.eingangsrechnungen;
create trigger trg_eingangsrechnungen_updated before update on public.eingangsrechnungen
  for each row execute function public.touch_updated_at();

-- ── Zugriff: ausschließlich Administratoren ──────────────────────────────
alter table public.mails enable row level security;
alter table public.mail_anhaenge enable row level security;
alter table public.eingangsrechnungen enable row level security;
alter table public.mail_sync_state enable row level security;

drop policy if exists mails_admin on public.mails;
create policy mails_admin on public.mails for all
  using (has_role(auth.uid(), 'administrator'::app_role))
  with check (has_role(auth.uid(), 'administrator'::app_role));

drop policy if exists mail_anhaenge_admin on public.mail_anhaenge;
create policy mail_anhaenge_admin on public.mail_anhaenge for all
  using (has_role(auth.uid(), 'administrator'::app_role))
  with check (has_role(auth.uid(), 'administrator'::app_role));

drop policy if exists eingangsrechnungen_admin on public.eingangsrechnungen;
create policy eingangsrechnungen_admin on public.eingangsrechnungen for all
  using (has_role(auth.uid(), 'administrator'::app_role))
  with check (has_role(auth.uid(), 'administrator'::app_role));

drop policy if exists mail_sync_state_admin on public.mail_sync_state;
create policy mail_sync_state_admin on public.mail_sync_state for all
  using (has_role(auth.uid(), 'administrator'::app_role))
  with check (has_role(auth.uid(), 'administrator'::app_role));

-- ── Anhänge im Speicher (privat, nur Administratoren) ────────────────────
insert into storage.buckets (id, name, public, file_size_limit)
values ('mail-anhaenge', 'mail-anhaenge', false, 52428800)
on conflict (id) do nothing;

drop policy if exists "Mail-Anhaenge lesen" on storage.objects;
create policy "Mail-Anhaenge lesen" on storage.objects for select
  using (bucket_id = 'mail-anhaenge' and has_role(auth.uid(), 'administrator'::app_role));
drop policy if exists "Mail-Anhaenge schreiben" on storage.objects;
create policy "Mail-Anhaenge schreiben" on storage.objects for insert
  with check (bucket_id = 'mail-anhaenge' and has_role(auth.uid(), 'administrator'::app_role));
drop policy if exists "Mail-Anhaenge aendern" on storage.objects;
create policy "Mail-Anhaenge aendern" on storage.objects for update
  using (bucket_id = 'mail-anhaenge' and has_role(auth.uid(), 'administrator'::app_role));
drop policy if exists "Mail-Anhaenge loeschen" on storage.objects;
create policy "Mail-Anhaenge loeschen" on storage.objects for delete
  using (bucket_id = 'mail-anhaenge' and has_role(auth.uid(), 'administrator'::app_role));

-- ── Kennzahlen für die Übersicht ─────────────────────────────────────────
create or replace function public.eingangsrechnungen_summen()
returns table (
  offen_anzahl integer, offen_brutto numeric,
  faellig_anzahl integer, faellig_brutto numeric,
  monat_brutto numeric, ungelesen_mails integer, neue_rechnungen integer
)
language sql
stable
security definer
set search_path to 'public'
as $$
  select
    (select count(*)::int from eingangsrechnungen where status in ('offen','geprueft')),
    (select coalesce(sum(brutto), 0) from eingangsrechnungen where status in ('offen','geprueft')),
    (select count(*)::int from eingangsrechnungen where status in ('offen','geprueft') and faellig_am is not null and faellig_am <= current_date + 7),
    (select coalesce(sum(brutto), 0) from eingangsrechnungen where status in ('offen','geprueft') and faellig_am is not null and faellig_am <= current_date + 7),
    (select coalesce(sum(brutto), 0) from eingangsrechnungen where datum >= date_trunc('month', current_date)),
    (select count(*)::int from mails where not gelesen and not erledigt),
    (select count(*)::int from eingangsrechnungen where status = 'offen' and created_at > now() - interval '7 days')
  where has_role(auth.uid(), 'administrator'::app_role);
$$;
revoke all on function public.eingangsrechnungen_summen() from public;
grant execute on function public.eingangsrechnungen_summen() to authenticated;
