-- =====================================================================
--  Walking back into an account that never had a password.
--
--  Paste the whole of this into the Supabase SQL editor and hit Run. Safe to
--  run twice. It adds one function and changes no row you have logged.
--
--  Run migrate-no-account.sql first if you have not already.
-- =====================================================================

-- The front door has to know which names have a password behind them and
-- which do not, and it cannot read auth.users. A plain yes/no on the profile
-- gives it exactly that and nothing more -- no address, nothing to harvest.
alter table profiles add column if not exists has_login boolean not null default false;

create or replace function sync_has_login() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update profiles set has_login =
        (coalesce(new.email, '') <> '' or coalesce(new.phone, '') <> '')
   where id = new.id;
  return new;
end $$;

drop trigger if exists on_auth_user_login_changed on auth.users;
create trigger on_auth_user_login_changed after insert or update on auth.users
  for each row execute function sync_has_login();

-- and catch up everybody who already exists
update profiles p set has_login =
       (select coalesce(u.email, '') <> '' or coalesce(u.phone, '') <> ''
          from auth.users u where u.id = p.id)
 where exists (select 1 from auth.users u where u.id = p.id);

-- Somebody who came in without an account has no email and no password. The
-- browser they did it in is the only thing that remembers them, so on a second
-- phone -- or after clearing site data, or for anybody else in the group --
-- their name sat on the front door asking for a password that does not exist.
--
-- An account with no email is exactly what a guest is: a name with nothing
-- behind it. So it gets claimed the same way. Everything the old profile has
-- moves onto whoever is asking, and the empty profile goes.
--
-- The guard that matters is the one in the middle: this refuses to touch a
-- profile whose auth user has an email or a phone on it. Those are real
-- accounts with a real way in, and taking one over would be theft rather than
-- a reunion.
create or replace function claim_profile(old_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid();
begin
  if me is null then
    raise exception 'nobody is signed in';
  end if;
  if old_id = me then
    return;                                   -- already yourself, nothing to do
  end if;
  if not exists (select 1 from profiles where id = old_id) then
    raise exception 'there is nobody by that name any more';
  end if;
  if exists (select 1 from auth.users u
              where u.id = old_id
                and (coalesce(u.email, '') <> '' or coalesce(u.phone, '') <> '')) then
    raise exception 'that account has a way of its own to sign in';
  end if;
  if exists (select 1 from profiles where id = old_id and is_admin) then
    raise exception 'the commissioner cannot be walked into';
  end if;

  -- Anywhere the two of them would end up on the same row twice, the old one
  -- gives way. Same reasoning as claiming a guest: it is the placeholder.
  delete from games g
   where g.profile_id = old_id
     and exists (select 1 from games k
                  where k.profile_id = me and k.session_id = g.session_id
                    and k.game_no = g.game_no);
  delete from session_players sp
   where sp.profile_id = old_id
     and exists (select 1 from session_players k
                  where k.profile_id = me and k.session_id = sp.session_id);
  delete from money m
   where m.profile_id = old_id
     and m.game_no is not null
     and exists (select 1 from money k
                  where k.profile_id = me and k.session_id = m.session_id
                    and k.game_no = m.game_no);

  -- The history itself.
  update games          set profile_id = me where profile_id = old_id;
  update games          set logged_by  = me where logged_by  = old_id;
  update session_players set profile_id = me where profile_id = old_id;
  update money          set profile_id = me where profile_id = old_id;
  update money          set created_by = me where created_by = old_id;
  update sessions       set created_by = me where created_by = old_id;
  update guests         set created_by = me where created_by = old_id;
  update edits          set editor_id  = me where editor_id  = old_id;

  -- Take the name. Unlike claiming a guest, there is no question here about
  -- whether you meant it: tapping this said you are that person.
  update profiles p
     set display_name = (select display_name from profiles where id = old_id),
         hand         = coalesce(p.hand,       (select hand       from profiles where id = old_id)),
         ball_weight  = coalesce(p.ball_weight,(select ball_weight from profiles where id = old_id)),
         home_house   = coalesce(p.home_house, (select home_house from profiles where id = old_id)),
         avatar_url   = coalesce(p.avatar_url, (select avatar_url from profiles where id = old_id))
   where p.id = me;

  -- And the empty profile goes. Deleting the auth user under it would be
  -- tidier still, but that is not ours to delete from here -- it is left
  -- signed out and unreachable, pointing at nothing.
  delete from profiles where id = old_id;
end $$;

revoke all on function claim_profile(uuid) from public;
grant execute on function claim_profile(uuid) to authenticated;
