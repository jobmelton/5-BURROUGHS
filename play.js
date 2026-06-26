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
import { playHit, playRICO, playInformant, playPardon, playExpose, playAccountant, playAudit, playJackpot } from './actions.js';
import { drawFrom } from './decks.js';
import { leaderboard, collectGodfatherTribute } from './season.js';
import { saveGame, loadGame, hasSaveFile } from './persistence.js';

// ---- setup -----------------------------------------------------------------
let state;
let human;
let turnNumber = 0;
let pendingBuy = null;
let humanId = null;  // track which player id is the human

// try loading a saved game, otherwise start fresh
const loaded = hasSaveFile() ? loadGame() : { ok: false };
if (loaded.ok) {
  state = loaded.state;
  human = Object.values(state.players).find(p => !p.isBot);
  humanId = human?.id;
  turnNumber = state._turnNumber || 0;
  print('Loaded saved game!');
} else {
  state = newGame();
  human = newPlayer('You');
  state.players[human.id] = human;
  humanId = human.id;

  // give bots some starting properties so the board isn't empty
  Object.values(state.players).forEach(b => {
    if (!b.isBot) return;
    for (let i = 0; i < 2; i++) {
      const lot = state.board.find(x => x.basePrice > 0 && x.ownerId === null);
      if (lot) { lot.ownerId = b.id; b.propertyIds.push(lot.index); recomputeNetWorth(state, b); }
    }
  });
}

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

function prompt() { rl.question('\n> ', handleInput); }

function print(msg) { console.log(msg); }

// ---- ANSI colors -----------------------------------------------------------
const C = {
  reset: '\x1b[0m',
  bold:  '\x1b[1m',
  dim:   '\x1b[2m',
  red:   '\x1b[31m',
  green: '\x1b[32m',
  yellow:'\x1b[33m',
  blue:  '\x1b[34m',
  magenta:'\x1b[35m',
  cyan:  '\x1b[36m',
  white: '\x1b[37m',
  bgRed: '\x1b[41m',
  bgGreen:'\x1b[42m',
  bgYellow:'\x1b[43m',
  bgBlue:'\x1b[44m',
  bgMagenta:'\x1b[45m',
};

const BOROUGH_COLORS = [C.red, C.green, C.yellow, C.blue, C.magenta];
function bColor(borough) { return BOROUGH_COLORS[(borough - 1) % 5]; }

// ---- display helpers -------------------------------------------------------

function showStatus() {
  recomputeNetWorth(state, human);
  print(`\n${C.bold}--- ${human.name} | Turn ${turnNumber} ---${C.reset}`);
  print(`  ${C.green}Cash: $${human.cash}${C.reset}  |  Net worth: ${C.bold}$${human.netWorth}${C.reset}  |  Position: #${human.position}`);
  print(`  Properties: ${C.cyan}${human.propertyIds.length}${C.reset}  |  Roles: ${C.yellow}${human.roles.map(r => r.role).join(', ') || 'none'}${C.reset}`);
  if (human.debts.length) print(`  ${C.red}Debts: ${human.debts.map(d => `$${d.principalRemaining}`).join(', ')}${C.reset}`);
  if (human.status.jailed) print(`  ${C.bgRed}${C.white}${C.bold} IN JAIL (${human.status.jailTurns} turns left) ${C.reset}`);
}

