// ===========================================================================
// 5 BOROUGHS ON THE TAKE — economy.js
// Core money logic: buying, rent (with capo skim / protection / halo),
// building with contiguity rules, demo-and-rebuild, and the catch-up stake.
// All money flows funnel through here so sinks stay consistent.
// ===========================================================================
import { CONFIG } from './gameConfig.js';
import { contiguousNeighbors } from './board.js';

const { economy, build, pricing } = CONFIG;

/** Count how many contiguous owned lots `player` has including `index`, in that borough. */
export function contiguousOwnedRun(state, playerId, index) {
  const board = state.board;
  const borough = board[index].borough;
  let run = 1;
  // walk left
  for (let i = index - 1; i >= 0 && board[i].borough === borough; i--) {
    if (board[i].ownerId === playerId) run++; else break;
  }
  // walk right
  for (let i = index + 1; i < board.length && board[i].borough === borough; i++) {
    if (board[i].ownerId === playerId) run++; else break;
  }
  return run;
}

// ---- TIER-BASED BUILDING SYSTEM -------------------------------------------

/**
 * Get the highest building tier available to a player at a space,
 * based on how many contiguous lots they own.
 * Returns { tier, contiguous, options } or null.
 */
export function getAvailableTier(state, playerId, index) {
  const space = state.board[index];
  if (space.ownerId !== playerId) return null;
  const contiguous = contiguousOwnedRun(state, playerId, index);

  // find highest tier this contiguity unlocks
  let bestTier = null;
  for (const tier of build.tiers) {
    if (contiguous >= tier.contiguous) bestTier = tier;
  }
  return bestTier ? { tier: bestTier, contiguous } : null;
}

/**
 * Get the current tier index of a space based on its buildingType.
 * Returns -1 if nothing built, or the tier index (0-5).
 */
export function getCurrentTierIndex(space) {
  if (!space.buildingType) return -1;
  for (let i = 0; i < build.tiers.length; i++) {
    if (build.tiers[i].steps.some(o => o.type === space.buildingType)) return i;
  }
  return -1;
}

/**
 * Get the cumulative investment already sunk into this space
 * (the cost multiplier of the building currently on it).
 */
export function getPreviousInvestment(space) {
  if (!space.buildingType) return 0;
  for (const tier of build.tiers) {
    const opt = tier.steps.find(o => o.type === space.buildingType);
    if (opt) return Math.round(space.basePrice * opt.costMult);
  }
  return 0;
}

/**
 * Get ALL contiguous lot indices owned by a player around a given index.
 */
export function getContiguousLots(state, playerId, index) {
  const board = state.board;
  const borough = board[index].borough;
  const lots = [index];
  // walk left
  for (let i = index - 1; i >= 0 && board[i].borough === borough; i--) {
    if (board[i].ownerId === playerId) lots.unshift(i); else break;
  }
  // walk right
  for (let i = index + 1; i < board.length && board[i].borough === borough; i++) {
    if (board[i].ownerId === playerId) lots.push(i); else break;
  }
  return lots;
}

/**
 * Check if ALL contiguous lots are at a given tier or higher.
 * Required before any lot in the run can upgrade to the next tier.
 */
export function allLotsAtTier(state, playerId, index, minTierIndex) {
  const lots = getContiguousLots(state, playerId, index);
  for (const lotIdx of lots) {
    const sp = state.board[lotIdx];
    const tierIdx = getCurrentTierIndex(sp);
    if (tierIdx < minTierIndex) return { allReady: false, notReady: lotIdx, currentTier: tierIdx };
  }
  return { allReady: true };
}

/**
 * Get build options for a space. Progressive building with tier gating:
 * - If nothing built: only Tier 1 options (pick one)
 * - To upgrade to Tier 2: ALL contiguous lots must have Tier 1 built
 * - To upgrade to Tier 3: ALL contiguous lots must have Tier 2 built
 * - And so on. Within a tier you choose ONE option.
 * - Cost = full tier cost minus previous investment (incremental).
 * - Demo surcharge applies to abandoned properties on first build only.
 */
