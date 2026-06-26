# BUILD PLAN — 5 Boroughs on the Take

Milestones to take the engine from draft to playable terminal game.
Each milestone builds on the last; mark ✅ when done.

## M1 — Turn loop ✅
Roll two dice, move around the board, wrap + payday, buy/rent/career draw.
File: `turns.js`, test in `game.js`.

## M2 — Action card effects ✅
Wire up Hit, RICO, Informant, Pardon with real game-state mutations.
File: `actions.js`, test: `testActions.js`.

## M3 — Jail mechanics
- Landing on a jail space sends the player to jail.
- Jailed players skip their turn; jail turns count down each turn.
- Doubles rolled while jailed = early release.
- RICO jail turns already wired; integrate into the turn loop.
- Test: a player goes to jail, sits, and gets released.

## M4 — Mortgages & debt ledger
- A player can mortgage a property to the bank for cash (fraction of base price).
- Mortgaged properties don't collect rent.
- Each payday, mortgage payments auto-deduct (principal + banker fee).
- Debt clears when principal hits 0; property un-mortgages.
- Test: mortgage, collect no rent, pay down, clear.

## M5 — Halo system on build
- When a player builds, apply the value halo to neighboring lots.
- Halo decays by distance, stacks up to the cap.
- Building raises effective rent for neighbors within radius.
- Test: build on a lot, verify neighbor halo bumps and cap.

## M6 — Season & leaderboard
- Season timer counts down over configured days.
- At season end: rank players by net worth, pay out bounty pool.
- Godfather tribute collected each payday; half goes to bounty pool.
- Soft-reset: properties revert, careers reshuffle, cash resets.
- Test: simulate season end, verify payouts and reset.

## M7 — Interactive terminal play (`play.js`)
- Stdin-driven game loop: roll, buy/pass, play action cards, view status.
- Human vs bots, bots auto-play on simple heuristics.
- Print board state, player stats, and turn history.
- Playable end-to-end from `node play.js`.
