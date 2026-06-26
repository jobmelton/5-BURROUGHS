// ===========================================================================
// 5 BOROUGHS ON THE TAKE — notifications.js
// Timed action notification system. Every player interaction generates a
// notification card with accept/decline/counter options and an expiration.
// ===========================================================================
import { CONFIG } from './gameConfig.js';

let _notifId = 0;

/**
 * @typedef {Object} Notification
 * @property {string} id
 * @property {string} type           notification type (see NOTIF_TYPES)
 * @property {string} fromId         player who initiated
 * @property {string} toId           player who must respond
 * @property {string} message        human-readable description
 * @property {Object} payload        type-specific data (amount, spaceIndex, rate, etc.)
 * @property {number} expiresInTurns turns until this notification expires (0 = expired)
 * @property {'pending'|'accepted'|'declined'|'expired'|'countered'} status
 * @property {?number} counterValue  if countered, the counter-offer value
 * @property {number} createdTurn    turn number when created
 */

export const NOTIF_TYPES = {
  // Property landing
  PARTNER_OFFER:       'partner_offer',        // "Player X offers 50/50 partnership on Lot #14"
  FLIP_OFFER:          'flip_offer',           // "Player X selling Lot #7 for $400 — buy it?"
  BANK_LOAN_REQUEST:   'bank_loan_request',    // "Player X needs a loan — what rate?"
  MOB_LOAN_REQUEST:    'mob_loan_request',     // "Player X needs mob money — what terms?"

  // Can't pay rent
  AUCTION_OFFER:       'auction_offer',        // "Lot #5 up for auction — bid?"
  MOB_DEAL_OFFER:      'mob_deal_offer',       // "Boss offers to cover $200 debt — become owned?"

  // Distressed buyout
  DISTRESSED_BUYOUT:   'distressed_buyout',    // "Partner in distress — buy out for $X?"

  // Partner buyout
  PARTNER_BUYOUT:      'partner_buyout',       // "Partner offers to buy you out for $X"

  // Role interactions
  COP_PROTECTION:      'cop_protection',       // "Pay 5% to Cop for protection?"
  COP_FLIPPED:         'cop_flipped',          // "Your Cop flipped — you now pay Capo"
  HIRE_LAWYER:         'hire_lawyer',          // "Hire Lawyer for RICO defense — name your price"
  LAWYER_PRICE:        'lawyer_price',         // "Lawyer charges $X for defense"
  JUDGE_BRIBE:         'judge_bribe',          // "Accept bribe of $X?" (to Judge)
  INSPECTOR_VIOLATION: 'inspector_violation',  // "Hired to create violation — accept $X?"
  CONSTRUCTION_BLOCK:  'construction_block',   // "Construction blocked this turn"
  LABORBOSS_HIRE:      'laborboss_hire',       // "Hire LaborBoss to block construction — fee $X"
  CROSS_BOROUGH_CONTACT: 'cross_borough_contact', // "Contact Boss/Capo in borough X for $fee"

  // Lending
  LOAN_RATE_OFFER:     'loan_rate_offer',      // "Banker offers X% rate"
  MOB_LOAN_TERMS:      'mob_loan_terms',       // "Boss offers loan at X% vig"

  // Dormant card
  DORMANT_CARD_SEIZED: 'dormant_card_seized',  // "Boss took your dormant Capo card"

  // Bail
  BAIL_PAYMENT:        'bail_payment',         // "Pay $X bail to Cop?"

  // General
  INFO:                'info',                 // informational only, no action needed
};

/**
 * Create a new notification and add it to the game state queue.
 * Returns the notification object.
 */
export function createNotification(state, {
  type, fromId, toId, message, payload = {}, expiresInTurns = null,
}) {
  const expiry = expiresInTurns ?? CONFIG.notifications.defaultExpiryTurns;
  const notif = {
    id: `notif-${++_notifId}`,
    type,
    fromId,
    toId,
    message,
    payload,
    expiresInTurns: expiry,
    status: 'pending',
    counterValue: null,
    createdTurn: state._turnNumber || 0,
  };

  if (!state.notifications) state.notifications = [];
  state.notifications.push(notif);
  return notif;
}

