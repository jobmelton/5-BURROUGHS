// ===========================================================================
// 5 BOROUGHS ON THE TAKE — lending.js
// Two lending paths: Bank (from Banker role) and Mob (from Boss).
// Bank: negotiated rate, pay on GO, foreclosure → unowned.
// Mob: creates money, negotiated vig, rent pays debt, foreclosure → Boss owns,
//      borrowing flips roles, mob becomes only lender while in debt.
// ===========================================================================
import { CONFIG } from './gameConfig.js';
import { createNotification, NOTIF_TYPES } from './notifications.js';

let _loanId = 0;

// ---- Finding lenders -------------------------------------------------------

/** Find the Banker role holder for a borough (or any Banker in the game). */
export function findBanker(state, borough) {
  // prefer Banker in same borough, fall back to any Banker
  for (const p of Object.values(state.players)) {
    const card = p.roles.find(r => r.role === 'Banker' && r.borough === borough);
    if (card) return p;
  }
  for (const p of Object.values(state.players)) {
    if (p.roles.some(r => r.role === 'Banker')) return p;
  }
  return null;
}

/** Find the Boss in a specific borough. */
export function findBoss(state, borough) {
  for (const p of Object.values(state.players)) {
    const card = p.roles.find(r => r.role === 'Boss' && r.borough === borough);
    if (card) return p;
  }
  return null;
}

// ---- Instant loan (no negotiation; works against bots) ---------------------

/**
 * Grant a loan immediately at the configured auto-rate and credit the borrower.
 * Bank loans come from a Banker (if one has the cash) else from the bank sink;
 * mob loans come from the Boss (money from nothing) and flip the borrower dirty.
 * Returns { ok, description, debt }.
 */
export function grantInstantLoan(state, borrowerId, amount, loanType) {
  const borrower = state.players[borrowerId];
  if (!borrower) return { ok: false, description: 'Invalid borrower.' };
  amount = Math.round(amount);
  if (!amount || amount <= 0) return { ok: false, description: 'Invalid loan amount.' };
  if (loanType === 'bank' && borrower.status.hasMobDebt && CONFIG.lending.mobDebtLockout) {
    return { ok: false, description: 'You have mob debt — the mob is your only lender.' };
  }

  const borough = (borrower.track === 'outer' && state.board[borrower.position])
    ? state.board[borrower.position].borough
    : (borrower.status.pitEntryBorough || 1);

  let lenderId = null;
  let lenderName = loanType === 'mob' ? 'the mob' : 'the bank';
  if (loanType === 'mob') {
    const boss = findBoss(state, borough);
    if (boss) { lenderId = boss.id; lenderName = boss.name; }
  } else {
    const banker = findBanker(state, borough);
    if (banker && banker.cash >= amount) { banker.cash -= amount; lenderId = banker.id; lenderName = banker.name; }
  }

  const rate = loanType === 'mob' ? CONFIG.lending.autoMobRate : CONFIG.lending.autoBankRate;
  const paymentPerGo = Math.round(amount * rate);
  const debt = {
    id: `loan-${++_loanId}`, lenderId, loanType,
    principalRemaining: amount, rate, spaceIndex: null, paymentPerGo,
  };
  borrower.debts.push(debt);
  borrower.cash += amount;

  if (loanType === 'mob') {
    borrower.status.hasMobDebt = true;
    for (const role of borrower.roles) {
      if (role.clean === true) { role.clean = false; borrower.status.roleDirty = true; }
    }
  }

  return {
    ok: true,
    debt,
    description: `Borrowed $${amount} from ${lenderName} at ${Math.round(rate * 100)}%/GO ($${paymentPerGo}/GO).${loanType === 'mob' ? ' Roles flipped dirty.' : ''}`,
  };
}

// ---- Loan requests ---------------------------------------------------------

/**
 * Request a bank loan. Sends notification to the Banker to name their rate.
 * Returns { ok, description, bankerId }.
 */
export function requestBankLoan(state, borrowerId, amount, spaceIndex) {
  const borrower = state.players[borrowerId];
  if (!borrower) return { ok: false, description: 'Invalid player.' };

  // check mob debt lockout
  if (borrower.status.hasMobDebt && CONFIG.lending.mobDebtLockout) {
    return { ok: false, description: 'You have mob debt — the mob is your only lender.' };
  }

  const borough = spaceIndex != null ? state.board[spaceIndex].borough : 1;
  const banker = findBanker(state, borough);
  if (!banker) return { ok: false, description: 'No Banker available.' };

  createNotification(state, {
    type: NOTIF_TYPES.BANK_LOAN_REQUEST,
    fromId: borrowerId,
    toId: banker.id,
    message: `${borrower.name} needs a $${amount} loan. What rate will you charge?`,
    payload: { borrowerId, amount, spaceIndex },
  });

  return { ok: true, description: `Loan request sent to Banker ${banker.name}.`, bankerId: banker.id };
}

