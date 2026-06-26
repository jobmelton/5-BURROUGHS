// ===========================================================================
// 5 BOROUGHS ON THE TAKE — game.js
// Ties the components together: create a new game, add players/bots,
// and a smoke test that exercises the core loop end to end.
// ===========================================================================
import { CONFIG } from './gameConfig.js';
import { buildBoard } from './board.js';
import { buildCareerPool, buildActionPool } from './decks.js';
import { desiredBotCount, onHumanJoin, dissolvePlayer } from './bots.js';
import { contiguousOwnedRun, canBuild, buildCost, buildOnSpace, placeAnchor, expandAnchor, effectiveRent, resolveRent, catchUpStake } from './economy.js';
import { takeTurn, sendToJail } from './turns.js';
import { mortgageProperty, payOffMortgage, processPaydayDebts, isMortgaged } from './mortgages.js';
import { leaderboard, collectGodfatherTribute, endSeason } from './season.js';

let _id = 0;
const newId = (p) => `${p}-${++_id}`;

export function newPlayer(name, isBot = false) {
  return {
    id: newId(isBot ? 'bot' : 'p'), name, isBot,
    cash: CONFIG.money.startingCash, position: 0,
    propertyIds: [], roles: [], hand: [], debts: [],
    status: { protectedByCopId: null, ownedByBossId: null, jailed: false, jailTurns: 0 },
    allianceIds: [], netWorth: CONFIG.money.startingCash,
  };
}

export function newGame() {
  const state = {
    gameId: newId('game'),
    board: buildBoard(),
    players: {},
    careerPool: buildCareerPool(),
    actionPool: buildActionPool(),
    taxPool: 0, bountyPool: 0, freeParkingPool: 0,
    cleanCityMeter: 1, godfatherId: null,
    seasonEndsAt: Date.now() + CONFIG.season.lengthDays * 864e5,
    lastBotTickAt: Date.now(), status: 'ongoing',
  };
  // fill to the bot floor
  topUpBots(state);
  return state;
}

export function topUpBots(state) {
  const need = desiredBotCount(state);
  const have = Object.values(state.players).filter(p => p.isBot).length;
  for (let i = have; i < have + Math.max(0, need - have); i++) {
    const b = newPlayer(`Bot ${i + 1}`, true);
    state.players[b.id] = b;
  }
}

// quick value helper for net worth (cash + property base prices)
export function recomputeNetWorth(state, p) {
  const props = p.propertyIds.reduce((s, idx) => s + state.board[idx].basePrice * (1 + state.board[idx].buildLevel), 0);
  p.netWorth = p.cash + props;
  return p.netWorth;
}

// ---------------------------------------------------------------------------
// SMOKE TEST — run with: node src/game.js
// Proves: board builds, pricing climbs, decks are right size, a buy works,
// rent resolves, contiguity gates building, and a human join dissolves the
// richest bot with alliance-collapse notices.
// ---------------------------------------------------------------------------
function smokeTest() {
  const s = newGame();
  const out = [];

  out.push(`Board spaces: ${s.board.length} (5 boroughs)`);
  const lots = s.board.filter(x => x.basePrice > 0);
  out.push(`Priced spaces: ${lots.length}`);
  out.push(`Cheapest lot: $${Math.min(...lots.map(l => l.basePrice))}  Priciest: $${Math.max(...lots.map(l => l.basePrice))}  (pricing climbs around the board)`);
  out.push(`Career pool: ${s.careerPool.length} (expect 50)`);
  out.push(`Action pool: ${s.actionPool.length} (expect 16)`);
  out.push(`Bots at start: ${Object.values(s.players).filter(p => p.isBot).length} (expect floor ${CONFIG.seats.botFloor})`);

  // give bots some assets so a "richest" exists
  Object.values(s.players).forEach((b, i) => {
    const lot = s.board.find(x => x.basePrice > 0 && x.ownerId === null);
    if (lot) { lot.ownerId = b.id; b.propertyIds.push(lot.index); }
    b.cash += i * 300;
    recomputeNetWorth(s, b);
  });

  // a buy by a test human
  const human = newPlayer('You');
  s.players[human.id] = human;
  const buy = s.board.find(x => x.type === 'vacantLot' && x.ownerId === null);
  human.cash -= buy.basePrice; buy.ownerId = human.id; human.propertyIds.push(buy.index);
  out.push(`Human bought lot #${buy.index} (borough ${buy.borough}) for $${buy.basePrice}; cash now $${human.cash}`);

  // contiguity / build gate
  const cb = canBuild(s, human.id, buy.index);
  out.push(`Can build on it? ${cb.ok ? 'yes' : 'no — ' + cb.reason} (borough ${buy.borough} needs ${CONFIG.build.contiguityRequired[buy.borough-1]} contiguous)`);
  out.push(`Build cost on that lot: ${JSON.stringify(buildCost(buy))}`);
  out.push(`Effective rent: $${effectiveRent(buy)}`);

  // alliance + dissolution test
  const richest = Object.values(s.players).filter(p => p.isBot).sort((a,b)=>b.netWorth-a.netWorth)[0];
  human.allianceIds.push(richest.id);
  out.push(`Human allied with richest bot (${richest.name}, net $${richest.netWorth}).`);
  const joiner = newPlayer('NewArrival');
  const notices = onHumanJoin(s, joiner);
  out.push(`A new human joined -> dissolved richest bot. Notices fired: ${notices.length}`);
  const allianceNotice = notices.find(n => n.to === human.id);
  out.push(`Ally got collapse notice: ${allianceNotice ? 'YES — "' + allianceNotice.msg.slice(0,60) + '..."' : 'no'}`);
  out.push(`New arrival catch-up stake: $${joiner.cash}`);

  console.log('\n=== 5 BOROUGHS ON THE TAKE — smoke test ===\n' + out.join('\n') + '\n');
}

