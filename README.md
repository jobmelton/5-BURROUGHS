# 5 Boroughs on the Take — Component Draft (v1)

A runnable JavaScript draft of the core game engine for the async, dice-and-track
mobile app. Framework-agnostic logic you can wire to any UI (web/React Native/etc.)
or hand to Claude Code to extend.

## Run the smoke test
    node src/game.js

## Files
- `src/gameConfig.js` — THE single source of truth for all tunable numbers. Balance here.
- `src/types.js`      — data-model definitions for every entity (board, players, cards, state).
- `src/board.js`      — builds the 5-borough loop with progressive pricing + space types.
- `src/economy.js`    — buying, rent (capo skim/protection/halo), building, contiguity, catch-up stake.
- `src/decks.js`      — the 50 career cards + 16 action cards.
- `src/bots.js`       — async seats: bot floor, richest-bot dissolution, alliance-collapse, double setback.
- `src/game.js`       — game initializer + smoke test wiring it all together.

## What's drafted vs. still to build
DRAFTED: board, pricing curve, decks, buy/rent/build/contiguity, catch-up stake,
bot floor + richest-bot dissolution + alliance collapse, game state + a passing smoke test.

NEXT (stubs to flesh out): turn/dice resolution, the full mob-vs-law action cards
(Hit/RICO/Informant/etc.), mortgages + debt ledger, anchors & halos applied on build,
season/leaderboard logic, server-tick bot AI, persistence layer, and the UI screens.