export function getBuildOptions(state, playerId, index) {
  const space = state.board[index];
  const player = state.players[playerId];
  if (!player || space.ownerId !== playerId) return [];

  // strike check
  if (state.strikeBoroughs?.[space.borough] > 0) return [];
  // code violation check
  if (state.codeViolations?.[space.borough]) return [];

  const contiguous = contiguousOwnedRun(state, playerId, index);
  const currentTierIdx = getCurrentTierIndex(space);
  const previousInvestment = getPreviousInvestment(space);
  const options = [];

  // determine the next tier to build
  const nextTierIdx = currentTierIdx + 1;

  // find current step within current tier
  let currentStepIdx = -1;
  let currentTier = currentTierIdx >= 0 ? build.tiers[currentTierIdx] : null;
  if (currentTier && space.buildingType) {
    currentStepIdx = currentTier.steps.findIndex(s => s.type === space.buildingType);
  }

  // CASE 1: nothing built — offer ALL steps of tier 1 (player can skip ahead but pays cumulative)
  if (currentTierIdx < 0) {
    const tier = build.tiers[0];
    if (!tier) return [];
    const demo = space.type.startsWith('abandoned')
      ? Math.round(space.basePrice * build.demoCost) : 0;
    for (const step of tier.steps) {
      const fullCost = Math.round(space.basePrice * step.costMult);
      options.push({
        type: step.type, label: step.label, costMult: step.costMult,
        fullCost, cost: fullCost + demo, demo, previousInvestment: 0,
        rentMult: step.rentMult, roi: step.roi,
        stepNumber: tier.steps.indexOf(step) + 1, totalSteps: tier.steps.length,
        tierContiguous: tier.contiguous, tierLabel: tier.label, tierIndex: 0,
        haloRadius: tier.haloRadius,
        affordable: player.cash >= (fullCost + demo),
        rentResult: Math.round(space.baseRent * step.rentMult),
        isUpgrade: false,
      });
    }
    return options;
  }

  // CASE 2: mid-tier — offer ALL remaining steps (can skip ahead, pays cumulative)
  if (currentStepIdx >= 0 && currentStepIdx < currentTier.steps.length - 1) {
    for (let s = currentStepIdx + 1; s < currentTier.steps.length; s++) {
      const step = currentTier.steps[s];
      const fullCost = Math.round(space.basePrice * step.costMult);
      const upgradeCost = Math.max(0, fullCost - previousInvestment);
      options.push({
        type: step.type, label: step.label, costMult: step.costMult,
        fullCost, cost: upgradeCost, demo: 0, previousInvestment,
        rentMult: step.rentMult, roi: step.roi,
        stepNumber: s + 1, totalSteps: currentTier.steps.length,
        tierContiguous: currentTier.contiguous, tierLabel: currentTier.label, tierIndex: currentTierIdx,
        haloRadius: currentTier.haloRadius,
        affordable: player.cash >= upgradeCost,
        rentResult: Math.round(space.baseRent * step.rentMult),
        isUpgrade: true,
      });
    }
    return options;
  }

  // CASE 3: at last step of tier — check if next tier is available
  if (nextTierIdx >= build.tiers.length) return []; // max tier reached
  const nextTier = build.tiers[nextTierIdx];
  if (contiguous < nextTier.contiguous) return []; // not enough lots

  // ALL lots must be at LAST STEP of current tier before any can start next tier
  const lots = getContiguousLots(state, playerId, index);
  const lastStepType = currentTier.steps[currentTier.steps.length - 1].type;
  for (const lotIdx of lots) {
    const sp = state.board[lotIdx];
    if (sp.buildingType !== lastStepType) {
      const spTierIdx = getCurrentTierIndex(sp);
      const spStepIdx = spTierIdx >= 0 ? build.tiers[spTierIdx].steps.findIndex(s => s.type === sp.buildingType) : -1;
      const spStepLabel = sp.buildingType || 'unbuilt';
      return [{
        type: '_blocked', label: 'Blocked', cost: 0, affordable: false, rentMult: 0, roi: 0,
        reason: `Lot #${lotIdx} is at ${spStepLabel}. All lots must reach ${currentTier.steps[currentTier.steps.length - 1].label} before starting ${nextTier.label}.`,
      }];
    }
  }

  // all lots maxed — offer step 1 of next tier
  const firstStep = nextTier.steps[0];
  const fullCost = Math.round(space.basePrice * firstStep.costMult);
  const upgradeCost = Math.max(0, fullCost - previousInvestment);
  return [{
    type: firstStep.type, label: firstStep.label, costMult: firstStep.costMult,
    fullCost, cost: upgradeCost, demo: 0, previousInvestment,
    rentMult: firstStep.rentMult, roi: firstStep.roi,
    stepNumber: 1, totalSteps: nextTier.steps.length,
    tierContiguous: nextTier.contiguous, tierLabel: nextTier.label, tierIndex: nextTierIdx,
    haloRadius: nextTier.haloRadius,
    affordable: player.cash >= upgradeCost,
    rentResult: Math.round(space.baseRent * firstStep.rentMult),
    isUpgrade: true,
  }];
}

