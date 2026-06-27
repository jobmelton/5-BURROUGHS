// ===========================================================================
// 5 BOROUGHS ON THE TAKE — simulation.js
// Full 8-player simulation with distinct strategies AND active role economy.
// Roles generate income, players play action cards, mob deals happen,
// cops get hired, judges get bribed, lawyers defend RICO.
// ===========================================================================
import { CONFIG } from './gameConfig.js';
import { buildBoard } from './board.js';
import { buildCareerPool, buildActionPool, drawFrom } from './decks.js';
import { contiguousOwnedRun, getBuildOptions, buildOnSpace, effectiveRent } from './economy.js';
import { rollDice } from './turns.js';
import { calculateCapoSkim, findRoleHolder, hasRole, bossHasRICOImmunity, bossIsJailImmune, calculateBail, calculateCasinoCut, processTaxSquare } from './roles.js';
import { splitRent } from './partnerships.js';

// ---- Player factory --------------------------------------------------------

function newSimPlayer(name, strategy) {
  return {
    id: name.toLowerCase().replace(/[^a-z0-9]/g, '_'),
    name, strategy, isBot: true,
    cash: CONFIG.money.startingCash, position: 0,
    propertyIds: [], roles: [], dormantRoles: [], hand: [], debts: [],
    status: { protectedByCopId: null, ownedByBossId: null, jailed: false, jailTurns: 0, hasMobDebt: false, roleDirty: false },
    allianceIds: [], netWorth: CONFIG.money.startingCash,
    stats: { rentPaid: 0, rentCollected: 0, skimEarned: 0, protectionEarned: 0, bailEarned: 0,
             casinoEarned: 0, taxCollected: 0, propertiesBought: 0, buildsMade: 0,
             jailVisits: 0, laps: 0, turnsPlayed: 0, hitsPlayed: 0, ricosPlayed: 0,
             mobDealsAccepted: 0, copProtectionsPaid: 0 },
  };
}

function newSimGame() {
  return {
    board: buildBoard(),
    players: {},
    careerPool: buildCareerPool(),
    actionPool: buildActionPool(),
    taxPool: 0, bountyPool: 0, freeParkingPool: 0,
    cleanCityMeter: 1, godfatherId: null,
    notifications: [], strikeBoroughs: {}, codeViolations: {},
    _turnNumber: 0,
  };
}

// ---- Strategies (now include role behavior) --------------------------------

const STRATEGIES = {
  aggressive: {
    name: 'Tony "All-In"',
    desc: 'Buys aggressively, builds fast, plays dirty',
    shouldBuy: (p, sp) => sp.basePrice <= p.cash * 0.50,
    shouldBuild: (p) => p.cash > 80,
    cashReserve: 0.05,
    playStyle: 'mob',
    copProtection: false,
  },
  conservative: {
    name: 'Maria "Safe Play"',
    desc: 'Buys cheap only, hoards cash, stays clean, pays cop protection',
    shouldBuy: (p, sp) => sp.basePrice < p.cash * 0.25,
    shouldBuild: (p) => p.cash > CONFIG.money.startingCash * 0.8,
    cashReserve: 0.55,
    playStyle: 'clean',
    copProtection: true,
  },
  focused: {
    name: 'Carlos "Borough King"',
    desc: 'Focuses on Borough 2, builds contiguity, mob connections',
    shouldBuy: (p, sp) => sp.borough === 2 && sp.basePrice <= p.cash * 0.50,
    shouldBuild: (p) => p.cash > 150,
    cashReserve: 0.20,
    playStyle: 'mob',
    copProtection: false,
  },
  premium: {
    name: 'Diana "High Roller"',
    desc: 'Only buys B3-B5 when affordable, pays for protection',
    shouldBuy: (p, sp) => sp.borough >= 3 && sp.basePrice <= p.cash * 0.55,
    shouldBuild: (p) => p.cash > 300,
    cashReserve: 0.15,
    playStyle: 'opportunist',
    copProtection: true,
  },
  slumlord: {
    name: 'Vinnie "Slumlord"',
    desc: 'Cheap lots B1-B2 only, minimal builds, mob muscle',
    shouldBuy: (p, sp) => sp.type === 'vacantLot' && sp.borough <= 2 && sp.basePrice <= p.cash * 0.40,
    shouldBuild: (p) => p.cash > CONFIG.money.startingCash * 0.4,
    cashReserve: 0.35,
    playStyle: 'mob',
    copProtection: false,
  },
  builder: {
    name: 'Santos "The Developer"',
    desc: 'Buys few cheap lots, pours everything into building them up',
    shouldBuy: (p, sp) => p.propertyIds.length < 4 && sp.type === 'vacantLot' && sp.basePrice <= p.cash * 0.40,
    shouldBuild: () => true, // always build if possible
    cashReserve: 0.03, // almost no reserve — all into building
    playStyle: 'clean',
    copProtection: true,
  },
  diversifier: {
    name: 'Elena "Spread Wide"',
    desc: 'One per borough, diversified, plays all angles',
    shouldBuy: (p, sp, st) => {
      const has = p.propertyIds.some(i => st.board[i].borough === sp.borough);
      return !has && sp.basePrice <= p.cash * 0.45;
    },
    shouldBuild: (p) => p.cash > 350,
    cashReserve: 0.25,
    playStyle: 'opportunist',
    copProtection: true,
  },
  passive: {
    name: 'Old Man Morales',
    desc: 'Rarely buys, collects roles, plays cards strategically',
    shouldBuy: (p, sp) => sp.basePrice < 200 && sp.basePrice <= p.cash * 0.15,
    shouldBuild: () => false,
    cashReserve: 0.80,
    playStyle: 'clean',
    copProtection: true,
  },
};

// ---- Role economy helpers --------------------------------------------------

