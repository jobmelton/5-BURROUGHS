// ===========================================================================
// 5 BOROUGHS ON THE TAKE — play.js
// Interactive terminal game. Human vs bots around the 5-borough loop.
// Run: node play.js
// ===========================================================================
import * as readline from 'node:readline';
import { CONFIG } from './gameConfig.js';
import { newGame, newPlayer, recomputeNetWorth } from './game.js';
import { takeTurn, rollDice, sendToJail } from './turns.js';
import { buildOnSpace, effectiveRent, canBuild, buildCost, placeAnchor } from './economy.js';
import { botAI } from './bots.js';
import { mortgageProperty, processPaydayDebts, isMortgaged } from './mortgages.js';
import { playHit, playRICO, playInformant, playPardon } from './actions.js';
import { drawFrom } from './decks.js';
import { leaderboard, collectGodfatherTribute } from './season.js';

// ---- setup -----------------------------------------------------------------
const state = newGame();
const human = newPlayer('You');
state.players[human.id] = human;

// give bots some starting properties so the board isn't empty
Object.values(state.players).forEach(b => {
  if (!b.isBot) return;
  for (let i = 0; i < 2; i++) {
    const lot = state.board.find(x => x.basePrice > 0 && x.ownerId === null);
    if (lot) { lot.ownerId = b.id; b.propertyIds.push(lot.index); recomputeNetWorth(state, b); }
  }
});

let turnNumber = 0;
let pendingBuy = null;  // space the player just landed on and can buy

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

function prompt() { rl.question('\n> ', handleInput); }

function print(msg) { console.log(msg); }

// ---- display helpers -------------------------------------------------------

function showStatus() {
  recomputeNetWorth(state, human);
  print(`\n--- ${human.name} | Turn ${turnNumber} ---`);
  print(`Cash: $${human.cash}  |  Net worth: $${human.netWorth}  |  Position: #${human.position}`);
  print(`Properties: ${human.propertyIds.length}  |  Roles: ${human.roles.map(r => r.role).join(', ') || 'none'}`);
  if (human.debts.length) print(`Debts: ${human.debts.map(d => `$${d.principalRemaining}`).join(', ')}`);
  if (human.status.jailed) print(`** IN JAIL (${human.status.jailTurns} turns left) **`);
}

function showBoard() {
  print('\n--- BOARD (your properties marked with *) ---');
  const borough = {};
  for (const sp of state.board) {
    if (!borough[sp.borough]) borough[sp.borough] = [];
    borough[sp.borough].push(sp);
  }
  for (const [b, spaces] of Object.entries(borough)) {
    const line = spaces.map(sp => {
      const owned = sp.ownerId === human.id ? '*' : sp.ownerId ? 'o' : '.';
      const mort = sp.buildLevel < 0 ? 'M' : '';
      if (sp.type === 'payday') return 'PAY';
      if (sp.type === 'career') return 'CAR';
      if (sp.type === 'jail') return 'JAL';
      return `${owned}${mort}${sp.index}`;
    }).join(' ');
    print(`  Borough ${b}: ${line}`);
  }
  print('  Legend: * = yours, o = owned, . = unowned, M = mortgaged');
}

function showLeaderboard() {
  const lb = leaderboard(state);
  print('\n--- LEADERBOARD ---');
  for (const e of lb.slice(0, 10)) {
    const tag = e.player.id === human.id ? ' (you)' : '';
    print(`  #${e.rank} ${e.player.name}${tag} — $${e.netWorth}`);
  }
}

function showHelp() {
  print(`
Commands:
  roll        — Roll dice and take your turn
  buy         — Buy the property you landed on (if available)
  pass        — Skip buying
  build <#>   — Build on property # (must own, meet contiguity)
  mortgage <#>— Mortgage property # for cash
  hit <name>  — Play Hit card on a player
  rico <name> — Play RICO card on a player
  inform <name> — Play Informant on a player
  pardon <name> — Play Pardon on a player
  status      — Show your stats
  board       — Show the board
  scores      — Show leaderboard
  help        — Show this help
  quit        — Exit the game`);
}

// ---- bot turn --------------------------------------------------------------