/** Can this player build on this space? */
export function canBuild(state, playerId, index) {
  const space = state.board[index];
  if (space.ownerId !== playerId) return { ok: false, reason: 'not owner' };
  if (space.buildLevel < 0) return { ok: false, reason: 'mortgaged' };
  if (state.strikeBoroughs?.[space.borough] > 0) {
    return { ok: false, reason: `strike in borough ${space.borough} (${state.strikeBoroughs[space.borough]} turns left)` };
  }
  if (state.codeViolations?.[space.borough]) {
    return { ok: false, reason: `code violation in borough ${space.borough} — pay $${state.codeViolations[space.borough].penalty} first` };
  }
  const options = getBuildOptions(state, playerId, index);
  if (options.length === 0) return { ok: false, reason: 'no build options (need more contiguous lots or already max)' };
  return { ok: true, options };
}

/** Build cost for a specific building type on a space. */
export function buildCost(space, buildingType) {
  if (!buildingType) {
    // fallback for legacy: find cheapest tier 1 option
    const t1 = build.tiers[0]?.options[0];
    if (!t1) return { build: 0, demo: 0, total: 0 };
    const base = Math.round(space.basePrice * t1.costMult);
    const demo = space.type.startsWith('abandoned') ? Math.round(space.basePrice * build.demoCost) : 0;
    return { build: base, demo, total: base + demo };
  }
  // find the option across all tiers
  for (const tier of build.tiers) {
    const opt = tier.steps.find(o => o.type === buildingType);
    if (opt) {
      const base = Math.round(space.basePrice * opt.costMult);
      const demo = space.type.startsWith('abandoned') ? Math.round(space.basePrice * build.demoCost) : 0;
      return { build: base, demo, total: base + demo, rentMult: opt.rentMult, haloRadius: tier.haloRadius, tierIndex: build.tiers.indexOf(tier) };
    }
  }
  return { build: 0, demo: 0, total: 0 };
}

/**
 * Build a specific building type on a space.
 * Replaces the old generic buildOnSpace. Player chooses what to build.
 * Returns { ok, description }.
 */
