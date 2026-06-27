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
    propertyTaxRate: 0.02,         // 2% of total property VALUE per GO (scales with empire size)
    emptyLotSurcharge: 0.03,      // empty (unbuilt) lots pay an EXTRA 3% (total 5%) — develop or lose money
    maxPropertiesBeforeSurtax: 8,  // after 8 properties, additional 1% per lot on ALL properties
    surtaxPerExtraLot: 0.01,      // 1% extra per lot over the cap
    maxActiveRoles: 3,           // max active roles per player; extras go dormant
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
      vacantLot:              { price: 1.00, rent: 1.00 },  // cheapest, blank canvas
      abandonedHouse:         { price: 1.20, rent: 0.80 },  // tier 1 abandoned
      abandonedStore:         { price: 1.50, rent: 1.00 },  // tier 1 abandoned
      abandonedStripMall:     { price: 2.00, rent: 1.30 },  // tier 2 abandoned
      abandonedApartment:     { price: 2.50, rent: 1.50 },  // tier 2 abandoned
      abandonedCondoTower:    { price: 3.00, rent: 1.80 },  // tier 3 abandoned
      abandonedSkyrise:       { price: 4.00, rent: 2.20 },  // tier 4 abandoned — premium location
      anchorSlot:             { price: 5.00, rent: 2.50 },  // tier 5-6 — casino/stadium potential
    },
    demoCost: 0.30,            // demo-and-rebuild costs 30% of price before rebuild
  },

  // ---- Building tiers (by contiguous lots owned) ---------------------------
  // Each tier unlocks bigger builds with higher rent and ROI.
  // Cost is a multiplier on the lot's base price. Rent mult replaces base rent.
  // Halo radius increases with tier — development lifts the whole neighborhood.
  build: {
    // Each tier has SEQUENTIAL steps. You must build through every step in order.
    // All contiguous lots must reach the LAST step of a tier before any can
    // start the next tier. 27 total upgrade steps from empty to Championship Stadium.
    tiers: [
      {
        contiguous: 1,
        label: 'Tier 1 — Single Lot',
        steps: [
          { type: 'house',         label: 'House',           costMult: 0.30, rentMult: 2.0,  roi: 0.12 },
          { type: 'duplex',        label: 'Duplex',          costMult: 0.45, rentMult: 2.8,  roi: 0.16 },
          { type: 'cornerStore',   label: 'Corner Store',    costMult: 0.60, rentMult: 3.5,  roi: 0.20 },
          { type: 'restaurant',    label: 'Restaurant',      costMult: 0.80, rentMult: 4.5,  roi: 0.25 },
          { type: 'boutiqueHotel', label: 'Boutique Hotel',  costMult: 1.00, rentMult: 5.5,  roi: 0.30 },
        ],
        haloRadius: 1,
      },
      {
        contiguous: 2,
        label: 'Tier 2 — Two Lots',
        steps: [
          { type: 'multifamily',   label: 'Multifamily',     costMult: 1.20, rentMult: 7.0,  roi: 0.35 },
          { type: 'stripMall',     label: 'Strip Mall',      costMult: 1.50, rentMult: 8.5,  roi: 0.40 },
          { type: 'medicalPlaza',  label: 'Medical Plaza',   costMult: 1.80, rentMult: 10.0, roi: 0.45 },
          { type: 'condos',        label: 'Condos',          costMult: 2.20, rentMult: 12.0, roi: 0.50 },
          { type: 'luxuryCondos',  label: 'Luxury Condos',   costMult: 2.60, rentMult: 14.0, roi: 0.55 },
        ],
        haloRadius: 2,
      },
      {
        contiguous: 3,
        label: 'Tier 3 — Three Lots',
        steps: [
          { type: 'aptComplex',    label: 'Apartment Complex',  costMult: 3.00, rentMult: 16.0, roi: 0.58 },
          { type: 'autoDealer',    label: 'Auto Dealership',    costMult: 3.50, rentMult: 18.0, roi: 0.62 },
          { type: 'miniMall',      label: 'Mini Mall',          costMult: 4.00, rentMult: 20.0, roi: 0.66 },
          { type: 'officePark',    label: 'Office Park',        costMult: 4.50, rentMult: 23.0, roi: 0.70 },
          { type: 'boutiqueResort',label: 'Boutique Resort',    costMult: 5.00, rentMult: 26.0, roi: 0.75 },
        ],
        haloRadius: 3,
      },
      {
        contiguous: 4,
        label: 'Tier 4 — Four Lots',
        steps: [
          { type: 'mixedUseRetail', label: 'Mixed-Use Retail',   costMult: 5.50, rentMult: 30.0,  roi: 0.78 },
          { type: 'parkingStructure',label: 'Parking Structure',  costMult: 6.50, rentMult: 35.0,  roi: 0.82 },
          { type: 'corpTower',      label: 'Corporate Tower',    costMult: 7.50, rentMult: 40.0,  roi: 0.85 },
          { type: 'resTower',       label: 'Residential Tower',  costMult: 8.50, rentMult: 45.0,  roi: 0.88 },
          { type: 'skyriseHotel',   label: 'Skyrise Hotel',      costMult: 10.00, rentMult: 50.0, roi: 0.92 },
        ],
        haloRadius: 4,
      },
      {
        contiguous: 5,
        label: 'Tier 5 — Five Lots',
        steps: [
          { type: 'entertainmentComplex', label: 'Entertainment Complex', costMult: 12.00, rentMult: 60.0, roi: 0.93 },
          { type: 'conventionCenter',     label: 'Convention Center',     costMult: 14.00, rentMult: 70.0, roi: 0.95 },
          { type: 'casino',               label: 'Casino',               costMult: 16.00, rentMult: 80.0, roi: 0.97 },
          { type: 'megaCasino',            label: 'Mega Casino',          costMult: 20.00, rentMult: 100.0, roi: 0.99 },
        ],
        haloRadius: 5,
      },
      {
        contiguous: 6,
        label: 'Tier 6 — Six+ Lots',
        steps: [
          { type: 'sportsArena',          label: 'Sports Arena',          costMult: 25.00, rentMult: 120.0, roi: 0.96 },
          { type: 'stadium',              label: 'Stadium',              costMult: 30.00, rentMult: 150.0, roi: 0.98 },
          { type: 'championshipStadium',  label: 'Championship Stadium', costMult: 40.00, rentMult: 200.0, roi: 1.00 },
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

    // --- Role income buffs (balancing weak roles) ---
    inspectorPermitFee: 0.03,       // inspector earns 3% of ALL build costs in their borough (automatic)
    laborBossWageFee: 0.02,         // laborBoss earns 2% of ALL rent in their borough (labor surcharge)
    casinoManagerMinimumCut: 25,    // CM earns at least $25 per casino landing even if rent is 0
    judgeCourtFee: 15,              // judge earns $15 every time someone goes to jail (court costs)
    lawyerRetainerPerGo: 10,        // lawyer earns $10 per protected client each GO (retainer)
    bankerInterestFloor: 0.05,      // banker earns at least 5% on all outstanding loans automatically
  },

  // ---- Jail (nerfed cop bail) ----------------------------------------------

  // ---- Action card effects --------------------------------------------------
  actions: {
    hit: {
      maxRolesStolen: 1,           // how many roles the attacker takes per Hit
    },
    rico: {
      minRolesToTarget: 2,         // boss must hold this many roles to be RICO-eligible
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

  jail: {
    maxTurns: 3,                   // auto-release after this many skipped turns
    doublesEscape: true,           // rolling doubles while jailed = early release
    bailCost: 100,                 // pay this to get out (halved from 200 — nerf cop income)
    copBailShare: 0.50,            // cop only gets 50% of bail (rest to court/bank sink)
  },

  // ---- The Pit (inner ring) ------------------------------------------------
  // Outer jail/tax/freeParking spaces are converted to two-way "pitEntry" blocks.
  // Land on one and your NEXT roll pulls you into this shared inner ring, which
  // you roll along until you hit an EXIT (back to GO) or a JAIL space (center
  // jail — reuses the normal jail economy). Equal LUCK vs DEMISE, plus 5 exits.
  pit: {
    // ringLayout length defines the ring size. 5 sectors of [exit, luck, demise]:
    // 5 exit / 5 luck (3 park + 2 career) / 5 demise (3 tax + 2 jail).
    ringLayout: [
      'exit', 'luckPark',   'demiseTax',
      'exit', 'luckCareer', 'demiseJail',
      'exit', 'luckPark',   'demiseTax',
      'exit', 'luckCareer', 'demiseJail',
      'exit', 'luckPark',   'demiseTax',
    ],
    entryRingIndex: 0,    // ring "mouth" — entry roll advances from here
    releasePayday: true,  // pit EXIT and center-jail release send player to GO with payday
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
    mobDebtPayoffMultiplier: 1.5,    // pay back 1.5x borrowed to escape mob ownership
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