function showBoard() {
  print(`\n${C.bold}--- BOARD ---${C.reset}`);
  const boroughs = {};
  for (const sp of state.board) {
    if (!boroughs[sp.borough]) boroughs[sp.borough] = [];
    boroughs[sp.borough].push(sp);
  }

  for (const [b, spaces] of Object.entries(boroughs)) {
    const bc = bColor(parseInt(b));
    const cells = spaces.map(sp => {
      const isHere = sp.index === human.position;
      const prefix = isHere ? `${C.bold}${C.bgYellow}${C.white}` : '';
      const suffix = isHere ? C.reset : '';

      if (sp.type === 'payday') return `${prefix}${bc}PAY${suffix}${C.reset}`;
      if (sp.type === 'career') return `${prefix}${bc}CAR${suffix}${C.reset}`;
      if (sp.type === 'jail')   return `${prefix}${C.red}JAL${suffix}${C.reset}`;

      let tag;
      if (sp.ownerId === human.id) tag = `${C.bold}${C.cyan}*${sp.index}${C.reset}`;
      else if (sp.ownerId) tag = `${C.dim}o${sp.index}${C.reset}`;
      else tag = `${bc}.${sp.index}${C.reset}`;

      if (sp.buildLevel < 0) tag += `${C.red}M${C.reset}`;
      else if (sp.buildLevel > 0) tag += `${C.green}^${sp.buildLevel}${C.reset}`;
      if (sp.anchorType) tag += `${C.yellow}A${C.reset}`;

      return `${prefix}${tag}${suffix}`;
    }).join(' ');
    print(`  ${bc}${C.bold}B${b}${C.reset}: ${cells}`);
  }
  print(`  ${C.dim}Legend: ${C.cyan}*${C.reset}${C.dim}=yours ${C.reset}${C.dim}o=owned .=free ${C.red}M${C.reset}${C.dim}=mortgaged ${C.green}^N${C.reset}${C.dim}=built ${C.yellow}A${C.reset}${C.dim}=anchor ${C.bgYellow} ${C.reset}${C.dim}=you are here${C.reset}`);
}

function showLeaderboard() {
  const lb = leaderboard(state);
  print(`\n${C.bold}--- LEADERBOARD ---${C.reset}`);
  for (const e of lb.slice(0, 10)) {
    const isYou = e.player.id === human.id;
    const tag = isYou ? ` ${C.cyan}(you)${C.reset}` : '';
    const color = isYou ? C.bold + C.cyan : (e.rank <= 3 ? C.yellow : '');
    print(`  ${color}#${e.rank} ${e.player.name}${tag}${C.reset} — $${e.netWorth}`);
  }
}

function showProperty(idx) {
  const sp = state.board[idx];
  if (!sp) { print('Invalid space index.'); return; }
  const bc = bColor(sp.borough);
  print(`\n${bc}${C.bold}--- Space #${idx} (${sp.type}, Borough ${sp.borough}) ---${C.reset}`);
  print(`  Owner: ${sp.ownerId === human.id ? `${C.cyan}You${C.reset}` : sp.ownerId ? state.players[sp.ownerId]?.name || sp.ownerId : 'unowned'}`);
  print(`  Base price: $${sp.basePrice}  |  Base rent: $${sp.baseRent}`);
  print(`  Build level: ${sp.buildLevel < 0 ? `${C.red}mortgaged${C.reset}` : sp.buildLevel}`);
  print(`  Effective rent: ${C.green}$${effectiveRent(sp)}${C.reset}`);
  print(`  Halo bonus: ${sp.haloBonus > 0 ? `${C.yellow}+${Math.round(sp.haloBonus * 100)}%${C.reset}` : 'none'}`);
  if (sp.anchorType) print(`  Anchor: ${C.yellow}${sp.anchorType}${C.reset} (level ${sp.anchorLevel})`);
}