function processRoleIncome(state, events) {
  const eco = CONFIG.economy;
  for (const p of Object.values(state.players)) {
    // Cop protection fees
    if (p.status.protectedByCopId) {
      const cop = state.players[p.status.protectedByCopId];
      if (cop) {
        const fee = Math.round(p.propertyIds.reduce((s, i) => s + effectiveRent(state.board[i]), 0) * 0.05);
        if (fee > 0 && p.cash >= fee) {
          p.cash -= fee; cop.cash += fee;
          cop.stats.protectionEarned += fee;
          p.stats.copProtectionsPaid += fee;
        }
      }
    }

    // Inspector permit fee: 3% of all build value in their borough
    for (const role of p.roles) {
      if (role.role === 'Inspector') {
        const boroughBuilt = Object.values(state.players).flatMap(pl => pl.propertyIds)
          .map(i => state.board[i])
          .filter(sp => sp.borough === role.borough && sp.buildingType);
        const totalBuildValue = boroughBuilt.reduce((s, sp) => s + sp.basePrice * (sp.rentMultiplier || 1), 0);
        const fee = Math.round(totalBuildValue * (eco.inspectorPermitFee || 0));
        if (fee > 0) { p.cash += fee; p.stats.skimEarned += fee; }
      }

      // LaborBoss wage fee: 2% of all rent in their borough
      if (role.role === 'LaborBoss') {
        const boroughRent = Object.values(state.players).flatMap(pl => pl.propertyIds)
          .map(i => state.board[i])
          .filter(sp => sp.borough === role.borough && sp.ownerId && sp.ownerId !== p.id)
          .reduce((s, sp) => s + effectiveRent(sp), 0);
        const fee = Math.round(boroughRent * (eco.laborBossWageFee || 0));
        if (fee > 0) { p.cash += fee; p.stats.skimEarned += fee; }
      }

      // Lawyer retainer: $10 per GO from each protected client
      if (role.role === 'Lawyer') {
        const retainer = eco.lawyerRetainerPerGo || 0;
        if (retainer > 0) { p.cash += retainer; p.stats.skimEarned += retainer; }
      }

      // Banker interest floor: 5% auto-earn on outstanding loans
      if (role.role === 'Banker') {
        const outstandingLoans = Object.values(state.players)
          .flatMap(pl => pl.debts)
          .filter(d => d.lenderId === p.id);
        const totalOutstanding = outstandingLoans.reduce((s, d) => s + d.principalRemaining, 0);
        const interest = Math.round(totalOutstanding * (eco.bankerInterestFloor || 0));
        if (interest > 0) { p.cash += interest; p.stats.skimEarned += interest; }
      }
    }
  }
}

function processCopProtectionDecision(state, player, space, strat) {
  // when acquiring property, decide if to pay cop for protection
  if (!strat.copProtection) return;
  const cop = findRoleHolder(state, 'Cop', space.borough);
  if (cop && cop.id !== player.id && !player.status.protectedByCopId) {
    player.status.protectedByCopId = cop.id;
  }
}

function processBailIfJailed(state, player, events) {
  const borough = state.board[player.position]?.borough || 1;
  const bail = calculateBail(state, player.id, borough);
  if (bail.collectorId && player.cash >= bail.amount) {
    player.cash -= bail.amount;
    const cop = state.players[bail.collectorId];
    // cop only gets their share (50%), rest sinks
    const copShare = Math.round(bail.amount * (CONFIG.jail.copBailShare || 0.5));
    if (cop) {
      cop.cash += copShare;
      cop.stats.bailEarned += copShare;
    }
    // judge earns court fee
    const judge = findRoleHolder(state, 'Judge', borough);
    const courtFee = CONFIG.economy.judgeCourtFee || 0;
    if (judge && judge.id !== player.id) {
      judge.cash += courtFee;
      judge.stats.skimEarned += courtFee;
    }
    events.push(`BAIL $${bail.amount}${bail.doubledFor ? ' (2x ' + bail.doubledFor + ')' : ''} → Cop $${copShare}${judge ? ' + Judge $' + courtFee : ''}`);
  }
}

// ---- Action card AI --------------------------------------------------------