export function buildOnSpace(state, playerId, index, buildingType) {
  const space = state.board[index];
  const player = state.players[playerId];
  if (!player) return { ok: false, description: 'Invalid player.' };

  const check = canBuild(state, playerId, index);
  if (!check.ok) return { ok: false, description: `Can't build: ${check.reason}` };

  // if no type specified, use first available option
  if (!buildingType && check.options?.length > 0) {
    buildingType = check.options[0].type;
  }

  // find the matching option from the progressive build options
  const options = getBuildOptions(state, playerId, index);
  const chosen = options.find(o => o.type === buildingType);
  if (!chosen) return { ok: false, description: `${buildingType} not available. Must build through tiers progressively.` };

  const upgradeCost = chosen.cost; // incremental cost (full - previous investment)

  // check affordability (account for partnership split if applicable)
  let playerCost = upgradeCost;
  let partnerCost = 0;
  if (space.partnership) {
    playerCost = Math.round(upgradeCost * (space.partnership.ownerSplit / 100));
    partnerCost = upgradeCost - playerCost;
    if (space.ownerId !== playerId) {
      playerCost = Math.round(upgradeCost * (space.partnership.partnerSplit / 100));
      partnerCost = upgradeCost - playerCost;
    }
  }

  if (player.cash < playerCost) {
    return { ok: false, description: `Can't afford ${chosen.label}: $${playerCost} (cash $${player.cash}).` };
  }

  // deduct cost
  player.cash -= playerCost;

  // deduct partner's share if partnership
  if (space.partnership && partnerCost > 0) {
    const partner = state.players[space.partnership.partnerId] || state.players[space.ownerId];
    if (partner && partner.id !== playerId && partner.cash >= partnerCost) {
      partner.cash -= partnerCost;
    }
  }

  // set building type and level
  const previousType = space.buildingType;
  space.buildingType = buildingType;
  space.buildLevel = chosen.tierIndex + 1; // tier 1 = level 1, etc.
  space.rentMultiplier = chosen.rentMult;

  // find tier data for halo
  let tierData = build.tiers[chosen.tierIndex];

  // apply halo to neighbors
  applyHalo(state, index, tierData);

  // split build cost to role holders
  const splits = buildingCostSplit(state, space.borough, upgradeCost);
  const splitNote = splits.filter(s => s.to !== 'BANK').map(s => `${s.reason}: $${s.amount}`).join(', ');

  const rentNow = Math.round(space.baseRent * chosen.rentMult * (1 + space.haloBonus));
  const upgradeNote = previousType ? ` (upgraded from ${previousType})` : '';

  return {
    ok: true,
    description: `Built ${chosen.label} on #${index} (b${space.borough}) for $${playerCost}${partnerCost > 0 ? ` + partner $${partnerCost}` : ''}${upgradeNote}. Rent: $${rentNow}/landing (${chosen.rentMult}x). ROI: ${Math.round(chosen.roi * 100)}%. Cash $${player.cash}.${splitNote ? ' Splits: ' + splitNote : ''}`,
  };
}

/**
 * Radiate the value halo from a built space. Tier determines radius and strength.
 * Higher-tier builds radiate further and stronger — cheap boroughs can become
 * more valuable than undeveloped expensive boroughs.
 */
export function applyHalo(state, sourceIndex, tierData) {
  const source = state.board[sourceIndex];
  const { decayPerSpace, stackCap, basePctPerTier } = build.halo;
  const tierIndex = tierData ? build.tiers.indexOf(tierData) : 0;
  const radius = tierData?.haloRadius || 1;
  const baseStrength = basePctPerTier[tierIndex] || 0.05;

  for (let dist = 1; dist <= radius; dist++) {
    const strength = baseStrength * Math.pow(1 - decayPerSpace, dist - 1);
    if (strength <= 0.001) break;

    for (const neighbor of [sourceIndex - dist, sourceIndex + dist]) {
      if (neighbor < 0 || neighbor >= state.board.length) continue;
      if (state.board[neighbor].borough !== source.borough) continue;
      const sp = state.board[neighbor];
      sp.haloBonus = Math.min(stackCap, sp.haloBonus + strength);
      sp.haloBonus = Math.round(sp.haloBonus * 1000) / 1000;
    }
  }
}

/**
 * Place an anchor (stadium/casino) on an anchor slot.
 * Player must own the slot. Costs basePrice * placeCostMultiplier.
 */