/**
 * Request a mob loan. Sends notification to the Boss to name their vig.
 * Boss can create money from nothing.
 * Returns { ok, description, bossId }.
 */
export function requestMobLoan(state, borrowerId, amount, spaceIndex) {
  const borrower = state.players[borrowerId];
  if (!borrower) return { ok: false, description: 'Invalid player.' };

  const borough = spaceIndex != null ? state.board[spaceIndex].borough : 1;
  const boss = findBoss(state, borough);
  if (!boss) return { ok: false, description: 'No Boss in this borough.' };

  createNotification(state, {
    type: NOTIF_TYPES.MOB_LOAN_REQUEST,
    fromId: borrowerId,
    toId: boss.id,
    message: `${borrower.name} needs $${amount} from the mob. What vig will you charge?`,
    payload: { borrowerId, amount, spaceIndex },
  });

  return { ok: true, description: `Loan request sent to Boss ${boss.name}.`, bossId: boss.id };
}

// ---- Setting rates (lender responds) ---------------------------------------

/**
 * Banker sets a rate for a loan request. Sends offer to borrower.
 */
export function offerBankRate(state, bankerId, borrowerId, rate, amount, spaceIndex) {
  const banker = state.players[bankerId];
  const borrower = state.players[borrowerId];
  if (!banker || !borrower) return { ok: false, description: 'Invalid players.' };

  createNotification(state, {
    type: NOTIF_TYPES.LOAN_RATE_OFFER,
    fromId: bankerId,
    toId: borrowerId,
    message: `Banker ${banker.name} offers a $${amount} loan at ${Math.round(rate * 100)}% per GO. Accept?`,
    payload: { bankerId, amount, rate, spaceIndex, loanType: 'bank' },
  });

  return { ok: true, description: `Rate offer of ${Math.round(rate * 100)}% sent to ${borrower.name}.` };
}

/**
 * Boss sets vig terms for a mob loan. Sends offer to borrower.
 */
export function offerMobTerms(state, bossId, borrowerId, rate, amount, spaceIndex) {
  const boss = state.players[bossId];
  const borrower = state.players[borrowerId];
  if (!boss || !borrower) return { ok: false, description: 'Invalid players.' };

  createNotification(state, {
    type: NOTIF_TYPES.MOB_LOAN_TERMS,
    fromId: bossId,
    toId: borrowerId,
    message: `Boss ${boss.name} offers $${amount} at ${Math.round(rate * 100)}% vig per GO. WARNING: Borrowing from the mob flips your role. Accept?`,
    payload: { bossId, amount, rate, spaceIndex, loanType: 'mob' },
  });

  return { ok: true, description: `Mob terms of ${Math.round(rate * 100)}% sent to ${borrower.name}.` };
}

// ---- Accepting a loan ------------------------------------------------------

/**
 * Accept a loan offer (bank or mob). Creates the debt, transfers money.
 * Mob loans: flip the borrower's roles dirty, set mob debt lockout.
 * Bank loans: Banker must have the cash. Mob loans: Boss creates money.
 * Returns { ok, description, debt }.
 */
export function acceptLoan(state, notifId) {
  const notif = state.notifications?.find(n => n.id === notifId);
  if (!notif) return { ok: false, description: 'Loan offer not found.' };
  if (notif.status !== 'pending') return { ok: false, description: `Offer already ${notif.status}.` };

  const { amount, rate, spaceIndex, loanType } = notif.payload;
  const lenderId = notif.payload.bankerId || notif.payload.bossId;
  const lender = state.players[lenderId];
  const borrower = state.players[notif.toId];

  if (!lender || !borrower) return { ok: false, description: 'Invalid players.' };

  // bank loans require the banker to have the cash
  if (loanType === 'bank') {
    if (lender.cash < amount) return { ok: false, description: `Banker doesn't have $${amount}.` };
    lender.cash -= amount;
  }
  // mob loans: boss creates money from nothing (no cash deduction)

  borrower.cash += amount;

  // calculate payment per GO
  const paymentPerGo = Math.round(amount * rate);

  const debt = {
    id: `loan-${++_loanId}`,
    lenderId,
    loanType,
    principalRemaining: amount,
    rate,
    spaceIndex: spaceIndex ?? null,
    paymentPerGo,
  };

  borrower.debts.push(debt);
  notif.status = 'accepted';

  // mob loan consequences
  if (loanType === 'mob') {
    borrower.status.hasMobDebt = true;

    // flip any clean roles dirty
    for (const role of borrower.roles) {
      if (role.clean === true) {
        role.clean = false;
        borrower.status.roleDirty = true;
      }
    }
  }

  const typeLabel = loanType === 'mob' ? 'Mob loan' : 'Bank loan';
  return {
    ok: true,
    description: `${typeLabel}! ${borrower.name} borrowed $${amount} from ${lender.name} at ${Math.round(rate * 100)}% ($${paymentPerGo}/GO).${loanType === 'mob' ? ' Roles flipped dirty. Mob is now your only lender.' : ''}`,
    debt,
  };
}

