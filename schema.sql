-- =====================================================================
--  Avengers Bowling — database
--  Paste this whole file into the Supabase SQL editor and hit Run.
--  It is safe to run twice.
-- =====================================================================
--
--  PIN BITMASK CONVENTION — every statistic in the site depends on this.
--    pin 1  = bit 0 = 1        pin 6  = bit 5 = 32
--    pin 2  = bit 1 = 2        pin 7  = bit 6 = 64
--    pin 3  = bit 2 = 4        pin 8  = bit 7 = 128
--    pin 4  = bit 3 = 8        pin 9  = bit 8 = 256
--    pin 5  = bit 4 = 16       pin 10 = bit 9 = 512
--  A full rack standing = 1023.  standing_before = what was up when the
--  ball was thrown; knocked = which of those went down. knocked is always
--  a subset of standing_before.
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------- people
create table if not exists profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  display_name text not null check (length(trim(display_name)) between 1 and 40),
  handle       text unique check (handle ~ '^[a-z0-9_]{2,20}$'),
  avatar_url   text,
  hand         text check (hand in ('L','R')),
  ball_weight  smallint check (ball_weight between 6 and 20),
  home_house   text,
  joined_at    timestamptz not null default now(),
  is_admin     boolean not null default false,
  -- Whether there is an email or a phone behind this name. Kept up to date
  -- from auth.users by sync_has_login below; nobody writes it by hand.
  has_login    boolean not null default false
);
-- Added later; this keeps an existing database in step.
alter table profiles add column if not exists is_admin boolean not null default false;
alter table profiles add column if not exists has_login boolean not null default false;

-- The commissioner. Can fix or remove anybody's games and sessions — every one
-- of those changes still lands in the edits table for all to see.
create or replace function is_commissioner() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select is_admin from profiles where id = auth.uid()), false)
$$;

-- -------------------------------------------------------------- outings
create table if not exists sessions (
  id          uuid primary key default gen_random_uuid(),
  played_on   date not null,
  house       text not null,
  title       text,
  created_by  uuid not null references profiles(id) on delete cascade,
  created_at  timestamptz not null default now(),
  -- When somebody pressed Finish. It locks nothing: the book stays editable
  -- afterwards and this only stops the night offering itself back as still
  -- open. Nullable because most nights never get finished, they just stop.
  finished_at timestamptz,
  -- When somebody put the night away. Archived nights are out of the book and
  -- out of every total, but nothing is destroyed and they can be brought back.
  archived_at timestamptz
);
-- for a database created before these existed
alter table sessions add column if not exists finished_at timestamptz;
alter table sessions add column if not exists archived_at timestamptz;
create index if not exists sessions_played_on_idx on sessions (played_on desc);

-- Teams are per session and ad hoc. The same two people can be teammates one
-- week and opponents the next, so there is deliberately no teams table.
create table if not exists session_players (
  session_id uuid not null references sessions(id) on delete cascade,
  profile_id uuid not null references profiles(id) on delete cascade,
  team       text check (team ~ '^[A-Z]$'),
  primary key (session_id, profile_id)
);

-- ---------------------------------------------------------------- games
create table if not exists games (
  id          uuid primary key default gen_random_uuid(),
  session_id  uuid not null references sessions(id) on delete cascade,
  profile_id  uuid not null references profiles(id) on delete cascade,
  game_no     smallint not null check (game_no between 1 and 12),
  total_score smallint not null check (total_score between 0 and 300),
  entry_mode  text not null check (entry_mode in ('pins','counts','quick')),
  logged_by   uuid not null references profiles(id) on delete cascade,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (session_id, profile_id, game_no)
);
-- Teams change between games, not just between nights: 3v3 for one game, then
-- 2v2v2, then somebody sits out. The team on the game row is what counts; the
-- one on session_players is only the starting line-up.
alter table games add column if not exists team text check (team ~ '^[A-Z]$');

create index if not exists games_profile_idx on games (profile_id);
create index if not exists games_session_idx on games (session_id);

-- One row per ball. Quick-entry games have none of these — they are just a total.
--   pins            how many went down. Always known.
--   split           tagged by the person scoring: that ball left a split.
--   standing_before / knocked
--                   which pins, as bitmasks. Only filled in when the game was
--                   scored by tapping the deck instead of typing the number, so
--                   they are nullable. Leave frequency needs them; nothing else does.
create table if not exists rolls (
  game_id         uuid not null references games(id) on delete cascade,
  frame           smallint not null check (frame between 1 and 10),
  roll            smallint not null check (roll between 1 and 3),
  pins            smallint check (pins between 0 and 10),
  split           boolean not null default false,
  standing_before smallint check (standing_before between 0 and 1023),
  knocked         smallint check (knocked between 0 and 1023),
  primary key (game_id, frame, roll),
  check ((knocked & ~standing_before) = 0)   -- cannot knock down what was already down
);

