// ===========================================================================
// 5 BOROUGHS ON THE TAKE — roles.js
// All 10 role mechanics in one place. Each role's abilities, defenses,
// income streams, and interactions are defined here.
// ===========================================================================
import { CONFIG } from './gameConfig.js';
import { createNotification, NOTIF_TYPES } from './notifications.js';

const { economy } = CONFIG;

// ---- Finders ---------------------------------------------------------------

/** Find a player holding a specific role in a specific borough. */
export function findRoleHolder(state, role, borough) {
  for (const p of Object.values(state.players)) {
    if (p.roles?.some(r => r.role === role && r.borough === borough)) return p;
  }
  return null;
}

/** Find ALL holders of a role across all boroughs. */
export function findAllRoleHolders(state, role) {
  const holders = [];
  for (const p of Object.values(state.players)) {
    const cards = p.roles?.filter(r => r.role === role) || [];
    if (cards.length > 0) holders.push({ player: p, cards });
  }
  return holders;
}

/** Check if a player holds a specific role (any borough). */
export function hasRole(player, role) {
  return player.roles?.some(r => r.role === role) || false;
}

/** Check if a player holds a specific role in a specific borough. */
export function hasRoleInBorough(player, role, borough) {
  return player.roles?.some(r => r.role === role && r.borough === borough) || false;
}

/** Get the Boss who controls a player (if any). */
export function getBoss(state, playerId) {
  const p = state.players[playerId];
  if (!p?.status?.ownedByBossId) return null;
  return state.players[p.status.ownedByBossId] || null;
}

/** Get all players owned by a Boss. */
export function getOwnedPlayers(state, bossId) {
  return Object.values(state.players).filter(p => p.status?.ownedByBossId === bossId);
}

// ===========================================================================
// BOSS
// Earns rent on own properties + kickups from Capos and owned players.
// Mob loans (creates money). RICO immune with Lawyer+Judge.
// Cop ownership = jail/informant immune.
// ===========================================================================

/** Check if Boss has RICO immunity (needs Lawyer + Judge under control). */
export function bossHasRICOImmunity(state, bossId) {
  const owned = getOwnedPlayers(state, bossId);
  const boss = state.players[bossId];
  // check if boss directly holds or controls a Lawyer and Judge
  const hasLawyer = hasRole(boss, 'Lawyer') ||
    owned.some(p => hasRole(p, 'Lawyer'));
  const hasJudge = hasRole(boss, 'Judge') ||
    owned.some(p => hasRole(p, 'Judge'));
  return hasLawyer && hasJudge;
}

/** Check if Boss is immune to jail (owns a Cop). */
export function bossIsJailImmune(state, bossId) {
  const owned = getOwnedPlayers(state, bossId);
  const boss = state.players[bossId];
  return hasRole(boss, 'Cop') || owned.some(p => hasRole(p, 'Cop'));
}

/** Check if Boss is immune to Informant (owns a Cop). */
export function bossIsInformantImmune(state, bossId) {
  return bossIsJailImmune(state, bossId); // same condition
}

/**
 * Boss upkeep: pay per controlled role each payday.
 * Returns { paid, description }.
 */
export function processBossUpkeep(state, bossId) {
  const boss = state.players[bossId];
  if (!boss || !hasRole(boss, 'Boss')) return { paid: 0, description: '' };

  const controlled = getOwnedPlayers(state, bossId);
  const controlledRoleCount = controlled.reduce((sum, p) => sum + (p.roles?.length || 0), 0);
  if (controlledRoleCount === 0) return { paid: 0, description: '' };

  const cost = controlledRoleCount * economy.bossUpkeepPerRole;
  const paid = Math.min(cost, boss.cash);
  boss.cash -= paid;

  return {
    paid,
    description: `${boss.name} (Boss) paid $${paid} upkeep for ${controlledRoleCount} controlled role(s).`,
  };
}

// ===========================================================================
// CAPO
// 5% auto-skim (10% under Boss, 5% kickup). Independent loans/partnerships.
// Shares Boss defenses when under a Boss. Can recruit players.
// ===========================================================================

/**
 * Calculate Capo skim on a rent payment in their borough.
 * Returns { capoAmount, bossKickup, isUnderBoss }.
 */
