// ===========================================================================
// 5 BOROUGHS ON THE TAKE — server.js
// Express server + WebSocket for real-time multiplayer web game.
// ===========================================================================
import express from 'express';
import { createServer } from 'node:http';
import { WebSocketServer } from 'ws';
import cookieParser from 'cookie-parser';
import { v4 as uuid } from 'uuid';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { CONFIG } from './gameConfig.js';
import { buildBoard } from './board.js';
import { buildPit, moveAndResolve, ensurePit, ensureTrack } from './movement.js';
import { buildCareerPool, buildActionPool, drawFrom } from './decks.js';
import { getBuildOptions, buildOnSpace, effectiveRent, contiguousOwnedRun } from './economy.js';
import { rollDice } from './turns.js';
import { calculateCapoSkim, findRoleHolder, hasRole, bossHasRICOImmunity, bossIsJailImmune, calculateBail, calculateCasinoCut, processTaxSquare } from './roles.js';
import { getPropertyOptions, executePropertyAction, acceptFlip } from './propertyFlow.js';
import { getCantPayOptions, startAuction, submitAuctionBid, closeAuction, acceptMobDeal, mortgageForRent } from './rentFlow.js';
import { createNotification, getPlayerNotifications, respondToNotification, tickNotifications, NOTIF_TYPES } from './notifications.js';
import { proposePartnership, acceptPartnership, splitRent } from './partnerships.js';
import { requestBankLoan, requestMobLoan, offerBankRate, offerMobTerms, acceptLoan, processLoanPaymentsOnGo, grantInstantLoan } from './lending.js';
import { makeDormant, activateDormant } from './dormant.js';
import * as db from './db.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ server });
const PORT = process.env.PORT || 3000;

// ---- Middleware ------------------------------------------------------------
app.use(express.json());
app.use(cookieParser());
app.use(express.static(join(__dirname, 'public'), {
  // Never let the browser serve a stale HTML page (which can redirect to a dead
  // /game/<id>). HTML always revalidates; hashed assets keep normal caching.
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.html')) res.setHeader('Cache-Control', 'no-cache');
  },
}));

// simple password hash (not bcrypt since it needs native)
function hashPw(pw) { return createHash('sha256').update(pw).digest('hex'); }

// auth middleware
function requireAuth(req, res, next) {
  const sid = req.cookies?.sid;
  if (!sid) return res.status(401).json({ error: 'Not logged in' });
  const session = db.getSession(sid);
  if (!session) return res.status(401).json({ error: 'Session expired' });
  req.userEmail = session.email;
  req.user = db.getUser(session.email);
  next();
}

// ---- WebSocket tracking ----------------------------------------------------
const wsClients = new Map(); // email → Set<ws>

wss.on('connection', (ws, req) => {
  // parse cookie from upgrade request
  const cookies = {};
  (req.headers.cookie || '').split(';').forEach(c => {
    const [k, v] = c.trim().split('=');
    if (k && v) cookies[k] = v;
  });
  const session = db.getSession(cookies.sid);
  if (!session) { ws.close(); return; }

  const email = session.email;
  if (!wsClients.has(email)) wsClients.set(email, new Set());
  wsClients.get(email).add(ws);

  ws.on('close', () => {
    wsClients.get(email)?.delete(ws);
    if (wsClients.get(email)?.size === 0) wsClients.delete(email);
  });
});

function broadcast(gameState, event) {
  // send to all players in a game
  for (const player of Object.values(gameState.players || {})) {
    if (player._email) {
      const clients = wsClients.get(player._email);
      if (clients) {
        const payload = JSON.stringify({ type: event.type, data: event.data, gameId: gameState.gameId });
        for (const ws of clients) {
          if (ws.readyState === 1) ws.send(payload);
        }
      }
    }
  }
}

function sendToPlayer(gameState, playerId, event) {
  const player = gameState.players?.[playerId];
  if (!player?._email) return;
  const clients = wsClients.get(player._email);
  if (clients) {
    const payload = JSON.stringify({ type: event.type, data: event.data, gameId: gameState.gameId });
    for (const ws of clients) {
      if (ws.readyState === 1) ws.send(payload);
    }
  }
}

