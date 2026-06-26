// ===========================================================================
// 5 BOROUGHS ON THE TAKE — actions.js
// Resolves action-card effects: Hit, RICO, Informant, Pardon.
// Each function mutates game state and returns { ok, description } so the
// caller can log / display what happened.
// ===========================================================================
import { CONFIG } from './gameConfig.js';
import { CLEAN_ROLES } from './types.js';

const { actions } = CONFIG;

// ---- helpers ---------------------------------------------------------------

/** Find the first clean role card (Cop/Politician/Judge) held by a player. */
function findCleanRole(player) {
  return player.roles.find(r => CLEAN_ROLES.includes(r.role) && r.clean);
}

/** Does this player hold a Boss career card? */
function hasBossRole(player) {
  return player.roles.some(r => r.role === 'Boss');
}

// ---- Hit -------------------------------------------------------------------
/**
 * The attacker plays a Hit card to steal a career role from the target.
 * Blocked if the target is cop-protected.
 */
export function playHit(state, attackerId, targetId) {
  const attacker = state.players[attackerId];
  const target = state.players[targetId];
  if (!attacker || !target) return { ok: false, description: 'Invalid player id.' };
  if (attackerId === targetId) return { ok: false, description: 'Cannot Hit yourself.' };

  // cop protection blocks the hit
  if (target.status.protectedByCopId) {
    const copName = state.players[target.status.protectedByCopId]?.name ?? 'a cop';
    return {
      ok: false,
      description: `Hit blocked — ${target.name} is under ${copName}'s protection.`,
    };
  }

  if (target.roles.length === 0) {
    return { ok: false, description: `${target.name} has no roles to steal.` };
  }

  // steal up to maxRolesStolen roles (default 1)
  const stolen = [];
  for (let i = 0; i < actions.hit.maxRolesStolen && target.roles.length > 0; i++) {
    const card = target.roles.shift();
    card.ownedById = attacker.id;
    attacker.roles.push(card);
    stolen.push(card);
  }

  const names = stolen.map(c => `${c.role} (b${c.borough})`).join(', ');
  return {
    ok: true,
    description: `Hit! ${attacker.name} stole ${names} from ${target.name}.`,
  };
}

// ---- RICO ------------------------------------------------------------------
/**
 * A player uses a clean Cop, Politician, or Judge to file a RICO case against
 * a Boss who holds 3+ roles. On success the Boss goes to jail.
 */
export function playRICO(state, prosecutorId, targetId) {
  const prosecutor = state.players[prosecutorId];
  const target = state.players[targetId];
  if (!prosecutor || !target) return { ok: false, description: 'Invalid player id.' };
  if (prosecutorId === targetId) return { ok: false, description: 'Cannot RICO yourself.' };

  // prosecutor needs a clean role to file
  const cleanCard = findCleanRole(prosecutor);
  if (!cleanCard) {
    return {
      ok: false,
      description: `RICO failed — ${prosecutor.name} has no clean official to file the case.`,
    };
  }

  // target must hold a Boss card
  if (!hasBossRole(target)) {
    return {
      ok: false,
      description: `RICO failed — ${target.name} is not a Boss.`,
    };
  }

  // target must hold enough roles
  if (target.roles.length < actions.rico.minRolesToTarget) {
    return {
      ok: false,
      description: `RICO failed — ${target.name} holds only ${target.roles.length} role(s); need ${actions.rico.minRolesToTarget}+.`,
    };
  }

  // success: the clean official is now tainted (spent political capital)
  cleanCard.clean = false;

  // target goes to jail
  target.status.jailed = true;
  target.status.jailTurns = actions.rico.jailTurns;

  return {
    ok: true,
    description: `RICO! ${prosecutor.name}'s ${cleanCard.role} (b${cleanCard.borough}) sent ${target.name} to jail for ${actions.rico.jailTurns} turns. The ${cleanCard.role} is no longer clean.`,
  };
}

// ---- Informant -------------------------------------------------------------
/**
 * Free a player from mob ownership and grant them temporary cop protection.
 */
export function playInformant(state, playerId, freedPlayerId) {
  const player = state.players[playerId];
  const freed = state.players[freedPlayerId];
  if (!player || !freed) return { ok: false, description: 'Invalid player id.' };

  const wasMobOwned = !!freed.status.ownedByBossId;
  const oldBossId = freed.status.ownedByBossId;

  // break mob ownership
  freed.status.ownedByBossId = null;

  // grant protection (tracked as a special 'informant' marker; the turn
  // system should count down informantProtectionTurns if wired up)
  freed.status.protectedByCopId = `informant-${playerId}`;
  freed.status.informantProtectionTurns = CONFIG.actions.informant.grantProtectionTurns;

  const bossNote = wasMobOwned
    ? ` freed from ${state.players[oldBossId]?.name ?? 'a boss'}'s control and`
    : '';
  return {
    ok: true,
    description: `Informant! ${freed.name} was${bossNote} granted protection for ${CONFIG.actions.informant.grantProtectionTurns} turns.`,
  };
}

// ---- Pardon ----------------------------------------------------------------
/**
 * Free any player from jail immediately.
 */
export function playPardon(state, playerId, pardonedPlayerId) {
  const player = state.players[playerId];
  const pardoned = state.players[pardonedPlayerId];
  if (!player || !pardoned) return { ok: false, description: 'Invalid player id.' };

  if (!pardoned.status.jailed) {
    return { ok: false, description: `${pardoned.name} is not in jail.` };
  }

  pardoned.status.jailed = false;
  pardoned.status.jailTurns = 0;

  return {
    ok: true,
    description: `Pardon! ${player.name} freed ${pardoned.name} from jail.`,
  };
}