export function calculateCapoSkim(state, borough, rentAmount) {
  const capo = findRoleHolder(state, 'Capo', borough);
  if (!capo) return { capoAmount: 0, bossKickup: 0, isUnderBoss: false };

  const boss = getBoss(state, capo.id);
  if (boss) {
    // under a boss: 10% total, 5% to capo, 5% kickup to boss
    const total = Math.round(rentAmount * economy.capoSkimUnderBoss);
    const kickup = Math.round(rentAmount * economy.capoKickupToBoss);
    return { capoAmount: total - kickup, bossKickup: kickup, isUnderBoss: true, capoId: capo.id, bossId: boss.id };
  } else {
    // freelance: 5%
    const amount = Math.round(rentAmount * economy.capoFreelance);
    return { capoAmount: amount, bossKickup: 0, isUnderBoss: false, capoId: capo.id };
  }
}

/** Check if Capo shares Boss defenses (RICO immunity, jail immunity, etc.). */
export function capoSharesBossDefenses(state, capoId) {
  const boss = getBoss(state, capoId);
  if (!boss) return { ricoImmune: false, jailImmune: false };
  return {
    ricoImmune: bossHasRICOImmunity(state, boss.id),
    jailImmune: bossIsJailImmune(state, boss.id),
  };
}

// ===========================================================================
// COP
// 5% protection fee. Collects ALL bail fees.
// Flips ONLY via mob loans. RICO/Expose only hurt if active mob debt.
// Boss/Capo in jail = 2x bail + 2x sentence.
// ===========================================================================

/**
 * Calculate bail for a jailed player. Cops/Bosses pay 2x.
 * Returns { amount, collectorId, doubledFor }.
 */
export function calculateBail(state, playerId, borough) {
  const player = state.players[playerId];
  const cop = findRoleHolder(state, 'Cop', borough);
  const baseBail = CONFIG.jail.bailCost;

  const isBossOrCapo = hasRole(player, 'Boss') || hasRole(player, 'Capo');
  const amount = isBossOrCapo ? baseBail * 2 : baseBail;

  // check if Boss/Capo has a Judge or can hire Lawyer to reduce
  let canReduce = false;
  if (isBossOrCapo) {
    const bossId = player.status?.ownedByBossId || player.id;
    const owned = getOwnedPlayers(state, bossId);
    const boss = state.players[bossId];
    canReduce = hasRole(player, 'Judge') || hasRole(boss, 'Judge') ||
      owned.some(p => hasRole(p, 'Judge'));
  }

  return {
    amount: canReduce ? baseBail : amount, // Judge reduces back to normal
    collectorId: cop?.id || null,
    doubledFor: isBossOrCapo && !canReduce ? player.roles.find(r => r.role === 'Boss' || r.role === 'Capo')?.role : null,
    copName: cop?.name,
  };
}

/**
 * Calculate jail sentence. Bosses/Capos get 2x unless they have Judge/Lawyer.
 */
export function calculateJailSentence(state, playerId) {
  const player = state.players[playerId];
  const baseTurns = CONFIG.jail.maxTurns;
  const isBossOrCapo = hasRole(player, 'Boss') || hasRole(player, 'Capo');

  if (!isBossOrCapo) return baseTurns;

  // check for Judge or Lawyer defense
  const bossId = player.status?.ownedByBossId || player.id;
  const owned = getOwnedPlayers(state, bossId);
  const boss = state.players[bossId] || player;
  const hasJudge = hasRole(player, 'Judge') || hasRole(boss, 'Judge') ||
    owned.some(p => hasRole(p, 'Judge'));
  const hasLawyer = hasRole(player, 'Lawyer') || hasRole(boss, 'Lawyer') ||
    owned.some(p => hasRole(p, 'Lawyer'));

  if (hasJudge || hasLawyer) return baseTurns; // reduced to normal
  return baseTurns * 2; // doubled
}

/**
 * Check if a Cop is vulnerable to RICO/Expose (only if they have active mob debt).
 */
export function copIsVulnerable(player) {
  return player.status?.hasMobDebt === true;
}

/**
 * Process cop protection choice: player opts to pay Cop 5% instead of Capo skim.
 */
export function setCopProtection(state, playerId, copId) {
  const player = state.players[playerId];
  const cop = state.players[copId];
  if (!player || !cop) return { ok: false, description: 'Invalid players.' };

  player.status.protectedByCopId = copId;

  return {
    ok: true,
    description: `${player.name} is now under ${cop.name}'s protection (5% fee). Immune to mob skim and Hits.`,
  };
}

/**
 * Notify player their Cop flipped — they now pay Capo instead.
 */
