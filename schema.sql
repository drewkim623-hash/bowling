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
  is_admin     boolean not null default false
);
-- Added later; this keeps an existing database in step.
alter table profiles add column if not exists is_admin boolean not null default false;

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
  finished_at timestamptz
);
-- for a database created before finishing existed
alter table sessions add column if not exists finished_at timestamptz;
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
-- things and there is nobody around yet to appoint them.
create or replace function handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into profiles (id, display_name, is_admin)
  values (new.id,
          coalesce(new.raw_user_meta_data->>'display_name', split_part(new.email,'@',1)),
          not exists (select 1 from profiles where is_admin))
  on conflict (id) do nothing;
  return new;
end $$;

-- Nobody promotes themselves. is_admin can only be changed by an existing
-- commissioner, or from the SQL editor, where auth.uid() is null.
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

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function handle_new_user();

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
