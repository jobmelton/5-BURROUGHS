// ===========================================================================
// 5 BOROUGHS ON THE TAKE — turns.js
// Single-player turn loop: roll dice, move around the board (with payday on
// wrap), resolve the landed space (buy / pay rent / draw career card).
// Handles jail: skip turns while jailed, countdown, doubles = early release.
// ===========================================================================
import { CONFIG } from './gameConfig.js';
import { resolveRent } from './economy.js';
import { drawFrom } from './decks.js';
import { tickNotifications } from './notifications.js';
import { moveAndResolve } from './movement.js';

/** Roll two six-sided dice. */
export function rollDice() {
  const d1 = Math.floor(Math.random() * 6) + 1;
  const d2 = Math.floor(Math.random() * 6) + 1;
  return { d1, d2, total: d1 + d2, doubles: d1 === d2 };
}

/** Send a player to (center) jail — used by RICO/Hit, tests, etc. */
export function sendToJail(player) {
  player.status.jailed = true;
  player.status.jailTurns = CONFIG.jail.maxTurns;
  player.track = 'jail';
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

  // --- move (handles jail, pit entry, pit ring, and the outer move) ---
  const res = moveAndResolve(state, player, roll);
  parts.push(...res.events);

  if (res.done) {
    // jail / pit / pit-entry fully handled — finish the turn
    if (state.strikeBoroughs) {
      for (const b of Object.keys(state.strikeBoroughs)) {
        if (state.strikeBoroughs[b] > 0) state.strikeBoroughs[b]--;
      }
    }
    tickNotifications(state);
    return { roll, description: parts.join(' → ') };
  }

  // --- landed on an OUTER space: resolve property / career here ---
  const space = res.space;
  parts.push(`moved to #${player.position} ${space.type} (borough ${space.borough})`);

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

  if (isProperty && space.ownerId === null) {
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
    // --- casino dice: special roll when landing on a casino anchor ---
    if (space.anchorType === 'casino') {
      const casinoRoll = rollDice();
      const casinoCfg = CONFIG.casino;
      parts.push(`Casino dice: ${casinoRoll.d1}+${casinoRoll.d2}=${casinoRoll.total}`);

      if (casinoCfg.free.includes(casinoRoll.total)) {
        parts.push('Lucky! Pay nothing');
      } else {
        const isOdd = casinoRoll.total % 2 !== 0;
        const mult = (isOdd && casinoCfg.tripleOnOdd) ? 3
                   : (!isOdd && casinoCfg.doubleOnEven) ? 2 : 1;
        const transfers = resolveRent(state, player.id, space.index);
        for (const t of transfers) {
          const adjusted = t.reason === 'rent' ? t.amount * mult : t.amount;
          if (state.players[t.from]) state.players[t.from].cash -= adjusted;
          if (t.to !== 'BANK' && state.players[t.to]) state.players[t.to].cash += adjusted;
        }
        const rentTransfer = transfers.find(t => t.reason === 'rent');
        if (rentTransfer) {
          const ownerName = state.players[space.ownerId]?.name ?? space.ownerId;
          parts.push(`${mult}x rent! Paid $${rentTransfer.amount * mult} to ${ownerName}`);
        }
      }
    } else {
      // normal rent
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

  // --- tick down strike durations ---
  if (state.strikeBoroughs) {
    for (const b of Object.keys(state.strikeBoroughs)) {
      if (state.strikeBoroughs[b] > 0) state.strikeBoroughs[b]--;
    }
  }

  // --- tick notifications ---
  tickNotifications(state);

  return { roll, description: parts.join(' → ') };
}
