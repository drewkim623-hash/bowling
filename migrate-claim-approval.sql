-- =====================================================================
--  Being somebody takes the commissioner's say-so.
--
--  Paste the whole of this into the Supabase SQL editor and hit Run. It is
--  safe to run twice, and it does not touch a single row you have logged --
--  no games, no money, no sessions. The only thing it writes is the has_login
--  flag on each profile, which is worked out from auth.users anyway.
--
--  It closes a hole. A name that never had a password on it could be tapped
--  by anybody, anywhere, and everything under that name moved onto them on
--  the spot. There was nothing to type because there was nothing to steal --
--  except the history, and the money, which is exactly what got taken.
--
--  Now tapping it only asks. The commissioner sees who is asking to be whom
--  and says yes or no, and nothing moves until they say yes.
--
--  It does not matter whether migrate-claim-account.sql was ever run; this
--  brings in what it needs from there. It is fine after
--  migrate-admin-flag-insert.sql and leaves that alone.
-- =====================================================================

-- 1. The front door has to know which names have a password behind them and
--    which do not, and it cannot read auth.users. A plain yes/no on the
--    profile gives it exactly that and nothing more -- no address, nothing to
--    harvest. The same as migrate-claim-account.sql; harmless to repeat.
alter table profiles add column if not exists has_login boolean not null default false;

create or replace function sync_has_login() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update profiles set has_login =
        (coalesce(new.email, '') <> '' or coalesce(new.phone, '') <> '')
   where id = new.id;
  return new;
end $$;

-- Named so it fires after on_auth_user_created, which makes the profile row
-- this writes to. Triggers of the same kind fire in name order.
drop trigger if exists on_auth_user_login_changed on auth.users;
create trigger on_auth_user_login_changed after insert or update on auth.users
  for each row execute function sync_has_login();

-- and catch up everybody who already exists
update profiles p set has_login =
       (select coalesce(u.email, '') <> '' or coalesce(u.phone, '') <> ''
          from auth.users u where u.id = p.id)
 where exists (select 1 from auth.users u where u.id = p.id);

-- 2. The instant takeover goes. Whatever copy of the page somebody is still
--    holding, this is the thing it called, and now there is nothing to call.
drop function if exists claim_profile(uuid);

-- 3. Asking. One row per time somebody said "that is me". target_name is the
--    name as it was when they asked, so the history still reads properly
--    after the target profile itself has been folded away.
create table if not exists claim_requests (
  id           uuid primary key default gen_random_uuid(),
  target_id    uuid references profiles(id) on delete set null,
  target_name  text not null,
  requester_id uuid not null references profiles(id) on delete cascade,
  status       text not null default 'pending'
               check (status in ('pending','approved','denied','cancelled')),
  requested_at timestamptz not null default now(),
  decided_by   uuid references profiles(id) on delete set null,
  decided_at   timestamptz
);
-- Somebody can only be waiting to be one person at a time.
create unique index if not exists claim_requests_one_pending
  on claim_requests (requester_id) where status = 'pending';

-- Everyone reads, like everything else in the book: the front door needs to
-- know who is waiting so it does not show the same name twice. Nobody writes
-- directly. The four functions below are the only way a row changes.
alter table claim_requests enable row level security;
drop policy if exists claims_read on claim_requests;
create policy claims_read on claim_requests for select using (true);
revoke insert, update, delete on claim_requests from anon, authenticated;

