# standings.js and scoring.js Internals, ESPN API, CSS Gotchas — Majors Golf Pool reference

Moved verbatim out of `CLAUDE.md` on 2026-11-11 so it loads only when needed. A cross-reference to another section may now point to a different `docs/claude/` file; grep the folder for the heading.

## ESPN API
Primary endpoint (no key required):
```
https://site.api.espn.com/apis/site/v2/sports/golf/leaderboard?event={espnEventId}
```
Scores cached in Firestore; browser refreshes pull from Firestore. `parseEspnLeaderboard()` in standings.js maps competitors to `{ score, position, status }`. Scores auto-refresh every 5 min while `status === 'locked'`.

**2026 confirmed event IDs:**
- Masters Tournament: `401811941`
- PGA Championship:   `401811947`
- U.S. Open:          `401811952`
- The Open:           `401811957`

Per-round data available via `competitors[n].linescores[]` with `{ period (1–4), value, displayValue }`.

## scoring.js — Key Behavior
`effectiveScore(golferName, scoresMap, mcPenalty)`:
- **Active player**: returns `g.score` from scoresMap (ESPN total to-par)
- **MC/WD player**: returns `g.score + mcPenalty` (actual R1+R2 score **plus** penalty, NOT a flat replacement)
- **Unknown player** (not in scoresMap): returns `mcPenalty` as worst-case

`calculateStandings()` uses `effectiveScore` for all 6 tiers, picks best 4, sorts by total → 5th → 6th. Sets `isTop4` flag on each tier entry.

`DEFAULT_PAYOUT_SPLIT` in standings.js (`[45, 25, 15, 10, 5]`) is used when a tournament has no `prizePayouts` config.

## Past Tournament Data (Hardcoded in standings.js)

### Scoreboard state reset pattern
Every `loadXxxScoreboard()` function **resets DOM state at the top** before deciding what to render. Ensures switching year tabs never shows stale data.

### Year-tracking state variables
```javascript
let mastersActiveYear = 2026;
let pgaActiveYear     = 2026;
let usOpenActiveYear  = 2026;
let theOpenActiveYear = 2026;
```

### `markYearTabsAvailable` hardcoded years
```javascript
const hardcodedYears = major === 'masters' ? [2025] : (major === 'pga' || major === 'usopen' || major === 'theopen') ? [2025] : [];
```
Note: Masters 2026 data lives in Firestore (Firebase tournament record) and is served via `MASTERS_2026_TOTAL` shortcut, not the hardcoded years array.

### Scoreboard HTML element IDs per major
| Major | Loading div | Table | Tbody | Search input |
|-------|------------|-------|-------|--------------|
| Masters | `mastersSbLoading` | `mastersSbTable` | `mastersSbBody` | `mastersSbSearch` |
| PGA Championship | `pgaSbLoading` | `pgaSbTable` | `pgaSbBody` | `pgaSbSearch` |
| U.S. Open | `usopenSbLoading` | `usopenSbTable` | `usopenSbBody` | `usopenSbSearch` |
| The Open | `theopenSbLoading` | `theopenSbTable` | `theopenSbBody` | `theopenSbSearch` |

### Pool panel IDs per major
| Major | Total | Round 1–4 | Payouts |
|-------|-------|-----------|---------|
| Masters | shared `standingsTable` / `standingsBody` | `masters-day1` … `masters-day4` | `masters-finalpayouts` |
| PGA | `pga-total` (rebuilt by `clearPgaPoolPanels()`) | `pga-day1` … `pga-day4` | `pga-finalpayouts` |
| U.S. Open | `usopen-total` | `usopen-day1` … `usopen-day4` | `usopen-finalpayouts` |
| The Open | `theopen-total` | `theopen-day1` … `theopen-day4` | `theopen-finalpayouts` |

### PGA live scoring — parallel state system
PGA has its own independent state to avoid conflicts with the Masters live system:
- **State vars**: `pgaCurrentTournamentId`, `pgaCurrentTournamentStatus`, `pgaCachedResults`, `pgaCachedScoresMap`, `pgaRefreshTimer`
- **Live DOM IDs**: `pgaLoadingMsg`, `pgaStandingsTable`, `pgaStandingsBody`, `pgaNoDataMsg`, `pgaStandingsSearch`, `pgaLastUpdated`, `pgaRefreshBtn`
- **Functions**: `loadPgaTournamentData()`, `renderPgaTable()`, `pgaManualRefresh()`, `updatePgaRefreshButton()`

`clearPgaPoolPanels()` **rebuilds the entire live standings HTML template** inside `#pga-total` — this is required when switching away from the hardcoded 2025 view back to 2026.

### Data shape for pool standings constants (TOTAL and rounds)

Two distinct formats exist in standings.js — do not confuse them:

**Format A — Standard (used by all TOTAL constants + all R1-R4 except Masters 2026 rounds):**
```javascript
{
  rank: number,
  total: number,
  pick: { entrantName: string, picksName: string },  // entrantName = real name, picksName = picks name
  tierScores: {
    t1: { score: number, status: null, golfer: string, isTop4: boolean },
    ...
  }
}
```
Note: `PGA_2025_R1`–`R4` only have `entrantName` in `pick` (no `picksName`).

**Format B — Masters 2026 rounds only (`MASTERS_2026_R1`–`R4`):**
```javascript
{ team: string, tiers: [{ player: string, score: number }, ...] }
```
No rank, no total, no isTop4 — just team name and 6 player/score pairs.