function showHelp() {
  print(`
${C.bold}Commands:${C.reset}
  ${C.cyan}roll${C.reset}          — Roll dice and take your turn
  ${C.cyan}build <#>${C.reset}    — Build on property # (must own, meet contiguity)
  ${C.cyan}anchor <#> <type>${C.reset} — Place an anchor (football/basketball/baseball/casino)
  ${C.cyan}mortgage <#>${C.reset}  — Mortgage property # for cash
  ${C.cyan}hit <name>${C.reset}    — Play Hit card on a player
  ${C.cyan}rico <name>${C.reset}   — Play RICO card on a player
  ${C.cyan}inform <name>${C.reset} — Play Informant on a player
  ${C.cyan}pardon <name>${C.reset} — Play Pardon on a player
  ${C.cyan}expose <name>${C.reset} — Expose a dirty official
  ${C.cyan}account <name>${C.reset} — Skim cash via Accountant
  ${C.cyan}audit <name>${C.reset}  — Back-tax a player's properties
  ${C.cyan}jackpot${C.reset}       — Collect the free parking pool
  ${C.cyan}inspect <#>${C.reset}   — View details of a space
  ${C.cyan}save${C.reset}          — Save the game
  ${C.cyan}load${C.reset}          — Load a saved game
  ${C.cyan}status${C.reset}        — Show your stats
  ${C.cyan}board${C.reset}         — Show the board
  ${C.cyan}scores${C.reset}        — Show leaderboard
  ${C.cyan}help${C.reset}          — Show this help
  ${C.cyan}quit${C.reset}          — Save and exit`);
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

      // auto-save after each turn
      state._turnNumber = turnNumber;
      saveGame(state);

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

    case 'expose': {
      const target = findPlayer(arg);
      if (!target) { print(`No player found matching "${arg}".`); break; }
      const result = playExpose(state, human.id, target.id);
      print(result.description);
      break;
    }

    case 'account': {
      const target = findPlayer(arg);
      if (!target) { print(`No player found matching "${arg}".`); break; }
      const result = playAccountant(state, human.id, target.id);
      print(result.description);
      break;
    }

    case 'audit': {
      const target = findPlayer(arg);
      if (!target) { print(`No player found matching "${arg}".`); break; }
      const result = playAudit(state, human.id, target.id);
      print(result.description);
      break;
    }

    case 'jackpot': {
      const result = playJackpot(state, human.id);
      print(result.description);
      break;
    }

    case 'anchor': {
      const anchorParts = arg.split(/\s+/);
      const idx = parseInt(anchorParts[0]);
      const type = anchorParts[1];
      if (isNaN(idx) || !type) { print('Usage: anchor <space#> <type> (football/basketball/baseball/casino)'); break; }
      const result = placeAnchor(state, human.id, idx, type);
      print(result.description);
      break;
    }

    case 'inspect': {
      const idx = parseInt(arg);
      if (isNaN(idx)) { print('Usage: inspect <space#>'); break; }
      showProperty(idx);
      break;
    }

    case 'save': {
      state._turnNumber = turnNumber;
      const result = saveGame(state);
      print(result.description);
      break;
    }

    case 'load': {
      const result = loadGame();
      if (result.ok) {
        Object.assign(state, result.state);
        human = Object.values(state.players).find(p => !p.isBot);
        turnNumber = state._turnNumber || 0;
        print(result.description);
        showStatus();
      } else {
        print(result.description);
      }
      break;
    }

    case 'status': showStatus(); break;
    case 'board':  showBoard();  break;
    case 'scores': showLeaderboard(); break;
    case 'help':   showHelp();   break;

    case 'quit':
    case 'exit':
      state._turnNumber = turnNumber;
      saveGame(state);
      print('Game saved and exited.');
      rl.close();
      process.exit(0);

    default:
      print(`Unknown command: "${cmd}". Type "help" for commands.`);
  }

  prompt();
}

// ---- start -----------------------------------------------------------------
print(`\n${C.bold}${C.red}=== 5 BOROUGHS ON THE TAKE ===${C.reset}`);
print(`${C.dim}Board: ${state.board.length} spaces | ${Object.values(state.players).filter(p => p.isBot).length} bots${C.reset}`);
if (loaded.ok) print(`${C.green}Resumed from save (turn ${turnNumber}).${C.reset}`);
print(`Type ${C.cyan}help${C.reset} for commands, ${C.cyan}roll${C.reset} to start playing.\n`);
showStatus();
prompt();
