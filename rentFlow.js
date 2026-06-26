// ===========================================================================
// 5 BOROUGHS ON THE TAKE — rentFlow.js
// Handles the can't-pay-rent scenario: mortgage, auction, or mob deal.
// ===========================================================================
import { CONFIG } from './gameConfig.js';
import { createNotification, broadcastNotification, allOtherPlayerIds, NOTIF_TYPES } from './notifications.js';
import { findBoss } from './lending.js';

/**
 * Get options when a player can't afford rent.
 * Returns array of available actions.
 */
export function getCantPayOptions(state, playerId, rentOwed, spaceIndex) {
  const player = state.players[playerId];
  const space = state.board[spaceIndex];
  const borough = space.borough;
  const options = [];

  // MORTGAGE — if player owns any unmortgaged properties
  const mortgageable = player.propertyIds.filter(idx => {
    const sp = state.board[idx];
    return sp.buildLevel >= 0; // not already mortgaged
  });
  if (mortgageable.length > 0) {
    options.push({
      action: 'mortgage',
      label: 'Mortgage a Property',
      description: `Mortgage one of your ${mortgageable.length} properties to raise cash.`,
      available: true,
      properties: mortgageable,
    });
  }

  // AUCTION — if player owns any properties
  if (player.propertyIds.length > 0) {
    options.push({
      action: 'auction',
      label: 'Auction a Property',
      description: 'Put a property up for auction to all players.',
      available: true,
      properties: player.propertyIds,
    });
  }

  // MOB DEAL — if there's a Boss in this borough
  const boss = findBoss(state, borough);
  if (boss && boss.id !== playerId) {
    options.push({
      action: 'mob_deal',
      label: 'Accept Mob Deal',
      description: `Boss ${boss.name} covers your $${rentOwed} debt — you become owned by the mob.`,
      available: true,
      bossId: boss.id,
      rentOwed,
    });
  }

  return options;
}

/**
 * Execute a mortgage to cover rent. Uses the lending system's mortgage mechanic.
 * Player mortgages a property (buildLevel = -1), gets cash = 50% of base price.
 * Returns { ok, description, cashRaised }.
 */
export function mortgageForRent(state, playerId, mortgageSpaceIndex) {
  const player = state.players[playerId];
  const space = state.board[mortgageSpaceIndex];

  if (!player) return { ok: false, description: 'Invalid player.' };
  if (space.ownerId !== playerId) return { ok: false, description: 'You don\'t own this property.' };
  if (space.buildLevel < 0) return { ok: false, description: 'Already mortgaged.' };

  const cashValue = Math.round(space.basePrice * CONFIG.mortgage.mortgageFraction);
  player.cash += cashValue;
  space.buildLevel = -1;

  return {
    ok: true,
    description: `Mortgaged Lot #${mortgageSpaceIndex} for $${cashValue}. Cash: $${player.cash}.`,
    cashRaised: cashValue,
  };
}

/**
 * Start an auction for a property. Broadcasts to all players.
 * Returns { ok, description }.
 */
export function startAuction(state, sellerId, auctionSpaceIndex, startingBid) {
  const seller = state.players[sellerId];
  const space = state.board[auctionSpaceIndex];

  if (!seller) return { ok: false, description: 'Invalid player.' };
  if (space.ownerId !== sellerId) return { ok: false, description: 'You don\'t own this property.' };

  const others = allOtherPlayerIds(state, sellerId);
  const minBid = startingBid || Math.round(space.basePrice * 0.5);

  broadcastNotification(state, {
    type: NOTIF_TYPES.AUCTION_OFFER,
    fromId: sellerId,
    toIds: others,
    message: `${seller.name} is auctioning Lot #${auctionSpaceIndex} (${space.type}, b${space.borough}). Starting bid: $${minBid}. Submit your bid!`,
    payload: { spaceIndex: auctionSpaceIndex, sellerId, minBid, bids: [] },
  });

  return {
    ok: true,
    description: `Auction started for Lot #${auctionSpaceIndex}. Starting bid: $${minBid}. Broadcast to ${others.length} players.`,
  };
}

/**
 * Submit a bid on an auction. Stores the bid in the notification payload.
 */
