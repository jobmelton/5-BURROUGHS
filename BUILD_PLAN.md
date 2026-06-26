# BUILD PLAN — 5 Boroughs on the Take

Milestones to take the engine from draft to playable terminal game.
Each milestone builds on the last; mark ✅ when done.

## M1 — Turn loop ✅
Roll two dice, move around the board, wrap + payday, buy/rent/career draw.
File: `turns.js`, test in `game.js`.

## M2 — Action card effects ✅
Wire up Hit, RICO, Informant, Pardon with real game-state mutations.
File: `actions.js`, test: `testActions.js`.

## M3 — Jail mechanics ✅
- Landing on a jail space sends the player to jail.
- Jailed players skip their turn; jail turns count down each turn.
- Doubles rolled while jailed = early release.
- RICO jail turns already wired; integrate into the turn loop.
- Test: a player goes to jail, sits, and gets released.

## M4 — Mortgages & debt ledger ✅
- A player can mortgage a property to the bank for cash (fraction of base price).
- Mortgaged properties don't collect rent.
- Each payday, mortgage payments auto-deduct (principal + banker fee).
- Debt clears when principal hits 0; property un-mortgages.
- Test: mortgage, collect no rent, pay down, clear.

## M5 — Halo system on build ✅
- When a player builds, apply the value halo to neighboring lots.
- Halo decays by distance, stacks up to the cap.
- Building raises effective rent for neighbors within radius.
- Test: build on a lot, verify neighbor halo bumps and cap.

## M6 — Season & leaderboard ✅
- Season timer counts down over configured days.
- At season end: rank players by net worth, pay out bounty pool.
- Godfather tribute collected each payday; half goes to bounty pool.
- Soft-reset: properties revert, careers reshuffle, cash resets.
- Test: simulate season end, verify payouts and reset.

## M7 — Interactive terminal play (`play.js`) ✅
- Stdin-driven game loop: roll, buy/pass, play action cards, view status.
- Human vs bots, bots auto-play on simple heuristics.
- Print board state, player stats, and turn history.
- Playable end-to-end from `node play.js`.

## M8 — Remaining action cards ✅
- Wire up the 6 unimplemented action types: Expose, Accountant, Audit, Election, Strike, Jackpot.
- Expose: reveal a dirty official; if cop/politician/judge, they pay cleanCopFine or lose the role.
- Accountant: audit a player's hidden income; skim a fraction to the tax pool.
- Audit: force a player to pay back-taxes on all properties to the bank.
- Election: replace a politician in a borough; the old holder loses the card.
- Strike: shut down building in a borough for a number of turns.
- Jackpot: collect the entire free parking pool.
- Test each card effect.

## M9 — Anchor mechanics ✅
- Place an anchor (football/basketball/baseball/casino) on an anchor slot.
- Expand anchor up to expandLevels if player owns surrounding lots.
- Anchors generate premium rent based on type and level.
- Test: place, expand, verify rent.

## M10 — Casino dice ✅
- Landing on a casino-type space triggers a special dice roll.
- Roll 7 or 11: pay nothing (free).
- Odd total: pay 3x hotel rent.
- Even total: pay 2x hotel rent.
- Test: simulate casino landings with different rolls.

## M11 — Smarter bot AI ✅
- Bots evaluate whether to buy based on cash reserves and board position.
- Bots play action cards when beneficial (Hit rich rivals, RICO bosses, etc.).
- Bots mortgage when cash-strapped, build when they have contiguity.
- Bots make alliance decisions based on relative power.
- Test: simulate bot turns and verify strategic choices.

## M12 — Save/load persistence ✅
- Save game state to a JSON file.
- Load game state from a JSON file on startup.
- Auto-save after each turn in play.js.
- Commands: `save`, `load` in play.js.
- Test: save, modify state, load, verify restored.

## M13 — Package.json + polish ✅
- Add package.json with `"type": "module"` to silence the ES module warning.
- Update CLAUDE.md and README.md to reflect all new systems.
- Clean up any dead code or stale comments.

## M14 — Terminal UI upgrade
- ANSI colors for boroughs, player highlights, rent/buy events.
- ASCII board map showing player positions.
- Turn history log visible on screen.
- Property detail view: show build level, rent, halo, mortgage status.
