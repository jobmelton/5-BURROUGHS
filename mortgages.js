// ===========================================================================
// 5 BOROUGHS ON THE TAKE — mortgages.js
// Mortgage a property to the bank for cash. Mortgaged lots collect no rent.
// Each payday, mortgage payments auto-deduct (fee + principal retirement).
// ===========================================================================
import { CONFIG } from './gameConfig.js';

const { mortgage: cfg, pricing } = CONFIG;

let _debtId = 0;

/**
 * Mortgage a property: player receives cash equal to a fraction of its value,
 * and a Debt is created. The property is flagged as mortgaged (buildLevel = -1).
 * Returns { ok, description }.
 */
export function mortgageProperty(state, playerId, spaceIndex) {
  const player = state.players[playerId];
  const space = state.board[spaceIndex];
  if (!player) return { ok: false, description: 'Invalid player.' };
  if (space.ownerId !== playerId) return { ok: false, description: 'You don\'t own this property.' };
  if (space.buildLevel < 0) return { ok: false, description: 'Already mortgaged.' };

  const value = Math.round(space.basePrice * cfg.mortgageFraction);
  const paymentPerPayday = Math.round(value * cfg.paymentFractionPerPayday);

  const debt = {
    id: `debt-${++_debtId}`,
    spaceIndex,
    bankerId: 'BANK',
    principalRemaining: value,
    paymentPerPayday,
    bankerFee: cfg.bankerFeeDefault,
  };

  player.cash += value;
  player.debts.push(debt);
  space.buildLevel = -1; // flag: mortgaged

  return {
    ok: true,
    description: `Mortgaged #${spaceIndex} (${space.type}, b${space.borough}) for $${value}. Payment: $${paymentPerPayday}/payday. Cash now $${player.cash}.`,
  };
}

/**
 * Pay off remaining principal on a debt, un-mortgaging the property.
 */
export function payOffMortgage(state, playerId, debtId) {
  const player = state.players[playerId];
  if (!player) return { ok: false, description: 'Invalid player.' };

  const idx = player.debts.findIndex(d => d.id === debtId);
  if (idx === -1) return { ok: false, description: 'Debt not found.' };

  const debt = player.debts[idx];
  if (player.cash < debt.principalRemaining) {
    return { ok: false, description: `Can't afford payoff: $${debt.principalRemaining} (cash $${player.cash}).` };
  }

  player.cash -= debt.principalRemaining;
  player.debts.splice(idx, 1);

  // un-mortgage the property
  if (debt.spaceIndex != null) {
    const space = state.board[debt.spaceIndex];
    if (space.buildLevel < 0) space.buildLevel = 0;
  }

  return {
    ok: true,
    description: `Paid off $${debt.principalRemaining} on debt ${debt.id}. Property un-mortgaged. Cash now $${player.cash}.`,
  };
}

/**
 * Process all debts for a player on payday: deduct payment, split into
 * banker fee (sink) and principal retirement. Clear debts that hit 0.
 * Returns { totalPaid, cleared, descriptions }.
 */
export function processPaydayDebts(state, player) {
  const descriptions = [];
  let totalPaid = 0;
  const cleared = [];

  for (let i = player.debts.length - 1; i >= 0; i--) {
    const debt = player.debts[i];
    const payment = Math.min(debt.paymentPerPayday, debt.principalRemaining);
    const fee = Math.round(payment * debt.bankerFee);
    const principal = payment - fee;

    player.cash -= payment;
    debt.principalRemaining -= principal;
    totalPaid += payment;

    if (debt.principalRemaining <= 0) {
      cleared.push(debt);
      player.debts.splice(i, 1);
      // un-mortgage the property
      if (debt.spaceIndex != null && state) {
        const sp = state.board[debt.spaceIndex];
        if (sp && sp.buildLevel < 0) sp.buildLevel = 0;
      }
      descriptions.push(`Debt ${debt.id} cleared! Final payment $${payment}. Property un-mortgaged.`);
    } else {
      descriptions.push(`Debt ${debt.id}: paid $${payment} ($${principal} principal + $${fee} fee). Remaining: $${debt.principalRemaining}.`);
    }
  }

  return { totalPaid, cleared, descriptions };
}

/**
 * Check if a space is mortgaged (buildLevel === -1).
 */
export function isMortgaged(space) {
  return space.buildLevel < 0;
}
