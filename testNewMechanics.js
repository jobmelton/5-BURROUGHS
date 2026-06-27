// ===========================================================================
// 5 BOROUGHS ON THE TAKE — testNewMechanics.js
// Comprehensive test for all new systems: notifications, partnerships,
// lending, property flow, rent flow, dormant cards, roles, tax, map, menu.
// ===========================================================================
import { newGame, newPlayer } from './game.js';
import { createNotification, getPlayerNotifications, respondToNotification, tickNotifications, broadcastNotification, allOtherPlayerIds, NOTIF_TYPES } from './notifications.js';
import { proposePartnership, acceptPartnership, splitRent, splitCost, proposeBuyout, executeBuyout, distressedBuyout } from './partnerships.js';
import { requestBankLoan, offerBankRate, requestMobLoan, offerMobTerms, acceptLoan, processLoanPaymentsOnGo, applyRentToMobDebt, findBanker, findBoss } from './lending.js';
import { getPropertyOptions, executePropertyAction, acceptFlip } from './propertyFlow.js';
import { getCantPayOptions, startAuction, submitAuctionBid, closeAuction, acceptMobDeal } from './rentFlow.js';
import { makeDormant, activateDormant, seizeDormantCard, getSeizeableDormantCards } from './dormant.js';
import { bossHasRICOImmunity, bossIsJailImmune, calculateCapoSkim, calculateBail, calculateJailSentence, copIsVulnerable, processTaxSquare, calculateCasinoCut, hireInspectorForViolation, requestLawyer, offerJudgeBribe, acceptJudgeBribe, laborBossBlockConstruction, setCopProtection } from './roles.js';
import { getTurnActions, formatActionMenu } from './actionMenu.js';
import { renderBoardMap, renderLotDetail } from './boardMap.js';
import { buildBoard } from './board.js';

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failed++;
    console.log(`  ✗ ${name}: ${e.message}`);
  }
}
function assert(condition, msg) { if (!condition) throw new Error(msg || 'assertion failed'); }

// ---- setup ----------------------------------------------------------------
function freshGame() {
  const s = newGame();
  s.notifications = [];
  s._turnNumber = 1;
  return s;
}

// ===========================================================================
console.log('\n=== NEW MECHANICS TEST SUITE ===\n');

// ---- Board ----
console.log('Board:');
test('Board has 90 spaces (5 boroughs x 18)', () => {
  const board = buildBoard();
  assert(board.length === 90, `Got ${board.length}`);
});
test('Each borough has pit entrances (jail/tax/free-parking converted)', () => {
  const board = buildBoard();
  for (let b = 1; b <= 5; b++) {
    assert(board.some(sp => sp.borough === b && sp.type === 'pitEntry'), `No pitEntry in borough ${b}`);
  }
  for (const t of ['tax', 'jail', 'freeParking']) {
    assert(!board.some(sp => sp.type === t), `outer board still has ${t}`);
  }
});

// ---- Notifications ----
console.log('\nNotifications:');
test('Create and retrieve notification', () => {
  const s = freshGame();
  const p1 = newPlayer('A'); s.players[p1.id] = p1;
  const p2 = newPlayer('B'); s.players[p2.id] = p2;
  createNotification(s, { type: 'info', fromId: p1.id, toId: p2.id, message: 'test' });
  assert(getPlayerNotifications(s, p2.id).length === 1);
});
test('Notifications expire after ticks', () => {
  const s = freshGame();
  const p1 = newPlayer('A'); s.players[p1.id] = p1;
  createNotification(s, { type: 'info', fromId: 'SYS', toId: p1.id, message: 'test', expiresInTurns: 2 });
  tickNotifications(s);
  assert(getPlayerNotifications(s, p1.id).length === 1);
  tickNotifications(s);
  assert(getPlayerNotifications(s, p1.id).length === 0);
});
test('Broadcast sends to all players', () => {
  const s = freshGame();
  const p1 = newPlayer('A'); s.players[p1.id] = p1;
  const p2 = newPlayer('B'); s.players[p2.id] = p2;
  const p3 = newPlayer('C'); s.players[p3.id] = p3;
  broadcastNotification(s, { type: 'info', fromId: p1.id, toIds: [p2.id, p3.id], message: 'hi' });
  assert(getPlayerNotifications(s, p2.id).length === 1);
  assert(getPlayerNotifications(s, p3.id).length === 1);
});

