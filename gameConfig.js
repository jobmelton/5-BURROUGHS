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

  // ---- Building tiers (by contiguous lots owned) ---------------------------
  // Each tier unlocks bigger builds with higher rent and ROI.
  // Cost is a multiplier on the lot's base price. Rent mult replaces base rent.
  // Halo radius increases with tier — development lifts the whole neighborhood.
  build: {
    tiers: [
      {
        contiguous: 1,
        label: 'Tier 1 — Single Lot',
        options: [
          { type: 'house',        label: 'House',          costMult: 0.50, rentMult: 2.0,  roi: 0.10 },
          { type: 'cornerStore',  label: 'Corner Store',   costMult: 0.60, rentMult: 2.2,  roi: 0.13 },
          { type: 'restaurant',   label: 'Restaurant',     costMult: 0.70, rentMult: 2.5,  roi: 0.15 },
        ],
        haloRadius: 1,
      },
      {
        contiguous: 2,
        label: 'Tier 2 — Two Lots',
        options: [
          { type: 'multifamily',  label: 'Multifamily',    costMult: 1.00, rentMult: 3.0,  roi: 0.25 },
          { type: 'stripMall',    label: 'Strip Mall',     costMult: 1.20, rentMult: 3.5,  roi: 0.30 },
          { type: 'condos',       label: 'Condos',         costMult: 1.50, rentMult: 4.0,  roi: 0.35 },
        ],
        haloRadius: 2,
      },
      {
        contiguous: 3,
        label: 'Tier 3 — Three Lots',
        options: [
          { type: 'aptComplex',   label: 'Apartment Complex', costMult: 2.00, rentMult: 5.0,  roi: 0.40 },
          { type: 'autoDealer',   label: 'Auto Dealership',   costMult: 2.20, rentMult: 5.5,  roi: 0.48 },
          { type: 'miniMall',     label: 'Mini Mall',         costMult: 2.50, rentMult: 6.0,  roi: 0.55 },
        ],
        haloRadius: 3,
      },
      {
        contiguous: 4,
        label: 'Tier 4 — Four Lots',
        options: [
          { type: 'skyriseRetail',  label: 'Skyrise Mixed-Use',  costMult: 3.00, rentMult: 8.0,   roi: 0.60 },
          { type: 'retailTower',    label: 'Retail Tower',       costMult: 3.50, rentMult: 9.0,   roi: 0.68 },
          { type: 'residentialTower', label: 'Residential Tower', costMult: 4.00, rentMult: 10.0,  roi: 0.75 },
        ],
        haloRadius: 4,
      },
      {
        contiguous: 5,
        label: 'Tier 5 — Five Lots',
        options: [
          { type: 'casino',       label: 'Casino',         costMult: 5.00, rentMult: 15.0, roi: 0.85 },
        ],
        haloRadius: 5,
      },
      {
        contiguous: 6,
        label: 'Tier 6 — Six+ Lots',
        options: [
          { type: 'stadium',      label: 'Stadium',        costMult: 7.00, rentMult: 20.0, roi: 0.95 },
          { type: 'arena',        label: 'Arena',          costMult: 8.00, rentMult: 25.0, roi: 1.00 },
        ],
        haloRadius: 6,
      },
    ],
    demoCost: 0.30,              // demo surcharge for abandoned properties (fraction of price)
    halo: {
      decayPerSpace: 0.25,       // halo decays 25% per space of distance (gentler for bigger builds)
      stackCap: 1.50,            // total halo on any lot capped at +150% (allows cheap boroughs to flip)
      basePctPerTier: [0.05, 0.10, 0.15, 0.20, 0.30, 0.40], // halo strength per tier (% of base rent)
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

  // ---- Notifications -------------------------------------------------------
  notifications: {
    defaultExpiryTurns: 3,       // notifications expire after N turns if no response
    historyLimit: 100,           // keep last N resolved notifications for history
    crossBoroughContactFee: 50,  // fee to contact a Boss/Capo in another borough
  },

  // ---- Lending ------------------------------------------------------------
  lending: {
    // Bank loans (from Banker role holder)
    bankForeclosureToUnowned: true,  // bank foreclosure = property goes unowned
    // Mob loans (from Boss)
    mobCreatesMoneyFromNothing: true, // Boss can loan money they don't have
    mobForeclosureToMob: true,       // mob foreclosure = property becomes Boss's
    mobDebtLockout: true,            // while in mob debt, mob is your only lender
  },

  // ---- Partnerships -------------------------------------------------------
  partnerships: {
    allowedSplits: [25, 50, 75],     // available partnership split percentages
    distressedBuyoutAtDebt: true,    // can buy out distressed partner for just their debt
  },

  // ---- Property landing ---------------------------------------------------
  propertyLanding: {
    politicianPurchaseTax: 0.01,     // 1% tax on all land purchases to Politician
    politicianAuctionTax: 0.05,      // 5% transfer tax on auction/flip sales
  },

  // ---- Dormant cards ------------------------------------------------------
  dormant: {
    seizeableRoles: ['Boss', 'Capo'], // these roles can be seized from dormant holders
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
