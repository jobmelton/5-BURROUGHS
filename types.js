// ===========================================================================
// 5 BOROUGHS ON THE TAKE — types.js
// Plain-JS "shapes" (documented as JSDoc typedefs) for every core entity.
// This is the data model the whole game keys off. No logic here.
// ===========================================================================

/**
 * @typedef {'vacantLot'|'abandonedBuilding'|'abandonedApartment'|'abandonedCondo'
 *  |'abandonedStore'|'abandonedHotel'|'abandonedCasino'|'anchorSlot'
 *  |'career'|'jail'|'freeParking'|'payday'} SpaceType
 */

/**
 * @typedef {Object} Space
 * @property {number} index        Absolute position on the loop (0..N-1)
 * @property {number} borough      1..5
 * @property {SpaceType} type
 * @property {number} basePrice     Buy price (computed from config curve)
 * @property {number} baseRent      Rent at build level 0
 * @property {?string} ownerId      Player/bot id, or null if unowned
 * @property {string} [name]        Player-given name (filtered) once owned
 * @property {number} buildLevel    0 = empty/standing, up to maxBuildLevel
 * @property {?('football'|'basketball'|'baseball'|'casino')} anchorType
 * @property {number} anchorLevel   0 if not expanded, up to anchors.expandLevels
 * @property {number} haloBonus     Current cumulative halo bump (0..stackCap)
 */

/**
 * @typedef {'Boss'|'Capo'|'Cop'|'Politician'|'LaborBoss'|'Inspector'
 *  |'CasinoManager'|'Lawyer'|'Judge'|'Banker'} RoleType
 */

/**
 * @typedef {Object} CareerCard
 * @property {string} id
 * @property {RoleType} role
 * @property {number} borough       1..5 (which borough's slate)
 * @property {?string} ownedById    if the mob owns this official, the owner id
 * @property {boolean} clean        for Cop/Politician/Judge: still honest?
 */

/**
 * @typedef {'Hit'|'RICO'|'Informant'|'Expose'|'Accountant'|'Audit'
 *  |'Election'|'Strike'|'Pardon'|'Jackpot'} ActionType
 */

/** @typedef {Object} ActionCard @property {string} id @property {ActionType} type */

/**
 * @typedef {Object} Debt
 * @property {string} id
 * @property {string} bankerId
 * @property {number} principalRemaining
 * @property {number} paymentPerPayday
 * @property {number} bankerFee        fraction to banker; rest retires principal
 */

/**
 * @typedef {Object} StatusEffects
 * @property {?string} protectedByCopId   non-null => immune to skims & hits
 * @property {?string} ownedByBossId      non-null => mob owns this player's income
 * @property {boolean} jailed
 * @property {number}  jailTurns
 */

/**
 * @typedef {Object} Player
 * @property {string} id
 * @property {string} name
 * @property {boolean} isBot
 * @property {number} cash
 * @property {number} position          space index
 * @property {string[]} propertyIds     spaces owned
 * @property {CareerCard[]} roles       career cards held
 * @property {ActionCard[]} hand        action cards held
 * @property {Debt[]} debts
 * @property {StatusEffects} status
 * @property {string[]} allianceIds     players/bots in this player's organization
 * @property {number} netWorth          cached: cash + property value
 */

/**
 * @typedef {Object} GameState
 * @property {string} gameId
 * @property {Space[]} board
 * @property {Object<string,Player>} players   keyed by id (humans + bots)
 * @property {CareerCard[]} careerPool         undrawn/returned career cards
 * @property {ActionCard[]} actionPool
 * @property {number} taxPool
 * @property {number} bountyPool
 * @property {number} freeParkingPool
 * @property {number} cleanCityMeter           0..1 (1 = fully clean)
 * @property {?string} godfatherId
 * @property {number} seasonEndsAt             timestamp
 * @property {number} lastBotTickAt           timestamp
 * @property {'mob'|'law'|'ongoing'} status
 */

export const ROLE_TYPES = [
  'Boss','Capo','Cop','Politician','LaborBoss',
  'Inspector','CasinoManager','Lawyer','Judge','Banker',
];

export const ACTION_TYPES = [
  'Hit','RICO','Informant','Expose','Accountant','Audit',
  'Election','Strike','Pardon','Jackpot',
];

export const CLEAN_ROLES = ['Cop','Politician','Judge']; // determine Clean City win