export function placeAnchor(state, playerId, index, anchorType) {
  const space = state.board[index];
  const player = state.players[playerId];
  const { anchors } = CONFIG;
  if (!player) return { ok: false, description: 'Invalid player.' };
  if (space.type !== 'anchorSlot') return { ok: false, description: 'Not an anchor slot.' };
  if (space.ownerId !== playerId) return { ok: false, description: 'You don\'t own this slot.' };
  if (space.anchorType) return { ok: false, description: `Already has a ${space.anchorType} anchor.` };
  if (!anchors.typesAllowed.includes(anchorType)) {
    return { ok: false, description: `Invalid anchor type: ${anchorType}. Allowed: ${anchors.typesAllowed.join(', ')}.` };
  }

  const cost = Math.round(space.basePrice * anchors.placeCostMultiplier);
  if (player.cash < cost) {
    return { ok: false, description: `Can't afford $${cost} to place ${anchorType} (cash $${player.cash}).` };
  }

  player.cash -= cost;
  space.anchorType = anchorType;
  space.anchorLevel = 0;
  return {
    ok: true,
    description: `Placed ${anchorType} anchor on #${index} (b${space.borough}) for $${cost}. Cash $${player.cash}.`,
  };
}

/**
 * Expand an existing anchor by one level. Requires owning surrounding lots
 * if config demands it. Max expandLevels.
 */
export function expandAnchor(state, playerId, index) {
  const space = state.board[index];
  const player = state.players[playerId];
  const { anchors } = CONFIG;
  if (!player) return { ok: false, description: 'Invalid player.' };
  if (space.ownerId !== playerId) return { ok: false, description: 'You don\'t own this slot.' };
  if (!space.anchorType) return { ok: false, description: 'No anchor placed here yet.' };
  if (space.anchorLevel >= anchors.expandLevels) {
    return { ok: false, description: `Already at max expansion level (${anchors.expandLevels}).` };
  }

  // check surrounding lot ownership
  if (anchors.expandRequiresSurroundingLots) {
    const neighbors = contiguousNeighbors(state.board, index);
    const ownedNeighbors = neighbors.filter(i => state.board[i].ownerId === playerId);
    const needOwned = space.anchorLevel + 1; // need 1 for lv1, 2 for lv2, etc.
    if (ownedNeighbors.length < needOwned) {
      return { ok: false, description: `Need ${needOwned} owned neighbor(s) for level ${space.anchorLevel + 1}, have ${ownedNeighbors.length}.` };
    }
  }

  const cost = Math.round(space.basePrice * anchors.expandCostMultiplier);
  if (player.cash < cost) {
    return { ok: false, description: `Can't afford $${cost} to expand (cash $${player.cash}).` };
  }

  player.cash -= cost;
  space.anchorLevel++;
  applyHalo(state, index);
  return {
    ok: true,
    description: `Expanded ${space.anchorType} on #${index} to level ${space.anchorLevel} for $${cost}. Cash $${player.cash}.`,
  };
}

/** Effective rent for a space, applying building type multiplier, halo bonus, and anchors. */
export function effectiveRent(space) {
  if (space.anchorType) {
    const { rentMultiplierByLevel } = CONFIG.anchors;
    const mult = rentMultiplierByLevel[space.anchorLevel] ?? rentMultiplierByLevel[0];
    return Math.round(space.baseRent * mult * (1 + space.haloBonus));
  }
  // use the building's rent multiplier if set, otherwise fallback to build level
  const mult = space.rentMultiplier || (1 + Math.max(0, space.buildLevel));
  return Math.round(space.baseRent * mult * (1 + space.haloBonus));
}

/**
 * Resolve rent when `payer` lands on a space owned by someone else.
 * Applies: protection (immune), capo skim + kickup, commission vig sink.
 * Returns a list of transfers the caller should apply atomically.
 */
