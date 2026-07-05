// ===========================================================================
// 5 BOROUGHS ON THE TAKE — db.js
// Simple JSON file-based persistence for users, games, and sessions.
// ===========================================================================
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';

// DATA_DIR is env-configurable so a hosting platform (e.g. Railway) can point it
// at a persistent volume; falls back to a local ./data folder for dev.
const DATA_DIR = process.env.DATA_DIR || './data';
if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });

function filePath(name) { return `${DATA_DIR}/${name}.json`; }

function load(name) {
  const fp = filePath(name);
  if (!existsSync(fp)) return {};
  return JSON.parse(readFileSync(fp, 'utf-8'));
}

function save(name, data) {
  writeFileSync(filePath(name), JSON.stringify(data, null, 2), 'utf-8');
}

// ---- Users -----------------------------------------------------------------
export function getUsers() { return load('users'); }
export function saveUsers(users) { save('users', users); }
export function getUser(email) { return getUsers()[email] || null; }
export function createUser(email, name, passwordHash) {
  const users = getUsers();
  if (users[email]) return null;
  users[email] = { email, name, passwordHash, createdAt: Date.now() };
  saveUsers(users);
  return users[email];
}

// ---- Sessions --------------------------------------------------------------
export function getSessions() { return load('sessions'); }
export function saveSessions(sessions) { save('sessions', sessions); }
export function createSession(sessionId, email) {
  const sessions = getSessions();
  sessions[sessionId] = { email, createdAt: Date.now() };
  saveSessions(sessions);
}
export function getSession(sessionId) { return getSessions()[sessionId] || null; }
export function deleteSession(sessionId) {
  const sessions = getSessions();
  delete sessions[sessionId];
  saveSessions(sessions);
}

// ---- Games -----------------------------------------------------------------
export function getGames() { return load('games'); }
export function saveGames(games) { save('games', games); }
export function getGame(gameId) { return getGames()[gameId] || null; }
export function saveGame(gameId, gameState) {
  const games = getGames();
  games[gameId] = gameState;
  saveGames(games);
}
export function deleteGame(gameId) {
  const games = getGames();
  delete games[gameId];
  saveGames(games);
}
export function listGames() {
  const games = getGames();
  return Object.values(games).map(g => ({
    gameId: g.gameId,
    status: g.status,
    playerCount: Object.keys(g.players || {}).length,
    turn: g._turnNumber || 0,
    createdAt: g._createdAt,
  }));
}

// ---- Leaderboard (persists across game deletion) ---------------------------
function blankLeaderboard() { return { games: [], players: {} }; }
export function getLeaderboard() {
  const lb = load('leaderboard');
  return (lb && lb.games && lb.players) ? lb : blankLeaderboard();
}
export function recordGameResult(result) {
  const lb = getLeaderboard();
  lb.games.unshift(result);
  if (lb.games.length > 100) lb.games.length = 100; // keep recent history
  for (const s of result.standings || []) {
    if (s.isBot || !s.email) continue;             // humans only, keyed by email
    const p = lb.players[s.email] || { name: s.name, email: s.email, games: 0, wins: 0, bestNetWorth: 0 };
    p.name = s.name;
    p.games += 1;
    if (result.winnerEmail && result.winnerEmail === s.email) p.wins += 1;
    p.bestNetWorth = Math.max(p.bestNetWorth, Math.round(s.netWorth || 0));
    lb.players[s.email] = p;
  }
  save('leaderboard', lb);
}