-- 4. "That is me." Checks everything the old instant version checked, and
--    then only writes it down. Asking again for the same person is the same
--    request; asking for somebody else withdraws the first.
create or replace function request_claim(target uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  me  uuid := auth.uid();
  rid uuid;
begin
  if me is null then
    raise exception 'nobody is signed in';
  end if;
  if not exists (select 1 from profiles where id = target) then
    raise exception 'there is nobody by that name any more';
  end if;
  if target = me then
    raise exception 'you are already you';
  end if;
  if exists (select 1 from auth.users u
              where u.id = target
                and (coalesce(u.email, '') <> '' or coalesce(u.phone, '') <> '')) then
    raise exception 'that account has a way of its own to sign in';
  end if;
  if exists (select 1 from profiles where id = target and is_admin) then
    raise exception 'the commissioner cannot be walked into';
  end if;

  select id into rid from claim_requests
   where requester_id = me and target_id = target and status = 'pending';
  if rid is not null then
    return rid;
  end if;

  update claim_requests set status = 'cancelled', decided_by = me, decided_at = now()
   where requester_id = me and status = 'pending';

  insert into claim_requests (target_id, target_name, requester_id)
  values (target, (select display_name from profiles where id = target), me)
  returning id into rid;
  return rid;
end $$;

-- 5. The commissioner says yes. Everything under the old name moves onto
--    whoever asked, the old profile goes, and so does the sign-in under it,
--    so nobody holding its old token can come back in as an empty shell.
--
--    Everything is checked again under a lock, because the world may have
--    moved on since the asking: the name may have gained an email, become
--    commissioner, or already been handed to somebody else.
create or replace function approve_claim(request_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  me     uuid := auth.uid();
  req    claim_requests%rowtype;
  old_id uuid;
  new_id uuid;
begin
  if me is null then
    raise exception 'nobody is signed in';
  end if;
  if not is_commissioner() then
    raise exception 'only the commissioner can say yes to that';
  end if;

  select * into req from claim_requests where id = request_id for update;
  if not found then
    raise exception 'there is no such request';
  end if;
  if req.status <> 'pending' then
    raise exception 'that has already been %', req.status;
  end if;
  old_id := req.target_id;
  new_id := req.requester_id;
  if old_id is null then
    raise exception 'there is nobody by that name any more';
  end if;

  perform 1 from profiles where id in (old_id, new_id) order by id for update;
  if not exists (select 1 from profiles where id = old_id) then
    raise exception 'there is nobody by that name any more';
  end if;
  if not exists (select 1 from profiles where id = new_id) then
    raise exception 'whoever asked is not here any more';
  end if;
  if old_id = new_id then
    raise exception 'they are already themselves';
  end if;
  if exists (select 1 from auth.users u
              where u.id = old_id
                and (coalesce(u.email, '') <> '' or coalesce(u.phone, '') <> '')) then
    raise exception 'that account has a way of its own to sign in now';
  end if;
  if exists (select 1 from profiles where id = old_id and is_admin) then
    raise exception 'the commissioner cannot be walked into';
  end if;

  -- Anywhere the two of them would end up on the same row twice, the old one
  -- gives way. Same reasoning as claiming a guest: it is the placeholder.
  delete from games g
   where g.profile_id = old_id
     and exists (select 1 from games k
                  where k.profile_id = new_id and k.session_id = g.session_id
                    and k.game_no = g.game_no);
  delete from session_players sp
   where sp.profile_id = old_id
     and exists (select 1 from session_players k
                  where k.profile_id = new_id and k.session_id = sp.session_id);
  delete from money m
   where m.profile_id = old_id
     and m.game_no is not null
     and exists (select 1 from money k
                  where k.profile_id = new_id and k.session_id = m.session_id
                    and k.game_no = m.game_no);

  -- The history itself. The edits keep their before and after exactly as
  -- they were; only who made them follows the person, because editor_id
  -- would otherwise go blank the moment the old profile is deleted.
  update games          set profile_id = new_id where profile_id = old_id;
  update games          set logged_by  = new_id where logged_by  = old_id;
  update session_players set profile_id = new_id where profile_id = old_id;
  update money          set profile_id = new_id where profile_id = old_id;
  update money          set created_by = new_id where created_by = old_id;
  update sessions       set created_by = new_id where created_by = old_id;
  update guests         set created_by = new_id where created_by = old_id;
  update edits          set editor_id  = new_id where editor_id  = old_id;

  -- Take the name, and whatever else they had not filled in for themselves.
  update profiles p
     set display_name = (select display_name from profiles where id = old_id),
         hand         = coalesce(p.hand,       (select hand       from profiles where id = old_id)),
         ball_weight  = coalesce(p.ball_weight,(select ball_weight from profiles where id = old_id)),
         home_house   = coalesce(p.home_house, (select home_house from profiles where id = old_id)),
         avatar_url   = coalesce(p.avatar_url, (select avatar_url from profiles where id = old_id))
   where p.id = new_id;

  -- Anybody else who was waiting to be the same person has their answer.
  update claim_requests set status = 'denied', decided_by = me, decided_at = now()
   where target_id = old_id and status = 'pending' and id <> request_id;
  update claim_requests set status = 'approved', decided_by = me, decided_at = now()
   where id = request_id;

  delete from profiles where id = old_id;

  -- And the sign-in under it, so its old token leads nowhere. If the hosted
  -- database ever refuses this, the yes still stands: the profile is gone,
  -- and the sign-in is left pointing at nothing, as it always used to be.
  begin
    delete from auth.users where id = old_id;
  exception when insufficient_privilege or foreign_key_violation then
    raise notice 'the old sign-in % stays, with nothing behind it', old_id;
  end;
end $$;

-- 6. The commissioner says no. Nothing moves.
create or replace function deny_claim(request_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid();
begin
  if me is null then
    raise exception 'nobody is signed in';
  end if;
  if not is_commissioner() then
    raise exception 'only the commissioner can say no to that';
  end if;
  update claim_requests set status = 'denied', decided_by = me, decided_at = now()
   where id = request_id and status = 'pending';
  if not found then
    raise exception 'that is not waiting on anybody';
  end if;
end $$;

-- 7. Whoever asked changes their mind. Nothing moves.
create or replace function cancel_claim(request_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid();
begin
  if me is null then
    raise exception 'nobody is signed in';
  end if;
  update claim_requests set status = 'cancelled', decided_by = me, decided_at = now()
   where id = request_id and requester_id = me and status = 'pending';
  if not found then
    raise exception 'that is not yours to take back, or it is already settled';
  end if;
end $$;

revoke all on function request_claim(uuid) from public, anon;
revoke all on function approve_claim(uuid) from public, anon;
revoke all on function deny_claim(uuid)    from public, anon;
revoke all on function cancel_claim(uuid)  from public, anon;
grant execute on function request_claim(uuid) to authenticated;
grant execute on function approve_claim(uuid) to authenticated;
grant execute on function deny_claim(uuid)    to authenticated;
grant execute on function cancel_claim(uuid)  to authenticated;

-- ---------------------------------------------------------------------
--  Taking it back out, if you must:
--    drop function if exists request_claim(uuid), approve_claim(uuid),
--                            deny_claim(uuid), cancel_claim(uuid);
--    drop table if exists claim_requests;
--  That leaves nobody able to walk into a name with no password at all.
--  claim_profile is deliberately not put back: it is the hole this closed.
-- ---------------------------------------------------------------------