export function submitAuctionBid(state, bidderId, notifId, bidAmount) {
  const notif = state.notifications?.find(n => n.id === notifId);
  if (!notif || notif.type !== NOTIF_TYPES.AUCTION_OFFER) {
    return { ok: false, description: 'Auction not found.' };
  }

  const bidder = state.players[bidderId];
  if (!bidder) return { ok: false, description: 'Invalid player.' };
  if (bidder.cash < bidAmount) return { ok: false, description: `Can't afford $${bidAmount}. Cash: $${bidder.cash}.` };
  if (bidAmount < notif.payload.minBid) return { ok: false, description: `Bid must be at least $${notif.payload.minBid}.` };

  // store bid (highest wins when auction closes)
  if (!notif.payload.bids) notif.payload.bids = [];
  notif.payload.bids.push({ bidderId, bidAmount });

  return {
    ok: true,
    description: `${bidder.name} bid $${bidAmount} on Lot #${notif.payload.spaceIndex}.`,
  };
}

/**
 * Close an auction: highest bidder wins, property transfers.
 * Applies politician auction tax (5%).
 */
export function closeAuction(state, notifId) {
  const notif = state.notifications?.find(n => n.id === notifId);
  if (!notif || notif.type !== NOTIF_TYPES.AUCTION_OFFER) {
    return { ok: false, description: 'Auction not found.' };
  }

  const { spaceIndex, sellerId, bids } = notif.payload;
  if (!bids || bids.length === 0) {
    notif.status = 'expired';
    return { ok: false, description: 'No bids received. Auction failed.' };
  }

  // highest bid wins
  const winning = bids.sort((a, b) => b.bidAmount - a.bidAmount)[0];
  const buyer = state.players[winning.bidderId];
  const seller = state.players[sellerId];
  const space = state.board[spaceIndex];

  if (!buyer || !seller) return { ok: false, description: 'Invalid players.' };
  if (buyer.cash < winning.bidAmount) return { ok: false, description: `Winner can't afford their bid.` };

  // transfer
  buyer.cash -= winning.bidAmount;
  seller.cash += winning.bidAmount;

  space.ownerId = winning.bidderId;
  space.partnership = null;
  seller.propertyIds = seller.propertyIds.filter(idx => idx !== spaceIndex);
  buyer.propertyIds.push(spaceIndex);

  // politician auction tax (5%)
  const taxAmount = Math.round(winning.bidAmount * CONFIG.propertyLanding.politicianAuctionTax);
  const politician = findPolitician(state, space.borough);
  if (politician && taxAmount > 0) {
    politician.cash += taxAmount;
  }

  notif.status = 'accepted';

  // expire other auction notifs for same space
  for (const n of state.notifications) {
    if (n.type === NOTIF_TYPES.AUCTION_OFFER && n.payload.spaceIndex === spaceIndex && n.id !== notifId) {
      n.status = 'expired';
    }
  }

  return {
    ok: true,
    description: `Auction won! ${buyer.name} bought Lot #${spaceIndex} for $${winning.bidAmount} from ${seller.name}.${taxAmount > 0 && politician ? ` $${taxAmount} tax to ${politician.name}.` : ''}`,
  };
}

/**
 * Accept a mob deal: Boss pays the rent debt, player becomes owned.
 */
export function acceptMobDeal(state, playerId, bossId, rentOwed, rentOwedToId) {
  const player = state.players[playerId];
  const boss = state.players[bossId];
  const landlord = state.players[rentOwedToId];

  if (!player || !boss) return { ok: false, description: 'Invalid players.' };

  // Boss pays the rent (creates money if needed per mob rules)
  if (landlord) landlord.cash += rentOwed;

  // Player becomes owned by the Boss
  player.status.ownedByBossId = bossId;
  player.status.hasMobDebt = true;

  // Flip any clean roles
  for (const role of player.roles) {
    if (role.clean === true) {
      role.clean = false;
      player.status.roleDirty = true;
    }
  }

  createNotification(state, {
    type: NOTIF_TYPES.INFO,
    fromId: bossId,
    toId: playerId,
    message: `${boss.name} covered your $${rentOwed} debt. You are now under mob control. The mob is your only lender from here on.`,
    payload: { bossId, rentOwed },
  });

  return {
    ok: true,
    description: `Mob deal! ${boss.name} covered ${player.name}'s $${rentOwed} debt. ${player.name} is now mob-owned.`,
  };
}

// ---- Helper ----------------------------------------------------------------
function findPolitician(state, borough) {
  for (const p of Object.values(state.players)) {
    if (p.roles.some(r => r.role === 'Politician' && r.borough === borough)) return p;
  }
  return null;
}
