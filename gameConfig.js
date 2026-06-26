// ===========================================================================
// 5 BOROUGHS ON THE TAKE — gameConfig.js
// THE single source of truth for every tunable number in the game.
// Every system reads from here. Balance the game by editing THIS file only.
// All values are first-draft starting points to tune in playtest.
// ===========================================================================

export const CONFIG = {

  // ---- Players & seats -----------------------------------------------------
  seats: {
    max: 50,            // hard cap on total seats
    botFloor: 8,        // always keep at least this many filled (bots top up)
    // humans fill first; bots only backfill empty seats up to `max`,
    // never added on top of humans. Bot count shrinks as humans arrive.
  },

  // ---- Starting money ------------------------------------------------------
  money: {
    startingCash: 1500,          // turn-1 bankroll for a player at game start
    // Late joiners get a catch-up stake scaled to the live economy so they
    // aren't broke on arrival. See catchUpStake() in economy.js.
    catchUpFloor: 1500,          // never less than the turn-1 amount
    catchUpFractionOfAvg: 0.6,   // catch-up = max(floor, 0.6 * avg human net worth)
    paydayBase: 200,             // base income for passing the payday space (GO)
  },

  // ---- Board pricing curve -------------------------------------------------
  // Prices climb continuously around the loop. A space's base price =
  // boroughBase[borough] * (1 + positionStep * spaceIndexWithinBorough).
  pricing: {
    boroughBase: [100, 160, 240, 340, 460], // base buy price, borough 1..5
    positionStep: 0.06,        // each space within a borough adds 6% over the last
    rentFractionOfPrice: 0.10, // base rent = 10% of buy price
    buildCostFractionOfPrice: 0.5, // build cost = 50% of lot price per build level
    // space-type modifiers (multiply base price; rent modifier separate)
    typeMods: {
      vacantLot:           { price: 1.00, rent: 1.00 },
      abandonedBuilding:   { price: 1.40, rent: 0.50 }, // costs more, cheap rent
      abandonedApartment:  { price: 1.80, rent: 1.10 },
      abandonedCondo:      { price: 2.10, rent: 1.25 },
      abandonedStore:      { price: 2.30, rent: 1.35 },
      abandonedHotel:      { price: 2.80, rent: 1.60 },
      abandonedCasino:     { price: 3.50, rent: 1.90 },
      anchorSlot:          { price: 4.00, rent: 2.20 },
    },
    demoCost: 0.30,            // demo-and-rebuild costs 30% of price before rebuild
  },

  // ---- Build ladder (contiguity by borough) --------------------------------
  build: {
    // lots of contiguous ownership required to build, per borough (1..5)
    contiguityRequired: [1, 2, 3, 4, 5],
    maxBuildLevel: 5,          // houses -> up to hotels; anchor handled separately
    // value halo: a build raises neighboring lots' value/rent
    halo: {
      radius: 2,               // affects lots within N spaces
      strengthByBuild: {       // % rent/value bump at the source
        house: 0.05, store: 0.10, condo: 0.12, park: 0.15,
        golf: 0.20, stadium: 0.30, casino: 0.25,
      },
      decayPerSpace: 0.4,      // bump falls 40% per space of distance
      stackCap: 0.6,           // total halo bump on any lot capped at +60%
    },
  },

  // ---- Anchors (one per borough) -------------------------------------------
  anchors: {
    typesAllowed: ["football", "basketball", "baseball", "casino"],
    perBorough: 1,
    expandRequiresSurroundingLots: true, // own neighbors to expand capacity
    expandLevels: 3,           // anchor can grow this many times
    placeCostMultiplier: 1.5,  // place cost = basePrice * this
    expandCostMultiplier: 1.0, // each expand = basePrice * this
    rentMultiplierByLevel: [2.0, 3.0, 4.0, 5.0], // rent mult at level 0,1,2,3
  },

  // ---- Career draw triggers ------------------------------------------------
  careers: {
    drawOnDoubles: true,
    drawOnTotals: [7, 11],
    drawOnCareerSpace: true,   // landing on a Career Space draws one too
    rolesPerBorough: [         // full 10-role slate, per borough
      "Boss", "Capo", "Cop", "Politician", "LaborBoss",
      "Inspector", "CasinoManager", "Lawyer", "Judge", "Banker",
    ],
    boroughs: 5,               // => 50 role cards total
  },

  // ---- Economy: skims, splits, sinks ---------------------------------------
  economy: {
    capoSkimUnderBoss: 0.10,   // capo takes 10% of rent on their territory
    capoKickupToBoss: 0.05,    // of which 5% kicks up to the boss
    capoFreelance: 0.05,       // independent capo keeps 5%
    protectionFee: 0.05,       // cop protection = 5% of protected player's rent
    commissionVig: 0.10,       // 10% of every bribe/protection payment -> bank (sink)
    bossUpkeepPerRole: 25,     // boss pays this per controlled role each payday (sink)
    buildingSplit: true,       // build cost splits among Inspector+LaborBoss(+Banker/Pol)
    politicianTaxSplit: true,  // taxes split among politicians in play
    cleanCopFine: 100,         // exposed cop pays this to stay clean
    cleanCityReward: 200,      // each clean holder's reward if the Law wins
  },

  // ---- Action card effects --------------------------------------------------
  actions: {
    hit: {
      maxRolesStolen: 1,           // how many roles the attacker takes per Hit
    },
    rico: {
      minRolesToTarget: 3,         // boss must hold this many roles to be RICO-eligible
      jailTurns: 3,                // how many turns the convicted boss sits in jail
    },
    informant: {
      grantProtectionTurns: 5,     // how many turns the freed player stays protected
    },
    expose: {
      fine: 100,                     // dirty official pays this or loses the role
    },
    accountant: {
      skimFraction: 0.15,            // skim 15% of target's cash to tax pool
    },
    audit: {
      taxPerProperty: 50,            // back-tax per owned property
    },
    election: {
      // no tunables beyond the mechanic: replace a politician in a borough
    },
    strike: {
      durationTurns: 3,             // building shut down in target borough for N turns
    },
    jackpot: {
      // collect the entire free parking pool — no tunables
    },
  },

  // ---- Jail ----------------------------------------------------------------
  jail: {
    maxTurns: 3,                   // auto-release after this many skipped turns
    doublesEscape: true,           // rolling doubles while jailed = early release
    bailCost: 200,                 // pay this to get out immediately (optional)
  },

  // ---- Casino dice ---------------------------------------------------------
  casino: {
    // on landing on a casino, roll two dice:
    free: [7, 11],             // pay nothing
    tripleOnOdd: true,         // odd total -> 3x hotel rent
    doubleOnEven: true,        // even total -> 2x hotel rent
  },

  // ---- Mortgages -----------------------------------------------------------
  mortgage: {
    bankerFeeDefault: 0.05,    // default servicing fee per payday (negotiable)
    principalToBank: true,     // balance of each payment retires principal (sink)
    builderBankerMinFeeToFreeParking: 0.10,
    mortgageFraction: 0.50,    // player receives 50% of base price as cash
    paymentFractionPerPayday: 0.20, // each payday payment = 20% of mortgage value
  },

  // ---- Async / bots --------------------------------------------------------
  bots: {
    tickHours: 4,              // bots act on a server tick every N hours
    dissolveRichestOnHumanJoin: true,
    revertDissolvedPropertyToUnbuilt: true,
    reshuffleDissolvedCards: true,
  },

  // ---- Seasons / win -------------------------------------------------------
  season: {
    enabled: true,
    lengthDays: 7,             // weekly soft-reset
    bountyPoolFromGodfatherTributeFraction: 0.5, // half of tribute -> bounty pool
    godfatherTributePerPayday: 25,
    payoutSplits: [0.50, 0.30, 0.20],  // top 3 split the bounty pool
  },
};