function botTurn(bot) {
  const result = takeTurn(state, bot.id);
  recomputeNetWorth(state, bot);
  botAI(state, bot.id);
  recomputeNetWorth(state, bot);
}

function runBotTurns() {
  for (const p of Object.values(state.players)) {
    if (p.isBot && !p.status.jailed) {
      botTurn(p);
    } else if (p.isBot && p.status.jailed) {
      // jailed bots just take turn (handles countdown)
      takeTurn(state, p.id);
    }
  }
}

// ---- payday processing (tribute + debt) ------------------------------------

function processPayday() {
  collectGodfatherTribute(state);
  if (human.debts.length > 0) {
    const result = processPaydayDebts(state, human);
    for (const d of result.descriptions) print(`  Debt: ${d}`);
  }
}

// ---- input handling --------------------------------------------------------

function findPlayer(name) {
  const lower = name.toLowerCase();
  return Object.values(state.players).find(p =>
    p.name.toLowerCase().includes(lower) && p.id !== human.id);
}

function handleInput(input) {
  const parts = input.trim().split(/\s+/);
  const cmd = parts[0]?.toLowerCase();
  const arg = parts.slice(1).join(' ');

  switch (cmd) {
    case 'roll': {
      if (pendingBuy) {
        print('You haven\'t decided on the property yet. Type "buy" or "pass".');
        break;
      }
      turnNumber++;

      // human turn
      const result = takeTurn(state, human.id);
      print(`\n** Turn ${turnNumber}: ${result.description}`);
      recomputeNetWorth(state, human);

      // check if landed on buyable unowned space (takeTurn auto-buys if affordable;
      // let's see if it was bought)
      const space = state.board[human.position];
      const isProperty = space.type === 'vacantLot' || space.type === 'anchorSlot' || space.type.startsWith('abandoned');

      // process payday debts if we passed start
      if (result.description.includes('Payday!')) processPayday();

      // bots play after human
      runBotTurns();
      showStatus();
      break;
    }

    case 'buy': {
      print('Properties are auto-purchased when you can afford them on landing.');
      break;
    }

    case 'pass': {
      pendingBuy = null;
      print('Noted.');
      break;
    }

    case 'build': {
      const idx = parseInt(arg);
      if (isNaN(idx)) { print('Usage: build <space#>'); break; }
      const result = buildOnSpace(state, human.id, idx);
      print(result.description);
      recomputeNetWorth(state, human);
      break;
    }

    case 'mortgage': {
      const idx = parseInt(arg);
      if (isNaN(idx)) { print('Usage: mortgage <space#>'); break; }
      const result = mortgageProperty(state, human.id, idx);
      print(result.description);
      break;
    }

    case 'hit': {
      const target = findPlayer(arg);
      if (!target) { print(`No player found matching "${arg}".`); break; }
      const result = playHit(state, human.id, target.id);
      print(result.description);
      break;
    }

    case 'rico': {
      const target = findPlayer(arg);
      if (!target) { print(`No player found matching "${arg}".`); break; }
      const result = playRICO(state, human.id, target.id);
      print(result.description);
      break;
    }

    case 'inform': {
      const target = findPlayer(arg);
      if (!target) { print(`No player found matching "${arg}".`); break; }
      const result = playInformant(state, human.id, target.id);
      print(result.description);
      break;
    }

    case 'pardon': {
      const target = findPlayer(arg);
      if (!target) { print(`No player found matching "${arg}".`); break; }
      const result = playPardon(state, human.id, target.id);
      print(result.description);
      break;
    }

    case 'status': showStatus(); break;
    case 'board':  showBoard();  break;
    case 'scores': showLeaderboard(); break;
    case 'help':   showHelp();   break;

    case 'quit':
    case 'exit':
      print('Game over.');
      rl.close();
      process.exit(0);

    default:
      print(`Unknown command: "${cmd}". Type "help" for commands.`);
  }

  prompt();
}

// ---- start -----------------------------------------------------------------
print('=== 5 BOROUGHS ON THE TAKE ===');
print(`Board: ${state.board.length} spaces | ${Object.values(state.players).filter(p => p.isBot).length} bots`);
print('Type "help" for commands, "roll" to start playing.\n');
showStatus();
prompt();
