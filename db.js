// ===========================================================================
// 5 BOROUGHS ON THE TAKE — db.js
// ---------------------------------------------------------------------------
// Runtime source of truth is an in-memory cache (fast, synchronous — no DB
// round-trip on every WebSocket state push). Durable storage is pluggable:
//   • Postgres (Supabase) — used when DATABASE_URL is set (production).
//   • JSON files (./data) — automatic fallback for local dev & tests (offline).
//
// SCHEMA IS AUTOMATIC: on startup, every migrations/*.sql not yet applied runs
// itself (tracked in schema_migrations). Never hand-paste SQL again — just add a
// new numbered file in migrations/ and it applies on the next deploy.
//
// Reads hit the cache; writes update the cache AND write through to the backend.
// Call `await init()` once at server startup to migrate + hydrate the cache.
// ===========================================================================
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.DATA_DIR || './data';
const DATABASE_URL = process.env.DATABASE_URL;
const USE_PG = Boolean(DATABASE_URL);

let pool = null;

// ---- In-memory cache (runtime source of truth) -----------------------------
const cache = {
  users: {},        // email → { email, name, passwordHash, createdAt }
  sessions: {},     // sessionId → { email, createdAt }
  games: {},        // gameId → full game state object
  leaderboard: { games: [], players: {} },
};

function pgErr(ctx) {
  return (err) => console.error(`[db] ${ctx}:`, err?.message || err);
}

// ---- File backend (dev fallback) -------------------------------------------
function filePath(name) { return `${DATA_DIR}/${name}.json`; }
function loadFile(name, fallback) {
  const fp = filePath(name);
  if (!existsSync(fp)) return fallback;
  try { return JSON.parse(readFileSync(fp, 'utf-8')); } catch { return fallback; }
}
function saveFile(name, data) {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(filePath(name), JSON.stringify(data, null, 2), 'utf-8');
}

// ---- Auto-migrations -------------------------------------------------------
// Runs any migrations/*.sql whose filename isn't recorded in schema_migrations.
async function runMigrations() {
  await pool.query(
    'create table if not exists schema_migrations (version text primary key, applied_at timestamptz default now())'
  );
  const done = new Set((await pool.query('select version from schema_migrations')).rows.map(r => r.version));
  const dir = join(__dirname, 'migrations');
  const files = existsSync(dir) ? readdirSync(dir).filter(f => f.endsWith('.sql')).sort() : [];
  for (const file of files) {
    if (done.has(file)) continue;
    const sql = readFileSync(join(dir, file), 'utf-8');
    const client = await pool.connect();
    try {
      await client.query('begin');
      await client.query(sql);
      await client.query('insert into schema_migrations (version) values ($1)', [file]);
      await client.query('commit');
      console.log(`[db] migration applied: ${file}`);
    } catch (e) {
      await client.query('rollback');
      throw new Error(`Migration ${file} failed: ${e.message}`);
    } finally {
      client.release();
    }
  }
}

// ---- Startup: migrate + hydrate the cache ----------------------------------
export async function init() {
  if (USE_PG) {
    const pg = await import('pg');
    pool = new pg.default.Pool({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false } });
    await runMigrations();
    const [users, sessions, games, lb] = await Promise.all([
      pool.query('select email, name, password_hash, created_at from users'),
      pool.query('select session_id, email, created_at from sessions'),
      pool.query('select game_id, state from games'),
      pool.query("select data from leaderboard where id = 'main'"),
    ]);
    for (const r of users.rows) cache.users[r.email] = { email: r.email, name: r.name, passwordHash: r.password_hash, createdAt: Number(r.created_at) };
    for (const r of sessions.rows) cache.sessions[r.session_id] = { email: r.email, createdAt: Number(r.created_at) };
    for (const r of games.rows) cache.games[r.game_id] = r.state;
    if (lb.rows[0]?.data) cache.leaderboard = lb.rows[0].data;
    console.log(`[db] Postgres backend ready — ${Object.keys(cache.games).length} games, ${Object.keys(cache.users).length} users`);
  } else {
    cache.users = loadFile('users', {});
    cache.sessions = loadFile('sessions', {});
    cache.games = loadFile('games', {});
    cache.leaderboard = loadFile('leaderboard', { games: [], players: {} });
    console.log(`[db] File backend ready (${DATA_DIR}) — no DATABASE_URL set`);
  }
}