export function notifyCopFlipped(state, playerId, copId) {
  const player = state.players[playerId];
  const cop = state.players[copId];

  if (player.status.protectedByCopId === copId) {
    player.status.protectedByCopId = null; // protection lost

    createNotification(state, {
      type: NOTIF_TYPES.COP_FLIPPED,
      fromId: 'SYSTEM',
      toId: playerId,
      message: `Your Cop ${cop?.name} flipped dirty! Protection lost. You now pay Capo skim.`,
      payload: { copId },
    });
  }
}

// ===========================================================================
// POLITICIAN
// Tax square income. 10% kickup from Inspector.
// 5% auction transfer tax. 1% land purchase tax.
// Controls LaborBoss (waive debt = 10% kickup). Only loses role via RICO.
// ===========================================================================

/**
 * Process tax square landing: tax all of the landing player's assets in that borough.
 * Politician of that borough collects.
 * Returns { taxAmount, collectorId, description }.
 */
export function processTaxSquare(state, playerId, borough) {
  const player = state.players[playerId];
  const politician = findRoleHolder(state, 'Politician', borough);

  // calculate total property value in this borough
  const boroughProperties = player.propertyIds
    .map(idx => state.board[idx])
    .filter(sp => sp.borough === borough);
  const totalValue = boroughProperties.reduce((sum, sp) => sum + sp.basePrice * (1 + Math.max(0, sp.buildLevel)), 0);

  const taxRate = 0.10; // 10% of borough asset value
  const taxAmount = Math.round(totalValue * taxRate);

  if (taxAmount <= 0) {
    return { taxAmount: 0, collectorId: null, description: `${player.name} has no taxable assets in borough ${borough}.` };
  }

  const paid = Math.min(taxAmount, player.cash);
  player.cash -= paid;
  if (politician) politician.cash += paid;

  return {
    taxAmount: paid,
    collectorId: politician?.id || null,
    description: `Tax! ${player.name} paid $${paid} on borough ${borough} assets ($${totalValue} total value).${politician ? ` Collected by ${politician.name}.` : ''}`,
  };
}

/**
 * Politician gets 10% kickup from Inspector's income in their borough.
 */
export function inspectorKickupToPolitician(state, borough, inspectorIncome) {
  const politician = findRoleHolder(state, 'Politician', borough);
  if (!politician) return 0;

  const kickup = Math.round(inspectorIncome * 0.10);
  politician.cash += kickup;
  return kickup;
}

// ===========================================================================
// LABORBOSS
// Cross-borough construction blocking (requires outside Boss/Capo partner).
// No default kickup. Politician can gain 10% kickup by waiving debt.
// ===========================================================================

/**
 * LaborBoss blocks construction in ANOTHER borough (not their own).
 * Requires partnering with a Boss or Capo from that other borough.
 * Returns { ok, description }.
 */
export function laborBossBlockConstruction(state, laborBossId, targetBorough) {
  const laborBoss = state.players[laborBossId];
  if (!laborBoss) return { ok: false, description: 'Invalid player.' };

  const lbCard = laborBoss.roles.find(r => r.role === 'LaborBoss');
  if (!lbCard) return { ok: false, description: 'Not a LaborBoss.' };
  if (lbCard.borough === targetBorough) {
    return { ok: false, description: 'Cannot block construction in your own borough.' };
  }

  // need a Boss or Capo in the target borough as partner
  const boss = findRoleHolder(state, 'Boss', targetBorough);
  const capo = findRoleHolder(state, 'Capo', targetBorough);
  const partner = boss || capo;
  if (!partner) {
    return { ok: false, description: `No Boss or Capo in borough ${targetBorough} to partner with.` };
  }

  // send notification to the partner
  createNotification(state, {
    type: NOTIF_TYPES.LABORBOSS_HIRE,
    fromId: laborBossId,
    toId: partner.id,
    message: `LaborBoss ${laborBoss.name} wants to block construction in borough ${targetBorough}. Partner up for a fee?`,
    payload: { laborBossId, targetBorough, fee: CONFIG.notifications.crossBoroughContactFee },
  });

  return {
    ok: true,
    description: `Construction block request sent to ${partner.name} in borough ${targetBorough}.`,
  };
}

// ===========================================================================
// INSPECTOR
// Hired by Boss/Capo for code violations in OTHER boroughs.
// Violation penalty = 2x hiring fee, paid by builder to hirer.
// Construction blocking chain: Boss → Inspector → builder blocked.
// ===========================================================================

