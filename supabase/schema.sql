-- ============================================================
-- SOLAR CONQUEST — Base de données des comptes (Supabase)
-- À coller une fois dans Supabase : SQL Editor → New query → Run.
-- Peut être relancé sans risque (il ne recrée que ce qui manque).
-- ============================================================

-- Profils : un pseudo unique (sans tenir compte des majuscules) par compte
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  pseudo text not null check (char_length(pseudo) between 2 and 16),
  created_at timestamptz not null default now()
);
create unique index if not exists profiles_pseudo_lower on public.profiles (lower(pseudo));
alter table public.profiles enable row level security;
drop policy if exists "profils lisibles par tous" on public.profiles;
create policy "profils lisibles par tous" on public.profiles for select using (true);

-- Statistiques par joueur (écrites uniquement par le serveur de jeu)
create table if not exists public.player_stats (
  id uuid primary key references public.profiles(id) on delete cascade,
  games int not null default 0,
  wins int not null default 0,
  eliminated int not null default 0,
  last_played timestamptz
);
alter table public.player_stats enable row level security;
drop policy if exists "stats lisibles par tous" on public.player_stats;
create policy "stats lisibles par tous" on public.player_stats for select using (true);

-- Historique des parties en ligne
create table if not exists public.matches (
  id bigint generated always as identity primary key,
  played_at timestamptz not null default now(),
  duration_s int,
  planets int,
  winner uuid references public.profiles(id) on delete set null,
  winner_name text,
  players jsonb not null default '[]'::jsonb
);
alter table public.matches enable row level security;
drop policy if exists "parties lisibles par tous" on public.matches;
create policy "parties lisibles par tous" on public.matches for select using (true);

-- Création automatique du profil et des statistiques à l'inscription
-- (le pseudo vient du formulaire d'inscription du jeu)
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, pseudo)
  values (new.id, coalesce(nullif(trim(new.raw_user_meta_data->>'pseudo'), ''), 'Pilote-' || substr(new.id::text, 1, 6)));
  insert into public.player_stats (id) values (new.id);
  return new;
end $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- À qui appartient ce pseudo ? (null s'il est libre)
create or replace function public.pseudo_owner(p text) returns uuid
language sql stable security definer set search_path = public as $$
  select id from public.profiles where lower(pseudo) = lower(trim(p)) limit 1;
$$;
grant execute on function public.pseudo_owner(text) to anon, authenticated;

-- Enregistrement d'une partie terminée (appelé par le serveur de jeu avec la clé secrète)
create or replace function public.record_match(p jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare r jsonb;
begin
  insert into public.matches (duration_s, planets, winner, winner_name, players)
  values ((p->>'duration')::int, (p->>'planets')::int, nullif(p->>'winner', '')::uuid, p->>'winnerName', coalesce(p->'players', '[]'::jsonb));
  for r in select * from jsonb_array_elements(coalesce(p->'players', '[]'::jsonb)) loop
    if coalesce(r->>'account', '') <> '' then
      update public.player_stats set
        games = games + 1,
        wins = wins + case when (r->>'won')::boolean then 1 else 0 end,
        eliminated = eliminated + case when (r->>'eliminated')::boolean then 1 else 0 end,
        last_played = now()
      where id = (r->>'account')::uuid;
    end if;
  end loop;
end $$;
revoke execute on function public.record_match(jsonb) from public, anon, authenticated;
