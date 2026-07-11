-- Create persistent role override table so admins can test roles without changing base role
create table public.user_role_overrides (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  override_role app_role not null,
  updated_at timestamptz not null default now()
);

alter table public.user_role_overrides enable row level security;

-- Policies: users can view their own override, admins can view all
create policy "Users can view own role override"
  on public.user_role_overrides for select
  using (auth.uid() = user_id);

create policy "Admins can view all role overrides"
  on public.user_role_overrides for select
  using (public.has_role(auth.uid(), 'administrator'));

-- Only admins may insert/update/delete overrides
create policy "Admins can insert role overrides"
  on public.user_role_overrides for insert
  with check (public.has_role(auth.uid(), 'administrator'));

create policy "Admins can update role overrides"
  on public.user_role_overrides for update
  using (public.has_role(auth.uid(), 'administrator'))
  with check (public.has_role(auth.uid(), 'administrator'));

create policy "Admins can delete role overrides"
  on public.user_role_overrides for delete
  using (public.has_role(auth.uid(), 'administrator'));

-- Trigger to keep updated_at fresh
create or replace function public.touch_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql security definer set search_path = public;

create trigger user_role_overrides_touch
before update on public.user_role_overrides
for each row execute function public.touch_updated_at();