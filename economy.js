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

/** Can this player build on this space? (contiguity rule scales by borough) */
export function canBuild(state, playerId, index) {
  const space = state.board[index];
  if (space.ownerId !== playerId) return { ok: false, reason: 'not owner' };
  if (space.buildLevel >= build.maxBuildLevel) return { ok: false, reason: 'max level' };
  // strike check: building shut down in this borough?
  if (state.strikeBoroughs?.[space.borough] > 0) {
    return { ok: false, reason: `strike in borough ${space.borough} (${state.strikeBoroughs[space.borough]} turns left)` };
  }
  const need = build.contiguityRequired[space.borough - 1];
  const have = contiguousOwnedRun(state, playerId, index);
  if (have < need) return { ok: false, reason: `need ${need} contiguous, have ${have}` };
  return { ok: true };
}

/** Build cost for the next level on a space (and demo surcharge if abandoned). */
export function buildCost(space) {
  const base = Math.round(space.basePrice * pricing.buildCostFractionOfPrice);
  const demo = space.type.startsWith('abandoned')
    ? Math.round(space.basePrice * pricing.demoCost)
    : 0;
  return { build: base, demo, total: base + demo };
}

/**
 * Build the next level on a space: check contiguity, deduct cost, bump level,
 * and radiate the value halo to neighbors.
 * Returns { ok, description }.
 */
export function buildOnSpace(state, playerId, index) {
  const check = canBuild(state, playerId, index);
  if (!check.ok) return { ok: false, description: `Can't build: ${check.reason}` };

  const space = state.board[index];
  const player = state.players[playerId];
  const cost = buildCost(space);
  if (player.cash < cost.total) {
    return { ok: false, description: `Can't afford build: $${cost.total} (cash $${player.cash})` };
  }

  player.cash -= cost.total;
  space.buildLevel++;
  applyHalo(state, index);

  // split build cost to role holders in this borough
  const splits = buildingCostSplit(state, space.borough, cost.total);
  const splitNote = splits.filter(s => s.to !== 'BANK').map(s => `${s.reason}: $${s.amount}`).join(', ');

  return {
    ok: true,
    description: `Built level ${space.buildLevel} on #${index} (b${space.borough}) for $${cost.total}. Cash $${player.cash}.${splitNote ? ' Splits: ' + splitNote : ''}`,
  };
}

/**
 * Radiate the value halo from a built space to its neighbors within radius.
 * Halo strength decays per space of distance; total bonus capped per config.
 */
export function applyHalo(state, sourceIndex) {
  const source = state.board[sourceIndex];
  const { radius, decayPerSpace, stackCap } = build.halo;
  // halo strength based on build level (use generic per-level strength)
  const baseStrength = 0.05 * source.buildLevel; // 5% per build level

  for (let dist = 1; dist <= radius; dist++) {
    const strength = baseStrength * Math.pow(1 - decayPerSpace, dist - 1);
    if (strength <= 0) break;

    for (const neighbor of [sourceIndex - dist, sourceIndex + dist]) {
      if (neighbor < 0 || neighbor >= state.board.length) continue;
      if (state.board[neighbor].borough !== source.borough) continue;
      const sp = state.board[neighbor];
      sp.haloBonus = Math.min(stackCap, sp.haloBonus + strength);
      sp.haloBonus = Math.round(sp.haloBonus * 1000) / 1000; // avoid float drift
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

/** Effective rent for a space, applying build level, halo bonus, and anchor multiplier. */
export function effectiveRent(space) {
  if (space.anchorType) {
    const { rentMultiplierByLevel } = CONFIG.anchors;
    const mult = rentMultiplierByLevel[space.anchorLevel] ?? rentMultiplierByLevel[0];
    return Math.round(space.baseRent * mult * (1 + space.haloBonus));
  }
  const levelMult = 1 + Math.max(0, space.buildLevel); // each level adds 1x base rent
  return Math.round(space.baseRent * levelMult * (1 + space.haloBonus));
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
