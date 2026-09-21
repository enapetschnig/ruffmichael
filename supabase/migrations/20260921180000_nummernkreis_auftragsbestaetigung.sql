-- Auftragsbestätigungen bekommen einen eigenen Nummernkreis (wie in KingBill:
-- Angebot 2026-1157, Auftragsbestätigung 2026-3001). Bisher teilten sie sich
-- den Kreis „angebot“ — beim Import der KingBill-Historie würden sich die
-- Serien vermischen.
drop index if exists public.belege_kreis_nummer_uniq;
alter table public.belege drop column kreis;
alter table public.belege add column kreis text generated always as (
  case
    when typ = 'angebot' then 'angebot'
    when typ = 'auftragsbestaetigung' then 'auftragsbestaetigung'
    when typ = 'gutschrift' then 'gutschrift'
    else 'rechnung'
  end) stored;
create unique index belege_kreis_nummer_uniq on public.belege (kreis, nummer) where nummer is not null;
insert into public.faktura_nummernkreise (kreis, naechste_nummer, breite, praefix, jahr_format, trenner)
values ('auftragsbestaetigung', 3002, 4, '', 'JJJJ', '-')
on conflict (kreis) do nothing;