function playActionCards(state, player, events) {
  const strat = STRATEGIES[player.strategy];
  if (player.hand.length === 0) return;

  for (let i = player.hand.length - 1; i >= 0; i--) {
    const card = player.hand[i];

    if (card.type === 'Hit' && strat.playStyle === 'mob') {
      // Hit the richest player who has roles and isn't protected
      const target = Object.values(state.players)
        .filter(p => p.id !== player.id && p.roles.length > 0 && !p.status.protectedByCopId)
        .sort((a, b) => b.netWorth - a.netWorth)[0];
      if (target) {
        const stolen = target.roles.shift();
        if (stolen) {
          stolen.ownedById = player.id;
          player.roles.push(stolen);
          player.hand.splice(i, 1);
          player.stats.hitsPlayed++;
          events.push(`HIT ${target.name} → stole ${stolen.role}`);
        }
      }
    }

    if (card.type === 'RICO' && strat.playStyle === 'clean') {
      // RICO a boss with 3+ roles
      const cleanCard = player.roles.find(r => ['Cop', 'Politician', 'Judge'].includes(r.role) && r.clean);
      if (cleanCard) {
        const target = Object.values(state.players)
          .filter(p => p.id !== player.id && hasRole(p, 'Boss') && p.roles.length >= CONFIG.actions.rico.minRolesToTarget)
          .sort((a, b) => b.roles.length - a.roles.length)[0];
        if (target) {
          // check RICO immunity
          if (bossHasRICOImmunity(state, target.id)) {
            events.push(`RICO vs ${target.name} BLOCKED (Lawyer+Judge)`);
          } else {
            target.status.jailed = true;
            target.status.jailTurns = CONFIG.actions.rico.jailTurns * (hasRole(target, 'Boss') ? 2 : 1);
            cleanCard.clean = false;
            player.stats.ricosPlayed++;
            events.push(`RICO! ${target.name} jailed for ${target.status.jailTurns} turns`);
            // mob loses cops/politicians
            for (const owned of Object.values(state.players)) {
              if (owned.status.ownedByBossId === target.id) {
                const lostRoles = owned.roles.filter(r => r.role === 'Cop' || r.role === 'Politician');
                for (const lr of lostRoles) {
                  owned.roles = owned.roles.filter(r => r.id !== lr.id);
                  lr.ownedById = null; lr.clean = true;
                  state.careerPool.push(lr);
                  events.push(`RICO fallout: ${owned.name} lost ${lr.role}`);
                }
              }
            }
          }
          player.hand.splice(i, 1);
        }
      }
    }

    if (card.type === 'Informant' && strat.playStyle === 'clean') {
      // free a mob-owned player
      const mobOwned = Object.values(state.players)
        .find(p => p.id !== player.id && p.status.ownedByBossId);
      if (mobOwned) {
        const oldBoss = mobOwned.status.ownedByBossId;
        mobOwned.status.ownedByBossId = null;
        mobOwned.status.protectedByCopId = player.id;
        player.hand.splice(i, 1);
        events.push(`INFORMANT freed ${mobOwned.name} from mob`);
      }
    }

    if (card.type === 'Expose' && strat.playStyle !== 'mob') {
      // expose a dirty official
      const target = Object.values(state.players)
        .find(p => p.id !== player.id && p.roles.some(r => ['Cop','Politician','Judge'].includes(r.role) && r.clean === false));
      if (target) {
        const dirtyRole = target.roles.find(r => ['Cop','Politician','Judge'].includes(r.role) && !r.clean);
        if (dirtyRole && target.cash < CONFIG.actions.expose.fine) {
          target.roles = target.roles.filter(r => r.id !== dirtyRole.id);
          dirtyRole.ownedById = null; dirtyRole.clean = true;
          state.careerPool.push(dirtyRole);
          events.push(`EXPOSE ${target.name} lost ${dirtyRole.role} (can't pay fine)`);
        } else if (dirtyRole) {
          target.cash -= CONFIG.actions.expose.fine;
          dirtyRole.clean = true;
          events.push(`EXPOSE ${target.name}'s ${dirtyRole.role} paid $${CONFIG.actions.expose.fine}`);
        }
        player.hand.splice(i, 1);
      }
    }

    if (card.type === 'Accountant') {
      const richest = Object.values(state.players)
        .filter(p => p.id !== player.id && p.cash > 200)
        .sort((a, b) => b.cash - a.cash)[0];
      if (richest) {
        const skim = Math.round(richest.cash * CONFIG.actions.accountant.skimFraction);
        richest.cash -= skim;
        state.taxPool += skim;
        events.push(`ACCOUNTANT skimmed $${skim} from ${richest.name}`);
        player.hand.splice(i, 1);
      }
    }

    if (card.type === 'Strike' && strat.playStyle === 'mob') {
      // strike a borough where rivals are building
      const targetBorough = Object.values(state.players)
        .filter(p => p.id !== player.id)
        .flatMap(p => p.propertyIds.map(idx => state.board[idx].borough))
        .reduce((counts, b) => { counts[b] = (counts[b] || 0) + 1; return counts; }, {});
      const busiest = Object.entries(targetBorough).sort((a, b) => b[1] - a[1])[0];
      if (busiest) {
        if (!state.strikeBoroughs) state.strikeBoroughs = {};
        state.strikeBoroughs[busiest[0]] = CONFIG.actions.strike.durationTurns;
        events.push(`STRIKE in B${busiest[0]} for ${CONFIG.actions.strike.durationTurns}t`);
        player.hand.splice(i, 1);
      }
    }

    if (card.type === 'Jackpot' && state.freeParkingPool > 100) {
      player.cash += state.freeParkingPool;
      events.push(`JACKPOT $${state.freeParkingPool}`);
      state.freeParkingPool = 0;
      player.hand.splice(i, 1);
    }

    if (card.type === 'Audit') {
      // audit the player with most properties
      const target = Object.values(state.players)
        .filter(p => p.id !== player.id && p.propertyIds.length > 0)
        .sort((a, b) => b.propertyIds.length - a.propertyIds.length)[0];
      if (target) {
        const tax = target.propertyIds.length * CONFIG.actions.audit.taxPerProperty;
        const paid = Math.min(tax, target.cash);
        target.cash -= paid;
        state.taxPool += paid;
        events.push(`AUDIT ${target.name} taxed $${paid} (${target.propertyIds.length} props)`);
        player.hand.splice(i, 1);
      }
    }

    if (card.type === 'Election') {
      // steal a politician from whoever has one
      const target = Object.values(state.players)
        .find(p => p.id !== player.id && p.roles.some(r => r.role === 'Politician'));
      if (target) {
        const polCard = target.roles.find(r => r.role === 'Politician');
        target.roles = target.roles.filter(r => r.id !== polCard.id);
        polCard.ownedById = player.id;
        player.roles.push(polCard);
        events.push(`ELECTION took ${polCard.role}(b${polCard.borough}) from ${target.name}`);
        player.hand.splice(i, 1);
      }
    }

    if (card.type === 'Pardon') {
      if (player.status.jailed) {
        player.status.jailed = false;
        player.status.jailTurns = 0;
        events.push('PARDON (self)');
        player.hand.splice(i, 1);
      } else {
        // pardon an ally (mob-owned by same boss)
        const ally = Object.values(state.players)
          .find(p => p.id !== player.id && p.status.jailed && p.status.ownedByBossId === player.status.ownedByBossId);
        if (ally) {
          ally.status.jailed = false; ally.status.jailTurns = 0;
          events.push(`PARDON freed ${ally.name}`);
          player.hand.splice(i, 1);
        }
      }
    }
  }
}