`isTop4` comes from the user's spreadsheet — **do not recalculate**. `status: null` for hardcoded data (MC penalty already baked into score). In live Firestore data, `pick.realName` holds the real name and `pick.entrantName` holds the picks name.

`renderTable()` in standings.js handles both cases: `rawName = r.pick.realName || r.pick.entrantName` (strips trailing number suffix), `picksName = r.pick.picksName || r.pick.entrantName`.

### Year tab switching flow
`switchMajorYear(major, year)` in standings.js:
- Year with Firebase tournament + Masters 2026 → `loadTournamentData()` detects year === 2026 and renders `MASTERS_2026_TOTAL` directly (skips ESPN fetch)
- PGA year with Firebase tournament (2026) → `loadPgaTournamentData()` for live scoring
- Masters/PGA **2025** → calls hardcoded load functions; switching *away* calls `clearXxxPoolPanels()` to wipe injected content
- Other years with no data → Scoreboard tab, "coming soon" for pool panels

**Pattern for adding future majors with hardcoded data:** always implement `clearXxxPoolPanels()` and call it in the `else` branch of the year guard in `switchMajorYear`.

### Season Leaderboard
`loadSeasonLeaderboard()` in standings.js renders the season tab. Currently built from `MASTERS_2026_TOTAL` (one entry per real name, best score if multiple entries). Will grow to include PGA/US Open/The Open columns as those finish. Uses `#seasonTable`, `#seasonBody`, `#seasonLoadingMsg`, `#seasonNoData`.

### Bonus Pool
`loadBonusPool()` in standings.js renders the bonus pool amount and projection. Masters contribution = $25 flat; PGA/US Open/The Open = $1 per entry (fetches pick counts from Firestore). Uses `#bonusPoolAmount`, `#seasonPayoutProjection`.

### Tournament completion status (as of May 2026)

**Masters 2025** (Rory McIlroy -11, Augusta) — All rounds + payouts + scoreboard ✅

**PGA Championship 2025** (Scheffler -11, Quail Hollow) — All rounds + payouts + scoreboard ✅
- Payouts: Bobby Cross 1st $405, Schumann/Pannullo T-2nd $180 ea, Bagnasco 4th $90, Bogardus 5th $45; daily: Vermilyea R1, N. Bova R2, B. Cross R3, Luke S R4 ($25 ea)

**Masters 2026** (Scottie Scheffler -11, Augusta) — All rounds + payouts + scoreboard ✅ — `MASTERS_2026_TOTAL`, `MASTERS_2026_R1`–`R4` all hardcoded
- Pool winner: **Sarah Crowell** (-33); Payouts: Sarah Crowell 1st $520, Mitch Pletcher 2nd $285, Erik Vermilyea T-3rd $142.50, Ron Pannullo T-3rd $142.50, Jeff Mersch 5th $60
- Daily winners: Nick Bova 2 (R1), Brandon Sullivan (R2), Sarah Crowell (R3), Ron Pannullo (R4)

**PGA Championship 2026** — All rounds + payouts + scoreboard ✅ — `PGA_2026_TOTAL`, `PGA_2026_R1`–`R4` all hardcoded

**U.S. Open 2025** (J.J. Spaun -1, Oakmont) — All rounds + payouts + scoreboard ✅ — `USOPEN_2025_TOTAL`, `USOPEN_2025_R1`–`R4` all hardcoded

**The Open Championship 2025** (Scheffler -17, Royal Portrush) — All rounds + payouts + scoreboard ✅ — `THEOPEN_2025_TOTAL`, `THEOPEN_2025_R1`–`R4` all hardcoded

**U.S. Open 2026** — All rounds + payouts + scoreboard ✅ — `US_OPEN_2026_TOTAL`, `US_OPEN_2026_R1`–`R4` all hardcoded. Pool winner: Bobby Cross ("Bobby 2")

**The Open Championship 2026** (Royal Birkdale) — All rounds + payouts + scoreboard ✅ — `THE_OPEN_2026_TOTAL`, `THE_OPEN_2026_R1`–`R4` all hardcoded 2026-07-31. Pool winner: Cameron Schnick ("Schnick 2", -22). Registry id `the-open-2026`; the live Firestore tournament (`NRMXw9q99ZBJ4Wwn5Urd`) and its ~47 picks/scores are still present but redundant — clean up once the hardcoded standings are confirmed live.

This was the final major of the 2026 season — all 4 majors (Masters, PGA, U.S. Open, The Open) are now hardcoded. The Season leaderboard tab computes final season standings automatically from these four constants (see `loadSeasonLeaderboard()`) — there is no separate "mark season final" step needed.

## CSS Gotchas

### Dark mode + per-major theme color conflict
Per-major themes override `--green-muted` to a light color. Any element using `background: var(--green-muted)` will be light even in dark mode. Fix with explicit dark-mode overrides:
```css
[data-theme="dark"] .element { color: #0a1535; }
```

### Mobile horizontal overflow
Wide banner logos can push `.major-banner` past viewport on mobile. Fix: `overflow-x: hidden` on `.major-panel` (600px breakpoint) + `flex-shrink: 1` on `.major-logo`. **Do not** add `overflow-x: hidden` to `body` — breaks `.major-nav` horizontal scroll.

### Admin page mobile navigation
`.btn-nav-header { display: none }` hides nav buttons at 768px. Admin page back link uses `btn-back-home` class with `!important` override for mobile visibility. New admin nav links that must show on mobile need this class.