// ---- Write-through persistence (fire-and-forget; cache already updated) -----
function persistUser(email) {
  if (!USE_PG) return saveFile('users', cache.users);
  const u = cache.users[email];
  pool.query(
    `insert into users (email, name, password_hash, created_at) values ($1,$2,$3,$4)
     on conflict (email) do update set name = excluded.name, password_hash = excluded.password_hash`,
    [u.email, u.name, u.passwordHash, u.createdAt]
  ).catch(pgErr('upsert user'));
}
function persistSession(sessionId) {
  if (!USE_PG) return saveFile('sessions', cache.sessions);
  const s = cache.sessions[sessionId];
  pool.query(
    `insert into sessions (session_id, email, created_at) values ($1,$2,$3)
     on conflict (session_id) do update set email = excluded.email`,
    [sessionId, s.email, s.createdAt]
  ).catch(pgErr('upsert session'));
}
function removeSession(sessionId) {
  if (!USE_PG) return saveFile('sessions', cache.sessions);
  pool.query('delete from sessions where session_id = $1', [sessionId]).catch(pgErr('delete session'));
}
function persistGame(gameId) {
  if (!USE_PG) return saveFile('games', cache.games);
  pool.query(
    `insert into games (game_id, state, updated_at) values ($1, $2::jsonb, $3)
     on conflict (game_id) do update set state = excluded.state, updated_at = excluded.updated_at`,
    [gameId, JSON.stringify(cache.games[gameId]), Date.now()]
  ).catch(pgErr('upsert game'));
}
function removeGame(gameId) {
  if (!USE_PG) return saveFile('games', cache.games);
  pool.query('delete from games where game_id = $1', [gameId]).catch(pgErr('delete game'));
}
function persistLeaderboard() {
  if (!USE_PG) return saveFile('leaderboard', cache.leaderboard);
  pool.query(
    `insert into leaderboard (id, data) values ('main', $1::jsonb)
     on conflict (id) do update set data = excluded.data`,
    [JSON.stringify(cache.leaderboard)]
  ).catch(pgErr('upsert leaderboard'));
}

// ---- Users -----------------------------------------------------------------
export function getUsers() { return cache.users; }
export function getUser(email) { return cache.users[email] || null; }
export function createUser(email, name, passwordHash) {
  if (cache.users[email]) return null;
  cache.users[email] = { email, name, passwordHash, createdAt: Date.now() };
  persistUser(email);
  return cache.users[email];
}

// ---- Sessions --------------------------------------------------------------
export function getSessions() { return cache.sessions; }
export function getSession(sessionId) { return cache.sessions[sessionId] || null; }
export function createSession(sessionId, email) {
  cache.sessions[sessionId] = { email, createdAt: Date.now() };
  persistSession(sessionId);
}
export function deleteSession(sessionId) {
  if (!sessionId || !cache.sessions[sessionId]) return;
  delete cache.sessions[sessionId];
  removeSession(sessionId);
}

// ---- Games -----------------------------------------------------------------
export function getGames() { return cache.games; }
export function getGame(gameId) { return cache.games[gameId] || null; }
export function saveGame(gameId, gameState) {
  cache.games[gameId] = gameState;
  persistGame(gameId);
}
export function deleteGame(gameId) {
  if (!cache.games[gameId]) return;
  delete cache.games[gameId];
  removeGame(gameId);
}
export function listGames() {
  return Object.values(cache.games).map(g => ({
    gameId: g.gameId, status: g.status,
    playerCount: Object.keys(g.players || {}).length,
    turn: g._turnNumber || 0, createdAt: g._createdAt,
  }));
}

// ---- Leaderboard (persists across game deletion) ---------------------------
export function getLeaderboard() { return cache.leaderboard; }
export function recordGameResult(result) {
  const lb = cache.leaderboard;
  lb.games.unshift(result);
  if (lb.games.length > 100) lb.games.length = 100;       // keep recent history
  for (const s of result.standings || []) {
    if (s.isBot || !s.email) continue;                    // humans only, keyed by email
    const p = lb.players[s.email] || { name: s.name, email: s.email, games: 0, wins: 0, bestNetWorth: 0 };
    p.name = s.name;
    p.games += 1;
    if (result.winnerEmail && result.winnerEmail === s.email) p.wins += 1;
    p.bestNetWorth = Math.max(p.bestNetWorth, Math.round(s.netWorth || 0));
    lb.players[s.email] = p;
  }
  persistLeaderboard();
}
