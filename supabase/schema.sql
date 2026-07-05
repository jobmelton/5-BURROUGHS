-- ===========================================================================
-- 5 BOROUGHS ON THE TAKE — Supabase schema
-- Run this in the Supabase dashboard: SQL Editor → New query → paste → Run.
-- The Node server talks to these tables with the SERVICE ROLE key (server-side
-- only, never shipped to the browser), so Row Level Security is left off — no
-- client ever connects to Supabase directly; they go through our game server.
-- Whole game state is stored as a single JSONB blob per game, matching the
-- engine's in-memory shape (no schema migration needed when the game evolves).
-- ===========================================================================

create table if not exists users (
  email         text primary key,
  name          text not null,
  password_hash text not null,
  created_at    bigint not null
);

create table if not exists sessions (
  session_id text primary key,
  email      text not null references users(email) on delete cascade,
  created_at bigint not null
);

create table if not exists games (
  game_id    text primary key,
  state      jsonb not null,
  updated_at bigint not null
);

-- The leaderboard is a single evolving document ({ games:[...], players:{...} }),
-- kept as one row so the append/aggregate logic in db.js stays trivial.
create table if not exists leaderboard (
  id   text primary key default 'main',
  data jsonb not null
);

insert into leaderboard (id, data)
  values ('main', '{"games":[],"players":{}}'::jsonb)
  on conflict (id) do nothing;
