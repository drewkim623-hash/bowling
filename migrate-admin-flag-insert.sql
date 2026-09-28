-- =====================================================================
--  Nobody walks in as commissioner.
--
--  Paste the whole of this into the Supabase SQL editor and hit Run. It is
--  safe to run twice, and it does not touch a single row you have already
--  logged — no games, no money, no guests, no profiles. The commissioner you
--  have now stays the commissioner.
--
--  It closes two ways in. The database already refused anybody who tried to
--  switch is_admin on for themselves, but only on a row that was already
--  there: somebody whose profile row went away while they stayed signed in
--  could write it back with is_admin already true. And a new sign-up was made
--  commissioner whenever nobody happened to hold the job, not only when they
--  were the very first person ever.
-- =====================================================================

-- 1. The same rule as guard_admin_flag, for a row being written fresh.
--    Signed in, nobody arrives as commissioner unless there is no profile at
--    all yet. It quietly writes false rather than refusing, like the update
--    guard, because the page saves a profile with an upsert and this fires on
--    those too. The SQL editor, where auth.uid() is null, is still allowed.
create or replace function guard_admin_insert() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.is_admin and auth.uid() is not null
     and exists (select 1 from profiles) then
    new.is_admin := false;
  end if;
  return new;
end $$;

drop trigger if exists profiles_guard_admin_insert on profiles;
create trigger profiles_guard_admin_insert before insert on profiles
  for each row execute function guard_admin_insert();

-- 2. Only the very first profile ever becomes commissioner. A group that
--    later finds itself with nobody in the job appoints somebody from the SQL
--    editor, rather than handing the keys to whoever signs up next. Nothing
--    else in this function has changed.
create or replace function handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into profiles (id, display_name, is_admin)
  values (new.id,
          -- Somebody who walked in without an account has no email to fall
          -- back on, and display_name is not null. Without the last rung of
          -- this ladder the insert fails and the sign-in fails with it.
          coalesce(nullif(trim(coalesce(new.raw_user_meta_data->>'display_name',
                                        split_part(coalesce(new.email, ''), '@', 1))), ''),
                   'Bowler'),
          not exists (select 1 from profiles))
  on conflict (id) do nothing;
  return new;
end $$;