// ---- Partnerships ----
console.log('\nPartnerships:');
test('Propose and accept partnership', () => {
  const s = freshGame();
  const p1 = newPlayer('A'); s.players[p1.id] = p1; p1.cash = 5000;
  const p2 = newPlayer('B'); s.players[p2.id] = p2; p2.cash = 5000;
  const r = proposePartnership(s, p1.id, 29, 75);
  assert(r.ok);
  const notif = s.notifications.find(n => n.toId === p2.id && n.type === NOTIF_TYPES.PARTNER_OFFER);
  const acc = acceptPartnership(s, p2.id, notif.id);
  assert(acc.ok);
  assert(s.board[29].partnership !== null);
  assert(s.board[29].partnership.ownerSplit === 75);
});
test('Rent splits correctly', () => {
  const space = { partnership: { ownerSplit: 60, partnerSplit: 40 } };
  const { ownerShare, partnerShare } = splitRent(space, 100);
  assert(ownerShare === 60);
  assert(partnerShare === 40);
});

// ---- Lending ----
console.log('\nLending:');
test('Bank loan flow', () => {
  const s = freshGame();
  const borrower = newPlayer('Tony'); s.players[borrower.id] = borrower;
  const banker = newPlayer('Bank'); s.players[banker.id] = banker;
  banker.roles.push({ id: 'b1', role: 'Banker', borough: 1, ownedById: banker.id });
  banker.cash = 10000;
  requestBankLoan(s, borrower.id, 500, 1);
  offerBankRate(s, banker.id, borrower.id, 0.10, 500, 1);
  const notif = s.notifications.find(n => n.type === NOTIF_TYPES.LOAN_RATE_OFFER);
  const r = acceptLoan(s, notif.id);
  assert(r.ok);
  assert(borrower.cash === 2000); // 1500 + 500
  assert(borrower.debts.length === 1);
  assert(borrower.debts[0].loanType === 'bank');
});
test('Mob loan flips roles dirty', () => {
  const s = freshGame();
  const borrower = newPlayer('Tony'); s.players[borrower.id] = borrower;
  borrower.roles.push({ id: 'cop1', role: 'Cop', borough: 1, ownedById: borrower.id, clean: true });
  const boss = newPlayer('Don'); s.players[boss.id] = boss;
  boss.roles.push({ id: 'boss1', role: 'Boss', borough: 1, ownedById: boss.id });
  requestMobLoan(s, borrower.id, 300, 1);
  offerMobTerms(s, boss.id, borrower.id, 0.15, 300, 1);
  const notif = s.notifications.find(n => n.type === NOTIF_TYPES.MOB_LOAN_TERMS);
  acceptLoan(s, notif.id);
  assert(borrower.status.hasMobDebt === true);
  assert(borrower.roles[0].clean === false, 'Cop should be dirty');
});
test('Mob debt blocks bank loans', () => {
  const s = freshGame();
  const borrower = newPlayer('Tony'); s.players[borrower.id] = borrower;
  borrower.status.hasMobDebt = true;
  const banker = newPlayer('Bank'); s.players[banker.id] = banker;
  banker.roles.push({ id: 'b1', role: 'Banker', borough: 1, ownedById: banker.id });
  const r = requestBankLoan(s, borrower.id, 100, 1);
  assert(!r.ok, 'Should be blocked');
});

// ---- Property flow ----
console.log('\nProperty Flow:');
test('Buy option available when can afford', () => {
  const s = freshGame();
  const p = newPlayer('A'); s.players[p.id] = p; p.cash = 5000;
  const opts = getPropertyOptions(s, p.id, 29);
  assert(opts.find(o => o.action === 'buy').available);
});
test('Borrow options appear when broke', () => {
  const s = freshGame();
  const p = newPlayer('A'); s.players[p.id] = p; p.cash = 10;
  const banker = newPlayer('Bank'); s.players[banker.id] = banker;
  banker.roles.push({ id: 'b1', role: 'Banker', borough: 3, ownedById: banker.id });
  const opts = getPropertyOptions(s, p.id, 29);
  assert(!opts.find(o => o.action === 'buy').available);
  assert(opts.find(o => o.action === 'borrow_bank'));
});
test('Flip broadcasts to all players', () => {
  const s = freshGame();
  const p1 = newPlayer('A'); s.players[p1.id] = p1;
  const p2 = newPlayer('B'); s.players[p2.id] = p2;
  executePropertyAction(s, p1.id, 29, 'flip', { askingPrice: 300 });
  assert(s.notifications.some(n => n.type === NOTIF_TYPES.FLIP_OFFER));
});

