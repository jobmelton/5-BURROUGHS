// ===========================================================================
// 5 BOROUGHS ON THE TAKE — partnerships.js
// Property partnerships: propose splits, shared costs/income, buyouts,
// distressed buyouts at debt value.
// ===========================================================================
import { CONFIG } from './gameConfig.js';
import { createNotification, broadcastNotification, allOtherPlayerIds, NOTIF_TYPES } from './notifications.js';

/**
 * Propose a partnership on a property. Broadcasts to all players.
 * The proposer sets their ownership %, partner pays their share of purchase.
 * Returns { ok, description, notifications }.
 */
export function proposePartnership(state, proposerId, spaceIndex, proposerSplit) {
  const space = state.board[spaceIndex];
  const proposer = state.players[proposerId];
  if (!proposer) return { ok: false, description: 'Invalid player.' };
  if (space.ownerId !== null) return { ok: false, description: 'Property already owned.' };
  if (!CONFIG.partnerships.allowedSplits.includes(proposerSplit)) {
    return { ok: false, description: `Invalid split. Allowed: ${CONFIG.partnerships.allowedSplits.join(', ')}%` };
  }

  const partnerSplit = 100 - proposerSplit;
  const proposerCost = Math.round(space.basePrice * (proposerSplit / 100));

  if (proposer.cash < proposerCost) {
    return { ok: false, description: `Can't afford your ${proposerSplit}% share ($${proposerCost}). Cash: $${proposer.cash}.` };
  }

  const others = allOtherPlayerIds(state, proposerId);
  const notifs = broadcastNotification(state, {
    type: NOTIF_TYPES.PARTNER_OFFER,
    fromId: proposerId,
    toIds: others,
    message: `${proposer.name} offers ${proposerSplit}/${partnerSplit} partnership on Lot #${spaceIndex} ($${space.basePrice}). Your cost: $${Math.round(space.basePrice * (partnerSplit / 100))}.`,
    payload: { spaceIndex, proposerSplit, partnerSplit, totalPrice: space.basePrice },
  });

  return {
    ok: true,
    description: `Partnership offer broadcast: ${proposerSplit}/${partnerSplit} on Lot #${spaceIndex} ($${space.basePrice}).`,
    notifications: notifs,
  };
}

/**
 * Accept a partnership. Both players pay their share, property is co-owned.
 * Returns { ok, description }.
 */
export function acceptPartnership(state, partnerId, notifId) {
  const notif = state.notifications?.find(n => n.id === notifId);
  if (!notif || notif.type !== NOTIF_TYPES.PARTNER_OFFER) {
    return { ok: false, description: 'Partnership offer not found.' };
  }
  if (notif.status !== 'pending') {
    return { ok: false, description: `Offer already ${notif.status}.` };
  }

  const { spaceIndex, proposerSplit, partnerSplit, totalPrice } = notif.payload;
  const space = state.board[spaceIndex];
  const proposer = state.players[notif.fromId];
  const partner = state.players[partnerId];

  if (!proposer || !partner) return { ok: false, description: 'Invalid players.' };
  if (space.ownerId !== null) return { ok: false, description: 'Property already taken.' };

  const proposerCost = Math.round(totalPrice * (proposerSplit / 100));
  const partnerCost = Math.round(totalPrice * (partnerSplit / 100));

  if (proposer.cash < proposerCost) return { ok: false, description: `${proposer.name} can no longer afford their share.` };
  if (partner.cash < partnerCost) return { ok: false, description: `You can't afford your share ($${partnerCost}). Cash: $${partner.cash}.` };

  // execute the purchase
  proposer.cash -= proposerCost;
  partner.cash -= partnerCost;
  space.ownerId = notif.fromId; // proposer is primary owner
  space.partnership = {
    partnerId: partnerId,
    ownerSplit: proposerSplit,
    partnerSplit: partnerSplit,
  };
  proposer.propertyIds.push(spaceIndex);

  // mark notification accepted, expire all other copies
  notif.status = 'accepted';
  for (const n of state.notifications) {
    if (n.type === NOTIF_TYPES.PARTNER_OFFER && n.payload.spaceIndex === spaceIndex && n.id !== notifId) {
      n.status = 'expired';
    }
  }

  return {
    ok: true,
    description: `Partnership formed! ${proposer.name} (${proposerSplit}%) & ${partner.name} (${partnerSplit}%) on Lot #${spaceIndex} for $${totalPrice}.`,
  };
}

/**
 * Split rent between partners on a partnered property.
 * Returns { ownerShare, partnerShare }.
 */
export function splitRent(space, rentAmount) {
  if (!space.partnership) return { ownerShare: rentAmount, partnerShare: 0 };
  const ownerShare = Math.round(rentAmount * (space.partnership.ownerSplit / 100));
  const partnerShare = rentAmount - ownerShare;
  return { ownerShare, partnerShare };
}

/**
 * Split a cost (building, development) between partners.
 * Returns { ownerCost, partnerCost }.
 */
export function splitCost(space, totalCost) {
  if (!space.partnership) return { ownerCost: totalCost, partnerCost: 0 };
  const ownerCost = Math.round(totalCost * (space.partnership.ownerSplit / 100));
  const partnerCost = totalCost - ownerCost;
  return { ownerCost, partnerCost };
}

