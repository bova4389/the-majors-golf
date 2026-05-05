# Majors Golf Pool — Project Context

## Project Identity
- **Site name**: Basic Bros - Majors Golf
- **GitHub repo**: https://github.com/bova4389/the-majors-golf.git
- **Firebase project**: basic-bros-majors-golf (projectId in firebase-config.js)
- **Hosting**: GitHub Pages (deploy from `main` branch)

## What This Is
A static website for a recurring golf pool covering all 4 major tournaments (Masters, US Open, The Open Championship, PGA Championship). 30–80 entrants each submit picks for a single tournament; the site displays live standings during play and calculates prize payouts.

## Tech Stack
- **Frontend**: Plain HTML / CSS / Vanilla JS — no build tools, no npm, no frameworks
- **Database**: Firebase Firestore (free tier) — all reads/writes via the JS SDK loaded from CDN
- **Auth**: Firebase Auth — single admin account only; public users have no login
- **Live scores**: ESPN unofficial golf API (primary), The Golf API fallback
- **Hosting**: GitHub Pages — all files must be static; no server-side code

**Rule**: Never introduce npm, Node, webpack, or any build step. All JS must be vanilla or loaded via `<script>` CDN tags.

## How the Pool Works
1. Admin creates a tournament and assigns golfers to 6 tiers
2. Pool opens — entrants visit `picks.html`, enter a shared entry password, and select 1 golfer per tier
3. Picks lock automatically at Thursday tee time (or when admin manually locks)
4. During the tournament, `index.html` shows live standings auto-refreshed every 5 min
5. Final standings determine prize payouts

## Scoring Rules
- Each entrant's score = best 4 of their 6 golfers' scores (strokes relative to par)
- Lower total = better (golf scoring)
- WD / MC (missed cut) = **+20 stroke penalty** (configurable per tournament)
- Tiebreaker: 5th-best golfer score, then 6th-best
- Scores displayed as: `-12`, `E`, `+3`
- Ties split prize money equally

## Season Bonus Pool Rules
- **The Masters**: $25 flat fee taken from the Masters pool (not per-entry)
- **PGA Championship, U.S. Open, The Open**: $1 per entry per tournament
- **Payout**: 100% to the single winner (best average finish across all 4 majors)
- **Eligibility**: must submit at least one entry in every completed major
- In `loadBonusPool()`: Masters contribution is hardcoded as `25`; PGA/US Open/The Open counts are fetched from Firestore at tournament IDs `pga-2026`, `usopen-2026`, `theopen-2026`

## Key Contacts (site content)
- **Ryne** — Co-commissioner
- **Cody** — Co-commissioner
- **Matt** — Website Vibes Guy

## File Map
| File | Purpose |
|---|---|
| `index.html` | Public standings/leaderboard |
| `picks.html` | Public pick submission form (locked after deadline) |
| `admin.html` | Admin-only management panel |
| `css/styles.css` | All styles |
| `js/firebase-config.js` | Firebase project credentials + SDK init |
| `js/scoring.js` | Pure scoring logic (no Firebase calls) |
| `js/standings.js` | Leaderboard page: fetch picks + scores, render table |
| `js/picks.js` | Pick form: load tiers, validate, submit to Firestore |
| `js/admin.js` | Admin panel: Firebase Auth + all CRUD operations |

## Firestore Data Model
```
tournaments/{id}
  name, year, major, prizePool, entryFee, entryPassword,
  pickDeadline (ISO string), mcPenalty (number), status (open|locked|final),
  espnEventId (for API calls)

tiers/{tournamentId}
  tier1: [{ name, worldRank }], tier2: [...], ..., tier6: [...]

picks/{pickId}
  tournamentId, entrantName, email, t1, t2, t3, t4, t5, t6, submittedAt

scores/{tournamentId}
  {golferName}: { score (number), position, status (active|cut|wd), lastUpdated }
```

## ESPN API
Primary endpoint (no key required):
```
https://site.api.espn.com/apis/site/v2/sports/golf/leaderboard?event={espnEventId}
```
Scores are cached in Firestore to avoid hammering the API; browser refreshes pull from Firestore.

**2026 confirmed event IDs:**
- Masters Tournament: `401811941`
- PGA Championship:   `401811947`
- U.S. Open:          `401811952`
- The Open:           `401811957`

Per-round data is available via `competitors[n].linescores` array: each entry has `period` (1-4),
`value` (raw score), `displayValue` (to-par string), `inScore`, `outScore`, `currentPosition`.

## Past Tournament Data (Hardcoded in standings.js)

Completed tournaments without Firebase data are hardcoded directly in `standings.js`. The pattern is:

### Scoreboard state reset pattern
Every `loadXxxScoreboard()` function **resets DOM state at the top of each call** (hides table, clears tbody, restores loading text) before deciding what to render. This ensures that switching year tabs never leaves stale data visible. If no players are found (e.g. 2026 pre-tournament), the loading element shows "Scoreboard not yet available for this year." and the table stays hidden.

### Year-tracking state variables
```javascript
let mastersActiveYear = 2026;
let pgaActiveYear     = 2026;
let usOpenActiveYear  = 2026;
let theOpenActiveYear = 2026;
```
Each is set in `switchMajorYear()` before the corresponding `loadXxxScoreboard()` is called.

### `markYearTabsAvailable` hardcoded years
The 2025 year tab is enabled for all four majors even without a Firebase tournament, because all four have hardcoded 2025 scoreboard data. The relevant line:
```javascript
const hardcodedYears = major === 'masters' ? [2025] : (major === 'pga' || major === 'usopen' || major === 'theopen') ? [2025] : [];
```

### Scoreboard HTML element IDs per major
| Major | Loading div | Table | Tbody | Search input |
|-------|------------|-------|-------|--------------|
| Masters | `mastersSbLoading` | `mastersSbTable` | `mastersSbBody` | `mastersSbSearch` |
| PGA Championship | `pgaSbLoading` | `pgaSbTable` | `pgaSbBody` | `pgaSbSearch` |
| U.S. Open | `usopenSbLoading` | `usopenSbTable` | `usopenSbBody` | `usopenSbSearch` |
| The Open | `theopenSbLoading` | `theopenSbTable` | `theopenSbBody` | `theopenSbSearch` |

### Pool panel IDs per major (hardcoded standings inject into these)
| Major | Total | Round 1–4 | Payouts |
|-------|-------|-----------|---------|
| Masters | shared `standingsTable` / `standingsBody` | `masters-day1` … `masters-day4` | `masters-finalpayouts` |
| PGA | `pga-total` | `pga-day1` … `pga-day4` | `pga-finalpayouts` |
| U.S. Open | `usopen-total` | `usopen-day1` … `usopen-day4` | `usopen-finalpayouts` |
| The Open | `theopen-total` | `theopen-day1` … `theopen-day4` | `theopen-finalpayouts` |

PGA/US Open/The Open use `innerHTML` injection (not the shared `standingsTable` element used by Masters live data).

### Data constants
Each tournament year has up to 6 constants:
- `MASTERS_20XX_FIELD` / `PGA_20XX_FIELD` / `USOPEN_20XX_FIELD` / `THEOPEN_20XX_FIELD` — full field scoreboard
- `MASTERS_20XX_TOTAL` — Pool total standings (all entries, final ranks)
- `MASTERS_20XX_R1/R2/R3/R4` — Round-by-round pool standings
- `MASTERS_20XX_FINISHERS` — Top 5 finishers for the Payouts tab (2026 only; 2025 uses `loadMasters2025Payouts()`)

### Data shape for pool standings (TOTAL and rounds)
```javascript
{
  rank: number,
  total: number,
  pick: { entrantName: string },
  tierScores: {
    t1: { score: number, status: null, golfer: string, isTop4: boolean },
    t2: ..., t3: ..., t4: ..., t5: ..., t6: ...
  }
}
```
`isTop4` is provided by the user from their spreadsheet — **do not recalculate it**. Score is a plain integer (negative = under par). `status` is `null` for all players (no MC/WD distinction needed in hardcoded data since the score already reflects any penalty).

### Year tab switching flow
`switchMajorYear(major, year)` in `standings.js`:
- Year with Firebase tournament → loads live data from Firestore
- Masters **2025** → calls `clearMastersPoolPanels()`, then loads all hardcoded standings, activates Total inner tab
- PGA **2025** → calls all `loadPga2025Xxx()` functions; switching *away* from 2025 calls `clearPgaPoolPanels()` to wipe injected content
- Other years with no data → jumps to Scoreboard tab, shows "coming soon" for pool panels

**Pattern for adding future majors with hardcoded pool data:** always implement a `clearXxxPoolPanels()` function (sets placeholder text in all pool panel divs) and call it in the `else` branch of the year-2025 guard in `switchMajorYear`. Without this, navigating back to 2026 shows stale 2025 content.

### 2025 completion status (as of May 2026)

**Masters 2025** (Rory McIlroy -11, Augusta)
- Total standings: ✅ done (`MASTERS_2025_TOTAL`, `loadMasters2025TotalStandings`)
- Round 1: ✅ done (`MASTERS_2025_R1`, `loadMasters2025Round1Standings`)
- Round 2: ✅ done (`MASTERS_2025_R2`, `loadMasters2025Round2Standings`)
- Round 3: ✅ done (`MASTERS_2025_R3`, `loadMasters2025Round3Standings`)
- Round 4: ✅ done (`MASTERS_2025_R4`, `loadMasters2025Round4Standings`)
- Final Payouts: ✅ fully done (`loadMasters2025Payouts`)
- Scoreboard: ✅ done (`MASTERS_2025_FIELD`, `loadMastersScoreboard`)

