// ===========================================================================
// 5 BOROUGHS ON THE TAKE — season.js
// Season timer, leaderboard, godfather tribute, bounty payout, soft-reset.
// ===========================================================================
import { CONFIG } from './gameConfig.js';
import { buildBoard } from './board.js';
import { buildCareerPool, buildActionPool } from './decks.js';

const { season, money } = CONFIG;

/**
 * Rank all players by net worth, descending.
 * Returns [{ player, rank, netWorth }].
 */
export function leaderboard(state) {
  return Object.values(state.players)
    .map(p => ({ player: p, netWorth: p.netWorth ?? p.cash }))
    .sort((a, b) => b.netWorth - a.netWorth)
    .map((entry, i) => ({ ...entry, rank: i + 1 }));
}

/**
 * Collect godfather tribute from every player on payday.
 * Half goes to the bounty pool; the rest is a sink.
 * Returns { collected, toBounty, descriptions }.
 */
export function collectGodfatherTribute(state) {
  const tribute = season.godfatherTributePerPayday;
  const descriptions = [];
  let collected = 0;

  for (const p of Object.values(state.players)) {
    const amount = Math.min(tribute, p.cash);
    p.cash -= amount;
    collected += amount;
  }

  const toBounty = Math.round(collected * season.bountyPoolFromGodfatherTributeFraction);
  state.bountyPool += toBounty;
  // the rest is a sink (disappears from economy)

  descriptions.push(`Tribute collected: $${collected} from ${Object.keys(state.players).length} players.`);
  descriptions.push(`Bounty pool now $${state.bountyPool} (+$${toBounty}).`);

  return { collected, toBounty, descriptions };
}

/**
 * End the season: pay out the bounty pool to the top players,
 * then soft-reset the board, decks, and player holdings.
 * Returns { payouts, descriptions }.
 */
export function endSeason(state) {
  const descriptions = [];
  const board = leaderboard(state);

  // --- payout: top 3 split the bounty pool (50% / 30% / 20%) ---
  const splits = [0.50, 0.30, 0.20];
  const payouts = [];
  const pool = state.bountyPool;

  for (let i = 0; i < Math.min(splits.length, board.length); i++) {
    const entry = board[i];
    const payout = Math.round(pool * splits[i]);
    entry.player.cash += payout;
    payouts.push({ player: entry.player, rank: entry.rank, payout });
    descriptions.push(`#${entry.rank} ${entry.player.name}: +$${payout} (net worth $${entry.netWorth})`);
  }

  descriptions.push(`Bounty pool $${pool} distributed.`);

  // --- soft reset ---
  // revert board: all properties go unowned, builds cleared
  for (const space of state.board) {
    space.ownerId = null;
    space.buildLevel = 0;
    space.anchorType = null;
    space.anchorLevel = 0;
    space.haloBonus = 0;
  }

  // clear player holdings, reset cash, keep identity
  for (const p of Object.values(state.players)) {
    p.propertyIds = [];
    p.roles = [];
    p.hand = [];
    p.debts = [];
    p.cash = money.startingCash;
    p.position = 0;
    p.netWorth = money.startingCash;
    p.status = { protectedByCopId: null, ownedByBossId: null, jailed: false, jailTurns: 0 };
    p.allianceIds = [];
  }

  // reshuffle decks
  state.careerPool = buildCareerPool();
  state.actionPool = buildActionPool();
  state.bountyPool = 0;
  state.taxPool = 0;
  state.freeParkingPool = 0;
  state.cleanCityMeter = 1;
  state.godfatherId = null;
  state.seasonEndsAt = Date.now() + season.lengthDays * 864e5;

  descriptions.push('Season reset: board cleared, cash reset, decks reshuffled.');

  return { payouts, descriptions };
}
