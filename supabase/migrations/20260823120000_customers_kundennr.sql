-- Kundennummer aus der Faktura-Software (z.B. "0253").
-- Ermöglicht das Zuordnen von Rechnungen/Angeboten aus dem Bestandssystem und
-- verhindert Dubletten beim Import weiterer Kunden.
alter table public.customers
  add column if not exists kundennr text;

comment on column public.customers.kundennr is
  'Kundennummer aus der Faktura-Software (führende Nullen erhalten, daher text).';

create unique index if not exists customers_kundennr_uniq
  on public.customers (kundennr) where kundennr is not null;