/**
 * Get all pending notifications for a player.
 */
export function getPlayerNotifications(state, playerId) {
  if (!state.notifications) return [];
  return state.notifications.filter(n =>
    n.toId === playerId && n.status === 'pending' && n.expiresInTurns > 0
  );
}

/**
 * Get all pending notifications FROM a player (ones they initiated).
 */
export function getSentNotifications(state, playerId) {
  if (!state.notifications) return [];
  return state.notifications.filter(n =>
    n.fromId === playerId && n.status === 'pending'
  );
}

/**
 * Respond to a notification: accept, decline, or counter.
 * Returns { ok, description }.
 */
export function respondToNotification(state, notifId, response, counterValue = null) {
  if (!state.notifications) return { ok: false, description: 'No notifications.' };
  const notif = state.notifications.find(n => n.id === notifId);
  if (!notif) return { ok: false, description: 'Notification not found.' };
  if (notif.status !== 'pending') return { ok: false, description: `Already ${notif.status}.` };
  if (notif.expiresInTurns <= 0) {
    notif.status = 'expired';
    return { ok: false, description: 'Notification expired.' };
  }

  if (response === 'accept') {
    notif.status = 'accepted';
    return { ok: true, description: `Accepted: ${notif.message}` };
  } else if (response === 'decline') {
    notif.status = 'declined';
    return { ok: true, description: `Declined: ${notif.message}` };
  } else if (response === 'counter') {
    notif.status = 'countered';
    notif.counterValue = counterValue;
    return { ok: true, description: `Counter-offered ${counterValue} on: ${notif.message}` };
  }

  return { ok: false, description: `Invalid response: ${response}` };
}

/**
 * Tick down all pending notification expiry timers. Call once per turn.
 * Returns array of newly expired notifications.
 */
export function tickNotifications(state) {
  if (!state.notifications) return [];
  const expired = [];

  for (const notif of state.notifications) {
    if (notif.status === 'pending') {
      notif.expiresInTurns--;
      if (notif.expiresInTurns <= 0) {
        notif.status = 'expired';
        expired.push(notif);
      }
    }
  }

  return expired;
}

/**
 * Broadcast a notification to multiple players (e.g., auction, flip offer).
 * Creates one notification per recipient. Returns array of notifications.
 */
export function broadcastNotification(state, { type, fromId, toIds, message, payload = {}, expiresInTurns = null }) {
  const notifs = [];
  for (const toId of toIds) {
    if (toId === fromId) continue; // don't notify yourself
    notifs.push(createNotification(state, { type, fromId, toId, message, payload, expiresInTurns }));
  }
  return notifs;
}

/**
 * Get all player IDs except the given one (for broadcasts).
 */
export function allOtherPlayerIds(state, excludeId) {
  return Object.keys(state.players).filter(id => id !== excludeId);
}

/**
 * Clean up old resolved/expired notifications beyond a history limit.
 */
export function pruneNotifications(state) {
  if (!state.notifications) return;
  const limit = CONFIG.notifications.historyLimit;
  const resolved = state.notifications.filter(n => n.status !== 'pending');
  if (resolved.length > limit) {
    const toRemove = resolved.slice(0, resolved.length - limit);
    state.notifications = state.notifications.filter(n => !toRemove.includes(n));
  }
}

/**
 * Format a notification for display.
 */
export function formatNotification(state, notif) {
  const from = state.players[notif.fromId]?.name ?? notif.fromId;
  const turnsLeft = notif.expiresInTurns > 0 ? `(${notif.expiresInTurns} turn(s) left)` : '(expired)';
  const actionable = notif.status === 'pending' && notif.expiresInTurns > 0;
  return {
    id: notif.id,
    from,
    message: notif.message,
    turnsLeft,
    actionable,
    type: notif.type,
    payload: notif.payload,
    status: notif.status,
  };
}