-- Bringing an older database up to date. All of this is safe to re-run.
alter table rolls add column if not exists pins  smallint;
alter table rolls add column if not exists split boolean not null default false;
alter table rolls alter column standing_before drop not null;
alter table rolls alter column knocked         drop not null;
-- fill in the count for anything logged before the column existed
update rolls set pins = length(replace(knocked::int::bit(10)::text, '0', ''))
  where pins is null and knocked is not null;
alter table games drop constraint if exists games_entry_mode_check;
alter table games add  constraint games_entry_mode_check check (entry_mode in ('pins','counts','quick'));
do $$ begin
  alter table rolls add constraint rolls_pins_ck check (pins between 0 and 10);
exception when duplicate_object then null; end $$;
do $$ begin
  alter table rolls add constraint rolls_has_a_count check (pins is not null or knocked is not null);
exception when duplicate_object then null; end $$;

-- The honour system in the open. Every change to a game appends a row here and
-- nothing ever deletes one, so game_id is deliberately NOT a foreign key: the
-- history outlives the game it describes.
create table if not exists edits (
  id        bigint generated always as identity primary key,
  game_id   uuid not null,
  editor_id uuid references profiles(id) on delete set null,
  at        timestamptz not null default now(),
  before    jsonb,
  after     jsonb
);
create index if not exists edits_game_idx on edits (game_id, at desc);

-- ---------------------------------------------------------------- money
-- What each person won or lost, per game. The site works out a proposal from
-- the team scores and the stake, but every number is editable before it is
-- saved, because the arrangement changes all night and sometimes people just
-- decide something. Amounts are in cents and signed: +500 is five dollars won.
create table if not exists money (
  id          uuid primary key default gen_random_uuid(),
  session_id  uuid not null references sessions(id) on delete cascade,
  game_no     smallint,                  -- null means a whole-night adjustment
  profile_id  uuid not null references profiles(id) on delete cascade,
  amount_cents integer not null check (amount_cents between -1000000 and 1000000),
  note        text,
  created_by  uuid not null references profiles(id) on delete cascade,
  created_at  timestamptz not null default now()
);
create unique index if not exists money_one_per_game
  on money (session_id, game_no, profile_id) where game_no is not null;
create index if not exists money_profile_idx on money (profile_id);