export function resolveRent(state, payerId, index) {
  const space = state.board[index];
  const owner = state.players[space.ownerId];
  const payer = state.players[payerId];
  if (!owner || owner.id === payerId) return [];
  if (space.buildLevel < 0) return []; // mortgaged — no rent

  const rent = effectiveRent(space);
  const transfers = [];

  // protected players still pay rent to the owner, but pay NO mob skim
  const protectedFromMob = !!payer.status.protectedByCopId;

  // base rent: payer -> owner
  transfers.push({ from: payerId, to: owner.id, amount: rent, reason: 'rent' });

  if (!protectedFromMob) {
    // capo on this borough skims; if under a boss, kicks up
    const capo = findRoleHolder(state, 'Capo', space.borough);
    if (capo) {
      const skim = Math.round(rent * economy.capoSkimUnderBoss);
      const underBoss = capo.status?.ownedByBossId || bossOf(state, capo.id);
      if (underBoss) {
        const kick = Math.round(rent * economy.capoKickupToBoss);
        transfers.push({ from: owner.id, to: capo.id, amount: skim - kick, reason: 'capo skim' });
        transfers.push({ from: owner.id, to: underBoss, amount: kick, reason: 'kickup' });
      } else {
        const freelance = Math.round(rent * economy.capoFreelance);
        transfers.push({ from: owner.id, to: capo.id, amount: freelance, reason: 'capo freelance' });
      }
    }
  } else {
    // protected: pay protection fee to the cop instead of mob skim
    const cop = state.players[payer.status.protectedByCopId];
    if (cop) {
      const fee = Math.round(rent * economy.protectionFee);
      const vig = Math.round(fee * economy.commissionVig); // sink
      transfers.push({ from: payerId, to: cop.id, amount: fee - vig, reason: 'protection' });
      transfers.push({ from: payerId, to: 'BANK', amount: vig, reason: 'commission vig (sink)' });
    }
  }
  return transfers;
}

/** Catch-up stake for a late joiner: scaled to live economy, floored at turn-1 cash. */
export function catchUpStake(state) {
  const humans = Object.values(state.players).filter(p => !p.isBot);
  if (humans.length === 0) return CONFIG.money.startingCash;
  const avg = humans.reduce((s, p) => s + (p.netWorth || p.cash), 0) / humans.length;
  return Math.max(
    CONFIG.money.catchUpFloor,
    Math.round(avg * CONFIG.money.catchUpFractionOfAvg)
  );
}

/**
 * Boss upkeep: each player holding a Boss card pays bossUpkeepPerRole for
 * every role they control (via ownedByBossId). Paid on payday; goes to bank (sink).
 * Returns [{ playerId, paid, roleCount, description }].
 */
export function processBossUpkeep(state) {
  const results = [];
  for (const p of Object.values(state.players)) {
    if (!p.roles.some(r => r.role === 'Boss')) continue;

    // count roles controlled by this boss (other players owned by them)
    const controlled = Object.values(state.players)
      .filter(o => o.id !== p.id && o.status?.ownedByBossId === p.id);
    const controlledRoleCount = controlled.reduce((sum, o) => sum + o.roles.length, 0);
    if (controlledRoleCount === 0) continue;

    const cost = controlledRoleCount * economy.bossUpkeepPerRole;
    const paid = Math.min(cost, p.cash);
    p.cash -= paid;

    results.push({
      playerId: p.id,
      paid,
      roleCount: controlledRoleCount,
      description: `${p.name} (Boss) paid $${paid} upkeep for ${controlledRoleCount} controlled role(s).`,
    });
  }
  return results;
}

/**
 * Building cost split: when a player builds, a portion of the cost goes to
 * role holders in that borough: Inspector, LaborBoss, and optionally Banker/Politician.
 * Call after deducting the build cost from the builder.
 * Returns transfers [{ to, amount, reason }].
 */