// ---- Rent flow ----
console.log('\nRent Flow:');
test('Cant-pay options include mortgage, auction, mob deal', () => {
  const s = freshGame();
  const p = newPlayer('Broke'); s.players[p.id] = p; p.cash = 10;
  s.board[1].ownerId = p.id; p.propertyIds.push(1);
  const boss = newPlayer('Don'); s.players[boss.id] = boss;
  boss.roles.push({ id: 'b1', role: 'Boss', borough: 1, ownedById: boss.id });
  const opts = getCantPayOptions(s, p.id, 200, 5);
  assert(opts.some(o => o.action === 'mortgage'));
  assert(opts.some(o => o.action === 'auction'));
  assert(opts.some(o => o.action === 'mob_deal'));
});
test('Mob deal makes player owned', () => {
  const s = freshGame();
  const p = newPlayer('Broke'); s.players[p.id] = p;
  const boss = newPlayer('Don'); s.players[boss.id] = boss;
  const landlord = newPlayer('Owner'); s.players[landlord.id] = landlord;
  const r = acceptMobDeal(s, p.id, boss.id, 200, landlord.id);
  assert(r.ok);
  assert(p.status.ownedByBossId === boss.id);
});

// ---- Dormant cards ----
console.log('\nDormant Cards:');
test('Make card dormant and activate', () => {
  const s = freshGame();
  const p = newPlayer('A'); s.players[p.id] = p;
  p.roles.push({ id: 'c1', role: 'Capo', borough: 1 });
  makeDormant(s, p.id, 'c1');
  assert(p.roles.length === 0);
  assert(p.dormantRoles.length === 1);
  activateDormant(s, p.id, 'c1');
  assert(p.roles.length === 1);
  assert(p.dormantRoles.length === 0);
});
test('Boss seizes dormant card', () => {
  const s = freshGame();
  const target = newPlayer('Cop'); s.players[target.id] = target;
  target.dormantRoles = [{ id: 'c1', role: 'Boss', borough: 1 }];
  const boss = newPlayer('Don'); s.players[boss.id] = boss;
  boss.roles.push({ id: 'b1', role: 'Boss', borough: 2 });
  const r = seizeDormantCard(s, boss.id, target.id, 'c1');
  assert(r.ok);
  assert(boss.roles.length === 2);
});