// ---- Mob deal when broke ---------------------------------------------------

function tryMobDealIfBroke(state, player, rentOwed, landlord, events) {
  const borough = state.board[player.position]?.borough || 1;
  const boss = findRoleHolder(state, 'Boss', borough);
  if (!boss || boss.id === player.id) return false;

  // boss covers the debt, player becomes owned
  if (landlord) landlord.cash += rentOwed;
  player.status.ownedByBossId = boss.id;
  player.status.hasMobDebt = true;
  player.stats.mobDealsAccepted++;

  // flip clean roles
  for (const r of player.roles) {
    if (r.clean === true) r.clean = false;
  }

  events.push(`MOB DEAL: ${boss.name} covered $${rentOwed}, ${player.name} now mob-owned`);
  return true;
}

// ---- Main simulation turn --------------------------------------------------

function simTurn(state, player) {
  const strat = STRATEGIES[player.strategy];
  player.stats.turnsPlayed++;
  const events = [];

  // jail check
  if (player.status.jailed) {
    const roll = rollDice();
    if (CONFIG.jail.doublesEscape && roll.doubles) {
      player.status.jailed = false;
      player.status.jailTurns = 0;
      events.push('FREED (doubles)');
    } else {
      player.status.jailTurns--;
      if (player.status.jailTurns <= 0) {
        player.status.jailed = false;
        player.status.jailTurns = 0;
        events.push('FREED (time served)');
      } else {
        // play pardon if have one
        playActionCards(state, player, events);
        return `${player.name} in jail (${player.status.jailTurns} left) | ${events.join(', ') || 'waiting'}`;
      }
    }
  }

  // roll and move
  const roll = rollDice();
  const boardLen = state.board.length;
  const oldPos = player.position;
  const newPos = (oldPos + roll.total) % boardLen;
  const passedGo = (oldPos + roll.total) >= boardLen;

  if (passedGo) {
    player.cash += CONFIG.money.paydayBase;
    player.stats.laps++;

    // value-based property tax on GO
    const totalLots = player.propertyIds.length;
    let propTax = 0;

    for (const idx of player.propertyIds) {
      const sp = state.board[idx];
      const value = sp.basePrice * (sp.rentMultiplier || 1);
      const baseRate = CONFIG.money.propertyTaxRate || 0.02;
      const emptyExtra = sp.buildingType ? 0 : (CONFIG.money.emptyLotSurcharge || 0.03);
      propTax += Math.round(value * (baseRate + emptyExtra));
    }

    // surtax for empires: extra 1% per lot over cap on ALL properties
    const cap = CONFIG.money.maxPropertiesBeforeSurtax || 8;
    if (totalLots > cap) {
      const extraLots = totalLots - cap;
      const surtaxRate = extraLots * (CONFIG.money.surtaxPerExtraLot || 0.01);
      const totalValue = player.propertyIds.reduce((s, i) => s + state.board[i].basePrice * (state.board[i].rentMultiplier || 1), 0);
      propTax += Math.round(totalValue * surtaxRate);
    }

    const unbuilt = player.propertyIds.filter(i => !state.board[i].buildingType).length;
    const built = player.propertyIds.filter(i => state.board[i].buildingType).length;

    if (propTax > 0) {
      const paid = Math.min(propTax, player.cash);
      player.cash -= paid;

      // distribute to politicians or free parking
      const playerBoroughs = [...new Set(player.propertyIds.map(i => state.board[i].borough))];
      let taxDistributed = 0;
      for (const b of playerBoroughs) {
        const pol = findRoleHolder(state, 'Politician', b);
        if (pol && pol.id !== player.id) {
          const share = Math.round(paid / playerBoroughs.length);
          pol.cash += share;
          pol.stats.taxCollected += share;
          taxDistributed += share;
        }
      }
      const toFreeParking = paid - taxDistributed;
      if (toFreeParking > 0) state.freeParkingPool += toFreeParking;
    }

    const netPayday = CONFIG.money.paydayBase - propTax;
    events.push(`PAYDAY +$${CONFIG.money.paydayBase} -$${propTax} tax(${unbuilt}e/${built}b/${totalLots}tot) net $${netPayday}`);

    // loan payments on GO
    for (let i = player.debts.length - 1; i >= 0; i--) {
      const debt = player.debts[i];
      const payment = Math.min(debt.paymentPerGo || 0, player.cash);
      if (payment > 0) {
        player.cash -= payment;
        debt.principalRemaining -= payment;
        const lender = state.players[debt.lenderId];
        if (lender) lender.cash += payment;
        if (debt.principalRemaining <= 0) {
          player.debts.splice(i, 1);
          events.push(`LOAN PAID OFF`);
          // mob debt payoff: if paid 2x, freed from mob ownership
          if (debt.loanType === 'mob' && !player.debts.some(d => d.loanType === 'mob')) {
            player.status.hasMobDebt = false;
            player.status.ownedByBossId = null;
            events.push('FREED FROM MOB (debt paid off)');
          }
        }
        else events.push(`LOAN -$${payment}`);
      }
    }

    // enforce max active roles — excess go dormant, swap strategically
    const maxRoles = CONFIG.money.maxActiveRoles || 3;
    if (!player.dormantRoles) player.dormantRoles = [];

    // first: if over cap, dormant the least valuable
    while (player.roles.length > maxRoles) {
      // rank roles by immediate value — keep income-generating ones active
      const ranked = player.roles.map(r => {
        let value = 0;
        if (r.role === 'Boss') value = 10;
        if (r.role === 'Capo') value = 8;
        if (r.role === 'Cop') value = 7;
        if (r.role === 'Politician') value = 6;
        if (r.role === 'Banker') value = 5;
        if (r.role === 'Lawyer') value = 4;
        if (r.role === 'Judge') value = 3;
        if (r.role === 'CasinoManager') value = 5;
        if (r.role === 'Inspector') value = 2;
        if (r.role === 'LaborBoss') value = 1;
        return { role: r, value };
      }).sort((a, b) => a.value - b.value);
      const toDormant = ranked[0].role;
      player.roles = player.roles.filter(r => r.id !== toDormant.id);
      player.dormantRoles.push(toDormant);
      events.push(`DORMANT: ${toDormant.role}(b${toDormant.borough})`);
    }

    // second: swap dormant→active if a dormant role is more valuable right now
    if (player.dormantRoles.length > 0 && player.roles.length === maxRoles) {
      const position = player.position;
      const currentBorough = state.board[position]?.borough || 1;

      for (const dormant of [...player.dormantRoles]) {
        // check if this dormant role is better than our weakest active
        let dormantValue = 0;
        if (dormant.role === 'Cop' && dormant.borough === currentBorough) dormantValue = 9; // bail income here
        if (dormant.role === 'Capo' && dormant.borough === currentBorough) dormantValue = 9; // skim income here
        if (dormant.role === 'Boss') dormantValue = 10;
        if (dormant.role === 'Lawyer' && player.status.jailed) dormantValue = 10; // need defense
        if (dormant.role === 'Politician' && player.propertyIds.some(i => state.board[i].borough === dormant.borough)) dormantValue = 7;

        if (dormantValue > 0) {
          const weakest = player.roles
            .map(r => {
              let v = 1;
              if (r.role === 'Boss') v = 10;
              if (r.role === 'Capo' && r.borough === currentBorough) v = 9;
              if (r.role === 'Cop' && r.borough === currentBorough) v = 8;
              else if (r.role === 'Cop') v = 4;
              if (r.role === 'Politician') v = 5;
              if (r.role === 'Banker') v = 4;
              if (r.role === 'Inspector') v = 2;
              if (r.role === 'LaborBoss') v = 1;
              return { role: r, value: v };
            })
            .sort((a, b) => a.value - b.value)[0];

          if (dormantValue > weakest.value) {
            // swap: dormant → active, weakest → dormant
            player.roles = player.roles.filter(r => r.id !== weakest.role.id);
            player.dormantRoles.push(weakest.role);
            player.dormantRoles = player.dormantRoles.filter(r => r.id !== dormant.id);
            player.roles.push(dormant);
            events.push(`SWAP: ${dormant.role}(b${dormant.borough})↑ ${weakest.role.role}(b${weakest.role.borough})↓`);
            break; // one swap per turn
          }
        }
      }
    }
  }

  player.position = newPos;
  const space = state.board[newPos];

  // --- resolve space ---
  if (space.type === 'jail') {
    player.status.jailed = true;
    player.status.jailTurns = hasRole(player, 'Boss') || hasRole(player, 'Capo') ? CONFIG.jail.maxTurns * 2 : CONFIG.jail.maxTurns;
    // jail immunity check
    if (hasRole(player, 'Boss') && bossIsJailImmune(state, player.id)) {
      player.status.jailed = false;
      player.status.jailTurns = 0;
      events.push('JAIL IMMUNE (owns Cop)');
    } else {
      player.stats.jailVisits++;
      processBailIfJailed(state, player, events);
      events.push(`JAILED ${player.status.jailTurns}t`);
    }

  } else if (space.type === 'freeParking') {
    // collect the free parking pool
    if (state.freeParkingPool > 0) {
      player.cash += state.freeParkingPool;
      events.push(`FREE PARKING! Collected $${state.freeParkingPool}`);
      state.freeParkingPool = 0;
    }

  } else if (space.type === 'tax') {
    const result = processTaxSquare(state, player.id, space.borough);
    if (result.taxAmount > 0) {
      events.push(`TAX $${result.taxAmount}`);
      if (result.collectorId) {
        const pol = state.players[result.collectorId];
        if (pol) pol.stats.taxCollected += result.taxAmount;
      }
    }

  } else if (space.type === 'career') {
    const card = drawFrom(state.careerPool);
    if (card) { card.ownedById = player.id; player.roles.push(card); events.push(`DREW ${card.role}(b${card.borough})`); }

  } else if (space.basePrice > 0) {
    if (space.ownerId === null) {
      // unowned — buy decision
      if (strat.shouldBuy(player, space, state)) {
        // politician purchase tax 1%
        const pol = findRoleHolder(state, 'Politician', space.borough);
        const tax = pol ? Math.round(space.basePrice * 0.01) : 0;

        player.cash -= space.basePrice;
        space.ownerId = player.id;
        player.propertyIds.push(space.index);
        player.stats.propertiesBought++;
        if (pol && tax > 0) { pol.cash += tax; pol.stats.taxCollected += tax; }
        events.push(`BOUGHT #${space.index} $${space.basePrice}${tax > 0 ? ' +tax$' + tax : ''}`);

        processCopProtectionDecision(state, player, space, strat);
      }

    } else if (space.ownerId !== player.id && space.buildLevel >= 0) {
      // pay rent
      let rent = effectiveRent(space);
      const owner = state.players[space.ownerId];

      // casino dice multiplier
      if (space.anchorType === 'casino' || space.buildingType === 'casino' || space.buildingType === 'megaCasino') {
        const casinoRoll = rollDice();
        if (CONFIG.casino.free.includes(casinoRoll.total)) {
          events.push(`CASINO DICE ${casinoRoll.total} — FREE!`);
          rent = 0;
        } else {
          const mult = (casinoRoll.total % 2 !== 0) ? 3 : 2;
          rent = rent * mult;
          events.push(`CASINO DICE ${casinoRoll.total} — ${mult}x!`);
        }
      }

      if (rent > 0) {
        // casino manager cut
        if (space.anchorType === 'casino' || space.buildingType?.includes('casino') || space.buildingType?.includes('Casino')) {
          const cmCut = calculateCasinoCut(state, space.borough, rent);
          if (cmCut.managerCut > 0) events.push(`CM cut $${cmCut.managerCut}`);
        }

        // capo skim (unless protected by cop)
        const skim = player.status.protectedByCopId ? { capoAmount: 0, bossKickup: 0 } : calculateCapoSkim(state, space.borough, rent);

        if (player.cash >= rent) {
          player.cash -= rent;
          player.stats.rentPaid += rent;

          if (owner && !owner.status.jailed) {
            let ownerIncome = rent;
            if (skim.capoAmount > 0) {
              const capo = state.players[skim.capoId];
              if (capo) { capo.cash += skim.capoAmount; capo.stats.skimEarned += skim.capoAmount; ownerIncome -= skim.capoAmount; }
              if (skim.bossKickup > 0 && skim.bossId) {
                const boss = state.players[skim.bossId];
                if (boss) { boss.cash += skim.bossKickup; boss.stats.skimEarned += skim.bossKickup; ownerIncome -= skim.bossKickup; }
              }
              events.push(`SKIM $${skim.capoAmount}${skim.bossKickup > 0 ? '+$' + skim.bossKickup + 'kickup' : ''}`);
            }
            // partnership split
            if (space.partnership) {
              const { ownerShare, partnerShare } = splitRent(space, ownerIncome);
              owner.cash += ownerShare;
              const partner = state.players[space.partnership.partnerId];
              if (partner) partner.cash += partnerShare;
              owner.stats.rentCollected += ownerShare;
            } else {
              owner.cash += Math.max(0, ownerIncome);
              owner.stats.rentCollected += Math.max(0, ownerIncome);
            }
          } else if (owner?.status.jailed) {
            state.freeParkingPool += rent;
            events.push('owner jailed→free parking');
          }
          events.push(`RENT $${rent} → ${owner?.name || '?'}`);

        } else {
          // CAN'T PAY RENT — mob deal or go broke
          const shortfall = rent - player.cash;
          const mobDeal = tryMobDealIfBroke(state, player, rent, owner, events);
          if (!mobDeal) {
            // pay what they can
            const paid = player.cash;
            player.cash = 0;
            player.stats.rentPaid += paid;
            if (owner) { owner.cash += paid; owner.stats.rentCollected += paid; }
            events.push(`CAN'T PAY! Paid $${paid}/$${rent}`);
          }
        }
      }
    }
  }

  // draw action card (doubles or 7/11, not on career space)
  if ((roll.doubles || CONFIG.careers.drawOnTotals.includes(roll.total)) && space.type !== 'career') {
    const actionCard = drawFrom(state.actionPool);
    if (actionCard) {
      player.hand.push(actionCard);
      events.push(`ACTION: ${actionCard.type}`);
    } else {
      const careerCard = drawFrom(state.careerPool);
      if (careerCard) { careerCard.ownedById = player.id; player.roles.push(careerCard); events.push(`DREW ${careerCard.role}(b${careerCard.borough})`); }
    }
  }

  // play action cards strategically
  playActionCards(state, player, events);

  // --- LENDING: broke players try to borrow to buy/build ---
  if (player.cash < 150 && player.propertyIds.length > 0 && player.debts.length === 0) {
    if (!player.status.hasMobDebt) {
      // try bank loan from any banker
      const banker = findRoleHolder(state, 'Banker', state.board[player.position]?.borough || 1);
      if (banker && banker.id !== player.id && banker.cash >= 300) {
        const loanAmt = 300;
        const rate = 0.08;
        banker.cash -= loanAmt;
        player.cash += loanAmt;
        player.debts.push({ id: `loan-${state._turnNumber}-${player.id}`, lenderId: banker.id, loanType: 'bank', principalRemaining: loanAmt, rate, spaceIndex: null, paymentPerGo: Math.round(loanAmt * rate) });
        events.push(`BANK LOAN $${loanAmt} from ${banker.name} at ${rate * 100}%`);
      }
    } else {
      // mob loan — boss creates money
      const boss = findRoleHolder(state, 'Boss', state.board[player.position]?.borough || 1);
      if (boss && boss.id !== player.id) {
        const loanAmt = 300;
        const rate = 0.15;
        player.cash += loanAmt; // boss creates money
        player.debts.push({ id: `mob-${state._turnNumber}-${player.id}`, lenderId: boss.id, loanType: 'mob', principalRemaining: loanAmt, rate, spaceIndex: null, paymentPerGo: Math.round(loanAmt * rate) });
        events.push(`MOB LOAN $${loanAmt} from ${boss.name} at ${rate * 100}%`);
      }
    }
  }

  // --- INSPECTOR HIRING: boss/capo hires inspector to block rivals ---
  if ((hasRole(player, 'Boss') || hasRole(player, 'Capo')) && player.cash > 200 && Math.random() < 0.08) {
    // find inspector in a DIFFERENT borough
    const playerBorough = player.roles.find(r => r.role === 'Boss' || r.role === 'Capo')?.borough;
    for (const other of Object.values(state.players)) {
      if (other.id === player.id) continue;
      const inspCard = other.roles.find(r => r.role === 'Inspector' && r.borough !== playerBorough);
      if (inspCard) {
        const fee = 50;
        player.cash -= fee;
        other.cash += fee;
        const targetB = inspCard.borough;
        if (!state.codeViolations) state.codeViolations = {};
        state.codeViolations[targetB] = { penalty: fee * 2, payToId: player.id };
        events.push(`HIRED Inspector ${other.name} → violation B${targetB} ($${fee * 2} penalty)`);
        break;
      }
    }
  }

  // --- LABORBOSS: block construction in rival borough ---
  if (hasRole(player, 'LaborBoss') && Math.random() < 0.05) {
    const lbCard = player.roles.find(r => r.role === 'LaborBoss');
    const rivalBoroughs = [1, 2, 3, 4, 5].filter(b => b !== lbCard.borough);
    const target = rivalBoroughs[Math.floor(Math.random() * rivalBoroughs.length)];
    if (!state.strikeBoroughs) state.strikeBoroughs = {};
    if (!state.strikeBoroughs[target]) {
      state.strikeBoroughs[target] = 2;
      events.push(`LABOR STRIKE B${target} for 2 turns`);
    }
  }

  // --- DORMANT CARD SEIZURE: boss seizes dormant Boss/Capo from mob-owned players ---
  if (hasRole(player, 'Boss') && Math.random() < 0.10) {
    for (const owned of Object.values(state.players)) {
      if (owned.status.ownedByBossId !== player.id) continue;
      if (!owned.dormantRoles || owned.dormantRoles.length === 0) continue;
      const seizable = owned.dormantRoles.find(r => r.role === 'Boss' || r.role === 'Capo');
      if (seizable) {
        owned.dormantRoles = owned.dormantRoles.filter(r => r.id !== seizable.id);
        seizable.ownedById = player.id;
        player.roles.push(seizable);
        events.push(`SEIZED dormant ${seizable.role}(b${seizable.borough}) from ${owned.name}`);
        break;
      }
    }
  }

  // --- PARTNERSHIP: offer partnership on expensive unaffordable lots ---
  // (handled at buy time — if can't afford but > 50%, propose partnership)

  // mob player: try to bribe judges, recruit owned players
  if (strat.playStyle === 'mob' && hasRole(player, 'Boss')) {
    // bribe an unowned clean judge for protection
    for (const other of Object.values(state.players)) {
      if (other.id === player.id) continue;
      const cleanJudge = other.roles.find(r => r.role === 'Judge' && r.clean && !other.status.ownedByBossId);
      if (cleanJudge && player.cash > 300) {
        // offer bribe
        const bribe = 150;
        player.cash -= bribe;
        other.cash += bribe;
        cleanJudge.clean = false;
        other.status.ownedByBossId = player.id;
        events.push(`BRIBED Judge ${other.name} $${bribe} → now mob-owned`);
        break;
      }
    }
  }

  // building phase
  if (strat.shouldBuild(player)) {
    const reserve = player.cash * strat.cashReserve;
    for (const idx of [...player.propertyIds]) {
      if (player.cash <= reserve) break;
      const opts = getBuildOptions(state, player.id, idx);
      if (opts.length === 0 || opts[0].type === '_blocked') continue;
      const affordable = opts.filter(o => o.affordable && o.cost <= (player.cash - reserve));
      if (affordable.length > 0) {
        const pick = affordable[affordable.length - 1];
        const r = buildOnSpace(state, player.id, idx, pick.type);
        if (r.ok) { player.stats.buildsMade++; events.push(`BUILT ${pick.label}#${idx}`); }
      }
    }
  }

  // update net worth
  const propValue = player.propertyIds.reduce((s, i) => s + state.board[i].basePrice * (state.board[i].rentMultiplier || 1), 0);
  player.netWorth = player.cash + propValue;

  return `${player.name} ${roll.total}→#${newPos} ${space.type} | ${events.join(', ') || '-'} | $${player.cash}`;
}

