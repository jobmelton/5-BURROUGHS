-- 001_init — base tables. Idempotent, so it's safe to re-run over the schema
-- you already created by hand in the SQL editor.
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

create table if not exists leaderboard (
  id   text primary key default 'main',
  data jsonb not null
);

insert into leaderboard (id, data)
  values ('main', '{"games":[],"players":{}}'::jsonb)
  on conflict (id) do nothing;
