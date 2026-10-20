-- KAIRO accounts: what a signed-in student's account keeps (Supabase Postgres).
--
-- Every table belongs to one user (auth.users) and Row Level Security lets a
-- signed-in user read and write only their own rows. Guests (no account) keep
-- the same data in their browser's localStorage instead.
--
--   profiles    name, avatar and experience shown in the app
--   code_files  the draft and the program input of each language
--   progress    XP, level, streaks and badges (the app's Progress object)
--   settings    theme, motion, sound, extensions, editor font size, panel layout
--   notebooks   the Python notebook
--   runs        a short history of runs (language, result, time), no code
--   heartbeat   one row the daily keep-alive updates through keepalive(), so the
--               free project is never paused for inactivity (see vercel.json)
--
-- Applied to the project with the Supabase MCP server on 2026-10-14; this file
-- is the schema as it stands, for a new project: `supabase db push`, or paste it
-- into the SQL editor. In Authentication > Providers > Email, turn off "Confirm
-- email" so a new account can sign in at once (see docs/accounts.md).

-- ------------------------------------------------------------------ helpers

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ----------------------------------------------------------------- profiles

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null default 'Coder' check (char_length(display_name) between 1 and 40),
  avatar text not null default 'comet' check (avatar ~ '^[a-z]{1,24}$'),
  experience text not null default 'some' check (experience in ('new', 'some', 'confident')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger profiles_touch before update on public.profiles
  for each row execute function public.touch_updated_at();
alter table public.profiles enable row level security;
create policy "own profile: read" on public.profiles for select to authenticated
  using ((select auth.uid()) = id);
create policy "own profile: create" on public.profiles for insert to authenticated
  with check ((select auth.uid()) = id);
create policy "own profile: change" on public.profiles for update to authenticated
  using ((select auth.uid()) = id) with check ((select auth.uid()) = id);

-- A profile for every new account, named from the sign-up form (or the e-mail).
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name)
  values (
    new.id,
    coalesce(
      nullif(left(btrim(new.raw_user_meta_data ->> 'full_name'), 40), ''),
      nullif(left(split_part(coalesce(new.email, ''), '@', 1), 40), ''),
      'Coder'
    )
  )
  on conflict (id) do nothing;
  return new;
end;
$$;
revoke execute on function public.handle_new_user() from public, anon, authenticated;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- --------------------------------------------------------------- code files

create table if not exists public.code_files (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  language_id text not null check (language_id ~ '^[a-z0-9][a-z0-9_+.-]{0,39}$'),
  source text not null default '' check (octet_length(source) <= 131072),
  stdin text not null default '' check (octet_length(stdin) <= 32768),
  updated_at timestamptz not null default now(),
  primary key (user_id, language_id)
);
create trigger code_files_touch before update on public.code_files
  for each row execute function public.touch_updated_at();
alter table public.code_files enable row level security;
create policy "own code" on public.code_files for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

-- ----------------------------------------------------------------- progress

create table if not exists public.progress (
  user_id uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  data jsonb not null default '{}'::jsonb check (pg_column_size(data) <= 65536),
  xp integer not null default 0 check (xp >= 0),
  badges integer not null default 0 check (badges >= 0),
  updated_at timestamptz not null default now()
);
create trigger progress_touch before update on public.progress
  for each row execute function public.touch_updated_at();
alter table public.progress enable row level security;
create policy "own progress" on public.progress for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

-- ----------------------------------------------------------------- settings

create table if not exists public.settings (
  user_id uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  data jsonb not null default '{}'::jsonb check (pg_column_size(data) <= 16384),
  updated_at timestamptz not null default now()
);
create trigger settings_touch before update on public.settings
  for each row execute function public.touch_updated_at();
alter table public.settings enable row level security;
create policy "own settings" on public.settings for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

-- ---------------------------------------------------------------- notebooks

create table if not exists public.notebooks (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null default 'main' check (char_length(name) between 1 and 60),
  content jsonb not null check (pg_column_size(content) <= 524288),
  updated_at timestamptz not null default now(),
  primary key (user_id, name)
);
create trigger notebooks_touch before update on public.notebooks
  for each row execute function public.touch_updated_at();
alter table public.notebooks enable row level security;
create policy "own notebooks" on public.notebooks for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

-- --------------------------------------------------------------------- runs

create table if not exists public.runs (
  id bigint generated always as identity primary key,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  language_id text not null check (char_length(language_id) between 1 and 40),
  state text not null check (char_length(state) between 1 and 32),
  duration_ms integer check (duration_ms >= 0),
  errors integer not null default 0 check (errors >= 0),
  created_at timestamptz not null default now()
);
create index if not exists runs_user_created_idx on public.runs (user_id, created_at desc);
alter table public.runs enable row level security;
create policy "own runs: read" on public.runs for select to authenticated
  using ((select auth.uid()) = user_id);
create policy "own runs: add" on public.runs for insert to authenticated
  with check ((select auth.uid()) = user_id);
create policy "own runs: remove" on public.runs for delete to authenticated
  using ((select auth.uid()) = user_id);

-- Nothing here is for visitors without an account.
revoke all on public.profiles, public.code_files, public.progress, public.settings,
  public.notebooks, public.runs from anon;

-- -------------------------------------------------------- daily keep-alive

create table if not exists public.heartbeat (
  id smallint primary key default 1 check (id = 1),
  beat_at timestamptz not null default now(),
  beats bigint not null default 0
);
insert into public.heartbeat (id) values (1) on conflict (id) do nothing;
alter table public.heartbeat enable row level security;
revoke all on public.heartbeat from anon, authenticated;
grant select (id, beat_at, beats), update (beat_at, beats) on public.heartbeat to anon, authenticated;
create policy "heartbeat: read" on public.heartbeat for select to anon, authenticated using (id = 1);
create policy "heartbeat: beat" on public.heartbeat for update to anon, authenticated
  using (id = 1) with check (id = 1);

-- Called by GET /api/v1/system/keepalive (Vercel Cron, once a day) with the
-- publishable key. It runs with the caller's rights and can only bump the counter.
create or replace function public.keepalive()
returns timestamptz
language sql
security invoker
set search_path = ''
as $$
  update public.heartbeat set beat_at = now(), beats = beats + 1 where id = 1 returning beat_at;
$$;
grant execute on function public.keepalive() to anon, authenticated;
