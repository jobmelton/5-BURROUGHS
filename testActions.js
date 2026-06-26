// ===========================================================================
// 5 BOROUGHS ON THE TAKE — testActions.js
// Exercises every action card effect and prints what happened.
// ===========================================================================
import { CONFIG } from './gameConfig.js';
import { newGame, newPlayer } from './game.js';
import {
  playHit, playRICO, playInformant, playPardon,
  playExpose, playAccountant, playAudit, playElection, playStrike, playJackpot,
} from './actions.js';

function heading(title) { console.log(`\n--- ${title} ---`); }

function actionTest() {
  console.log('=== ACTION CARD EFFECTS TEST ===');

  // --- shared setup ---------------------------------------------------------
  const s = newGame();

  const mobster  = newPlayer('Vinnie');
  const rival    = newPlayer('Carmine');
  const lawman   = newPlayer('Det. Santos');
  const pawn     = newPlayer('Frankie');
  s.players[mobster.id]  = mobster;
  s.players[rival.id]    = rival;
  s.players[lawman.id]   = lawman;
  s.players[pawn.id]     = pawn;

  // give Carmine (the rival boss) plenty of roles so he's RICO-eligible
  rival.roles.push(
    { id: 'c-boss',  role: 'Boss',       borough: 1, ownedById: rival.id, clean: undefined },
    { id: 'c-capo',  role: 'Capo',       borough: 1, ownedById: rival.id, clean: undefined },
    { id: 'c-bank',  role: 'Banker',     borough: 1, ownedById: rival.id, clean: undefined },
    { id: 'c-insp',  role: 'Inspector',  borough: 2, ownedById: rival.id, clean: undefined },
  );

  // give the lawman a clean Cop
  lawman.roles.push(
    { id: 'l-cop', role: 'Cop', borough: 1, ownedById: lawman.id, clean: true },
  );

  // Frankie is mob-owned by Carmine
  pawn.status.ownedByBossId = rival.id;

  // =========================================================================
  // 1. RICO — success
  // =========================================================================
  heading(`RICO — Det. Santos vs Carmine (${rival.roles.length} roles, need ${CONFIG.actions.rico.minRolesToTarget}+)`);
  const rico1 = playRICO(s, lawman.id, rival.id);
  console.log(rico1.description);
  console.log(`  Carmine jailed: ${rival.status.jailed}, turns: ${rival.status.jailTurns}`);
  console.log(`  Cop still clean? ${lawman.roles.find(r => r.role === 'Cop')?.clean}`);

  // =========================================================================
  // 2. RICO — fail (cop tainted)
  // =========================================================================
  heading('RICO — fail (cop no longer clean)');
  console.log(playRICO(s, lawman.id, rival.id).description);

  // =========================================================================
  // 3. RICO — fail (target not a Boss)
  // =========================================================================
  heading('RICO — fail (target not a Boss)');
  lawman.roles.push({ id: 'l-judge', role: 'Judge', borough: 2, ownedById: lawman.id, clean: true });
  console.log(playRICO(s, lawman.id, pawn.id).description);

  // =========================================================================
  // 4. PARDON — success
  // =========================================================================
  heading('PARDON — Vinnie pardons Carmine');
  console.log(`  Before: jailed=${rival.status.jailed}, jailTurns=${rival.status.jailTurns}`);
  const par1 = playPardon(s, mobster.id, rival.id);
  console.log(par1.description);
  console.log(`  After:  jailed=${rival.status.jailed}, jailTurns=${rival.status.jailTurns}`);

  // =========================================================================
  // 5. PARDON — fail (already free)
  // =========================================================================
  heading('PARDON — fail (already free)');
  console.log(playPardon(s, mobster.id, rival.id).description);

  // =========================================================================
  // 6. HIT — success
  // =========================================================================
  heading('HIT — Vinnie hits Carmine (unprotected)');
  console.log(`  Carmine's roles before: ${rival.roles.map(r => r.role).join(', ')}`);
  const hit1 = playHit(s, mobster.id, rival.id);
  console.log(hit1.description);
  console.log(`  Vinnie's roles: ${mobster.roles.map(r => r.role).join(', ')}`);
  console.log(`  Carmine's roles: ${rival.roles.map(r => r.role).join(', ')}`);

  // =========================================================================
  // 7. HIT — blocked by protection
  // =========================================================================
  heading('HIT — blocked by protection');
  rival.status.protectedByCopId = lawman.id;
  console.log(playHit(s, mobster.id, rival.id).description);
  rival.status.protectedByCopId = null;

  // =========================================================================
  // 8. HIT — fail (no roles)
  // =========================================================================
  heading('HIT — target has no roles');
  console.log(playHit(s, mobster.id, pawn.id).description);

  // =========================================================================
  // 9. INFORMANT — free from mob + grant protection
  // =========================================================================
  heading('INFORMANT — Vinnie frees Frankie');
  console.log(`  Before: ownedByBoss=${pawn.status.ownedByBossId}, protected=${pawn.status.protectedByCopId}`);
  const inf1 = playInformant(s, mobster.id, pawn.id);
  console.log(inf1.description);
  console.log(`  After:  ownedByBoss=${pawn.status.ownedByBossId}, protected=${pawn.status.protectedByCopId}`);

  // =========================================================================
  // 10. EXPOSE — target pays fine (dirty cop from RICO taint)
  // =========================================================================
  heading('EXPOSE — lawman\'s cop is dirty, Vinnie exposes');
  console.log(`  Cop clean? ${lawman.roles.find(r => r.role === 'Cop')?.clean}, lawman cash: $${lawman.cash}`);
  const exp1 = playExpose(s, mobster.id, lawman.id);
  console.log(exp1.description);
  console.log(`  Cop clean now? ${lawman.roles.find(r => r.role === 'Cop')?.clean}, cash: $${lawman.cash}`);

  // =========================================================================
  // 11. EXPOSE — fail (no dirty officials)
  // =========================================================================
  heading('EXPOSE — fail (no dirty officials)');
  console.log(playExpose(s, mobster.id, lawman.id).description);

  // =========================================================================
  // 12. EXPOSE — target can't afford fine (loses role)
  // =========================================================================
  heading('EXPOSE — target broke, loses role');
  // taint the judge, then empty lawman's cash
  lawman.roles.find(r => r.role === 'Judge').clean = false;
  lawman.cash = 10;
  const exp3 = playExpose(s, mobster.id, lawman.id);
  console.log(exp3.description);
  console.log(`  Lawman roles now: ${lawman.roles.map(r => r.role).join(', ') || 'none'}`);
  lawman.cash = 1500; // restore

  // =========================================================================
  // 13. ACCOUNTANT — skim cash to tax pool
  // =========================================================================
  heading('ACCOUNTANT — skim from Carmine');
  console.log(`  Before: Carmine cash=$${rival.cash}, tax pool=$${s.taxPool}`);
  const acc1 = playAccountant(s, mobster.id, rival.id);
  console.log(acc1.description);
  console.log(`  After:  Carmine cash=$${rival.cash}`);

  // =========================================================================
  // 14. AUDIT — back-taxes on properties
  // =========================================================================
  heading('AUDIT — tax Carmine\'s properties');
  // give Carmine some properties
  const lot1 = s.board.find(x => x.basePrice > 0 && x.ownerId === null);
  const lot2 = s.board.find(x => x.basePrice > 0 && x.ownerId === null && x.index !== lot1.index);
  lot1.ownerId = rival.id; lot2.ownerId = rival.id;
  rival.propertyIds.push(lot1.index, lot2.index);
  console.log(`  Carmine owns ${rival.propertyIds.length} properties, cash=$${rival.cash}`);
  const aud1 = playAudit(s, mobster.id, rival.id);
  console.log(aud1.description);

  // =========================================================================
  // 15. AUDIT — fail (no properties)
  // =========================================================================
  heading('AUDIT — fail (no properties)');
  console.log(playAudit(s, mobster.id, pawn.id).description);

  // =========================================================================
  // 16. ELECTION — take a politician from another player
  // =========================================================================
  heading('ELECTION — Vinnie takes borough 1 Politician');
  // give Carmine the borough 1 politician
  rival.roles.push({ id: 'c-pol', role: 'Politician', borough: 1, ownedById: rival.id, clean: true });
  console.log(`  Carmine's roles: ${rival.roles.map(r => r.role).join(', ')}`);
  const el1 = playElection(s, mobster.id, 1);
  console.log(el1.description);
  console.log(`  Vinnie's roles: ${mobster.roles.map(r => r.role).join(', ')}`);
  console.log(`  Carmine's roles: ${rival.roles.map(r => r.role).join(', ')}`);

  // =========================================================================
  // 17. STRIKE — shut down building in borough 2
  // =========================================================================
  heading('STRIKE — shut down borough 2');
  const str1 = playStrike(s, mobster.id, 2);
  console.log(str1.description);
  console.log(`  Strike state: ${JSON.stringify(s.strikeBoroughs)}`);

  // =========================================================================
  // 18. JACKPOT — collect free parking pool
  // =========================================================================
  heading('JACKPOT — Vinnie hits the jackpot');
  s.freeParkingPool = 500; // seed the pool
  console.log(`  Free parking pool: $${s.freeParkingPool}, Vinnie cash: $${mobster.cash}`);
  const jp1 = playJackpot(s, mobster.id);
  console.log(jp1.description);
  console.log(`  Pool now: $${s.freeParkingPool}, Vinnie cash: $${mobster.cash}`);

  // =========================================================================
  // 19. JACKPOT — fail (pool empty)
  // =========================================================================
  heading('JACKPOT — fail (pool empty)');
  console.log(playJackpot(s, mobster.id).description);

  console.log('\n=== ALL ACTION CARD TESTS COMPLETE ===\n');
}

actionTest();
