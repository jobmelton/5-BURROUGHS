// ===========================================================================
// 5 BOROUGHS ON THE TAKE — dormant.js
// Dormant card system: players can hold Boss/Capo cards as inactive.
// Risk: if in trouble, a Boss/Capo can seize dormant cards as a condition.
// ===========================================================================
import { CONFIG } from './gameConfig.js';
import { createNotification, NOTIF_TYPES } from './notifications.js';

/**
 * Place a drawn role card into dormant status instead of activating it.
 * The card shows on the player's profile as inactive but has no effect.
 * Returns { ok, description }.
 */
export function makeDormant(state, playerId, cardId) {
  const player = state.players[playerId];
  if (!player) return { ok: false, description: 'Invalid player.' };

  const cardIdx = player.roles.findIndex(r => r.id === cardId);
  if (cardIdx === -1) return { ok: false, description: 'Card not found in active roles.' };

  const card = player.roles.splice(cardIdx, 1)[0];
  if (!player.dormantRoles) player.dormantRoles = [];
  player.dormantRoles.push(card);

  return {
    ok: true,
    description: `${player.name} placed ${card.role} (b${card.borough}) into dormant status. Visible on profile but inactive.`,
  };
}

/**
 * Activate a dormant card — move it from dormant to active roles.
 * Returns { ok, description }.
 */
export function activateDormant(state, playerId, cardId) {
  const player = state.players[playerId];
  if (!player) return { ok: false, description: 'Invalid player.' };
  if (!player.dormantRoles) return { ok: false, description: 'No dormant cards.' };

  const cardIdx = player.dormantRoles.findIndex(r => r.id === cardId);
  if (cardIdx === -1) return { ok: false, description: 'Card not found in dormant roles.' };

  const card = player.dormantRoles.splice(cardIdx, 1)[0];
  player.roles.push(card);

  return {
    ok: true,
    description: `${player.name} activated dormant ${card.role} (b${card.borough}).`,
  };
}

/**
 * Seize a dormant card from a player in trouble.
 * A Boss or Capo can force-take a seizable dormant card (Boss/Capo)
 * as a condition of providing help (loan, bail, etc.).
 * Returns { ok, description, card }.
 */
export function seizeDormantCard(state, seizerId, targetId, cardId) {
  const seizer = state.players[seizerId];
  const target = state.players[targetId];
  if (!seizer || !target) return { ok: false, description: 'Invalid players.' };
  if (!target.dormantRoles || target.dormantRoles.length === 0) {
    return { ok: false, description: `${target.name} has no dormant cards.` };
  }

  // seizer must hold a Boss or Capo role
  const hasPower = seizer.roles.some(r => r.role === 'Boss' || r.role === 'Capo');
  if (!hasPower) return { ok: false, description: `${seizer.name} doesn't have the authority to seize cards.` };

  const cardIdx = target.dormantRoles.findIndex(r => r.id === cardId);
  if (cardIdx === -1) return { ok: false, description: 'Dormant card not found.' };

  const card = target.dormantRoles[cardIdx];
  if (!CONFIG.dormant.seizeableRoles.includes(card.role)) {
    return { ok: false, description: `${card.role} cards cannot be seized.` };
  }

  // seize it
  target.dormantRoles.splice(cardIdx, 1);
  card.ownedById = seizerId;
  seizer.roles.push(card);

  createNotification(state, {
    type: NOTIF_TYPES.DORMANT_CARD_SEIZED,
    fromId: seizerId,
    toId: targetId,
    message: `${seizer.name} seized your dormant ${card.role} (b${card.borough}) card as a condition of help.`,
    payload: { cardId: card.id, role: card.role, borough: card.borough },
  });

  return {
    ok: true,
    description: `${seizer.name} seized ${target.name}'s dormant ${card.role} (b${card.borough}).`,
    card,
  };
}

/**
 * Get all dormant cards a target has that could be seized.
 */
export function getSeizeableDormantCards(target) {
  if (!target.dormantRoles) return [];
  return target.dormantRoles.filter(r => CONFIG.dormant.seizeableRoles.includes(r.role));
}

/**
 * Check if a player has any dormant cards.
 */
export function hasDormantCards(player) {
  return player.dormantRoles && player.dormantRoles.length > 0;
}
