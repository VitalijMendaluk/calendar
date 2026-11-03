-- PUBLIC MODE: no login/password. Anyone with the site URL can read/change/delete data.
-- Run once in Supabase SQL Editor after deploying the updated frontend.
alter table public.consultations alter column owner_id drop not null;
alter table public.push_subscriptions alter column owner_id drop not null;

drop policy if exists "owner can read own consultations" on public.consultations;
drop policy if exists "owner can insert own consultations" on public.consultations;
drop policy if exists "owner can update own consultations" on public.consultations;
drop policy if exists "owner can delete own consultations" on public.consultations;
drop policy if exists "owner_select_consultations" on public.consultations;
drop policy if exists "owner_insert_consultations" on public.consultations;
drop policy if exists "owner_update_consultations" on public.consultations;
drop policy if exists "owner_delete_consultations" on public.consultations;

create policy "public_read_consultations"
on public.consultations for select to anon, authenticated using (true);
create policy "public_insert_consultations"
on public.consultations for insert to anon, authenticated with check (true);
create policy "public_update_consultations"
on public.consultations for update to anon, authenticated using (true) with check (true);
create policy "public_delete_consultations"
on public.consultations for delete to anon, authenticated using (true);

drop policy if exists "owner can read own push subscriptions" on public.push_subscriptions;
drop policy if exists "owner can insert own push subscriptions" on public.push_subscriptions;
drop policy if exists "owner can update own push subscriptions" on public.push_subscriptions;
drop policy if exists "owner can delete own push subscriptions" on public.push_subscriptions;
drop policy if exists "owner_select_push" on public.push_subscriptions;
drop policy if exists "owner_insert_push" on public.push_subscriptions;
drop policy if exists "owner_update_push" on public.push_subscriptions;
drop policy if exists "owner_delete_push" on public.push_subscriptions;

create policy "public_read_push"
on public.push_subscriptions for select to anon, authenticated using (true);
create policy "public_insert_push"
on public.push_subscriptions for insert to anon, authenticated with check (true);
create policy "public_update_push"
on public.push_subscriptions for update to anon, authenticated using (true) with check (true);
create policy "public_delete_push"
on public.push_subscriptions for delete to anon, authenticated using (true);
