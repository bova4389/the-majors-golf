# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Identity
- **Site name**: Basic Bros — Majors Pick'em (BBRC)
- **GitHub repo**: https://github.com/bova4389/the-majors-golf.git
- **Firebase project**: `basic-bros-majors-golf` (projectId in `js/firebase-config.js`)
- **Hosting**: GitHub Pages (deploy from `main` branch — push to main and the site updates automatically)

## Key Contacts
- **Ryne** — Co-commissioner
- **Cody** — Co-commissioner
- **Matt** — Website Vibes Guy

## Tech Stack Constraints
Plain HTML / CSS / Vanilla JS only. **Never introduce npm, Node, webpack, or any build step.** All JS loaded via `<script type="module">` or CDN `<script>` tags. Firebase JS SDK loaded from `https://www.gstatic.com/firebasejs/10.12.0/`.

## How the Pool Works
1. Admin creates a tournament and assigns golfers to 6 tiers via `admin.html`
2. Pool opens — entrants visit `picks.html`, select the open tournament from a 4-card grid, fill in their info, and select 1 golfer per tier
3. Picks lock automatically at `pickDeadline` (or when admin manually flips status to `locked`)
4. During the tournament, `index.html` shows live standings auto-refreshed every 5 min
5. After the tournament, admin flips to `final` and uses the Prize Calculator tab

## Scoring Rules
- Each entrant's score = **best 4 of their 6 golfers'** scores (strokes relative to par)
- Lower total = better (golf scoring)
- **MC/WD penalty**: actual R1+R2 score + mcPenalty (+20 default) = R1+R2 actual + +10 (R3) + +10 (R4)
- Tiebreaker: 5th-best golfer score, then 6th-best; ties split prize money equally
- Scores displayed as: `-12`, `E`, `+3`

## Entry Fee Breakdown (per entry)
- **$25.00** total entry fee
- **−$1.00** → Season-long bonus pool
- **−$0.50** → Website/maintenance fund
- **= $23.50** → Tournament prize pool per entry

The prize calculator in admin uses this formula automatically. Admin only stores `entryFee: 25` in Firestore; the $1.50 deduction is applied at display time in `loadPrizesForAdmin()`.

## Season Bonus Pool Rules
- **The Masters**: $25 flat fee (not per-entry)
- **PGA Championship, U.S. Open, The Open**: $1 per entry
- **Payout**: 100% to single winner (best average finish across all 4 majors)
- **Eligibility**: must submit at least one entry in every completed major

## File Map
| File | Purpose |
|---|---|
| `index.html` | Public standings/leaderboard — all 4 majors + home/season tabs |
| `picks.html` | Public pick submission — tournament selector grid → entry form |
| `admin.html` | Admin-only management panel |
| `css/styles.css` | All styles |
| `js/firebase-config.js` | Firebase credentials + SDK init; exports `getDb()`, `getAuthInstance()` |
| `js/scoring.js` | Pure scoring logic (no Firebase, no DOM) — import anywhere |
| `js/standings.js` | Leaderboard page: ESPN API fetch, Firestore cache, render table, all hardcoded past data |
| `js/picks.js` | Pick form: tournament selection grid, tier loading, form validation, Firestore submit |
| `js/admin.js` | Admin panel: Firebase Auth + all CRUD for tournaments/tiers/picks/scores/prizes |

## Firestore Data Model

```
tournaments/{autoId}
  name, major ('masters'|'pga'|'us-open'|'the-open'), year,
  entryFee, mcPenalty, pickDeadline (ISO string),
  espnEventId, status ('open'|'locked'|'final'),
  prizePayouts ([{place, pct}])
  — NOTE: no entryPassword field; password was removed

tiers/{tournamentId}
  tier1: [{ name, worldRank }], tier2: [...], ..., tier6: [...]

picks/{autoId}
  tournamentId, realName, entrantName (= Picks Name, unique per tournament),
  email, phone, t1, t2, t3, t4, t5, t6, submittedAt

scores/{tournamentId}
  {golferName}: { score (number, to-par), position, status ('active'|'cut'|'wd'), lastUpdated }
```