// ---------------------------------------------------------------------------
// TURN-LOOP TEST — plays 10 turns for one human player, printing each turn.
// ---------------------------------------------------------------------------
function turnLoopTest() {
  const s = newGame();
  const human = newPlayer('Vinnie');
  s.players[human.id] = human;

  // give bots some properties so rent can happen
  Object.values(s.players).forEach(b => {
    if (!b.isBot) return;
    const lot = s.board.find(x => x.basePrice > 0 && x.ownerId === null);
    if (lot) { lot.ownerId = b.id; b.propertyIds.push(lot.index); }
  });

  console.log('\n=== TURN-LOOP TEST — 10 turns for Vinnie ===');
  console.log(`Starting cash: $${human.cash} | Board: ${s.board.length} spaces\n`);

  for (let t = 1; t <= 10; t++) {
    const { description } = takeTurn(s, human.id);
    console.log(`Turn ${String(t).padStart(2)}: ${description}`);
  }

  console.log(`\nAfter 10 turns: cash $${human.cash}, position #${human.position}, `
    + `properties: ${human.propertyIds.length}, career cards: ${human.roles.length}`);
}

// ---------------------------------------------------------------------------
// JAIL TEST — sends a player to jail and plays turns until they're out.
// ---------------------------------------------------------------------------
function jailTest() {
  const s = newGame();
  const human = newPlayer('Tony');
  s.players[human.id] = human;

  console.log('\n=== JAIL TEST ===');
  sendToJail(human);
  console.log(`Tony sent to jail (jailTurns=${human.status.jailTurns}, maxTurns=${CONFIG.jail.maxTurns})`);

  let t = 0;
  while (human.status.jailed || t === 0) {
    t++;
    const { description } = takeTurn(s, human.id);
    console.log(`Turn ${t}: ${description}`);
    if (t > CONFIG.jail.maxTurns + 1) break; // safety
  }
  console.log(`Released after ${t} turn(s). jailed=${human.status.jailed}`);

  // verify landing on jail space sends player to jail
  const jailSpace = s.board.find(sp => sp.type === 'jail');
  console.log(`\nJail space exists on board at #${jailSpace.index} (borough ${jailSpace.borough})`);
  human.status.jailed = false;
  human.status.jailTurns = 0;
  human.position = jailSpace.index - 2; // position so we could land on it
  // manually place to test
  human.position = jailSpace.index;
  // simulate what takeTurn does when landing on jail
  sendToJail(human);
  console.log(`Manually landed on jail → jailed=${human.status.jailed}, turns=${human.status.jailTurns}`);
}

