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
  id         uuid primary key default gen_random_uuid(),
  played_on  date not null,
  house      text not null,
  title      text,
  created_by uuid not null references profiles(id) on delete cascade,
  created_at timestamptz not null default now()
);
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
  entry_mode  text not null check (entry_mode in ('pins','quick')),
  logged_by   uuid not null references profiles(id) on delete cascade,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (session_id, profile_id, game_no)
);
create index if not exists games_profile_idx on games (profile_id);
create index if not exists games_session_idx on games (session_id);

-- Only present for entry_mode = 'pins'. Quick-entry games are just a total.
create table if not exists rolls (
  game_id         uuid not null references games(id) on delete cascade,
  frame           smallint not null check (frame between 1 and 10),
  roll            smallint not null check (roll between 1 and 3),
  standing_before smallint not null check (standing_before between 0 and 1023),
  knocked         smallint not null check (knocked between 0 and 1023),
  primary key (game_id, frame, roll),
  check ((knocked & ~standing_before) = 0)   -- cannot knock down what was already down
);

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
