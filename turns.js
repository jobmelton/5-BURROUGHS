// ===========================================================================
// 5 BOROUGHS ON THE TAKE — turns.js
// Single-player turn loop: roll dice, move around the board (with payday on
// wrap), resolve the landed space (buy / pay rent / draw career card).
// Handles jail: skip turns while jailed, countdown, doubles = early release.
// ===========================================================================
import { CONFIG } from './gameConfig.js';
import { resolveRent } from './economy.js';
import { drawFrom } from './decks.js';

/** Roll two six-sided dice. */
export function rollDice() {
  const d1 = Math.floor(Math.random() * 6) + 1;
  const d2 = Math.floor(Math.random() * 6) + 1;
  return { d1, d2, total: d1 + d2, doubles: d1 === d2 };
}

/** Send a player to jail (used by RICO, landing on jail space, etc.). */
export function sendToJail(player) {
  player.status.jailed = true;
  player.status.jailTurns = CONFIG.jail.maxTurns;
}

/**
 * Execute one full turn for a player:
 *   0. If jailed: roll for doubles (escape) or count down; skip movement
 *   1. Roll two dice
 *   2. Move (wrap + payday if passing start)
 *   3. Resolve the space (buy / rent / career draw / jail)
 * Returns { roll, description }.
 */
export function takeTurn(state, playerId) {
  const player = state.players[playerId];
  const roll = rollDice();
  const parts = [];

  let rollTag = `rolled ${roll.d1}+${roll.d2}=${roll.total}`;
  if (roll.doubles) rollTag += ' (doubles!)';
  parts.push(`${player.name} ${rollTag}`);

  // --- jail check ---
  if (player.status.jailed) {
    if (CONFIG.jail.doublesEscape && roll.doubles) {
      player.status.jailed = false;
      player.status.jailTurns = 0;
      parts.push('Doubles! Released from jail');
      // freed player gets a normal turn with this roll — fall through
    } else {
      player.status.jailTurns--;
      if (player.status.jailTurns <= 0) {
        player.status.jailed = false;
        player.status.jailTurns = 0;
        parts.push('Jail time served — released');
      } else {
        parts.push(`Still in jail (${player.status.jailTurns} turn(s) left)`);
        return { roll, description: parts.join(' → ') };
      }
    }
  }

  // --- move ---
  const boardLen = state.board.length;
  const oldPos = player.position;
  const newPos = (oldPos + roll.total) % boardLen;
  const passedStart = oldPos + roll.total >= boardLen;

  if (passedStart) {
    player.cash += CONFIG.money.paydayBase;
  }
  player.position = newPos;

  const space = state.board[newPos];
  parts.push(`moved to #${newPos} ${space.type} (borough ${space.borough})`);
  if (passedStart) parts.push(`Payday! +$${CONFIG.money.paydayBase}`);

  // --- career-draw triggers ---
  const triggerCareer =
    (CONFIG.careers.drawOnDoubles && roll.doubles) ||
    CONFIG.careers.drawOnTotals.includes(roll.total) ||
    (CONFIG.careers.drawOnCareerSpace && space.type === 'career');

  // --- resolve space ---
  const isProperty =
    space.type === 'vacantLot' ||
    space.type === 'anchorSlot' ||
    space.type.startsWith('abandoned');

  if (space.type === 'jail') {
    sendToJail(player);
    parts.push(`Busted! Sent to jail for ${CONFIG.jail.maxTurns} turns`);
  } else if (isProperty && space.ownerId === null) {
    // unowned buyable space
    if (player.cash >= space.basePrice) {
      player.cash -= space.basePrice;
      space.ownerId = player.id;
      player.propertyIds.push(space.index);
      parts.push(`Bought for $${space.basePrice} (cash $${player.cash})`);
    } else {
      parts.push(`Can't afford $${space.basePrice} (cash $${player.cash})`);
    }
  } else if (isProperty && space.ownerId && space.ownerId !== player.id) {
    // owned by someone else — pay rent (+ any capo skim / protection flows)
    const transfers = resolveRent(state, player.id, space.index);
    for (const t of transfers) {
      if (state.players[t.from]) state.players[t.from].cash -= t.amount;
      if (t.to !== 'BANK' && state.players[t.to]) {
        state.players[t.to].cash += t.amount;
      }
    }
    const rentTransfer = transfers.find(t => t.reason === 'rent');
    if (rentTransfer) {
      const ownerName = state.players[space.ownerId]?.name ?? space.ownerId;
      parts.push(`Paid $${rentTransfer.amount} rent to ${ownerName}`);
    }
  }

  // --- career card draw ---
  if (triggerCareer) {
    const card = drawFrom(state.careerPool);
    if (card) {
      player.roles.push(card);
      card.ownedById = player.id;
      parts.push(`Drew career: ${card.role} (borough ${card.borough})`);
    } else {
      parts.push('Career pool empty — no card drawn');
    }
  }

  return { roll, description: parts.join(' → ') };
}