// ---- Payment on GO ---------------------------------------------------------

/**
 * Process all loan payments for a player passing GO.
 * Bank: payment goes to Banker. If can't pay → foreclose (unowned).
 * Mob: payment goes to Boss. If can't pay → foreclose (Boss gets property).
 * Returns { totalPaid, foreclosures, descriptions }.
 */
export function processLoanPaymentsOnGo(state, playerId) {
  const player = state.players[playerId];
  if (!player) return { totalPaid: 0, foreclosures: [], descriptions: [] };

  const descriptions = [];
  const foreclosures = [];
  let totalPaid = 0;

  for (let i = player.debts.length - 1; i >= 0; i--) {
    const debt = player.debts[i];
    const payment = Math.min(debt.paymentPerGo, debt.principalRemaining);
    const lender = state.players[debt.lenderId];

    if (player.cash >= payment) {
      // can pay
      player.cash -= payment;
      debt.principalRemaining -= payment;
      if (lender) lender.cash += payment;
      totalPaid += payment;

      if (debt.principalRemaining <= 0) {
        // loan fully paid off
        player.debts.splice(i, 1);
        descriptions.push(`Loan ${debt.id} paid off to ${lender?.name ?? 'unknown'}.`);

        // check if still has mob debt
        if (debt.loanType === 'mob' && !player.debts.some(d => d.loanType === 'mob')) {
          player.status.hasMobDebt = false;
          descriptions.push('All mob debts cleared — free to borrow from banks again.');
        }
      } else {
        descriptions.push(`Paid $${payment} on loan to ${lender?.name ?? 'unknown'}. Remaining: $${debt.principalRemaining}.`);
      }
    } else {
      // can't pay — foreclosure
      const foreclosed = foreclose(state, playerId, debt);
      foreclosures.push(foreclosed);
      player.debts.splice(i, 1);
      descriptions.push(foreclosed.description);
    }
  }

  return { totalPaid, foreclosures, descriptions };
}

/**
 * Foreclose a property tied to a debt.
 * Bank: property goes to unowned.
 * Mob: property becomes Boss's.
 */
function foreclose(state, playerId, debt) {
  const player = state.players[playerId];
  const lender = state.players[debt.lenderId];

  if (debt.spaceIndex != null) {
    const space = state.board[debt.spaceIndex];

    if (debt.loanType === 'mob' && lender) {
      // mob foreclosure: Boss gets the property
      space.ownerId = lender.id;
      space.partnership = null;
      space.mobOwnerId = lender.id;
      if (!lender.propertyIds.includes(debt.spaceIndex)) lender.propertyIds.push(debt.spaceIndex);
      player.propertyIds = player.propertyIds.filter(idx => idx !== debt.spaceIndex);

      createNotification(state, {
        type: NOTIF_TYPES.INFO,
        fromId: 'SYSTEM',
        toId: playerId,
        message: `Foreclosure! Lot #${debt.spaceIndex} seized by ${lender.name} (mob debt).`,
        payload: { spaceIndex: debt.spaceIndex },
      });

      return {
        spaceIndex: debt.spaceIndex,
        newOwner: lender.id,
        description: `Mob foreclosure! Lot #${debt.spaceIndex} seized by ${lender.name}.`,
      };
    } else {
      // bank foreclosure: property goes unowned
      space.ownerId = null;
      space.partnership = null;
      space.buildLevel = 0;
      player.propertyIds = player.propertyIds.filter(idx => idx !== debt.spaceIndex);

      createNotification(state, {
        type: NOTIF_TYPES.INFO,
        fromId: 'SYSTEM',
        toId: playerId,
        message: `Foreclosure! Lot #${debt.spaceIndex} returned to market (bank debt).`,
        payload: { spaceIndex: debt.spaceIndex },
      });

      return {
        spaceIndex: debt.spaceIndex,
        newOwner: null,
        description: `Bank foreclosure! Lot #${debt.spaceIndex} returned to market.`,
      };
    }
  }

  return { spaceIndex: null, newOwner: null, description: 'Foreclosure on unsecured loan.' };
}

/**
 * Apply rent from a mob-financed property toward the mob debt automatically.
 * Call this when rent is collected on a property with a mob loan.
 * Returns amount applied to debt.
 */
export function applyRentToMobDebt(state, playerId, spaceIndex, rentAmount) {
  const player = state.players[playerId];
  if (!player) return 0;

  const debt = player.debts.find(d => d.loanType === 'mob' && d.spaceIndex === spaceIndex);
  if (!debt) return 0;

  const applied = Math.min(rentAmount, debt.principalRemaining);
  debt.principalRemaining -= applied;

  const lender = state.players[debt.lenderId];
  if (lender) lender.cash += applied;

  if (debt.principalRemaining <= 0) {
    player.debts = player.debts.filter(d => d.id !== debt.id);
    if (!player.debts.some(d => d.loanType === 'mob')) {
      player.status.hasMobDebt = false;
    }
  }

  return applied;
}