// ---- Auth Routes -----------------------------------------------------------
app.post('/api/register', (req, res) => {
  const { email, name, password } = req.body;
  if (!email || !name || !password) return res.status(400).json({ error: 'Missing fields' });
  const existing = db.getUser(email);
  if (existing) return res.status(400).json({ error: 'Email already registered' });
  db.createUser(email, name, hashPw(password));
  const sid = uuid();
  db.createSession(sid, email);
  res.cookie('sid', sid, { httpOnly: true, maxAge: 30 * 24 * 60 * 60 * 1000 });
  res.json({ ok: true, name });
});

app.post('/api/login', (req, res) => {
  const { email, password } = req.body;
  const user = db.getUser(email);
  if (!user || user.passwordHash !== hashPw(password)) return res.status(401).json({ error: 'Invalid credentials' });
  const sid = uuid();
  db.createSession(sid, email);
  res.cookie('sid', sid, { httpOnly: true, maxAge: 30 * 24 * 60 * 60 * 1000 });
  res.json({ ok: true, name: user.name });
});

app.post('/api/logout', (req, res) => {
  db.deleteSession(req.cookies?.sid);
  res.clearCookie('sid');
  res.json({ ok: true });
});

app.get('/api/me', requireAuth, (req, res) => {
  res.json({ email: req.user.email, name: req.user.name });
});

// ---- Game Routes -----------------------------------------------------------
app.get('/api/games', requireAuth, (req, res) => {
  res.json(db.listGames());
});

app.post('/api/games', requireAuth, (req, res) => {
  const gameId = uuid().slice(0, 8);
  const state = {
    gameId,
    board: buildBoard(),
    pit: buildPit(),
    players: {},
    careerPool: buildCareerPool(),
    actionPool: buildActionPool(),
    taxPool: 0, bountyPool: 0, freeParkingPool: 0,
    cleanCityMeter: 1, godfatherId: null,
    notifications: [], strikeBoroughs: {}, codeViolations: {},
    _turnNumber: 0, _currentPlayerIdx: 0, _playerOrder: [],
    _createdAt: Date.now(), _startedAt: null,
    status: 'waiting',
  };

  // creator joins as first player
  const playerId = `p-${uuid().slice(0, 6)}`;
  state.players[playerId] = newWebPlayer(playerId, req.user.name, req.userEmail);
  state._playerOrder.push(playerId);

  db.saveGame(gameId, state);
  res.json({ gameId, playerId });
});

app.post('/api/games/:id/join', requireAuth, (req, res) => {
  const state = db.getGame(req.params.id);
  if (!state) return res.status(404).json({ error: 'Game not found' });
  if (state.status !== 'waiting') return res.status(400).json({ error: 'Game already started' });
  if (Object.keys(state.players).length >= CONFIG.seats.max) return res.status(400).json({ error: 'Game full' });

  // check if already joined
  const existing = Object.values(state.players).find(p => p._email === req.userEmail);
  if (existing) return res.json({ gameId: state.gameId, playerId: existing.id });

  const playerId = `p-${uuid().slice(0, 6)}`;
  state.players[playerId] = newWebPlayer(playerId, req.user.name, req.userEmail);
  state._playerOrder.push(playerId);

  db.saveGame(state.gameId, state);
  broadcast(state, { type: 'player_joined', data: { name: req.user.name, playerId, count: Object.keys(state.players).length } });
  res.json({ gameId: state.gameId, playerId });
});

app.post('/api/games/:id/start', requireAuth, (req, res) => {
  const state = db.getGame(req.params.id);
  if (!state) return res.status(404).json({ error: 'Game not found' });
  if (state.status !== 'waiting') return res.status(400).json({ error: 'Already started' });

  // fill remaining seats with bots up to botFloor
  const humanCount = Object.keys(state.players).length;
  const botsNeeded = Math.max(0, CONFIG.seats.botFloor - humanCount);
  for (let i = 0; i < botsNeeded; i++) {
    const botId = `bot-${uuid().slice(0, 4)}`;
    state.players[botId] = newWebPlayer(botId, `Bot ${i + 1}`, null, true);
    state._playerOrder.push(botId);
  }

  state.status = 'ongoing';
  state._startedAt = Date.now();
  state._turnNumber = 1;
  state._currentPlayerIdx = 0;

  db.saveGame(state.gameId, state);
  broadcast(state, { type: 'game_started', data: { playerCount: Object.keys(state.players).length, turn: 1 } });
  res.json({ ok: true, currentPlayer: state._playerOrder[0] });
});

