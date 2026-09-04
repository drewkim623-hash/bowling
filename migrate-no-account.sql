-- =====================================================================
--  Letting people in without an account.
--
--  Paste the whole of this into the Supabase SQL editor and hit Run. It is
--  safe to run twice, it adds nothing you have to undo, and it does not
--  touch a single row you have already logged — no games, no money, no
--  guests, no profiles. It only teaches the database two new tricks.
--
--  Then turn on Authentication -> Sign In / Providers -> Anonymous sign-ins.
--  Nothing works without that switch.
-- =====================================================================

-- 1. A person with no account has no email either, and the old version of
--    this built their display name out of one. That left the name null,
--    which the not-null check refuses, which fails the whole sign-in. The
--    last rung of the ladder is the fix.
create or replace function handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into profiles (id, display_name, is_admin)
  values (new.id,
          coalesce(nullif(trim(coalesce(new.raw_user_meta_data->>'display_name',
                                        split_part(coalesce(new.email, ''), '@', 1))), ''),
                   'Bowler'),
          not exists (select 1 from profiles where is_admin))
  on conflict (id) do nothing;
  return new;
end $$;

-- 2. A guest is a name somebody typed so that "Mike owes twenty dollars"
--    would survive the week. When Mike turns up and taps his own name, the
--    placeholder and the person become one.
--
--    This runs as the owner because it has to. The money rows being
--    rewritten were created by whoever kept the book that night, so
--    money_update refuses them to Mike, who is neither their author, the
--    session's creator, nor the commissioner. Those policies are right.
--    This is the one sanctioned way past them, and it can only ever move
--    money onto the account of whoever is calling it.
create or replace function claim_guest(g uuid) returns void
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid();
begin
  if me is null then
    raise exception 'nobody is signed in';
  end if;
  if not exists (select 1 from guests where id = g) then
    raise exception 'that guest is already gone';
  end if;

  -- If one game somehow has money for both guest-Mike and account-Mike, the
  -- rewrite would collide with money_one_per_game. The guest row is the
  -- placeholder, so it is the one that loses.
  delete from money m
   where m.guest_id = g
     and m.game_no is not null
     and exists (select 1 from money k
                  where k.profile_id = me and k.session_id = m.session_id
                    and k.game_no = m.game_no);

  update money set profile_id = me, guest_id = null where guest_id = g;

  -- Take the name too, unless this account already picked one for itself.
  update profiles p set display_name = (select name from guests where id = g)
   where p.id = me and (p.display_name is null or p.display_name = 'Bowler');

  delete from guests where id = g;
end $$;

revoke all on function claim_guest(uuid) from public;
grant execute on function claim_guest(uuid) to authenticated;
