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

### Data constants
Each tournament year has up to 6 constants:
- `MASTERS_20XX_FIELD` — PGA official scoreboard (used by the Scoreboard tab)
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
`switchMajorYear('masters', year)` in `standings.js`:
- Year with Firebase tournament → loads live data from Firestore
- Year **2025** (no Firebase data) → calls `clearMastersPoolPanels()` then immediately calls `loadMasters2025TotalStandings()`, `loadMasters2025Round1Standings()`, `loadMasters2025Round2Standings()`, and `loadMasters2025Payouts()`, and activates the Total inner tab instead of jumping to Scoreboard
- Other years with no Firebase data → jumps to Scoreboard tab, shows "coming soon" for pool panels

### 2025 completion status (as of May 2026)
- Total standings: ✅ done (`MASTERS_2025_TOTAL`, `loadMasters2025TotalStandings`)
- Round 1: ✅ done (`MASTERS_2025_R1`, `loadMasters2025Round1Standings`)
- Round 2: ✅ done (`MASTERS_2025_R2`, `loadMasters2025Round2Standings`)
- Round 3: ✅ done (`MASTERS_2025_R3`, `loadMasters2025Round3Standings`)
- Round 4: ✅ done (`MASTERS_2025_R4`, `loadMasters2025Round4Standings`)
- Final Payouts: ✅ fully done (`loadMasters2025Payouts`); daily winner chips pull tier scores from `roundDataMap` which references all four round constants

### Adding a round for a future year (template)
1. Add `MASTERS_20XX_RN` constant (same shape as existing round constants)
2. Add `loadMasters20XXRoundNStandings()` — targets `masters-dayN`, tbody id `rNStandingsBody`, search input id `rNSearch`
3. Add the call in `switchMajorYear` for that year
4. Update `loadMasters20XXPayouts()` to include a `roundDataMap` referencing all round constants

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