// ---- Game State (player's personal view) -----------------------------------
app.get('/api/games/:id/state', requireAuth, (req, res) => {
  const state = db.getGame(req.params.id);
  if (!state) return res.status(404).json({ error: 'Game not found' });

  const myPlayer = Object.values(state.players).find(p => p._email === req.userEmail);
  if (!myPlayer) return res.status(403).json({ error: 'Not in this game' });

  ensurePit(state);                 // backfill pit ring for pre-pit saved games
  Object.values(state.players).forEach(ensureTrack);

  const currentPlayerId = state._playerOrder[state._currentPlayerIdx];
  const isMyTurn = currentPlayerId === myPlayer.id;

  // build personal view
  res.json({
    gameId: state.gameId,
    status: state.status,
    turn: state._turnNumber,
    isMyTurn,
    currentPlayer: state.players[currentPlayerId]?.name || currentPlayerId,
    me: sanitizePlayer(myPlayer),
    players: Object.values(state.players).map(p => ({
      id: p.id, name: p.name, isBot: p.isBot,
      cash: p.cash, netWorth: p.netWorth,
      position: p.position, track: p.track || 'outer',
      propertyCount: p.propertyIds.length,
      roleCount: p.roles.length,
      jailed: p.status.jailed,
      ownedByBoss: p.status.ownedByBossId ? state.players[p.status.ownedByBossId]?.name : null,
    })),
    board: state.board.map(sp => ({
      index: sp.index, borough: sp.borough, type: sp.type,
      basePrice: sp.basePrice, baseRent: sp.baseRent,
      ownerId: sp.ownerId, ownerName: sp.ownerId ? state.players[sp.ownerId]?.name : null,
      buildLevel: sp.buildLevel, buildingType: sp.buildingType,
      rentMultiplier: sp.rentMultiplier,
      effectiveRent: sp.basePrice > 0 ? effectiveRent(sp) : 0,
      anchorType: sp.anchorType, anchorLevel: sp.anchorLevel,
      haloBonus: sp.haloBonus,
      partnership: sp.partnership,
      isMine: sp.ownerId === myPlayer.id,
      // build choices for the viewer's own lots — powers the Build picker
      buildOptions: sp.ownerId === myPlayer.id
        ? getBuildOptions(state, myPlayer.id, sp.index).map(o => ({
            type: o.type, label: o.label, cost: o.cost, affordable: o.affordable,
            rentResult: o.rentResult, blocked: o.type === '_blocked', reason: o.reason || null,
          }))
        : undefined,
    })),
    notifications: getPlayerNotifications(state, myPlayer.id),
    freeParkingPool: state.freeParkingPool,
    taxPool: state.taxPool,
    pit: { ring: state.pit.ring.map(s => ({ index: s.index, kind: s.kind })) },
  });
});

// ---- Turn Actions ----------------------------------------------------------
app.post('/api/games/:id/roll', requireAuth, (req, res) => {
  const state = db.getGame(req.params.id);
  if (!state) return res.status(404).json({ error: 'Game not found' });
  if (state.status !== 'ongoing') return res.status(400).json({ error: 'Game not active' });

  const myPlayer = Object.values(state.players).find(p => p._email === req.userEmail);
  if (!myPlayer) return res.status(403).json({ error: 'Not in this game' });

  const currentPlayerId = state._playerOrder[state._currentPlayerIdx];
  if (currentPlayerId !== myPlayer.id) return res.status(400).json({ error: 'Not your turn' });
  if (myPlayer.status.rolledThisTurn) return res.status(400).json({ error: 'Already rolled this turn' });

  // execute the roll and movement
  const result = executeRoll(state, myPlayer);
  myPlayer.status.rolledThisTurn = true;

  db.saveGame(state.gameId, state);
  broadcast(state, { type: 'turn_taken', data: result });

  res.json(result);
});

