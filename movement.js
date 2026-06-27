// ===========================================================================
// 5 BOROUGHS ON THE TAKE — movement.js
// Shared multi-track movement so the four turn loops (turns.js takeTurn,
// server.js executeRoll + autoBotTurn, simulation.js) never diverge.
//
// Tracks: 'outer' (the 90-space pentagon), 'pit' (a shared inner ring), 'jail'
// (the center jail — reuses the normal jail economy). A player carries:
//   player.track            : 'outer' | 'pit' | 'jail'
//   player.position         : index within the CURRENT track
//   player.status.pendingPitEntry / pitEntryBorough
//
// moveAndResolve() handles jail, pit entry, pit movement + resolution, and the
// OUTER move (position math + payday). For an outer landing it returns the
// space and lets the caller run its own property/rent/career resolution.
// ===========================================================================
import { CONFIG } from './gameConfig.js';
import { drawFrom } from './decks.js';
import { processTaxSquare, calculateJailSentence, bossIsJailImmune, hasRole } from './roles.js';
import { processLoanPaymentsOnGo } from './lending.js';

/** Build the inner pit ring from config. */
export function buildPit() {
  return { ring: CONFIG.pit.ringLayout.map((kind, index) => ({ index, kind })) };
}

/** Lazy backfill so older saved games / players gain the new fields. */
export function ensurePit(state) {
  if (!state.pit) state.pit = buildPit();
}
export function ensureTrack(player) {
  if (!player.track) player.track = 'outer';
  if (player.status.pendingPitEntry === undefined) player.status.pendingPitEntry = false;
  if (player.status.pitEntryBorough === undefined) player.status.pitEntryBorough = null;
}

/** Leave any track and return to outer GO (collect payday + process loans). */
function goToGo(state, player, events, reason) {
  player.track = 'outer';
  player.position = 0;
  player.status.pendingPitEntry = false;
  if (CONFIG.pit.releasePayday) {
    player.cash += CONFIG.money.paydayBase;
    const loan = processLoanPaymentsOnGo(state, player.id);
    events.push(...loan.descriptions);
    events.push(`${reason} → back to GO (+$${CONFIG.money.paydayBase})`);
  } else {
    events.push(`${reason} → back to GO`);
  }
}

/** Send a player to the center jail (reuses status.jailed + sentence + immunity). */
export function sendToCenterJail(state, player, borough, events) {
  if (hasRole(player, 'Boss') && bossIsJailImmune(state, player.id)) {
    goToGo(state, player, events, 'Pit jail dodged (own a Cop)');
    return;
  }
  player.status.jailed = true;
  player.status.jailTurns = calculateJailSentence(state, player.id);
  player.track = 'jail';
  player.status.pendingPitEntry = false;
  events.push(`Thrown in the pit jail for ${player.status.jailTurns} turns`);
}

/** Resolve a landed pit-ring space. */
export function resolvePitSpace(state, player, pitSpace, events) {
  switch (pitSpace.kind) {
    case 'luckPark': {
      const amt = state.freeParkingPool || 0;
      player.cash += amt;
      state.freeParkingPool = 0;
      events.push(amt > 0 ? `Pit · Free Parking! +$${amt}` : 'Pit · Free Parking (empty)');
      break;
    }
    case 'luckCareer': {
      const card = drawFrom(state.careerPool);
      if (card) {
        card.ownedById = player.id;
        player.roles.push(card);
        events.push(`Pit · drew career ${card.role} (B${card.borough})`);
      } else {
        events.push('Pit · career pool empty');
      }
      break;
    }
    case 'demiseTax': {
      const r = processTaxSquare(state, player.id, player.status.pitEntryBorough || 1);
      events.push('Pit · ' + r.description);
      break;
    }
    case 'demiseJail':
      sendToCenterJail(state, player, player.status.pitEntryBorough || 1, events);
      break;
    case 'exit':
      goToGo(state, player, events, 'Pit exit');
      break;
    default:
      events.push(`Pit · unknown space ${pitSpace.kind}`);
  }
}

/** Handle a jailed player's turn. Always consumes the turn. */
function handleJailTurn(state, player, roll, events) {
  if (CONFIG.jail.doublesEscape && roll.doubles) {
    player.status.jailed = false;
    player.status.jailTurns = 0;
    goToGo(state, player, events, 'Doubles! Out of jail');
    return;
  }
  player.status.jailTurns--;
  if (player.status.jailTurns <= 0) {
    player.status.jailed = false;
    player.status.jailTurns = 0;
    goToGo(state, player, events, 'Time served');
  } else {
    events.push(`Still jailed (${player.status.jailTurns} turn(s) left)`);
  }
}

/**
 * Advance a player by a roll and handle jail / pit fully.
 * Returns { done, events, space, passedGo }.
 *   done=true  → turn fully handled here (jail, pit entry, pit move, or landed
 *                on a pitEntry block). Caller should stop.
 *   done=false → player moved on the OUTER board to `space`; caller resolves it.
 */
export function moveAndResolve(state, player, roll) {
  ensurePit(state);
  ensureTrack(player);
  const events = [];

  // --- jail (track 'jail') ---
  if (player.status.jailed || player.track === 'jail') {
    handleJailTurn(state, player, roll, events);
    return { done: true, events };
  }

  // --- entering the pit (pending from last turn's pitEntry landing) ---
  if (player.status.pendingPitEntry) {
    player.status.pendingPitEntry = false;
    player.track = 'pit';
    const ring = state.pit.ring;
    player.position = (CONFIG.pit.entryRingIndex + roll.total) % ring.length;
    const sp = ring[player.position];
    events.push('Pulled into the pit');
    resolvePitSpace(state, player, sp, events);
    return { done: true, events };
  }

  // --- already in the pit: roll along the ring ---
  if (player.track === 'pit') {
    const ring = state.pit.ring;
    player.position = (player.position + roll.total) % ring.length;
    const sp = ring[player.position];
    resolvePitSpace(state, player, sp, events);
    return { done: true, events };
  }

  // --- outer board move ---
  const boardLen = state.board.length;
  const old = player.position;
  const next = (old + roll.total) % boardLen;
  const passedGo = old + roll.total >= boardLen;
  if (passedGo) {
    player.cash += CONFIG.money.paydayBase;
    const loan = processLoanPaymentsOnGo(state, player.id);
    events.push(...loan.descriptions);
    events.push(`Payday! +$${CONFIG.money.paydayBase}`);
  }
  player.position = next;
  const space = state.board[next];

  // pit entrance block → pulled in next turn
  if (space.type === 'pitEntry') {
    player.status.pendingPitEntry = true;
    player.status.pitEntryBorough = space.borough;
    events.push(`Stepped on a pit entrance (B${space.borough}) — pulled in next turn`);
    return { done: true, events, space };
  }

  return { done: false, events, space, passedGo };
}
