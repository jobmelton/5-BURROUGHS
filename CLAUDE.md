# 5 Boroughs on the Take — Claude Code Guide

## Project overview
Mob-themed async board game engine in framework-agnostic JavaScript (ES modules).
Players move around a 65-space, 5-borough loop buying property, collecting rent,
drawing career/action cards, and wheeling & dealing with mob and law mechanics.

## Run commands
- Tests: `npm test` or `node game.js && node testActions.js`
- Interactive play: `npm run play` or `node play.js`

## Architecture
- `gameConfig.js` — THE single source of truth for every tunable number. Never hard-code values.
- `types.js` — JSDoc typedefs for every entity (no logic).
- `board.js` — builds the 65-space loop with jail spaces and progressive pricing.
- `economy.js` — buy/rent/build/contiguity/halo/anchor placement and expansion.
- `decks.js` — career pool (50 cards) + action deck (16 cards).
- `bots.js` — bot floor, dissolution, alliance collapse, strategic AI.
- `turns.js` — turn loop: roll, move, wrap, payday, jail, casino dice.
- `actions.js` — all 10 action card effects.
- `mortgages.js` — mortgage/payoff/payday debt processing.
- `season.js` — tribute, leaderboard, bounty payout, soft-reset.
- `persistence.js` — save/load game state to JSON.
- `game.js` — game init + 10 test suites.
- `testActions.js` — 19 action card effect tests.
- `play.js` — interactive terminal game with save/load and bot AI.

## Rules
- All tunable numbers go in `gameConfig.js`, nowhere else.
- Every new system gets a test in `game.js` or its own `test*.js` file.
- ES module syntax (`import`/`export`), no CommonJS.
- Keep files small and focused — one system per file.
- `savegame.json` is auto-generated; add to `.gitignore` if needed.
