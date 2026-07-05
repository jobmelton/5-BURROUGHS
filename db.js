// ===========================================================================
// 5 BOROUGHS ON THE TAKE — db.js
// ---------------------------------------------------------------------------
// Runtime source of truth is an in-memory cache (fast, synchronous — no DB
// round-trip on every WebSocket state push). Durable storage is pluggable:
//   • Supabase (Postgres)  — used in production when SUPABASE_URL + key are set.
//   • JSON files (./data)  — automatic fallback for local dev & tests (offline).
// Reads hit the cache; writes update the cache AND write through to the backend.
// Call `await init()` once at server startup to hydrate the cache.
// ===========================================================================
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';

const DATA_DIR = process.env.DATA_DIR || './data';
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_KEY;
const USE_SUPABASE = Boolean(SUPABASE_URL && SUPABASE_KEY);

let supabase = null;

// ---- In-memory cache (runtime source of truth) -----------------------------
const cache = {
  users: {},        // email → { email, name, passwordHash, createdAt }
  sessions: {},     // sessionId → { email, createdAt }
  games: {},        // gameId → full game state object
  leaderboard: { games: [], players: {} },
};

function logErr(ctx) {
  return (res) => { if (res?.error) console.error(`[db] ${ctx}:`, res.error.message || res.error); };
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

// ---- Startup: hydrate the cache from the durable backend -------------------
export async function init() {
  if (USE_SUPABASE) {
    const { createClient } = await import('@supabase/supabase-js');
    supabase = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } });
    const [users, sessions, games, lb] = await Promise.all([
      supabase.from('users').select('*'),
      supabase.from('sessions').select('*'),
      supabase.from('games').select('*'),
      supabase.from('leaderboard').select('*').eq('id', 'main').maybeSingle(),
    ]);
    for (const r of users.data || []) cache.users[r.email] = { email: r.email, name: r.name, passwordHash: r.password_hash, createdAt: Number(r.created_at) };
    for (const r of sessions.data || []) cache.sessions[r.session_id] = { email: r.email, createdAt: Number(r.created_at) };
    for (const r of games.data || []) cache.games[r.game_id] = r.state;
    if (lb.data?.data) cache.leaderboard = lb.data.data;
    console.log(`[db] Supabase backend ready — ${Object.keys(cache.games).length} games, ${Object.keys(cache.users).length} users`);
  } else {
    cache.users = loadFile('users', {});
    cache.sessions = loadFile('sessions', {});
    cache.games = loadFile('games', {});
    cache.leaderboard = loadFile('leaderboard', { games: [], players: {} });
    console.log(`[db] File backend ready (${DATA_DIR})`);
  }
}

// ---- Write-through persistence (fire-and-forget; cache already updated) -----
function persistUser(email) {
  if (!USE_SUPABASE) return saveFile('users', cache.users);
  const u = cache.users[email];
  supabase.from('users').upsert({ email: u.email, name: u.name, password_hash: u.passwordHash, created_at: u.createdAt }).then(logErr('upsert user'));
}
function persistSession(sessionId) {
  if (!USE_SUPABASE) return saveFile('sessions', cache.sessions);
  const s = cache.sessions[sessionId];
  supabase.from('sessions').upsert({ session_id: sessionId, email: s.email, created_at: s.createdAt }).then(logErr('upsert session'));
}
function removeSession(sessionId) {
  if (!USE_SUPABASE) return saveFile('sessions', cache.sessions);
  supabase.from('sessions').delete().eq('session_id', sessionId).then(logErr('delete session'));
}
function persistGame(gameId) {
  if (!USE_SUPABASE) return saveFile('games', cache.games);
  supabase.from('games').upsert({ game_id: gameId, state: cache.games[gameId], updated_at: Date.now() }).then(logErr('upsert game'));
}
function removeGame(gameId) {
  if (!USE_SUPABASE) return saveFile('games', cache.games);
  supabase.from('games').delete().eq('game_id', gameId).then(logErr('delete game'));
}
function persistLeaderboard() {
  if (!USE_SUPABASE) return saveFile('leaderboard', cache.leaderboard);
  supabase.from('leaderboard').upsert({ id: 'main', data: cache.leaderboard }).then(logErr('upsert leaderboard'));
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
