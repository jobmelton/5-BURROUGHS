// ===========================================================================
// One-off: slice the labeled building sheet into individual transparent PNGs.
// Source: graphics/Gemini_..._k8lt.png — 1024x1024, 5 cols x 5 rows = 25 cells.
// Each cell has the building + base plate on top, a baked-in text label at the
// bottom; we crop off the label band (trimFrac) and keep the building.
//
// The source has NO real alpha — the "transparent" look is a painted checkerboard
// of two light greys (~255 and ~201). We key it out PER TILE with an edge
// flood-fill (seeded from each tile's own border) so interior window-lights and
// enclosed checkerboard pockets between buildings are handled correctly. Only
// background-coloured pixels reachable from a tile edge become transparent, so
// grey-stone facades and lit windows stay opaque.
//
// Output: public/assets/buildings/<artSlug>.png  (named by the art's identity).
// Run: node scripts/sliceBuildings.mjs [trimFrac]
// ===========================================================================
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { PNG } from 'pngjs';

const SRC = 'graphics/Gemini_Generated_Image_k8ltpqk8ltpqk8lt.png';
const OUT = 'public/assets/buildings';
const COLS = 5, ROWS = 5;
const trimFrac = Number(process.argv[2] ?? 0.20); // fraction of cell height cropped off the bottom (label band)

// Row-major identities, matching the labels baked into the sheet.
const SLUGS = [
  'house', 'megaCasino', 'apartmentBuilding', 'officeTower', 'bank',
  'retailShop', 'hotel', 'trainStation', 'factory', 'warehouse',
  'docks', 'hospital', 'school', 'school2', 'policeStation',
  'fireStation', 'cityHall', 'theater', 'restaurant', 'radioTower',
  'gasStation', 'parkPavilion', 'arena', 'championshipStadium', 'megaCasinoTower',
];

// Edge flood-fill keying on a single tile PNG. Background = bright + low-saturation
// (the grey/white checkerboard). Buildings are warm/saturated or dark, so they survive.
function keyTile(png) {
  const { width: W, height: H, data } = png;
  const isBg = (p) => {
    const o = p * 4, r = data[o], g = data[o + 1], b = data[o + 2];
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    return (mx - mn) <= 22 && mn >= 150;
  };
  const visited = new Uint8Array(W * H);
  const stack = [];
  for (let x = 0; x < W; x++) stack.push(x, (H - 1) * W + x);
  for (let y = 0; y < H; y++) stack.push(y * W, y * W + W - 1);
  while (stack.length) {
    const p = stack.pop();
    if (visited[p]) continue;
    visited[p] = 1;
    if (!isBg(p)) continue;
    data[p * 4 + 3] = 0;
    const x = p % W, y = (p / W) | 0;
    if (x > 0) stack.push(p - 1);
    if (x < W - 1) stack.push(p + 1);
    if (y > 0) stack.push(p - W);
    if (y < H - 1) stack.push(p + W);
  }
}

const src = PNG.sync.read(readFileSync(SRC));
const { width: W, height: H } = src;
mkdirSync(OUT, { recursive: true });

let i = 0;
for (let r = 0; r < ROWS; r++) {
  for (let c = 0; c < COLS; c++, i++) {
    const left = Math.round((c * W) / COLS);
    const right = Math.round(((c + 1) * W) / COLS);
    const top = Math.round((r * H) / ROWS);
    const cellH = Math.round(((r + 1) * H) / ROWS) - top;
    const w = right - left;
    const h = Math.round(cellH * (1 - trimFrac));
    const out = new PNG({ width: w, height: h });
    PNG.bitblt(src, out, left, top, w, h, 0, 0);
    keyTile(out);
    writeFileSync(`${OUT}/${SLUGS[i]}.png`, PNG.sync.write(out));
  }
}
console.log(`Sliced + keyed ${i} buildings -> ${OUT}/ (trimFrac=${trimFrac})`);
