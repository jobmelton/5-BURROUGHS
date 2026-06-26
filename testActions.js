// ===========================================================================
// 5 BOROUGHS ON THE TAKE — testActions.js
// Exercises every action card effect (Hit, RICO, Informant, Pardon) and
// prints what happened so you can see the mechanics working.
// ===========================================================================
import { CONFIG } from './gameConfig.js';
import { newGame, newPlayer } from './game.js';
import { playHit, playRICO, playInformant, playPardon } from './actions.js';

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
  // 1. RICO — success (lawman convicts the boss while he still has 4 roles)
  // =========================================================================
  heading(`RICO — Det. Santos vs Carmine (${rival.roles.length} roles, need ${CONFIG.actions.rico.minRolesToTarget}+)`);
  const rico1 = playRICO(s, lawman.id, rival.id);
  console.log(rico1.description);
  console.log(`  Carmine jailed: ${rival.status.jailed}, turns: ${rival.status.jailTurns}`);
  console.log(`  Cop still clean? ${lawman.roles.find(r => r.role === 'Cop')?.clean}`);

  // =========================================================================
  // 2. RICO — fail (no clean official left — cop was tainted by case 1)
  // =========================================================================
  heading('RICO — fail (cop no longer clean)');
  const rico2 = playRICO(s, lawman.id, rival.id);
  console.log(rico2.description);

  // =========================================================================
  // 3. RICO — fail (target is not a Boss)
  // =========================================================================
  heading('RICO — fail (target not a Boss)');
  lawman.roles.push(
    { id: 'l-judge', role: 'Judge', borough: 2, ownedById: lawman.id, clean: true },
  );
  const rico3 = playRICO(s, lawman.id, pawn.id);
  console.log(rico3.description);

  // =========================================================================
  // 4. PARDON — success (free Carmine from jail, where RICO put him)
  // =========================================================================
  heading('PARDON — Vinnie pardons Carmine');
  console.log(`  Before: jailed=${rival.status.jailed}, jailTurns=${rival.status.jailTurns}`);
  const par1 = playPardon(s, mobster.id, rival.id);
  console.log(par1.description);
  console.log(`  After:  jailed=${rival.status.jailed}, jailTurns=${rival.status.jailTurns}`);

  // =========================================================================
  // 5. PARDON — fail (Carmine already free)
  // =========================================================================
  heading('PARDON — fail (Carmine already free)');
  const par2 = playPardon(s, mobster.id, rival.id);
  console.log(par2.description);

  // =========================================================================
  // 6. HIT — success (steal a role from the rival)
  // =========================================================================
  heading('HIT — Vinnie hits Carmine (unprotected)');
  console.log(`  Carmine's roles before: ${rival.roles.map(r => r.role).join(', ')}`);
  const hit1 = playHit(s, mobster.id, rival.id);
  console.log(hit1.description);
  console.log(`  Vinnie's roles: ${mobster.roles.map(r => r.role).join(', ')}`);
  console.log(`  Carmine's roles: ${rival.roles.map(r => r.role).join(', ')}`);

  // =========================================================================
  // 7. HIT — blocked by cop protection
  // =========================================================================
  heading('HIT — blocked by protection');
  rival.status.protectedByCopId = lawman.id;
  const hit2 = playHit(s, mobster.id, rival.id);
  console.log(hit2.description);
  rival.status.protectedByCopId = null;

  // =========================================================================
  // 8. HIT — fail (target has no roles)
  // =========================================================================
  heading('HIT — target has no roles');
  const hit3 = playHit(s, mobster.id, pawn.id);
  console.log(hit3.description);

  // =========================================================================
  // 9. INFORMANT — free Frankie from mob ownership + grant protection
  // =========================================================================
  heading('INFORMANT — Vinnie frees Frankie from Carmine\'s mob');
  console.log(`  Before: ownedByBoss=${pawn.status.ownedByBossId}, protected=${pawn.status.protectedByCopId}`);
  const inf1 = playInformant(s, mobster.id, pawn.id);
  console.log(inf1.description);
  console.log(`  After:  ownedByBoss=${pawn.status.ownedByBossId}, protected=${pawn.status.protectedByCopId}, turns=${pawn.status.informantProtectionTurns}`);

  console.log('\n=== ALL ACTION CARD TESTS COMPLETE ===\n');
}

actionTest();