**Critical**: The `major` field values in Firestore come from admin.html's `<select id="tFormMajor">` — these are `masters`, `pga`, `us-open`, `the-open`. The picks.js `MAJORS` array must use these exact keys or the tournament selection grid won't match open tournaments.

## picks.html — Entry Form Fields
All 4 info fields are required; no entry password:
1. **Your Name** (`entrantRealName`) — real name; stored as `realName`; tracked across all tournaments
2. **Picks Name** (`entrantName`) — unique per tournament; stored as `entrantName`; must be distinct from all other entries for that tournament
3. **Email** — required
4. **Cell Phone** — required

Uniqueness is enforced on `entrantName` (Picks Name) via Firestore query before write.

After successful submit, `showSuccessSummary()` in picks.js:
- Renders a table of all 6 tier selections in `#successPicksSummary`
- Builds a `mailto:` link pre-addressed to the entrant's email with their picks in the body, shown as **📧 Email Yourself a Copy** (`#successMailtoBtn`)
- Displays an amber warning box telling users to email/screenshot their picks because standings are hidden until the tournament begins
- Shows **Submit Another Entry** (returns to tournament selector) and **View Standings** buttons

`backToTournamentSelect()` hides `#successMailtoBtn` and resets the form. The submit button state is reset in both `openPicksForm()` and the success path to prevent it getting stuck as "Submitting..." on subsequent entries.

## Tournament Selection Grid (picks.html)
`loadPickForm()` in picks.js fetches all tournaments, then `renderTournamentSelect()` renders 4 major cards. A card is clickable (`major-card--open`) only if a matching tournament has `status === 'open'` and `pickDeadline` hasn't passed. Clicking calls `openPicksForm(tournament)` which fetches the tiers doc and shows the form.

## Admin Workflow
1. Log in at `admin.html` (Firebase Auth — multiple admin accounts supported)
2. **Tournaments tab**: Create/edit tournament — no entry password field
3. **Tiers & Golfers tab**: Select tournament → each tier has **Bulk Add** button → paste one name per line → Save All. Golfers are stored as `{ name, worldRank: null }`.
4. Set status to `open` → picks form becomes live
5. Picks auto-lock at `pickDeadline`; admin can manually flip to `locked`
6. During tournament: scores auto-refresh from ESPN; admin can override individual scores
7. After final round: flip status to `final` → Prize Calculator tab shows payouts

## Standings Blind

`loadTournamentData()` in standings.js hides the picks table while picks are still being collected. When `status === 'open'` and `Date.now() < pickDeadline`, the function returns early after showing:

> *"Standings are hidden while picks are open. Check back after [deadline]."*

This prevents entrants from seeing each other's picks before the deadline and copying them. The blind lifts automatically once the deadline passes — even if the admin hasn't manually flipped status to `locked` yet. If no `pickDeadline` is set on the tournament, the blind stays up indefinitely while status is `open`.

The auto-refresh interval (`setInterval`) only starts when `status === 'locked'`, so ESPN score fetching is entirely separate from this visibility check.

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
| PGA | `pga-total` | `pga-day1` … `pga-day4` | `pga-finalpayouts` |
| U.S. Open | `usopen-total` | `usopen-day1` … `usopen-day4` | `usopen-finalpayouts` |
| The Open | `theopen-total` | `theopen-day1` … `theopen-day4` | `theopen-finalpayouts` |

PGA/US Open/The Open use `innerHTML` injection; Masters live data uses the shared `standingsTable` element.

### Data shape for pool standings constants (TOTAL and rounds)
```javascript
{
  rank: number,
  total: number,
  pick: { entrantName: string },  // entrantName = Picks Name
  tierScores: {
    t1: { score: number, status: null, golfer: string, isTop4: boolean },
    ...
  }
}
```
`isTop4` comes from the user's spreadsheet — **do not recalculate**. `status: null` for hardcoded data (MC penalty already baked into score).

### Year tab switching flow
`switchMajorYear(major, year)` in standings.js:
- Year with Firebase tournament → loads live data from Firestore
- Masters/PGA **2025** → calls hardcoded load functions; switching *away* calls `clearXxxPoolPanels()` to wipe injected content
- Other years with no data → Scoreboard tab, "coming soon" for pool panels