app.post('/api/games/:id/action', requireAuth, (req, res) => {
  const state = db.getGame(req.params.id);
  if (!state) return res.status(404).json({ error: 'Game not found' });

  const myPlayer = Object.values(state.players).find(p => p._email === req.userEmail);
  if (!myPlayer) return res.status(403).json({ error: 'Not in this game' });

  const { action, params } = req.body;
  const result = executeAction(state, myPlayer, action, params || {});

  db.saveGame(state.gameId, state);
  broadcast(state, { type: 'action_taken', data: { player: myPlayer.name, ...result } });

  res.json(result);
});

app.post('/api/games/:id/endturn', requireAuth, (req, res) => {
  const state = db.getGame(req.params.id);
  if (!state) return res.status(404).json({ error: 'Game not found' });

  const myPlayer = Object.values(state.players).find(p => p._email === req.userEmail);
  const currentPlayerId = state._playerOrder[state._currentPlayerIdx];
  if (currentPlayerId !== myPlayer?.id) return res.status(400).json({ error: 'Not your turn' });

  // advance to next player
  advanceTurn(state);

  // auto-play bot turns
  while (state.status === 'ongoing') {
    const nextId = state._playerOrder[state._currentPlayerIdx];
    const nextPlayer = state.players[nextId];
    if (!nextPlayer?.isBot) break;
    autoBotTurn(state, nextPlayer);
    advanceTurn(state);
  }

  db.saveGame(state.gameId, state);

  const nextId = state._playerOrder[state._currentPlayerIdx];
  broadcast(state, { type: 'turn_advanced', data: { turn: state._turnNumber, currentPlayer: state.players[nextId]?.name } });

  res.json({ ok: true, turn: state._turnNumber, currentPlayer: state.players[nextId]?.name });
});

app.post('/api/games/:id/respond', requireAuth, (req, res) => {
  const state = db.getGame(req.params.id);
  if (!state) return res.status(404).json({ error: 'Game not found' });

  const myPlayer = Object.values(state.players).find(p => p._email === req.userEmail);
  if (!myPlayer) return res.status(403).json({ error: 'Not in this game' });

  const { notifId, response, counterValue } = req.body;
  const result = respondToNotification(state, notifId, response, counterValue);

  // handle accepted notifications
  if (response === 'accept') {
    const notif = state.notifications.find(n => n.id === notifId);
    if (notif?.type === NOTIF_TYPES.PARTNER_OFFER) {
      const pResult = acceptPartnership(state, myPlayer.id, notifId);
      result.description = pResult.description;
    } else if (notif?.type === NOTIF_TYPES.FLIP_OFFER) {
      const fResult = acceptFlip(state, myPlayer.id, notifId);
      result.description = fResult.description;
    } else if (notif?.type === NOTIF_TYPES.LOAN_RATE_OFFER || notif?.type === NOTIF_TYPES.MOB_LOAN_TERMS) {
      const lResult = acceptLoan(state, notifId);
      result.description = lResult.description;
    }
  }

  db.saveGame(state.gameId, state);
  broadcast(state, { type: 'notification_response', data: { player: myPlayer.name, ...result } });

  res.json(result);
});

// ---- Game Logic Helpers ----------------------------------------------------

function newWebPlayer(id, name, email, isBot = false) {
  return {
    id, name, isBot, _email: email,
    cash: CONFIG.money.startingCash, position: 0, track: 'outer',
    propertyIds: [], roles: [], dormantRoles: [], hand: [], debts: [],
    status: { protectedByCopId: null, ownedByBossId: null, jailed: false, jailTurns: 0, hasMobDebt: false, roleDirty: false, rolledThisTurn: false, pendingPitEntry: false, pitEntryBorough: null },
    allianceIds: [], netWorth: CONFIG.money.startingCash,
  };
}