// ---- Roles ----
console.log('\nRoles:');
test('Boss RICO immunity with Lawyer+Judge', () => {
  const s = freshGame();
  const boss = newPlayer('Don'); s.players[boss.id] = boss;
  boss.roles.push({ id: 'b1', role: 'Boss', borough: 1 });
  const lawyer = newPlayer('Saul'); s.players[lawyer.id] = lawyer;
  lawyer.roles.push({ id: 'l1', role: 'Lawyer', borough: 1 });
  lawyer.status.ownedByBossId = boss.id;
  const judge = newPlayer('J'); s.players[judge.id] = judge;
  judge.roles.push({ id: 'j1', role: 'Judge', borough: 1 });
  judge.status.ownedByBossId = boss.id;
  assert(bossHasRICOImmunity(s, boss.id));
});
test('Boss jail immunity with owned Cop', () => {
  const s = freshGame();
  const boss = newPlayer('Don'); s.players[boss.id] = boss;
  boss.roles.push({ id: 'b1', role: 'Boss', borough: 1 });
  assert(!bossIsJailImmune(s, boss.id));
  const cop = newPlayer('Cop'); s.players[cop.id] = cop;
  cop.roles.push({ id: 'c1', role: 'Cop', borough: 1 });
  cop.status.ownedByBossId = boss.id;
  assert(bossIsJailImmune(s, boss.id));
});
test('Capo skim 10% under boss, 5% freelance', () => {
  const s = freshGame();
  const capo = newPlayer('Capo'); s.players[capo.id] = capo;
  capo.roles.push({ id: 'c1', role: 'Capo', borough: 1 });
  // freelance
  let skim = calculateCapoSkim(s, 1, 1000);
  assert(skim.capoAmount === 50 && !skim.isUnderBoss);
  // under boss
  const boss = newPlayer('Don'); s.players[boss.id] = boss;
  boss.roles.push({ id: 'b1', role: 'Boss', borough: 1 });
  capo.status.ownedByBossId = boss.id;
  skim = calculateCapoSkim(s, 1, 1000);
  assert(skim.capoAmount === 50 && skim.bossKickup === 50 && skim.isUnderBoss);
});
test('Boss/Capo get 2x bail unless Judge', () => {
  const s = freshGame();
  const boss = newPlayer('Don'); s.players[boss.id] = boss;
  boss.roles.push({ id: 'b1', role: 'Boss', borough: 1 });
  const bail = calculateBail(s, boss.id, 1);
  assert(bail.amount === 200, `Expected 200, got ${bail.amount}`);
});
test('Tax square taxes borough assets', () => {
  const s = freshGame();
  const p = newPlayer('Rich'); s.players[p.id] = p; p.cash = 5000;
  const pol = newPlayer('Pol'); s.players[pol.id] = pol;
  pol.roles.push({ id: 'p1', role: 'Politician', borough: 1 });
  s.board[1].ownerId = p.id; p.propertyIds.push(1);
  const r = processTaxSquare(s, p.id, 1);
  assert(r.taxAmount > 0);
});
test('Casino manager gets 10% cut', () => {
  const s = freshGame();
  const mgr = newPlayer('Mgr'); s.players[mgr.id] = mgr;
  mgr.roles.push({ id: 'cm1', role: 'CasinoManager', borough: 1 });
  const prevCash = mgr.cash;
  calculateCasinoCut(s, 1, 500);
  assert(mgr.cash === prevCash + 50);
});
test('Judge bribe flips dirty', () => {
  const s = freshGame();
  const briber = newPlayer('Don'); s.players[briber.id] = briber; briber.cash = 5000;
  const judge = newPlayer('Judge'); s.players[judge.id] = judge;
  judge.roles.push({ id: 'j1', role: 'Judge', borough: 1, clean: true });
  offerJudgeBribe(s, briber.id, judge.id, 200);
  const notif = s.notifications.find(n => n.type === NOTIF_TYPES.JUDGE_BRIBE);
  acceptJudgeBribe(s, notif.id);
  assert(judge.roles[0].clean === false);
});

// ---- Action Menu ----
console.log('\nAction Menu:');
test('Menu shows context-dependent options', () => {
  const s = freshGame();
  const p = newPlayer('Boss'); s.players[p.id] = p;
  p.roles.push({ id: 'b1', role: 'Boss', borough: 1 });
  p.hand.push({ id: 'h1', type: 'Hit' });
  s.board[1].ownerId = p.id; p.propertyIds.push(1);
  const actions = getTurnActions(s, p.id);
  assert(actions.some(a => a.action === 'roll'));
  assert(actions.some(a => a.action === 'build'));
  assert(actions.some(a => a.action === 'play_card'));
  assert(actions.some(a => a.action === 'contact_cross_borough'));
});

// ---- Board Map ----
console.log('\nBoard Map:');
test('Map renders without errors', () => {
  const s = freshGame();
  const p = newPlayer('V'); s.players[p.id] = p;
  const map = renderBoardMap(s, p.id);
  assert(map.includes('Borough 1'));
  assert(map.includes('Borough 5'));
});
test('Lot detail renders', () => {
  const s = freshGame();
  const detail = renderLotDetail(s, 5);
  assert(detail.includes('Lot #5'));
});

// ---- Summary ----
console.log(`\n=== RESULTS: ${passed} passed, ${failed} failed ===`);
if (failed === 0) console.log('ALL NEW MECHANICS TESTS PASS\n');
else process.exit(1);
