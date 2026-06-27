// ===========================================================================
// 5 BOROUGHS ON THE TAKE — testPit.js
// Tests the inner "pit" track: board conversion, pit entry, ring movement,
// luck/demise resolution, and the center jail (reusing the jail economy).
// Run: node testPit.js
// ===========================================================================
import { CONFIG } from './gameConfig.js';
import { buildBoard } from './board.js';
import { newGame, newPlayer } from './game.js';
import { buildPit, moveAndResolve, resolvePitSpace, sendToCenterJail } from './movement.js';
import { calculateBail } from './roles.js';

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { failed++; console.log(`  ✗ ${name}: ${e.message}`); }
}
function assert(c, msg) { if (!c) throw new Error(msg || 'assertion failed'); }

// fresh game with a single controllable human (no reliance on bots)
function freshGame() {
  const s = newGame();
  s.notifications = s.notifications || [];
  const p = newPlayer('You');
  s.players[p.id] = p;
  return { s, p };
}
const roll = (total, doubles = false) => ({ d1: 1, d2: total - 1, total, doubles });

console.log('\n=== PIT TEST SUITE ===\n');

// ---- Ring + board ----
console.log('Ring & board:');
test('Pit ring length matches config', () => {
  const ring = buildPit().ring;
  assert(ring.length === CONFIG.pit.ringLayout.length, `len ${ring.length}`);
});
test('Equal luck vs demise + 5 exits', () => {
  const ring = buildPit().ring;
  const c = k => ring.filter(s => s.kind === k).length;
  const luck = c('luckPark') + c('luckCareer');
  const demise = c('demiseTax') + c('demiseJail');
  assert(c('exit') === 5, `exits ${c('exit')}`);
  assert(luck === demise, `luck ${luck} != demise ${demise}`);
  assert(luck === 5, `luck ${luck}`);
});
test('Outer board has no jail/tax/freeParking, has pitEntry per borough', () => {
  const b = buildBoard();
  assert(b.length === 90, `len ${b.length}`);
  for (const t of ['jail', 'tax', 'freeParking']) {
    assert(!b.some(s => s.type === t), `still has ${t}`);
  }
  for (let bo = 1; bo <= 5; bo++) {
    assert(b.some(s => s.borough === bo && s.type === 'pitEntry'), `no pitEntry in borough ${bo}`);
  }
});

// ---- Entry ----
console.log('Entry:');
test('Landing on pitEntry sets pending, stays on outer track', () => {
  const { s, p } = freshGame();
  const entry = s.board.find(x => x.type === 'pitEntry' && x.index > 5);
  p.position = entry.index - 3;
  const r = moveAndResolve(s, p, roll(3));
  assert(r.done === true, 'should be done (turn ends)');
  assert(p.status.pendingPitEntry === true, 'pendingPitEntry not set');
  assert(p.status.pitEntryBorough === entry.borough, 'borough not recorded');
  assert(p.track === 'outer', `track ${p.track} (should not enter ring yet)`);
});
test('Next roll pulls player into the pit ring', () => {
  const { s, p } = freshGame();
  p.status.pendingPitEntry = true; p.status.pitEntryBorough = 2;
  const r = moveAndResolve(s, p, roll(4));
  assert(p.track === 'pit', `track ${p.track}`);
  assert(p.status.pendingPitEntry === false, 'pending not cleared');
  assert(p.position === (CONFIG.pit.entryRingIndex + 4) % s.pit.ring.length, `pos ${p.position}`);
  assert(r.done === true, 'should be done');
});

// ---- Pit resolution ----
console.log('Pit resolution:');
test('luckPark drains free-parking pool into cash', () => {
  const { s, p } = freshGame();
  s.freeParkingPool = 250; const cash0 = p.cash; const ev = [];
  resolvePitSpace(s, p, { kind: 'luckPark' }, ev);
  assert(p.cash === cash0 + 250, `cash ${p.cash}`);
  assert(s.freeParkingPool === 0, 'pool not drained');
});
test('luckCareer adds a career card', () => {
  const { s, p } = freshGame();
  const n0 = p.roles.length; const ev = [];
  resolvePitSpace(s, p, { kind: 'luckCareer' }, ev);
  assert(p.roles.length === n0 + 1, `roles ${p.roles.length}`);
});
test('demiseTax taxes the player', () => {
  const { s, p } = freshGame();
  p.status.pitEntryBorough = 1;
  const lot = s.board.find(x => x.borough === 1 && x.basePrice > 0);
  lot.ownerId = p.id; p.propertyIds.push(lot.index);
  p.cash = 5000; const cash0 = p.cash; const ev = [];
  resolvePitSpace(s, p, { kind: 'demiseTax' }, ev);
  assert(p.cash < cash0, `cash unchanged ${p.cash}`);
});
test('demiseJail sends to center jail (reuses jail economy)', () => {
  const { s, p } = freshGame();
  p.status.pitEntryBorough = 1; const ev = [];
  resolvePitSpace(s, p, { kind: 'demiseJail' }, ev);
  assert(p.status.jailed === true, 'not jailed');
  assert(p.track === 'jail', `track ${p.track}`);
  assert(p.status.jailTurns > 0, `jailTurns ${p.status.jailTurns}`);
  const bail = calculateBail(s, p.id, 1);
  assert(bail.amount > 0, `bail ${bail.amount}`);
});
test('exit returns player to GO with payday', () => {
  const { s, p } = freshGame();
  p.track = 'pit'; p.position = 7; const cash0 = p.cash; const ev = [];
  resolvePitSpace(s, p, { kind: 'exit' }, ev);
  assert(p.track === 'outer', `track ${p.track}`);
  assert(p.position === 0, `pos ${p.position}`);
  assert(p.cash === cash0 + CONFIG.money.paydayBase, `cash ${p.cash}`);
});

// ---- Center jail ----
console.log('Center jail:');
test('Doubles frees jailed player to GO', () => {
  const { s, p } = freshGame();
  sendToCenterJail(s, p, 1, []);
  const r = moveAndResolve(s, p, roll(6, true));
  assert(p.status.jailed === false, 'still jailed');
  assert(p.track === 'outer' && p.position === 0, `track ${p.track} pos ${p.position}`);
  assert(r.done === true, 'should be done');
});
test('Serving time frees jailed player to GO', () => {
  const { s, p } = freshGame();
  sendToCenterJail(s, p, 1, []);
  p.status.jailTurns = 1;
  const r = moveAndResolve(s, p, roll(5, false));
  assert(p.status.jailed === false, 'still jailed');
  assert(p.track === 'outer' && p.position === 0, 'not released to GO');
});
test('Still-jailed player stays put on a non-doubles roll', () => {
  const { s, p } = freshGame();
  sendToCenterJail(s, p, 1, []);
  p.status.jailTurns = 3;
  moveAndResolve(s, p, roll(5, false));
  assert(p.status.jailed === true, 'should still be jailed');
  assert(p.track === 'jail', `track ${p.track}`);
  assert(p.status.jailTurns === 2, `jailTurns ${p.status.jailTurns}`);
});

console.log(`\n=== RESULTS: ${passed} passed, ${failed} failed ===`);
if (failed > 0) process.exit(1);
