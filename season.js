// ===========================================================================
// 5 BOROUGHS ON THE TAKE — season.js
// Season timer, leaderboard, godfather tribute, bounty payout, soft-reset.
// ===========================================================================
import { CONFIG } from './gameConfig.js';
import { buildCareerPool, buildActionPool } from './decks.js';
import { checkCleanCityWin } from './economy.js';

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

  descriptions.push(`Tribute collected: $${collected} from ${Object.keys(state.players).length} players.`);
  descriptions.push(`Bounty pool now $${state.bountyPool} (+$${toBounty}).`);

  return { collected, toBounty, descriptions };
}

/**
 * End the season: check Clean City, pay out bounty pool, then soft-reset.
 * Returns { payouts, descriptions }.
 */
export function endSeason(state) {
  const descriptions = [];

  // --- Clean City check: do the Law holders win? ---
  const cleanCity = checkCleanCityWin(state);
  if (cleanCity.lawWins) {
    for (const d of cleanCity.descriptions) descriptions.push(d);
  }

  // --- bounty payout: top N split the bounty pool ---
  const board = leaderboard(state);
  const splits = season.payoutSplits;
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
  for (const space of state.board) {
    space.ownerId = null;
    space.buildLevel = 0;
    space.anchorType = null;
    space.anchorLevel = 0;
    space.haloBonus = 0;
  }

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

  state.careerPool = buildCareerPool();
  state.actionPool = buildActionPool();
  state.bountyPool = 0;
  state.taxPool = 0;
  state.freeParkingPool = 0;
  state.cleanCityMeter = 1;
  state.godfatherId = null;
  state.strikeBoroughs = {};
  state.seasonEndsAt = Date.now() + season.lengthDays * 864e5;

  descriptions.push('Season reset: board cleared, cash reset, decks reshuffled.');

  return { payouts, descriptions };
}