export function buildingCostSplit(state, borough, totalCost) {
  if (!economy.buildingSplit) return [];
  const transfers = [];

  // find role holders for this borough
  const inspector = findRoleHolder(state, 'Inspector', borough);
  const laborBoss = findRoleHolder(state, 'LaborBoss', borough);
  const banker = findRoleHolder(state, 'Banker', borough);
  const politician = findRoleHolder(state, 'Politician', borough);

  const holders = [inspector, laborBoss, banker, politician].filter(Boolean);
  if (holders.length === 0) return [];

  const shareEach = Math.floor(totalCost / holders.length);
  for (const holder of holders) {
    const vig = Math.round(shareEach * economy.commissionVig);
    const net = shareEach - vig;
    holder.cash += net;
    transfers.push({ to: holder.id, amount: net, reason: `build split (${holder.roles.find(r => ['Inspector','LaborBoss','Banker','Politician'].includes(r.role) && r.borough === borough)?.role})` });
    // vig sinks to bank
    if (vig > 0) transfers.push({ to: 'BANK', amount: vig, reason: 'build split vig (sink)' });
  }
  return transfers;
}

/**
 * Distribute the tax pool among all Politician role holders, equally.
 * Returns { distributed, perPolitician, descriptions }.
 */
export function distributeTaxPool(state) {
  if (!economy.politicianTaxSplit) return { distributed: 0, perPolitician: 0, descriptions: [] };
  if (state.taxPool <= 0) return { distributed: 0, perPolitician: 0, descriptions: [] };

  // find all players holding Politician cards
  const politicians = [];
  for (const p of Object.values(state.players)) {
    const polCards = p.roles.filter(r => r.role === 'Politician');
    if (polCards.length > 0) politicians.push({ player: p, count: polCards.length });
  }
  if (politicians.length === 0) return { distributed: 0, perPolitician: 0, descriptions: [] };

  const totalShares = politicians.reduce((s, p) => s + p.count, 0);
  const perShare = Math.floor(state.taxPool / totalShares);
  const descriptions = [];
  let distributed = 0;

  for (const { player, count } of politicians) {
    const payout = perShare * count;
    player.cash += payout;
    distributed += payout;
    descriptions.push(`${player.name} received $${payout} from tax pool (${count} Politician card(s)).`);
  }

  state.taxPool -= distributed;
  descriptions.push(`Tax pool: $${distributed} distributed, $${state.taxPool} remaining.`);
  return { distributed, perPolitician: perShare, descriptions };
}

/**
 * Check for Clean City win: if all Cop/Politician/Judge cards in play are clean,
 * the Law wins and each clean role holder gets the cleanCityReward.
 * Returns { lawWins, rewards, descriptions }.
 */
export function checkCleanCityWin(state) {
  const cleanRoles = ['Cop', 'Politician', 'Judge'];
  const holders = [];
  let allClean = true;
  let anyInPlay = false;

  for (const p of Object.values(state.players)) {
    for (const card of p.roles) {
      if (cleanRoles.includes(card.role)) {
        anyInPlay = true;
        if (!card.clean) { allClean = false; break; }
        holders.push(p);
      }
    }
    if (!allClean) break;
  }

  if (!anyInPlay || !allClean) {
    return { lawWins: false, rewards: [], descriptions: [] };
  }

  const reward = economy.cleanCityReward;
  const rewards = [];
  const descriptions = [];
  const seen = new Set();

  for (const p of holders) {
    if (seen.has(p.id)) continue;
    seen.add(p.id);
    p.cash += reward;
    rewards.push({ playerId: p.id, amount: reward });
    descriptions.push(`${p.name} earned $${reward} Clean City reward.`);
  }
  descriptions.push('The Law wins! All officials are clean.');
  return { lawWins: true, rewards, descriptions };
}

// --- small helpers (stubs to wire to your role-tracking) -------------------
function findRoleHolder(state, role, borough) {
  return Object.values(state.players).find(p =>
    p.roles?.some(r => r.role === role && r.borough === borough));
}
function bossOf(state, playerId) {
  // returns boss id if this player is owned/controlled by a boss, else null
  const p = state.players[playerId];
  return p?.status?.ownedByBossId ?? null;
}