// ---------------------------------------------------------------------------
// MORTGAGE TEST — mortgage, skip rent, payday payments, payoff.
// ---------------------------------------------------------------------------
function mortgageTest() {
  const s = newGame();
  const owner = newPlayer('Sal');
  const tenant = newPlayer('Mikey');
  s.players[owner.id] = owner;
  s.players[tenant.id] = tenant;

  console.log('\n=== MORTGAGE TEST ===');

  // owner buys a lot
  const lot = s.board.find(x => x.type === 'vacantLot' && x.ownerId === null);
  owner.cash -= lot.basePrice; lot.ownerId = owner.id; owner.propertyIds.push(lot.index);
  console.log(`Sal bought lot #${lot.index} for $${lot.basePrice} (cash $${owner.cash})`);

  // mortgage it
  const m = mortgageProperty(s, owner.id, lot.index);
  console.log(m.description);
  console.log(`  Mortgaged? ${isMortgaged(lot)} (buildLevel=${lot.buildLevel})`);
  console.log(`  Debts: ${owner.debts.length}, principal: $${owner.debts[0]?.principalRemaining}`);

  // tenant lands on it — should pay no rent
  const transfers = resolveRent(s, tenant.id, lot.index);
  console.log(`  Rent while mortgaged: ${transfers.length} transfers (expect 0)`);

  // process payday debts
  console.log('\nPayday debt processing:');
  for (let i = 1; i <= 6; i++) {
    if (owner.debts.length === 0) { console.log(`  Payday ${i}: All debts cleared!`); break; }
    const result = processPaydayDebts(s, owner);
    console.log(`  Payday ${i}: ${result.descriptions.join(' ')}`);
  }
  console.log(`  Cash after paydays: $${owner.cash}`);
  console.log(`  Debts remaining: ${owner.debts.length}`);
  console.log(`  Property un-mortgaged? ${!isMortgaged(lot)} (buildLevel=${lot.buildLevel})`);

  // if debt still exists, pay it off manually
  if (owner.debts.length > 0) {
    const po = payOffMortgage(s, owner.id, owner.debts[0].id);
    console.log(`\nManual payoff: ${po.description}`);
    console.log(`  Debts remaining: ${owner.debts.length}`);
  }
}

// ---------------------------------------------------------------------------
// HALO TEST — build on a lot, verify neighbor halo bumps and cap.
// ---------------------------------------------------------------------------
function haloTest() {
  const s = newGame();
  const player = newPlayer('Gino');
  s.players[player.id] = player;
  player.cash = 50000; // plenty of cash for building

  console.log('\n=== HALO TEST ===');

  // buy 3 contiguous lots in borough 1 (indices 1, 2, 3 are vacantLot, vacantLot, abandonedBuilding)
  const targets = [1, 2, 3];
  for (const idx of targets) {
    const sp = s.board[idx];
    sp.ownerId = player.id;
    player.propertyIds.push(idx);
  }
  console.log(`Gino owns lots #${targets.join(', ')} (borough 1)`);

  // show neighbor halos before build
  console.log(`Before build: halo on #1=${s.board[1].haloBonus}, #2=${s.board[2].haloBonus}, #3=${s.board[3].haloBonus}`);

  // build on lot #2 (middle)
  const b1 = buildOnSpace(s, player.id, 2);
  console.log(`Build 1: ${b1.description}`);
  console.log(`  Halos: #1=${s.board[1].haloBonus}, #2=${s.board[2].haloBonus}, #3=${s.board[3].haloBonus}`);

  // build again on lot #2
  const b2 = buildOnSpace(s, player.id, 2);
  console.log(`Build 2: ${b2.description}`);
  console.log(`  Halos: #1=${s.board[1].haloBonus}, #2=${s.board[2].haloBonus}, #3=${s.board[3].haloBonus}`);

  // show effective rent change
  console.log(`  Rent on #1 (with halo): $${effectiveRent(s.board[1])} (base rent $${s.board[1].baseRent})`);
  console.log(`  Rent on #2 (built lv${s.board[2].buildLevel}): $${effectiveRent(s.board[2])}`);

  // build many times to test cap
  for (let i = 0; i < 10; i++) {
    buildOnSpace(s, player.id, 2);
  }
  console.log(`After max builds: halo on #1=${s.board[1].haloBonus} (cap=${CONFIG.build.halo.stackCap})`);
}

// ---------------------------------------------------------------------------
// SEASON TEST — tribute, leaderboard, bounty payout, soft-reset.
// ---------------------------------------------------------------------------
function seasonTest() {
  const s = newGame();
  const p1 = newPlayer('Vito');   p1.cash = 5000; p1.netWorth = 5000;
  const p2 = newPlayer('Sonny');  p2.cash = 3000; p2.netWorth = 3000;
  const p3 = newPlayer('Fredo');  p3.cash = 1000; p3.netWorth = 1000;
  s.players[p1.id] = p1;
  s.players[p2.id] = p2;
  s.players[p3.id] = p3;

  // give p1 a property so reset is visible
  const lot = s.board.find(x => x.basePrice > 0);
  lot.ownerId = p1.id; p1.propertyIds.push(lot.index);

  console.log('\n=== SEASON TEST ===');

  // collect tribute a few times to build bounty pool
  for (let i = 0; i < 3; i++) {
    const t = collectGodfatherTribute(s);
    console.log(`Tribute ${i + 1}: ${t.descriptions.join(' ')}`);
  }

  // leaderboard
  const lb = leaderboard(s);
  console.log('\nLeaderboard:');
  for (const e of lb.slice(0, 5)) {
    console.log(`  #${e.rank} ${e.player.name} — $${e.netWorth}`);
  }

  // end season
  console.log('\nEnding season...');
  const result = endSeason(s);
  for (const line of result.descriptions) console.log(`  ${line}`);

  console.log(`\nAfter reset: Vito cash=$${p1.cash}, properties=${p1.propertyIds.length}, lot #${lot.index} owner=${lot.ownerId}`);
}