/**
 * Hire an Inspector to create a code violation in another borough.
 * The hiring fee is set by the hirer; the builder pays 2x that.
 * Returns { ok, description }.
 */
export function hireInspectorForViolation(state, hirerId, inspectorId, targetBorough, hiringFee) {
  const hirer = state.players[hirerId];
  const inspector = state.players[inspectorId];
  if (!hirer || !inspector) return { ok: false, description: 'Invalid players.' };

  // hirer must be Boss or Capo
  if (!hasRole(hirer, 'Boss') && !hasRole(hirer, 'Capo')) {
    return { ok: false, description: 'Only a Boss or Capo can hire an Inspector.' };
  }

  // inspector can't violate their own borough
  const inspCard = inspector.roles.find(r => r.role === 'Inspector');
  if (inspCard && inspCard.borough === targetBorough) {
    return { ok: false, description: 'Inspector cannot create violations in their own borough.' };
  }

  if (hirer.cash < hiringFee) {
    return { ok: false, description: `Can't afford $${hiringFee} hiring fee. Cash: $${hirer.cash}.` };
  }

  // send offer to Inspector
  createNotification(state, {
    type: NOTIF_TYPES.INSPECTOR_VIOLATION,
    fromId: hirerId,
    toId: inspectorId,
    message: `${hirer.name} wants you to create a code violation in borough ${targetBorough} for $${hiringFee}. Builder will pay $${hiringFee * 2}. Accept?`,
    payload: { hirerId, targetBorough, hiringFee, violationPenalty: hiringFee * 2 },
  });

  return {
    ok: true,
    description: `Violation offer sent to Inspector ${inspector.name}: $${hiringFee} to block building in borough ${targetBorough}.`,
  };
}

/**
 * Apply a code violation to a borough. Any builder there must pay 2x the fee first.
 * Tracked in state.codeViolations: { [borough]: { penalty, payTo } }.
 */
export function applyCodeViolation(state, borough, penalty, payToId) {
  if (!state.codeViolations) state.codeViolations = {};
  state.codeViolations[borough] = { penalty, payToId };
}

/**
 * Check if there's a code violation in a borough that must be paid before building.
 */
export function getCodeViolation(state, borough) {
  return state.codeViolations?.[borough] || null;
}

/**
 * Pay off a code violation to build. Clears the violation.
 */
export function payCodeViolation(state, playerId, borough) {
  const violation = getCodeViolation(state, borough);
  if (!violation) return { ok: false, description: 'No violation.' };

  const player = state.players[playerId];
  if (player.cash < violation.penalty) {
    return { ok: false, description: `Can't afford $${violation.penalty} violation penalty.` };
  }

  player.cash -= violation.penalty;
  const recipient = state.players[violation.payToId];
  if (recipient) recipient.cash += violation.penalty;

  delete state.codeViolations[borough];

  return {
    ok: true,
    description: `${player.name} paid $${violation.penalty} code violation penalty in borough ${borough}.${recipient ? ` Paid to ${recipient.name}.` : ''}`,
  };
}

// ===========================================================================
// CASINO MANAGER
// 10% cut of all rent/income generated by casino spaces in their borough.
// ===========================================================================

/**
 * Calculate CasinoManager's cut from casino rent.
 * Returns { managerCut, managerId }.
 */
export function calculateCasinoCut(state, borough, casinoRentAmount) {
  const manager = findRoleHolder(state, 'CasinoManager', borough);
  if (!manager) return { managerCut: 0, managerId: null };

  const cut = Math.round(casinoRentAmount * 0.10);
  manager.cash += cut;
  return { managerCut: cut, managerId: manager.id };
}

// ===========================================================================
// LAWYER
// Hireable for RICO defense. Names their price. Defending doesn't flip them.
// Free agent mercenary — can defend any player.
// ===========================================================================

/**
 * Request a Lawyer for defense. Sends notification to available Lawyers.
 * Returns { ok, description }.
 */
export function requestLawyer(state, defendantId, reason) {
  const defendant = state.players[defendantId];
  if (!defendant) return { ok: false, description: 'Invalid player.' };

  const lawyers = findAllRoleHolders(state, 'Lawyer');
  if (lawyers.length === 0) return { ok: false, description: 'No Lawyers available.' };

  for (const { player: lawyer } of lawyers) {
    if (lawyer.id === defendantId) continue; // can't hire yourself
    createNotification(state, {
      type: NOTIF_TYPES.HIRE_LAWYER,
      fromId: defendantId,
      toId: lawyer.id,
      message: `${defendant.name} needs legal defense (${reason}). Name your price.`,
      payload: { defendantId, reason },
    });
  }

  return {
    ok: true,
    description: `Defense request sent to ${lawyers.length} Lawyer(s).`,
  };
}

