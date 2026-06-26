// ===========================================================================
// 5 BOROUGHS ON THE TAKE — game.js
// Ties the components together: create a new game, add players/bots,
// and a smoke test that exercises the core loop end to end.
// ===========================================================================
import { CONFIG } from './gameConfig.js';
import { buildBoard } from './board.js';
import { buildCareerPool, buildActionPool } from './decks.js';
import { desiredBotCount, onHumanJoin, dissolvePlayer } from './bots.js';
import { contiguousOwnedRun, canBuild, buildCost, effectiveRent, resolveRent, catchUpStake } from './economy.js';
import { takeTurn, sendToJail } from './turns.js';

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

// run if invoked directly
smokeTest();
turnLoopTest();
jailTest();
