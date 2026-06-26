# 5 Boroughs on the Take — Claude Code Guide

## Project overview
Mob-themed async board game engine in framework-agnostic JavaScript (ES modules).
Players move around a 65-space, 5-borough loop buying property, collecting rent,
drawing career/action cards, and wheeling & dealing with mob and law mechanics.

## Run commands
- Smoke test + turn loop: `node game.js`
- Action card test: `node testActions.js`
- Interactive play: `node play.js`

## Architecture
- `gameConfig.js` — THE single source of truth for every tunable number. Never hard-code values.
- `types.js` — JSDoc typedefs for every entity (no logic).
- `board.js` — builds the 65-space loop with progressive pricing.
- `economy.js` — buy/rent/build/contiguity/catch-up stake.
- `decks.js` — career pool (50 cards) + action deck (16 cards).
- `bots.js` — bot floor, dissolution, alliance collapse.
- `turns.js` — single-player turn: roll, move, resolve space.
- `actions.js` — action card effects (Hit, RICO, Informant, Pardon).
- `game.js` — game init + smoke/turn-loop tests.
- `testActions.js` — action card effect tests.

## Rules
- All tunable numbers go in `gameConfig.js`, nowhere else.
- Every new system gets a test in `game.js` or its own `test*.js` file.
- ES module syntax (`import`/`export`), no CommonJS.
- Keep files small and focused — one system per file.
