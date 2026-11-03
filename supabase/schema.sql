-- 1) Enable extensions used by the reminder scheduler
create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;
create extension if not exists pgcrypto with schema extensions;

-- 2) Consultations: starts_at is stored as an absolute UTC instant (timestamptz).
create table if not exists public.consultations (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title text not null,
  timezone text not null check (timezone in ('Asia/Tbilisi','Europe/Kyiv','Europe/Warsaw')),
  starts_at timestamptz not null,
  duration_minutes integer not null default 60 check (duration_minutes in (30,45,60,90,120)),
  notes text not null default '',
  reminder_at timestamptz not null,
  reminder_sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists consultations_owner_starts_idx
  on public.consultations(owner_id, starts_at);
create index if not exists consultations_reminder_idx
  on public.consultations(reminder_at) where reminder_sent_at is null;

create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  endpoint text not null unique,
  subscription jsonb not null,
  created_at timestamptz not null default now()
);

alter table public.consultations enable row level security;
alter table public.push_subscriptions enable row level security;

create policy "owner can read own consultations" on public.consultations
  for select to authenticated using (owner_id = auth.uid());
create policy "owner can insert own consultations" on public.consultations
  for insert to authenticated with check (owner_id = auth.uid());
create policy "owner can update own consultations" on public.consultations
  for update to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy "owner can delete own consultations" on public.consultations
  for delete to authenticated using (owner_id = auth.uid());

create policy "owner can read own push subscriptions" on public.push_subscriptions
  for select to authenticated using (owner_id = auth.uid());
create policy "owner can insert own push subscriptions" on public.push_subscriptions
  for insert to authenticated with check (owner_id = auth.uid());
create policy "owner can update own push subscriptions" on public.push_subscriptions
  for update to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy "owner can delete own push subscriptions" on public.push_subscriptions
  for delete to authenticated using (owner_id = auth.uid());

-- Set updated_at automatically.
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end;
$$;
drop trigger if exists consultations_updated_at on public.consultations;
create trigger consultations_updated_at before update on public.consultations
for each row execute function public.set_updated_at();

-- 3) Reminder scheduler.
-- After deploying the Edge Function and saving its URL + service-role key in Vault,
-- run the cron SQL shown in README.md. Supabase Cron invokes the function every minute.
