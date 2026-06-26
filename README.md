# 5 Boroughs on the Take

A mob-themed async board game engine in framework-agnostic JavaScript.
Players move around a 65-space, 5-borough loop buying property, collecting rent,
drawing career/action cards, and wheeling & dealing with mob and law mechanics.

## Quick start
    npm test          # run all tests (smoke, turns, jail, mortgage, halo, anchor, casino, bot AI, save/load, season)
    npm run play      # interactive terminal game (human vs 8 bots)

## Files
- `gameConfig.js`   — Single source of truth for all tunable numbers
- `types.js`        — JSDoc typedefs for every entity (no logic)
- `board.js`        — 65-space board with jail spaces and progressive pricing
- `economy.js`      — Buy/rent/build/contiguity/halo/anchors
- `decks.js`        — 50 career cards + 16 action cards
- `bots.js`         — Bot floor, dissolution, alliance collapse, AI strategy
- `turns.js`        — Turn loop: roll, move, wrap, payday, jail, casino dice
- `actions.js`      — All 10 action card effects (Hit, RICO, Informant, Pardon, Expose, Accountant, Audit, Election, Strike, Jackpot)
- `mortgages.js`    — Mortgage/payoff/payday debt processing
- `season.js`       — Tribute, leaderboard, bounty payout, soft-reset
- `persistence.js`  — Save/load game state to JSON
- `game.js`         — Game init + 10 test suites
- `testActions.js`  — 19 action card effect tests
- `play.js`         — Interactive terminal game with save/load

## Systems implemented
- **Board**: 65 spaces across 5 boroughs, progressive pricing curve, jail spaces
- **Turns**: Roll two dice, move, wrap + payday, buy/rent/career draw
- **Jail**: Landing on jail, skip turns, countdown, doubles escape, bail
- **Action cards**: Hit, RICO, Informant, Pardon, Expose, Accountant, Audit, Election, Strike, Jackpot
- **Economy**: Rent with capo skim/protection, building with contiguity rules
- **Halo**: Build radiates value to neighbors, decay by distance, stack cap
- **Anchors**: Place stadium/casino on anchor slots, expand with neighbor requirement
- **Casino dice**: Special roll on casino landing (free/2x/3x rent)
- **Mortgages**: Mortgage for cash, no rent while mortgaged, payday auto-payments
- **Seasons**: Tribute, bounty pool, leaderboard payouts, soft-reset
- **Bot AI**: Strategic building, mortgaging, Hit/RICO plays
- **Persistence**: Auto-save after each turn, load on startup
