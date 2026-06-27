// ===========================================================================
// 5 BOROUGHS ON THE TAKE — board.js
// Builds the dice-and-track loop: 5 boroughs, progressive pricing, mixed
// space types, one career space + one anchor slot per borough.
// ===========================================================================
import { CONFIG } from './gameConfig.js';

const { pricing } = CONFIG;

// How the spaces in each borough are laid out, in order around the loop.
// Tunable: the mix and count of space types per borough.
// 18 spaces per borough = 90 total. Mix of vacant lots and abandoned buildings
// of increasing value. Abandoned properties cost more (premium locations) but
// require a demo fee before rebuilding. Higher-tier abandoneds are rarer and
// clustered in later boroughs for natural price escalation.
const BOROUGH_LAYOUT = [
  'payday',                                    // borough start marker (GO)
  'vacantLot', 'vacantLot', 'abandonedHouse',  // cheap start
  'career',                                    // career card draw
  'vacantLot', 'abandonedStore', 'abandonedStripMall',
  'vacantLot', 'anchorSlot',                   // casino/stadium anchor
  'abandonedApartment', 'vacantLot', 'abandonedCondoTower',
  'freeParking',                                // mid-borough free parking
  'abandonedSkyrise',                          // premium lot — expensive but huge potential
  'freeParking', 'tax', 'jail',                // second free parking + tax square + jail
];

/** base price for a space given its borough and its index within that borough */
function priceFor(borough, idxInBorough, type) {
  const base = pricing.boroughBase[borough - 1];
  const positional = base * (1 + pricing.positionStep * idxInBorough);
  const mod = pricing.typeMods[type]?.price ?? 1;
  return Math.round(positional * mod);
}
function rentFor(price, type) {
  const mod = pricing.typeMods[type]?.rent ?? 1;
  return Math.round(price * pricing.rentFractionOfPrice * mod);
}

/** Build the full board (array of Space objects) for a 5-borough loop. */
export function buildBoard() {
  const board = [];
  let index = 0;
  for (let borough = 1; borough <= CONFIG.careers.boroughs; borough++) {
    BOROUGH_LAYOUT.forEach((type, idxInBorough) => {
      const isPlayable = ![ 'payday', 'career', 'jail', 'freeParking', 'tax' ].includes(type);
      const price = isPlayablePrice(type) ? priceFor(borough, idxInBorough, type) : 0;
      board.push({
        index,
        borough,
        type,
        basePrice: price,
        baseRent: isPlayablePrice(type) ? rentFor(price, type) : 0,
        ownerId: null,
        buildLevel: 0,
        anchorType: null,
        anchorLevel: 0,
        haloBonus: 0,
        partnership: null,
        mobOwnerId: null,
        buildingType: null,
        rentMultiplier: null,
      });
      index++;
    });
  }
  return board;
}

// price-bearing spaces: vacant lots, all abandoned types, anchor slots
function isPlayablePrice(type) {
  return type === 'anchorSlot' || type === 'vacantLot' || type.startsWith('abandoned');
}

/** Check if a space type requires demo before building. */
export function requiresDemo(type) {
  return type.startsWith('abandoned');
}

/** Helper: list the space indices contiguous to a given index within the same borough. */
export function contiguousNeighbors(board, index) {
  const here = board[index];
  return [index - 1, index + 1]
    .filter(i => i >= 0 && i < board.length)
    .filter(i => board[i].borough === here.borough);
}