-- ---------------------------------------------------------------- guests
-- People who turn up and bowl but never make an account. They still need a
-- stable identity, otherwise "Mike owes twenty dollars" evaporates next week.
create table if not exists guests (
  id         uuid primary key default gen_random_uuid(),
  name       text not null check (length(trim(name)) between 1 and 40),
  created_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create unique index if not exists guests_name_uniq on guests (lower(trim(name)));

-- A money row belongs to exactly one person: an account or a guest.
alter table money add column if not exists guest_id uuid references guests(id) on delete cascade;
alter table money alter column profile_id drop not null;
do $$ begin
  alter table money add constraint money_one_person check ((profile_id is null) <> (guest_id is null));
exception when duplicate_object then null; end $$;
create unique index if not exists money_one_per_game_guest
  on money (session_id, game_no, guest_id) where game_no is not null and guest_id is not null;

-- ------------------------------------------------------------- triggers
-- Runs as the table owner so it can write to edits while the edits policies
-- below refuse every direct insert.
create or replace function log_game_edit() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if (tg_op = 'UPDATE') then
    new.updated_at := now();
    if (to_jsonb(new) - 'updated_at') is distinct from (to_jsonb(old) - 'updated_at') then
      insert into edits (game_id, editor_id, before, after)
      values (old.id, auth.uid(), to_jsonb(old), to_jsonb(new));
    end if;
    return new;
  else
    insert into edits (game_id, editor_id, before, after)
    values (old.id, auth.uid(), to_jsonb(old), null);
    return old;
  end if;
end $$;

drop trigger if exists games_edit_log on games;
create trigger games_edit_log before update or delete on games
  for each row execute function log_game_edit();

-- New sign-ups get a profile row automatically. The very first account to
-- exist becomes the commissioner, because somebody has to be able to fix
-- things and there is nobody around yet to appoint them. Only the very first:
-- a group that later finds itself with no commissioner appoints one from the
-- SQL editor, rather than handing the keys to whoever signs up next.
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

-- Nobody promotes themselves. is_admin can only be changed by an existing
-- commissioner, or from the SQL editor, where auth.uid() is null. That holds
-- for a new row as much as a changed one: see guard_admin_insert below.
create or replace function guard_admin_flag() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.is_admin is distinct from old.is_admin
     and auth.uid() is not null and not is_commissioner() then
    new.is_admin := old.is_admin;
  end if;
  return new;
end $$;

drop trigger if exists profiles_guard_admin on profiles;
create trigger profiles_guard_admin before update on profiles
  for each row execute function guard_admin_flag();

-- The same rule for a row being written fresh. Somebody whose profile row went
-- away, but whose sign-in did not, could otherwise put it back with is_admin
-- already true. Signed in, nobody arrives as commissioner unless there is no
-- profile at all yet. It quietly writes false rather than refusing, like the
-- guard above, because the page saves a profile with an upsert and this fires
-- on those too.
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

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function handle_new_user();

-- ------------------------------------------------------------ claiming
-- A guest is a name somebody typed so that "Mike owes twenty dollars" would
-- survive the week. When Mike finally turns up and taps his own name, that
-- placeholder and the person become one: his money moves onto his account
-- and the guest row goes away.
--
-- This has to run as the owner. The money rows being rewritten were created
-- by whoever was keeping the book that night, so money_update refuses them
-- to Mike, who is neither its author, the session's creator, nor the
-- commissioner. The policies are right; this is the one sanctioned way past
-- them, and it can only ever move money onto the caller's own account.
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

  -- If the book ever gave one game money for both guest-Mike and account-Mike,
  -- the rewrite would collide with money_one_per_game. The guest row is the
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

-- A name that never had a password on it is a different matter. It is an
-- account somebody walked into with nothing but a name, and on any other
-- phone there is nothing to type to get back to it. Walking back in used to
-- be instant, which meant anybody on the internet could tap that name and
-- walk off with the history and the money. Now tapping it only asks, and the
-- commissioner says yes or no. Nothing moves until they say yes.
--
-- The front door has to know which names have a password behind them, and it
-- cannot read auth.users. A plain yes/no on the profile gives it exactly that
-- and nothing more -- no address, nothing to harvest.
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

-- The instant version. Gone, so that no copy of the page can still call it.
drop function if exists claim_profile(uuid);

-- One row per time somebody said "that is me". target_name is the name as it
-- was when they asked, so the history still reads after the target itself
-- has been folded away. Nobody writes here directly: the four functions below
-- are the only way a row changes.
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

-- "That is me." It checks everything, then only writes it down. Asking again
-- for the same person is the same request; asking for somebody else
-- withdraws the first.
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
  -- The guard that matters: a name with an email or a phone on it is a real
  -- account with a real way in, and taking one over would be theft.
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

-- The commissioner says yes. Everything under the old name moves onto
-- whoever asked, the old profile goes, and so does the sign-in under it, so
-- nobody holding its old token comes back in as an empty shell. Everything is
-- checked again under a lock, because the name may have gained an email,
-- become commissioner, or been handed to somebody else since the asking.
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

  -- If the hosted database ever refuses this, the yes still stands: the
  -- profile is gone and the sign-in is left pointing at nothing.
  begin
    delete from auth.users where id = old_id;
  exception when insufficient_privilege or foreign_key_violation then
    raise notice 'the old sign-in % stays, with nothing behind it', old_id;
  end;
end $$;

-- The commissioner says no. Nothing moves.
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

-- Whoever asked changes their mind. Nothing moves.
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

-- =====================================================================
--  Row level security. The anon key in index.html is public knowledge —
--  these policies are the only thing that actually enforces anything.
-- =====================================================================
alter table profiles        enable row level security;
alter table sessions        enable row level security;
alter table session_players enable row level security;
alter table games           enable row level security;
alter table rolls           enable row level security;
alter table edits           enable row level security;
alter table money           enable row level security;
alter table guests          enable row level security;
alter table claim_requests  enable row level security;

-- profiles: everyone reads, you may only touch your own row
drop policy if exists profiles_read   on profiles;
drop policy if exists profiles_insert on profiles;
drop policy if exists profiles_update on profiles;
create policy profiles_read   on profiles for select using (true);
create policy profiles_insert on profiles for insert to authenticated with check (id = auth.uid());
create policy profiles_update on profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

-- sessions: everyone reads, any signed-in person may add one, creator owns it
drop policy if exists sessions_read   on sessions;
drop policy if exists sessions_insert on sessions;
drop policy if exists sessions_update on sessions;
drop policy if exists sessions_delete on sessions;
create policy sessions_read   on sessions for select using (true);
create policy sessions_insert on sessions for insert to authenticated with check (created_by = auth.uid());
create policy sessions_update on sessions for update to authenticated using (created_by = auth.uid() or is_commissioner());
create policy sessions_delete on sessions for delete to authenticated using (created_by = auth.uid() or is_commissioner());

drop policy if exists sp_read   on session_players;
drop policy if exists sp_insert on session_players;
drop policy if exists sp_update on session_players;
drop policy if exists sp_delete on session_players;
create policy sp_read   on session_players for select using (true);
create policy sp_insert on session_players for insert to authenticated
  with check (exists (select 1 from sessions s where s.id = session_id));
create policy sp_update on session_players for update to authenticated
  using (exists (select 1 from sessions s where s.id = session_id and (s.created_by = auth.uid() or is_commissioner())));
create policy sp_delete on session_players for delete to authenticated
  using (exists (select 1 from sessions s where s.id = session_id and (s.created_by = auth.uid() or is_commissioner())));

-- games: everyone reads. A signed-in person may log a game for themselves OR
-- for anyone else, because one person usually enters the whole lane. Only the
-- bowler or the person who logged it may change or remove it afterwards.
drop policy if exists games_read   on games;
drop policy if exists games_insert on games;
drop policy if exists games_update on games;
drop policy if exists games_delete on games;
create policy games_read   on games for select using (true);
create policy games_insert on games for insert to authenticated with check (logged_by = auth.uid());
create policy games_update on games for update to authenticated
  using (profile_id = auth.uid() or logged_by = auth.uid() or is_commissioner());
create policy games_delete on games for delete to authenticated
  using (profile_id = auth.uid() or logged_by = auth.uid() or is_commissioner());

-- rolls: inherit whatever the parent game allows
drop policy if exists rolls_read   on rolls;
drop policy if exists rolls_insert on rolls;
drop policy if exists rolls_update on rolls;
drop policy if exists rolls_delete on rolls;
create policy rolls_read on rolls for select using (true);
create policy rolls_insert on rolls for insert to authenticated with check (
  exists (select 1 from games g where g.id = game_id and (g.profile_id = auth.uid() or g.logged_by = auth.uid() or is_commissioner())));
create policy rolls_update on rolls for update to authenticated using (
  exists (select 1 from games g where g.id = game_id and (g.profile_id = auth.uid() or g.logged_by = auth.uid() or is_commissioner())));
create policy rolls_delete on rolls for delete to authenticated using (
  exists (select 1 from games g where g.id = game_id and (g.profile_id = auth.uid() or g.logged_by = auth.uid() or is_commissioner())));

-- money: everyone reads. Anyone signed in may settle a game; the person who
-- wrote the row, whoever started the session, and the commissioner may change it.
drop policy if exists money_read   on money;
drop policy if exists money_insert on money;
drop policy if exists money_update on money;
drop policy if exists money_delete on money;
create policy money_read   on money for select using (true);
create policy money_insert on money for insert to authenticated with check (created_by = auth.uid());
create policy money_update on money for update to authenticated using (
  created_by = auth.uid() or is_commissioner()
  or exists (select 1 from sessions s where s.id = session_id and s.created_by = auth.uid()));
create policy money_delete on money for delete to authenticated using (
  created_by = auth.uid() or is_commissioner()
  or exists (select 1 from sessions s where s.id = session_id and s.created_by = auth.uid()));

-- guests: everyone reads, anyone signed in may add one, the person who added
-- them or the commissioner may rename or remove them.
drop policy if exists guests_read   on guests;
drop policy if exists guests_insert on guests;
drop policy if exists guests_update on guests;
drop policy if exists guests_delete on guests;
create policy guests_read   on guests for select using (true);
create policy guests_insert on guests for insert to authenticated with check (created_by = auth.uid());
create policy guests_update on guests for update to authenticated using (created_by = auth.uid() or is_commissioner());
create policy guests_delete on guests for delete to authenticated using (created_by = auth.uid() or is_commissioner());

-- edits: everyone reads — that is the entire point. Nobody writes directly,
-- nobody updates, nobody deletes. Only the trigger above ever adds a row.
drop policy if exists edits_read on edits;
create policy edits_read on edits for select using (true);

-- claim_requests: everyone reads, so the front door knows who is waiting and
-- does not show the same name twice. Nobody writes directly; only the
-- claiming functions above ever change a row.
drop policy if exists claims_read on claim_requests;
create policy claims_read on claim_requests for select using (true);
revoke insert, update, delete on claim_requests from anon, authenticated;

-- Avatars, if you want them. Public bucket, you may only write your own folder.
insert into storage.buckets (id, name, public)
values ('avatars','avatars', true) on conflict (id) do nothing;
drop policy if exists avatars_read   on storage.objects;
drop policy if exists avatars_write  on storage.objects;
create policy avatars_read  on storage.objects for select using (bucket_id = 'avatars');
create policy avatars_write on storage.objects for insert to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

-- ---------------------------------------------------------------------
--  Appointing a commissioner by hand, if the first-account rule missed:
--    update profiles set is_admin = true where display_name = 'Drew';
--  And to step down, or to appoint somebody else:
--    update profiles set is_admin = false where display_name = 'Drew';
--  Run either from the SQL editor. The site cannot do it for you on purpose.
-- ---------------------------------------------------------------------