/**
 * Propose buying out a partner at an agreed price.
 * Returns { ok, description }.
 */
export function proposeBuyout(state, buyerId, spaceIndex, offerPrice) {
  const space = state.board[spaceIndex];
  if (!space.partnership) return { ok: false, description: 'No partnership on this property.' };

  const buyer = state.players[buyerId];
  if (!buyer) return { ok: false, description: 'Invalid player.' };

  // determine who is being bought out
  let targetId;
  if (space.ownerId === buyerId) {
    targetId = space.partnership.partnerId;
  } else if (space.partnership.partnerId === buyerId) {
    targetId = space.ownerId;
  } else {
    return { ok: false, description: 'You are not a partner on this property.' };
  }

  const target = state.players[targetId];
  createNotification(state, {
    type: NOTIF_TYPES.PARTNER_BUYOUT,
    fromId: buyerId,
    toId: targetId,
    message: `${buyer.name} offers to buy your share of Lot #${spaceIndex} for $${offerPrice}.`,
    payload: { spaceIndex, offerPrice, buyerId },
  });

  return {
    ok: true,
    description: `Buyout offer sent to ${target.name}: $${offerPrice} for their share of Lot #${spaceIndex}.`,
  };
}

/**
 * Execute a buyout after acceptance.
 * Returns { ok, description }.
 */
export function executeBuyout(state, notifId) {
  const notif = state.notifications?.find(n => n.id === notifId);
  if (!notif || notif.type !== NOTIF_TYPES.PARTNER_BUYOUT) {
    return { ok: false, description: 'Buyout offer not found.' };
  }

  const { spaceIndex, offerPrice, buyerId } = notif.payload;
  const space = state.board[spaceIndex];
  const buyer = state.players[buyerId];
  const seller = state.players[notif.toId];

  if (!buyer || !seller) return { ok: false, description: 'Invalid players.' };
  if (buyer.cash < offerPrice) return { ok: false, description: `${buyer.name} can't afford $${offerPrice}.` };

  buyer.cash -= offerPrice;
  seller.cash += offerPrice;

  // transfer full ownership to buyer
  space.ownerId = buyerId;
  space.partnership = null;
  if (!buyer.propertyIds.includes(spaceIndex)) buyer.propertyIds.push(spaceIndex);

  notif.status = 'accepted';

  return {
    ok: true,
    description: `Buyout complete! ${buyer.name} bought out ${seller.name}'s share of Lot #${spaceIndex} for $${offerPrice}.`,
  };
}

/**
 * Distressed buyout: buy out a partner who can't cover their obligations,
 * for just the debt amount regardless of property value.
 * Returns { ok, description }.
 */
export function distressedBuyout(state, buyerId, spaceIndex, debtAmount) {
  const space = state.board[spaceIndex];
  if (!space.partnership) return { ok: false, description: 'No partnership on this property.' };

  const buyer = state.players[buyerId];
  if (!buyer) return { ok: false, description: 'Invalid player.' };

  let distressedId;
  if (space.ownerId === buyerId) {
    distressedId = space.partnership.partnerId;
  } else if (space.partnership.partnerId === buyerId) {
    distressedId = space.ownerId;
  } else {
    return { ok: false, description: 'You are not a partner on this property.' };
  }

  const distressed = state.players[distressedId];

  // send notification
  createNotification(state, {
    type: NOTIF_TYPES.DISTRESSED_BUYOUT,
    fromId: buyerId,
    toId: distressedId,
    message: `${buyer.name} offers to buy your share of Lot #${spaceIndex} for $${debtAmount} (your debt amount). Accept?`,
    payload: { spaceIndex, debtAmount, buyerId },
  });

  return {
    ok: true,
    description: `Distressed buyout offer sent: $${debtAmount} for ${distressed.name}'s share of Lot #${spaceIndex}.`,
  };
}

/**
 * Execute a distressed buyout after acceptance.
 */
export function executeDistressedBuyout(state, notifId) {
  const notif = state.notifications?.find(n => n.id === notifId);
  if (!notif || notif.type !== NOTIF_TYPES.DISTRESSED_BUYOUT) {
    return { ok: false, description: 'Distressed buyout not found.' };
  }

  const { spaceIndex, debtAmount, buyerId } = notif.payload;
  const space = state.board[spaceIndex];
  const buyer = state.players[buyerId];
  const seller = state.players[notif.toId];

  if (!buyer || !seller) return { ok: false, description: 'Invalid players.' };
  if (buyer.cash < debtAmount) return { ok: false, description: `${buyer.name} can't afford $${debtAmount}.` };

  buyer.cash -= debtAmount;
  seller.cash += debtAmount; // covers their debt

  // transfer full ownership
  space.ownerId = buyerId;
  space.partnership = null;
  if (!buyer.propertyIds.includes(spaceIndex)) buyer.propertyIds.push(spaceIndex);

  notif.status = 'accepted';

  return {
    ok: true,
    description: `Distressed buyout! ${buyer.name} acquired ${seller.name}'s share of Lot #${spaceIndex} for just $${debtAmount} (debt amount).`,
  };
}

/**
 * Check if a space has a partnership.
 */
export function hasPartnership(space) {
  return space.partnership !== null && space.partnership !== undefined;
}