**Pattern for adding future majors with hardcoded data:** always implement `clearXxxPoolPanels()` and call it in the `else` branch of the year guard in `switchMajorYear`.

### 2025 completion status (as of May 2026)

**Masters 2025** (Rory McIlroy -11, Augusta) — All rounds + payouts + scoreboard ✅

**PGA Championship 2025** (Scheffler -11, Quail Hollow) — All rounds + payouts + scoreboard ✅
- Payouts: Bobby Cross 1st $405, Schumann/Pannullo T-2nd $180 ea, Bagnasco 4th $90, Bogardus 5th $45; daily: Vermilyea R1, N. Bova R2, B. Cross R3, Luke S R4 ($25 ea)

**U.S. Open 2025** (J.J. Spaun -1, Oakmont) — Scoreboard ✅ | Pool standings ❌ not yet hardcoded

**The Open Championship 2025** (Scheffler -17, Royal Portrush) — Scoreboard ✅ | Pool standings ❌ not yet hardcoded

### Planned: Picks Name column for Masters historical data
Next update needed: add `picksName` alongside `entrantName` in hardcoded standings constants. Copy current `entrantName` → `picksName`; strip trailing numbers from `entrantName` to get the real name. This enables season-long aggregation by real name across multiple entries per person.

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

## Completed Tournament Lockdown
- Auto-refresh skips non-`locked` tournaments ✓
- Refresh button disabled when `status === 'final'` ✓
- ESPN API calls skipped for non-`locked` tournaments ✓
- TODO: per-tournament Refresh button scoped to each major panel (when per-panel live scoring is built)

## PGA Championship 2026 — Pre-Tournament Checklist

### Admin Tasks (Monday when field is finalized)
1. **Finalize tiers in admin.html** — Bulk-add all 6 tiers with the confirmed field
2. **Confirm tournament record in Firestore has:**
   - `espnEventId: "401811947"` ← critical for live scores
   - `pickDeadline` set correctly (before Thursday tee times)
   - `mcPenalty: 20`
   - `status: "open"`

### Right Before the Tournament (at pick deadline)
3. **Manually flip status to `locked`** in admin.html — starts the 5-min auto-refresh timer on the PGA standings page

### Testing Checklist
4. **Test standings blind** — With status `open` and a future `pickDeadline`, the PGA Total tab should show *"Standings are hidden while picks are open..."* rather than the table or an infinite spinner
5. **Test Refresh button end-to-end** — Flip status to `locked`, click Refresh on PGA tab; should hit ESPN, cache scores in Firestore `scores/{tournamentId}`, and render the table (all entries at `mcPenalty` before play starts — expected)
6. **Verify ESPN event ID is active** — Run in browser console:
   ```
   fetch('https://site.api.espn.com/apis/site/v2/sports/golf/leaderboard?event=401811947').then(r=>r.json()).then(d=>console.log(d?.events?.[0]?.name, d?.events?.[0]?.competitions?.[0]?.competitors?.length))
   ```
   Should return event name + player count. ESPN sometimes activates event IDs 1–2 days before the tournament.
7. **Test search on PGA tab** — Confirm entry/player name filtering works
8. **Check mobile layout** — Refresh button + timestamp in year tab bar can overflow on small screens

### During the Tournament
- Scores auto-refresh every 5 min when status is `locked` — no manual action needed
- Manual Refresh button available for immediate update
- Use admin → score override for any ESPN data that looks wrong for an individual player

### Known Gaps (PGA 2026, non-blockers)
- R1–R4 round tabs show "coming soon" — will be hardcoded after the tournament like Masters/PGA 2025 was
- U.S. Open 2025 and The Open 2025 pool standings not yet hardcoded (scoreboards done)

## Prize Payout Logic
- Prize pool = $23.50 × entries (see Entry Fee Breakdown above)
- Admin defines payout % per place as JSON in tournament settings: `[{"place":1,"pct":40},...]`
- Ties: tied entrants split the combined prize money for those places
- Prize display shows 2 decimal places