**PGA Championship 2025** (Scheffler -11, Quail Hollow)
- Scoreboard: ✅ done (`PGA_2025_FIELD`, `loadPgaScoreboard`)
- Total standings: ✅ done (`PGA_2025_TOTAL`, `loadPga2025TotalStandings`)
- Round 1: ✅ done (`PGA_2025_R1`, `loadPga2025Round1Standings`)
- Round 2: ✅ done (`PGA_2025_R2`, `loadPga2025Round2Standings`)
- Round 3: ✅ done (`PGA_2025_R3`, `loadPga2025Round3Standings`)
- Round 4: ✅ done (`PGA_2025_R4`, `loadPga2025Round4Standings`)
- Final Payouts: ✅ done (`loadPga2025Payouts`) — Bobby Cross 1st $405, Chris Schumann/Ron Pannullo T-2nd $180 ea, Jeff Bagnasco 4th $90, Jake Bogardus 5th $45; daily winners: Erik Vermilyea R1, Nick Bova R2, Bobby Cross R3, Luke S R4 ($25 ea)

**U.S. Open 2025** (J.J. Spaun -1, Oakmont)
- Scoreboard: ✅ done (`USOPEN_2025_FIELD`, `loadUsOpenScoreboard`)
- Pool standings: ❌ not yet hardcoded

**The Open Championship 2025** (Scheffler -17, Royal Portrush)
- Scoreboard: ✅ done (`THEOPEN_2025_FIELD`, `loadTheOpenScoreboard`)
- Pool standings: ❌ not yet hardcoded

### Adding a round for a future year (template)
1. Add `MASTERS_20XX_RN` constant (same shape as existing round constants)
2. Add `loadMasters20XXRoundNStandings()` — targets `masters-dayN`, tbody id `rNStandingsBody`, search input id `rNSearch`
3. Add the call in `switchMajorYear` for that year
4. Update `loadMasters20XXPayouts()` to include a `roundDataMap` referencing all round constants

## CSS Gotchas

### Dark mode + per-major theme color conflict
Per-major themes override `--green-muted` to a **light** color (e.g. `body.theme-pga { --green-muted: #d4dff5; }`). Any element using `background: var(--green-muted)` will have a light background even in dark mode. The `.pot-strip-label` and inner tab hover/active states are affected. The fix is explicit dark-mode overrides:
```css
[data-theme="dark"] .pot-strip-label { color: #0a1535; } /* keep text dark against light badge bg */
```
Always check per-major theme interactions when adding new elements that use `--green-muted` or `--green`.

### Mobile horizontal overflow
Wide banner logos (PGA Championship, U.S. Open, The Open have landscape-format logos) can push `.major-banner` past the viewport width on mobile. The fix is `overflow-x: hidden` on `.major-panel` (600px breakpoint) combined with `flex-shrink: 1` on `.major-logo`. Do not add `overflow-x: hidden` to `body` — it breaks the `.major-nav` horizontal scroll.

### Admin page mobile navigation
`.btn-nav-header { display: none }` hides navigation buttons at 768px. On `admin.html`, the "← Leaderboard" back link uses class `btn-back-home` which has an `!important` override to remain visible on mobile. Any new admin-page nav links that must appear on mobile should use this class.

## Admin Workflow
1. Log in at `admin.html` with Firebase email/password
2. Create tournament → fills in name, dates, prize pool, entry fee, entry password, ESPN event ID
3. Add golfers → assign each to a tier (1–6)
4. Set status to `open` → picks form becomes active
5. Picks auto-lock at `pickDeadline`; admin can also manually flip to `locked`
6. During tournament: scores refresh automatically; admin can override individual scores
7. After final round: flip status to `final` → prize calculator shows payouts

## Completed Tournament Lockdown (TODO — not yet fully built)
When a tournament's status is set to `final`, the following must be enforced:
- **Auto-refresh stops**: `standings.js` already skips the `setInterval` for non-`locked` tournaments ✓
- **Refresh button disabled**: `updateRefreshButton()` in `standings.js` greys out the Refresh button when `status === 'final'` ✓
- **ESPN API calls blocked**: `fetchOrRefreshScores()` skips the ESPN fetch for non-`locked` tournaments ✓
- **Per-tournament page**: each major panel will eventually need its own Refresh button scoped to that panel's tournament — wire up the same `status === 'final'` guard when that work is done

## Prize Payout Logic
- Total pool = entryFee × number of entries
- Admin defines payout percentages per place (e.g., 1st 40%, 2nd 25%, 3rd 15%, ...)
- Ties: tied entrants split the combined prize money for those places