function sanitizePlayer(p) {
  return {
    id: p.id, name: p.name, cash: p.cash, position: p.position, track: p.track || 'outer',
    propertyIds: p.propertyIds,
    roles: p.roles.map(r => ({ id: r.id, role: r.role, borough: r.borough, clean: r.clean })),
    dormantRoles: (p.dormantRoles || []).map(r => ({ id: r.id, role: r.role, borough: r.borough })),
    hand: p.hand.map(c => ({ id: c.id, type: c.type })),
    debts: p.debts,
    status: p.status,
    netWorth: p.netWorth,
    jailed: p.status.jailed,
    jailTurns: p.status.jailTurns,
  };
}

function executeRoll(state, player) {
  const roll = rollDice();
  const res = moveAndResolve(state, player, roll);
  const events = [...res.events];
  let options = [];

  // jail / pit entry / pit ring fully handled by movement.js
  if (res.done) {
    tickNotifications(state);
    updateNetWorth(state, player);
    return {
      roll, events, position: player.position, track: player.track,
      space: res.space ? { index: res.space.index, type: res.space.type, borough: res.space.borough, basePrice: res.space.basePrice } : null,
      options, cash: player.cash,
    };
  }

  // landed on an OUTER space — resolve career / property / rent here
  const space = res.space;

  if (space.type === 'career') {
    const card = drawFrom(state.careerPool);
    if (card) {
      card.ownedById = player.id;
      player.roles.push(card);
      events.push(`Drew career: ${card.role} (Borough ${card.borough})`);
    }
  } else if (space.basePrice > 0 && space.ownerId === null) {
    options = getPropertyOptions(state, player.id, space.index);
    options.forEach(o => { o.spaceIndex = space.index; }); // so the client can act on the landed lot
    events.push(`Unowned ${space.type} — $${space.basePrice}`);
  } else if (space.basePrice > 0 && space.ownerId && space.ownerId !== player.id && space.buildLevel >= 0) {
    const rent = effectiveRent(space);
    const owner = state.players[space.ownerId];
    if (player.cash >= rent) {
      player.cash -= rent;
      if (owner && !owner.status.jailed) {
        const skim = player.status.protectedByCopId ? { capoAmount: 0, bossKickup: 0 } : calculateCapoSkim(state, space.borough, rent);
        let ownerIncome = rent;
        if (skim.capoAmount > 0) {
          const capo = state.players[skim.capoId]; if (capo) { capo.cash += skim.capoAmount; ownerIncome -= skim.capoAmount; }
          if (skim.bossKickup > 0) { const boss = state.players[skim.bossId]; if (boss) { boss.cash += skim.bossKickup; ownerIncome -= skim.bossKickup; } }
        }
        owner.cash += Math.max(0, ownerIncome);
      } else if (owner?.status.jailed) {
        state.freeParkingPool += rent;
        events.push('Owner jailed — rent to free parking');
      }
      events.push(`Paid $${rent} rent to ${owner?.name || '?'}`);
    } else {
      // can't pay rent
      options = getCantPayOptions(state, player.id, rent, space.index);
      events.push(`Owe $${rent} rent to ${owner?.name || '?'} — can't afford!`);
    }
  }

  // career draw on doubles/7/11
  if ((roll.doubles || CONFIG.careers.drawOnTotals.includes(roll.total)) && space.type !== 'career') {
    const card = drawFrom(state.actionPool) || drawFrom(state.careerPool);
    if (card) {
      if (card.type) { player.hand.push(card); events.push(`Action card: ${card.type}`); }
      else { card.ownedById = player.id; player.roles.push(card); events.push(`Drew ${card.role} (B${card.borough})`); }
    }
  }

  tickNotifications(state);
  updateNetWorth(state, player);

  return {
    roll, events, position: player.position, track: player.track,
    space: { index: space.index, type: space.type, borough: space.borough, basePrice: space.basePrice },
    options,
    cash: player.cash,
  };
}

