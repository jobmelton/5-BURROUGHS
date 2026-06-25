// ===========================================================================
// 5 BOROUGHS ON THE TAKE — decks.js
// Builds the 50-card career pool (10 roles x 5 boroughs) and the action deck.
// ===========================================================================
import { CONFIG } from './gameConfig.js';
import { ROLE_TYPES, ACTION_TYPES, CLEAN_ROLES } from './types.js';

/** 50 career cards: the full 10-role slate for each of the 5 boroughs. */
export function buildCareerPool() {
  const pool = [];
  for (let borough = 1; borough <= CONFIG.careers.boroughs; borough++) {
    for (const role of ROLE_TYPES) {
      pool.push({
        id: `career-${borough}-${role}`,
        role,
        borough,
        ownedById: null,
        clean: CLEAN_ROLES.includes(role) ? true : undefined,
      });
    }
  }
  return shuffle(pool);
}

/** Action / balance deck: 5 Hits + the 11 balance cards (RICO x2, Informant x2,
 *  plus singles). Counts match the tabletop v10 deck. */
export function buildActionPool() {
  const counts = {
    Hit: 5, RICO: 2, Informant: 2,
    Expose: 1, Accountant: 1, Audit: 1, Election: 1, Strike: 1, Pardon: 1, Jackpot: 1,
  };
  const pool = [];
  for (const type of ACTION_TYPES) {
    for (let i = 0; i < (counts[type] || 0); i++) {
      pool.push({ id: `action-${type}-${i}`, type });
    }
  }
  return shuffle(pool);
}

export function drawFrom(pool) {
  return pool.length ? pool.shift() : null;
}

function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
