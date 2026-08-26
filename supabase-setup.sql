-- VITB Sport cloud sync schema.
-- Run this entire file once in Supabase Dashboard → SQL Editor.

create table if not exists public.vitb_user_state (
  user_id uuid primary key references auth.users(id) on delete cascade,
  state jsonb not null default '{}'::jsonb,
  client_id text,
  updated_at timestamptz not null default now()
);

alter table public.vitb_user_state enable row level security;

drop policy if exists "vitb users can read own state" on public.vitb_user_state;
create policy "vitb users can read own state"
  on public.vitb_user_state
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "vitb users can create own state" on public.vitb_user_state;
create policy "vitb users can create own state"
  on public.vitb_user_state
  for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists "vitb users can update own state" on public.vitb_user_state;
create policy "vitb users can update own state"
  on public.vitb_user_state
  for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

revoke all on table public.vitb_user_state from anon;
grant select, insert, update on table public.vitb_user_state to authenticated;

create or replace function public.set_vitb_state_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_vitb_state_updated_at on public.vitb_user_state;
create trigger set_vitb_state_updated_at
before update on public.vitb_user_state
for each row execute function public.set_vitb_state_updated_at();