/**
 * Lawyer sets their price for defense.
 */
export function lawyerSetsPrice(state, lawyerId, defendantId, price) {
  const lawyer = state.players[lawyerId];
  const defendant = state.players[defendantId];
  if (!lawyer || !defendant) return { ok: false, description: 'Invalid players.' };

  createNotification(state, {
    type: NOTIF_TYPES.LAWYER_PRICE,
    fromId: lawyerId,
    toId: defendantId,
    message: `Lawyer ${lawyer.name} will defend you for $${price}. Accept?`,
    payload: { lawyerId, price },
  });

  return { ok: true, description: `${lawyer.name} offered defense for $${price}.` };
}

/**
 * Accept Lawyer's defense. Pay the fee. Does NOT flip the Lawyer.
 */
export function acceptLawyerDefense(state, notifId) {
  const notif = state.notifications?.find(n => n.id === notifId);
  if (!notif || notif.type !== NOTIF_TYPES.LAWYER_PRICE) {
    return { ok: false, description: 'Lawyer offer not found.' };
  }

  const { lawyerId, price } = notif.payload;
  const lawyer = state.players[lawyerId];
  const defendant = state.players[notif.toId];

  if (defendant.cash < price) return { ok: false, description: `Can't afford $${price}.` };

  defendant.cash -= price;
  lawyer.cash += price;
  notif.status = 'accepted';

  return {
    ok: true,
    description: `${defendant.name} hired ${lawyer.name} for $${price}. Defense active.`,
    lawyerId,
  };
}

// ===========================================================================
// JUDGE
// RICO immunity for Boss (with Lawyer). Automatic sentence reduction.
// Can accept bribes (flips dirty).
// ===========================================================================

/**
 * Offer a bribe to a Judge. If accepted, Judge flips dirty.
 * Returns { ok, description }.
 */
export function offerJudgeBribe(state, briberId, judgeId, amount) {
  const briber = state.players[briberId];
  const judge = state.players[judgeId];
  if (!briber || !judge) return { ok: false, description: 'Invalid players.' };
  if (!hasRole(judge, 'Judge')) return { ok: false, description: 'Target is not a Judge.' };
  if (briber.cash < amount) return { ok: false, description: `Can't afford $${amount}.` };

  createNotification(state, {
    type: NOTIF_TYPES.JUDGE_BRIBE,
    fromId: briberId,
    toId: judgeId,
    message: `${briber.name} offers you a $${amount} bribe. Accept? WARNING: Accepting flips you dirty.`,
    payload: { briberId, amount },
  });

  return { ok: true, description: `Bribe offer of $${amount} sent to Judge ${judge.name}.` };
}

/**
 * Judge accepts a bribe. Gets paid, flips dirty.
 */
export function acceptJudgeBribe(state, notifId) {
  const notif = state.notifications?.find(n => n.id === notifId);
  if (!notif || notif.type !== NOTIF_TYPES.JUDGE_BRIBE) {
    return { ok: false, description: 'Bribe offer not found.' };
  }

  const { briberId, amount } = notif.payload;
  const briber = state.players[briberId];
  const judge = state.players[notif.toId];

  if (briber.cash < amount) return { ok: false, description: 'Briber can no longer afford this.' };

  briber.cash -= amount;
  judge.cash += amount;

  // flip judge dirty
  const judgeCard = judge.roles.find(r => r.role === 'Judge');
  if (judgeCard) judgeCard.clean = false;
  judge.status.roleDirty = true;

  notif.status = 'accepted';

  return {
    ok: true,
    description: `Judge ${judge.name} accepted $${amount} bribe from ${briber.name}. Judge is now dirty.`,
  };
}

// ===========================================================================
// BANKER
// Negotiated lending rate only. Collects on GO.
// Foreclosure → property goes unowned.
// Competes with mob lending as the clean alternative.
// ===========================================================================
// (Banker mechanics are fully handled in lending.js — findBanker, offerBankRate,
//  processLoanPaymentsOnGo. No additional logic needed here.)

export { findBanker } from './lending.js';
