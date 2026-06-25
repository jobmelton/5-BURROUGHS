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

/** Effective rent for a space, applying build level and halo bonus. */
export function effectiveRent(space) {
  const levelMult = 1 + space.buildLevel; // each level adds 1x base rent
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