// ---- Run -------------------------------------------------------------------

function runSimulation() {
  const state = newSimGame();
  for (const key of Object.keys(STRATEGIES)) {
    const p = newSimPlayer(STRATEGIES[key].name, key);
    state.players[p.id] = p;
  }

  const players = Object.values(state.players);
  console.log('=== 5 BOROUGHS SIMULATION: 8 STRATEGIES + ROLE ECONOMY ===\n');
  players.forEach(p => console.log(`  ${p.name} — ${STRATEGIES[p.strategy].desc}`));
  console.log(`\nBoard: ${state.board.length} | Cash: $${CONFIG.money.startingCash} | Payday: $${CONFIG.money.paydayBase}\n`);

  let bankrupt = null;
  const maxTurns = 400;
  const snapshots = [];

  for (let turn = 1; turn <= maxTurns && !bankrupt; turn++) {
    state._turnNumber = turn;

    // process role income once per round
    if (turn % 8 === 0) {
      processRoleIncome(state, []);

      // distribute accumulated tax pool to politicians, or free parking if none
      if (state.taxPool > 0) {
        const allPols = Object.values(state.players).filter(p => p.roles.some(r => r.role === 'Politician'));
        if (allPols.length > 0) {
          const perPol = Math.floor(state.taxPool / allPols.length);
          for (const pol of allPols) {
            pol.cash += perPol;
            pol.stats.taxCollected += perPol;
          }
          state.taxPool -= perPol * allPols.length;
        } else {
          // no politicians — all tax goes to free parking
          state.freeParkingPool += state.taxPool;
          state.taxPool = 0;
        }
      }
    }

    for (const player of players) {
      if (player.cash < -100) { bankrupt = player; break; }
      const log = simTurn(state, player);

      // print turns with action
      const hasAction = log.includes('BOUGHT') || log.includes('BUILT') || log.includes('RENT') ||
        log.includes('JAIL') || log.includes('HIT') || log.includes('RICO') || log.includes('MOB DEAL') ||
        log.includes('DREW') || log.includes('SKIM') || log.includes('BAIL') || log.includes('ACTION:') ||
        log.includes('JACKPOT') || log.includes('FREED') || log.includes('CASINO') ||
        log.includes('CAN\'T PAY') || log.includes('PARDON') || log.includes('IMMUNE') ||
        player.cash < 50;

      if (turn <= 10 || (hasAction && (turn <= 50 || turn % 5 === 0)) || player.cash < 0) {
        console.log(`T${String(turn).padStart(3)}: ${log}`);
      }

      if (player.cash < -100) { bankrupt = player; break; }
    }

    if (turn % 50 === 0) {
      snapshots.push(players.map(p => ({ name: p.name, nw: p.netWorth, cash: p.cash, props: p.propertyIds.length, roles: p.roles.length, builds: p.stats.buildsMade, strategy: p.strategy })).sort((a, b) => b.nw - a.nw));
    }
  }

  // ---- Results ----
  console.log('\n' + '='.repeat(70));
  console.log(bankrupt ? `BANKRUPTCY: ${bankrupt.name} at turn ${state._turnNumber}!` : `200 TURNS COMPLETE — no bankruptcy`);
  console.log('='.repeat(70));

  const sorted = players.sort((a, b) => b.netWorth - a.netWorth);
  console.log('\n--- FINAL STANDINGS ---');
  sorted.forEach((p, i) => {
    const s = p.stats;
    console.log(`#${i + 1} ${p.name.padEnd(24)} NW:$${String(Math.round(p.netWorth)).padStart(7)} Cash:$${String(p.cash).padStart(6)} Props:${String(p.propertyIds.length).padStart(2)} Builds:${String(s.buildsMade).padStart(2)} Roles:${String(p.roles.length).padStart(2)} Cards:${String(p.hand.length).padStart(2)}`);
    console.log(`   Rent:+$${s.rentCollected}/-$${s.rentPaid} Skim:$${s.skimEarned} Protect:$${s.protectionEarned} Bail:$${s.bailEarned} Tax:$${s.taxCollected} Hits:${s.hitsPlayed} RICOs:${s.ricosPlayed} MobDeals:${s.mobDealsAccepted} Jail:${s.jailVisits}`);
  });

  // role distribution
  console.log('\n--- ROLE HOLDINGS ---');
  sorted.forEach(p => {
    const roleStr = p.roles.map(r => `${r.role}(b${r.borough})${r.clean === false ? '*DIRTY' : ''}`).join(', ') || 'none';
    const mobStatus = p.status.ownedByBossId ? ` [OWNED BY ${state.players[p.status.ownedByBossId]?.name || '?'}]` : '';
    const copProt = p.status.protectedByCopId ? ` [COP PROTECTED]` : '';
    console.log(`  ${p.name}: ${roleStr}${mobStatus}${copProt}`);
  });

  // property map
  console.log('\n--- PROPERTY MAP ---');
  for (let b = 1; b <= 5; b++) {
    const spaces = state.board.filter(s => s.borough === b && s.basePrice > 0);
    const line = spaces.map(s => {
      if (!s.ownerId) return '. ';
      const o = state.players[s.ownerId];
      const built = s.buildingType ? s.buildingType.slice(0, 3).toUpperCase() : '___';
      return o ? o.name.slice(0, 2) + built.slice(0, 1) : '? ';
    }).join(' ');
    console.log(`  B${b}: ${line}`);
  }

  // economics summary
  console.log('\n--- ECONOMY ---');
  console.log(`Total rent circulated: $${players.reduce((s, p) => s + p.stats.rentPaid, 0)}`);
  console.log(`Total skim earned: $${players.reduce((s, p) => s + p.stats.skimEarned, 0)}`);
  console.log(`Total protection fees: $${players.reduce((s, p) => s + p.stats.protectionEarned, 0)}`);
  console.log(`Total bail collected: $${players.reduce((s, p) => s + p.stats.bailEarned, 0)}`);
  console.log(`Total tax collected: $${players.reduce((s, p) => s + p.stats.taxCollected, 0)}`);
  console.log(`Tax pool: $${state.taxPool} | Free parking: $${state.freeParkingPool}`);
  console.log(`Hits played: ${players.reduce((s, p) => s + p.stats.hitsPlayed, 0)} | RICOs: ${players.reduce((s, p) => s + p.stats.ricosPlayed, 0)} | Mob deals: ${players.reduce((s, p) => s + p.stats.mobDealsAccepted, 0)}`);

  // snapshots
  if (snapshots.length > 0) {
    console.log('\n--- NET WORTH OVER TIME ---');
    snapshots.forEach((snap, i) => {
      console.log(`  Turn ${(i + 1) * 50}:`);
      snap.forEach(s => console.log(`    ${s.name.padEnd(24)} NW:$${String(Math.round(s.nw)).padStart(7)} Props:${s.props} Builds:${s.builds} Roles:${s.roles}`));
    });
  }

  // pattern analysis
  console.log('\n--- PATTERNS ---');
  const nwRange = sorted[0].netWorth - sorted[sorted.length - 1].netWorth;
  const avgNW = players.reduce((s, p) => s + p.netWorth, 0) / players.length;
  console.log(`Spread: ${Math.round(nwRange / avgNW * 100)}% of average`);
  if (sorted[0].stats.skimEarned > 100) console.log(`✓ Mob skim is generating real income ($${sorted[0].stats.skimEarned})`);
  if (players.some(p => p.stats.protectionEarned > 50)) console.log(`✓ Cop protection economy is active`);
  if (players.some(p => p.stats.hitsPlayed > 0)) console.log(`✓ Hit cards being played`);
  if (players.some(p => p.stats.ricosPlayed > 0)) console.log(`✓ RICO prosecutions happening`);
  if (players.some(p => p.stats.mobDealsAccepted > 0)) console.log(`✓ Mob deals saving broke players`);
  if (players.some(p => p.stats.bailEarned > 0)) console.log(`✓ Cops earning bail income`);
  if (players.some(p => p.stats.taxCollected > 0)) console.log(`✓ Politicians collecting taxes`);

  console.log('\n=== SIMULATION COMPLETE ===');
}

runSimulation();
