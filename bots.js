// ===========================================================================
// 5 BOROUGHS ON THE TAKE — bots.js
// Async seat management: bot floor, richest-bot dissolution on human join,
// alliance-collapse notices, and the double-setback rule.
// ===========================================================================
import { CONFIG } from './gameConfig.js';
import { catchUpStake } from './economy.js';

const { seats, bots } = CONFIG;

/** How many bots should currently exist: keep total filled seats >= botFloor,
 *  humans fill first, bots only backfill up to max. */
export function desiredBotCount(state) {
  const humans = Object.values(state.players).filter(p => !p.isBot).length;
  const targetFilled = Math.max(seats.botFloor, humans);
  const cappedFilled = Math.min(seats.max, targetFilled);
  return Math.max(0, cappedFilled - humans);
}

/** A human joins: dissolve the richest bot (if any), return its assets to the
 *  pool, fire alliance-collapse notices, and seat the human with a catch-up stake. */
export function onHumanJoin(state, human) {
  const notices = [];

  const richestBot = Object.values(state.players)
    .filter(p => p.isBot)
    .sort((a, b) => (b.netWorth || 0) - (a.netWorth || 0))[0];

  if (richestBot) {
    notices.push(...dissolvePlayer(state, richestBot.id, 'A rival was eliminated'));
  }

  // seat the human with a scaled catch-up stake (the human's "setback":
  // they do NOT inherit the bot's empire — they start fresh-but-scaled)
  human.isBot = false;
  human.cash = catchUpStake(state);
  human.position = 0;
  human.propertyIds = human.propertyIds || [];
  human.roles = human.roles || [];
  human.hand = human.hand || [];
  human.debts = human.debts || [];
  human.status = human.status || { protectedByCopId: null, ownedByBossId: null, jailed: false, jailTurns: 0 };
  human.allianceIds = human.allianceIds || [];
  state.players[human.id] = human;

  notices.push({ to: human.id, msg: `You've entered the city with $${human.cash}. The board is live — make your move.` });
  return notices;
}

/** Remove a player/bot entirely; return their holdings to the pool; ripple
 *  the collapse through everyone allied or entangled with them. */
export function dissolvePlayer(state, playerId, headline) {
  const p = state.players[playerId];
  if (!p) return [];
  const notices = [];

  // 1) properties revert to buyable + unbuilt
  for (const idx of p.propertyIds || []) {
    const space = state.board[idx];
    space.ownerId = null;
    space.name = undefined;
    if (bots.revertDissolvedPropertyToUnbuilt) {
      space.buildLevel = 0;
      space.anchorLevel = 0;
      space.haloBonus = 0;
    }
  }

  // 2) career cards reshuffle into the pool; owned officials go free
  if (bots.reshuffleDissolvedCards) {
    for (const card of p.roles || []) {
      card.ownedById = null;
      card.clean = true;
      state.careerPool.push(card);
    }
  }

  // 3) ripple: anyone allied with this player loses the relationship
  for (const other of Object.values(state.players)) {
    if (other.id === playerId) continue;
    const wasAllied = (other.allianceIds || []).includes(playerId);
    if (wasAllied) {
      other.allianceIds = other.allianceIds.filter(id => id !== playerId);
      notices.push({
        to: other.id,
        msg: `${headline}: ${p.name} has been eliminated and is no longer part of your organization. All ties — kickups, partnerships, protection — have ended.`,
      });
    }
    // protection sold by this player lapses
    if (other.status?.protectedByCopId === playerId) {
      other.status.protectedByCopId = null;
      notices.push({ to: other.id, msg: `Your protection lapsed — ${p.name} is gone.` });
    }
    // ownership by this player (as a boss) dissolves -> the official goes free
    if (other.status?.ownedByBossId === playerId) {
      other.status.ownedByBossId = null;
      notices.push({ to: other.id, msg: `You're free — ${p.name} no longer controls you.` });
    }
  }

  // 4) debts held by this player return to the bank (cleared for borrowers)
  for (const other of Object.values(state.players)) {
    other.debts = (other.debts || []).filter(d => {
      if (d.bankerId === playerId) {
        notices.push({ to: other.id, msg: `A debt to ${p.name} was wiped when they fell.` });
        return false;
      }
      return true;
    });
  }

  // 5) remove the player from the game
  delete state.players[playerId];
  return notices;
}
