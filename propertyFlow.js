// ===========================================================================
// 5 BOROUGHS ON THE TAKE — propertyFlow.js
// Property landing flow: Buy, Partner, Flip, or Borrow when landing on an
// unowned space. Handles the full decision tree with notifications.
// ===========================================================================
import { CONFIG } from './gameConfig.js';
import { createNotification, broadcastNotification, allOtherPlayerIds, NOTIF_TYPES } from './notifications.js';
import { proposePartnership } from './partnerships.js';
import { requestBankLoan, requestMobLoan, findBanker, findBoss } from './lending.js';

/**
 * Get available options when a player lands on an unowned property.
 * Returns an array of option objects: { action, label, description, available }.
 */
export function getPropertyOptions(state, playerId, spaceIndex) {
  const player = state.players[playerId];
  const space = state.board[spaceIndex];
  const options = [];

  const canAfford = player.cash >= space.basePrice;
  const borough = space.borough;

  // BUY — always shown, greyed out if can't afford
  options.push({
    action: 'buy',
    label: 'Buy',
    description: `Purchase outright for $${space.basePrice}`,
    available: canAfford,
    cost: space.basePrice,
  });

  // PARTNER — always available (broadcast to all players)
  options.push({
    action: 'partner',
    label: 'Partner',
    description: `Propose a partnership (${CONFIG.partnerships.allowedSplits.join('/')}% splits)`,
    available: true,
    splits: CONFIG.partnerships.allowedSplits,
  });

  // FLIP — always available (set your price, broadcast to all)
  options.push({
    action: 'flip',
    label: 'Flip',
    description: 'Set a price and offer to all players',
    available: true,
  });

  // BORROW — shown if can't afford and a Banker or Boss exists
  if (!canAfford) {
    const banker = findBanker(state, borough);
    const boss = findBoss(state, borough);

    if (banker && !player.status.hasMobDebt) {
      options.push({
        action: 'borrow_bank',
        label: 'Borrow (Bank)',
        description: `Request a loan from Banker ${banker.name}`,
        available: true,
        bankerId: banker.id,
        amountNeeded: space.basePrice - player.cash,
      });
    }

    if (boss) {
      options.push({
        action: 'borrow_mob',
        label: 'Borrow (Mob)',
        description: `Request a loan from Boss ${boss.name} — WARNING: flips your role`,
        available: true,
        bossId: boss.id,
        amountNeeded: space.basePrice - player.cash,
      });
    }
  }

  // PASS — always available
  options.push({
    action: 'pass',
    label: 'Pass',
    description: 'Skip this property',
    available: true,
  });

  return options;
}

/**
 * Execute a property action based on the player's choice.
 * Returns { ok, description, pendingNotifications }.
 */
export function executePropertyAction(state, playerId, spaceIndex, action, params = {}) {
  const player = state.players[playerId];
  const space = state.board[spaceIndex];

  switch (action) {
    case 'buy':
      return executeBuy(state, playerId, spaceIndex);

    case 'partner':
      return proposePartnership(state, playerId, spaceIndex, params.split || 50);

    case 'flip':
      return executeFlip(state, playerId, spaceIndex, params.askingPrice);

    case 'borrow_bank':
      return requestBankLoan(state, playerId, params.amount || (space.basePrice - player.cash), spaceIndex);

    case 'borrow_mob':
      return requestMobLoan(state, playerId, params.amount || (space.basePrice - player.cash), spaceIndex);

    case 'pass':
      return { ok: true, description: `${player.name} passed on Lot #${spaceIndex}.` };

    default:
      return { ok: false, description: `Unknown action: ${action}` };
  }
}

/**
 * Execute a straight buy: deduct cash, set owner, apply politician tax.
 */
function executeBuy(state, playerId, spaceIndex) {
  const player = state.players[playerId];
  const space = state.board[spaceIndex];

  if (player.cash < space.basePrice) {
    return { ok: false, description: `Can't afford $${space.basePrice}. Cash: $${player.cash}.` };
  }

  player.cash -= space.basePrice;
  space.ownerId = playerId;
  space.partnership = null;
  space.mobOwnerId = null;
  player.propertyIds.push(spaceIndex);

  // Politician purchase tax (1%)
  const taxAmount = Math.round(space.basePrice * CONFIG.propertyLanding.politicianPurchaseTax);
  const politician = findPolitician(state, space.borough);
  if (politician && taxAmount > 0) {
    politician.cash += taxAmount;
    // tax comes from the purchase (already paid), so it's on top
  }

  // Notify Cop and Capo in the borough
  notifyBoroughRoles(state, playerId, spaceIndex);

  return {
    ok: true,
    description: `${player.name} bought Lot #${spaceIndex} (${space.type}, b${space.borough}) for $${space.basePrice}. Cash: $${player.cash}.${taxAmount > 0 && politician ? ` $${taxAmount} tax to ${politician.name}.` : ''}`,
  };
}