function executeAction(state, player, action, params) {
  switch (action) {
    case 'buy': return executePropertyAction(state, player.id, params.spaceIndex, 'buy');
    case 'partner': return executePropertyAction(state, player.id, params.spaceIndex, 'partner', params);
    case 'flip': return executePropertyAction(state, player.id, params.spaceIndex, 'flip', params);
    case 'pass': return { ok: true, description: 'Passed.' };
    case 'borrow_bank': return requestBankLoan(state, player.id, params.amount, params.spaceIndex);
    case 'borrow_mob': return requestMobLoan(state, player.id, params.amount, params.spaceIndex);
    case 'borrow': return grantInstantLoan(state, player.id, params.amount, params.loanType || 'bank');
    case 'build': return buildOnSpace(state, player.id, params.spaceIndex, params.buildingType);
    case 'mortgage': return mortgageForRent(state, player.id, params.spaceIndex);
    case 'auction': return startAuction(state, player.id, params.spaceIndex, params.startingBid);
    case 'mob_deal': return acceptMobDeal(state, player.id, params.bossId, params.rentOwed, params.landlordId);
    case 'dormant': return makeDormant(state, player.id, params.cardId);
    case 'activate': return activateDormant(state, player.id, params.cardId);
    default: return { ok: false, description: `Unknown action: ${action}` };
  }
}

function advanceTurn(state) {
  state._currentPlayerIdx = (state._currentPlayerIdx + 1) % state._playerOrder.length;
  if (state._currentPlayerIdx === 0) state._turnNumber++;
  // Fresh turn for the incoming player — they may roll again.
  const incoming = state.players[state._playerOrder[state._currentPlayerIdx]];
  if (incoming) incoming.status.rolledThisTurn = false;
}

function autoBotTurn(state, bot) {
  // simplified bot: roll (jail/pit handled by movement.js), auto-buy cheap, auto-build
  const roll = rollDice();
  const res = moveAndResolve(state, bot, roll);

  if (!res.done) {
    const space = res.space;
    if (space.basePrice > 0 && space.ownerId === null && space.basePrice <= bot.cash * 0.4) {
      bot.cash -= space.basePrice; space.ownerId = bot.id; bot.propertyIds.push(space.index);
    } else if (space.basePrice > 0 && space.ownerId && space.ownerId !== bot.id && space.buildLevel >= 0) {
      const rent = effectiveRent(space);
      const paid = Math.min(rent, bot.cash); bot.cash -= paid;
      const owner = state.players[space.ownerId]; if (owner) owner.cash += paid;
    } else if (space.type === 'career') {
      const card = drawFrom(state.careerPool);
      if (card) { card.ownedById = bot.id; bot.roles.push(card); }
    }
  }

  // bot builds (only while out on the board)
  if (bot.track === 'outer') {
    for (const idx of bot.propertyIds) {
      if (bot.cash < 100) break;
      const opts = getBuildOptions(state, bot.id, idx);
      if (opts.length > 0 && opts[0].type !== '_blocked' && opts[0].affordable) {
        buildOnSpace(state, bot.id, idx, opts[0].type);
      }
    }
  }

  updateNetWorth(state, bot);
}

function updateNetWorth(state, player) {
  const propValue = player.propertyIds.reduce((s, i) => s + state.board[i].basePrice * (state.board[i].rentMultiplier || 1), 0);
  player.netWorth = player.cash + propValue;
}

// ---- Serve frontend --------------------------------------------------------
const noCacheHtml = { headers: { 'Cache-Control': 'no-cache' } };
app.get('/', (req, res) => res.sendFile(join(__dirname, 'public', 'index.html'), noCacheHtml));
app.get('/game/:id', (req, res) => res.sendFile(join(__dirname, 'public', 'game.html'), noCacheHtml));

// ---- JSON error handler ----------------------------------------------------
// Defense-in-depth: any uncaught error in a route returns JSON, never a raw
// HTML stack trace (which would leak filesystem paths to the client).
app.use((err, req, res, next) => {
  console.error('Unhandled route error:', err);
  if (res.headersSent) return next(err);
  res.status(500).json({ error: 'Internal server error' });
});

// ---- Start -----------------------------------------------------------------
server.listen(PORT, () => {
  console.log(`5 Boroughs server running on http://localhost:${PORT}`);
});