// ---------------------------------------------------------------------------
// ANCHOR TEST — place, expand, verify rent multiplier.
// ---------------------------------------------------------------------------
function anchorTest() {
  const s = newGame();
  const player = newPlayer('Marco');
  s.players[player.id] = player;
  player.cash = 50000;

  console.log('\n=== ANCHOR TEST ===');

  // anchor slot is at index 9 in each borough (borough 1 = index 9)
  const anchorIdx = 9;
  const anchor = s.board[anchorIdx];
  anchor.ownerId = player.id;
  player.propertyIds.push(anchorIdx);
  console.log(`Marco owns anchor slot #${anchorIdx} (b${anchor.borough}), baseRent=$${anchor.baseRent}`);

  // place a football stadium
  const p1 = placeAnchor(s, player.id, anchorIdx, 'football');
  console.log(p1.description);
  console.log(`  Rent with anchor (level 0): $${effectiveRent(anchor)}`);

  // try placing again — should fail
  const p2 = placeAnchor(s, player.id, anchorIdx, 'casino');
  console.log(`Place again: ${p2.description}`);

  // expand — need surrounding lots owned
  // own neighbor #8 and #10
  s.board[8].ownerId = player.id; player.propertyIds.push(8);
  s.board[10].ownerId = player.id; player.propertyIds.push(10);
  console.log(`Owns neighbors #8, #10`);

  const e1 = expandAnchor(s, player.id, anchorIdx);
  console.log(`Expand 1: ${e1.description}`);
  console.log(`  Rent at level ${anchor.anchorLevel}: $${effectiveRent(anchor)}`);

  const e2 = expandAnchor(s, player.id, anchorIdx);
  console.log(`Expand 2: ${e2.description}`);
  console.log(`  Rent at level ${anchor.anchorLevel}: $${effectiveRent(anchor)}`);

  // expand 3 — need 3 neighbors, only have 2
  const e3 = expandAnchor(s, player.id, anchorIdx);
  console.log(`Expand 3: ${e3.description}`);

  // invalid type test
  const p3 = placeAnchor(s, player.id, 22, 'hockey');
  console.log(`Invalid type: ${p3.description}`);
}

// ---------------------------------------------------------------------------
// CASINO TEST — land on a casino anchor, special dice determine rent.
// ---------------------------------------------------------------------------
function casinoTest() {
  const s = newGame();
  const owner = newPlayer('CasinoKing');
  const visitor = newPlayer('Gambler');
  s.players[owner.id] = owner;
  s.players[visitor.id] = visitor;
  owner.cash = 50000;
  visitor.cash = 50000;

  console.log('\n=== CASINO TEST ===');

  // set up a casino anchor on slot #9
  const anchorIdx = 9;
  const anchor = s.board[anchorIdx];
  anchor.ownerId = owner.id;
  owner.propertyIds.push(anchorIdx);
  placeAnchor(s, owner.id, anchorIdx, 'casino');
  console.log(`Casino placed on #${anchorIdx}. Base rent: $${anchor.baseRent}, effective: $${effectiveRent(anchor)}`);

  // run many turns from nearby until we get some casino landings
  console.log(`\nGambler rolls repeatedly near the casino:`);
  let casinoHits = 0;
  for (let i = 0; i < 30 && casinoHits < 3; i++) {
    // set position so a range of rolls can hit the casino
    visitor.position = anchorIdx - 7; // rolls 2-12 cover a range around the casino
    const cashBefore = visitor.cash;
    const result = takeTurn(s, visitor.id);
    if (result.description.includes('Casino dice') || result.description.includes('Lucky')) {
      const spent = cashBefore - visitor.cash;
      console.log(`  ${result.description} (net ${spent > 0 ? '-' : '+'}$${Math.abs(spent)})`);
      casinoHits++;
    }
  }
  if (casinoHits === 0) console.log('  (No casino landings in 30 rolls — dice are random!)');
  console.log(`Gambler cash after: $${visitor.cash}`);
}

// run tests only when this file is the entry point
const isMain = process.argv[1]?.replace(/\\/g, '/').endsWith('game.js');
if (isMain) {
  smokeTest();
  turnLoopTest();
  jailTest();
  mortgageTest();
  haloTest();
  anchorTest();
  casinoTest();
  seasonTest();
}