/**
 * Execute a flip: set a price and broadcast to all players.
 */
function executeFlip(state, playerId, spaceIndex, askingPrice) {
  const player = state.players[playerId];
  const space = state.board[spaceIndex];

  if (!askingPrice || askingPrice <= 0) {
    return { ok: false, description: 'Must set an asking price.' };
  }

  const others = allOtherPlayerIds(state, playerId);
  broadcastNotification(state, {
    type: NOTIF_TYPES.FLIP_OFFER,
    fromId: playerId,
    toIds: others,
    message: `${player.name} is flipping Lot #${spaceIndex} (${space.type}, b${space.borough}) for $${askingPrice}. Buy it?`,
    payload: { spaceIndex, askingPrice, sellerId: playerId },
  });

  return {
    ok: true,
    description: `Flip offer broadcast: Lot #${spaceIndex} for $${askingPrice}.`,
  };
}

/**
 * Accept a flip offer: buyer pays the asking price, gets the property.
 */
export function acceptFlip(state, buyerId, notifId) {
  const notif = state.notifications?.find(n => n.id === notifId);
  if (!notif || notif.type !== NOTIF_TYPES.FLIP_OFFER) {
    return { ok: false, description: 'Flip offer not found.' };
  }
  if (notif.status !== 'pending') return { ok: false, description: `Offer already ${notif.status}.` };

  const { spaceIndex, askingPrice } = notif.payload;
  const space = state.board[spaceIndex];
  const buyer = state.players[buyerId];

  if (!buyer) return { ok: false, description: 'Invalid player.' };
  if (buyer.cash < askingPrice) return { ok: false, description: `Can't afford $${askingPrice}. Cash: $${buyer.cash}.` };
  if (space.ownerId !== null) return { ok: false, description: 'Property already taken.' };

  buyer.cash -= askingPrice;
  space.ownerId = buyerId;
  space.partnership = null;
  buyer.propertyIds.push(spaceIndex);

  // Politician auction/flip tax (5%)
  const taxAmount = Math.round(askingPrice * CONFIG.propertyLanding.politicianAuctionTax);
  const politician = findPolitician(state, space.borough);
  if (politician && taxAmount > 0) {
    politician.cash += taxAmount;
  }

  // expire all other flip offers for this space
  for (const n of state.notifications) {
    if (n.type === NOTIF_TYPES.FLIP_OFFER && n.payload.spaceIndex === spaceIndex && n.id !== notifId) {
      n.status = 'expired';
    }
  }
  notif.status = 'accepted';

  notifyBoroughRoles(state, buyerId, spaceIndex);

  return {
    ok: true,
    description: `${buyer.name} bought Lot #${spaceIndex} via flip for $${askingPrice}.${taxAmount > 0 && politician ? ` $${taxAmount} transfer tax to ${politician.name}.` : ''}`,
  };
}

// ---- Helpers ----------------------------------------------------------------

function findPolitician(state, borough) {
  for (const p of Object.values(state.players)) {
    if (p.roles.some(r => r.role === 'Politician' && r.borough === borough)) return p;
  }
  return null;
}

/**
 * When a property is acquired, notify the Cop and Capo in that borough
 * so the new owner can choose protection.
 */
function notifyBoroughRoles(state, newOwnerId, spaceIndex) {
  const space = state.board[spaceIndex];
  const borough = space.borough;
  const player = state.players[newOwnerId];

  // find Cop in this borough
  for (const p of Object.values(state.players)) {
    if (p.id === newOwnerId) continue;
    if (p.roles.some(r => r.role === 'Cop' && r.borough === borough)) {
      createNotification(state, {
        type: NOTIF_TYPES.COP_PROTECTION,
        fromId: 'SYSTEM',
        toId: newOwnerId,
        message: `Cop ${p.name} offers protection in borough ${borough} for 5%. Pay to avoid mob skim?`,
        payload: { copId: p.id, borough, spaceIndex },
      });
    }
  }

  // notify Capo in this borough
  for (const p of Object.values(state.players)) {
    if (p.id === newOwnerId) continue;
    if (p.roles.some(r => r.role === 'Capo' && r.borough === borough)) {
      createNotification(state, {
        type: NOTIF_TYPES.INFO,
        fromId: 'SYSTEM',
        toId: p.id,
        message: `${player.name} acquired property in your borough (Lot #${spaceIndex}). Skim is active.`,
        payload: { spaceIndex, newOwnerId },
      });
    }
  }
}
