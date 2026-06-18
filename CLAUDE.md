# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Identity
- **Site name**: Basic Bros — Majors Pick'em (BBRC)
- **GitHub repo**: https://github.com/bova4389/the-majors-golf.git
- **Firebase project**: `basic-bros-majors-golf` (projectId in `js/firebase-config.js`)
- **Domain**: https://basic-bros-pga-pickems.com
- **Hosting**: DreamHost (fully hosted) — push to `main` and GitHub Actions automatically deploys via SFTP
- **Deploy workflow**: `.github/workflows/deploy.yml` uses `wlixcc/SFTP-Deploy-Action` → uploads to `/home/mattbova/basic-bros-pga-pickems.com/` on DreamHost
- **GitHub Actions secrets required**: `FTP_SERVER`, `FTP_USERNAME`, `FTP_PASSWORD` (set in repo Settings → Secrets → Actions)

## Key Contacts
- **Ryne** — Co-commissioner
- **Cody** — Co-commissioner
- **Matt** — Website Vibes Guy

## Priority: PII Data Split (do after current tournament closes)

**Problem**: The `picks` collection stores `email` and `phone` alongside the leaderboard fields. Because the public leaderboard must be able to read `picks`, the entire document — including PII — is technically readable via the Firestore REST API by anyone who knows the project ID (which is visible in `firebase-config.js`). Email and phone are never rendered on the public leaderboard, but they are accessible if someone queries Firestore directly.

**Fix**: Split PII into a separate admin-only collection at pick-submission time.

### Target data model

```
picks/{autoId}                         ← publicly readable (leaderboard needs it)
  tournamentId, realName, entrantName,
  t1, t2, t3, t4, t5, t6, submittedAt

pickDetails/{same autoId as picks}     ← admin-read-only (NEW)
  tournamentId, realName, entrantName,
  email, phone
```

### What needs to change

1. **`js/picks.js`** — in the submit function, write two documents atomically:
   - `picks/{id}` — everything except email and phone
   - `pickDetails/{id}` — tournamentId, realName, entrantName, email, phone
   Use the same auto-generated ID for both so they stay in sync.

2. **`js/admin.js`** — update `loadPicksForAdmin()` and `loadPaymentsForAdmin()` to join `picks` + `pickDetails` on document ID so the admin Picks tab still shows email and phone columns. Admin visibility must not be lost.

3. **`js/admin.js`** — update `saveAdminPick()` to write/update both documents.

4. **`js/admin.js`** — update `deletePick()` to delete both documents.

5. **`js/admin.js`** — update `exportPicksCsv()` to include email and phone sourced from `pickDetails`.

6. **Firestore security rules** (Firebase Console → Firestore → Rules) — apply these rules:

```js
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /picks/{id} {
      allow read: if true;
      allow write: if true;
    }
    match /pickDetails/{id} {
      allow read, write: if request.auth != null;
    }
    match /tournaments/{id} {
      allow read: if true;
      allow write: if request.auth != null;
    }
    match /tiers/{id} {
      allow read: if true;
      allow write: if request.auth != null;
    }
    match /scores/{id} {
      allow read: if true;
      allow write: if request.auth != null;
    }
    match /payments/{id} {
      allow read, write: if request.auth != null;
    }
    match /{document=**} {
      allow read, write: if false;
    }
  }
}
```

7. **Data migration** — existing picks already in Firestore have email/phone in the `picks` document. After the code ships, run a one-time migration: for each existing `picks` doc that has `email` or `phone`, create the matching `pickDetails` doc, then remove `email` and `phone` from the `picks` doc. This can be done from the browser console while logged in as admin using the Firebase SDK.

### Why not do this during a live tournament
Any code change to `picks.js` during an active submission window risks breaking the form mid-submission. Wait until the current tournament closes (status → `final`), then implement and migrate. The risk to PII in the interim is low — this is a small private pool with no realistic scraper threat.

## Cache Busting (Required — Do Not Remove)

Safari on mobile caches pages aggressively. To prevent users from seeing stale versions after a deployment:

1. **`.htaccess`** (already in this repo) — sends `no-cache` headers for all HTML/JS/CSS files. Never delete it.
2. **`?v=` query string on every local JS/CSS `<script src>` and `<link rel="stylesheet">` tag** — must be bumped on every change to that file.

### Version string rule (critical — follow exactly)

**Format:** `?v=YYYYMMDD` — bump to today's date whenever you edit the file.

**Same-day collision rule:** If the version string already shows today's date, append or increment a letter suffix: `20260618` → `20260618b` → `20260618c` etc. Never leave the version unchanged after editing a file — a collision means users keep the old cached version even after a deploy.

**How to check before editing:** Always grep for the current `?v=` value in `index.html` for the file you are about to change. If it already equals today's date, use the next available suffix.

If you add any new local `<script src>` or `<link rel="stylesheet">` tags, include `?v=YYYYMMDD` on those too.

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
| `archive-scripts/` | Python scripts for exporting all tournament data to CSV (see Data Archive section) |
| `data-archive/` | CSV backups organized as `{year}/{major}/scoreboard.csv`, `picks.csv`, `standings_*.csv` |
| `Picks/` | Manual admin CSV exports (one subfolder per tournament) |

## Firestore Data Lifecycle — Critical

**Firestore only holds data for the CURRENT active season.** Once a tournament is fully finalized and its standings are hardcoded into `standings.js`, the Firestore records for that tournament (tournaments doc, picks, tiers, scores) are cleaned up and deleted. This is intentional — the hardcoded JS constants become the permanent record.

**As of May 2026:**
- Only the two 2026 tournaments exist in Firestore (`masters-2026` and `AMcWqXqIGQN605XypuDI` for PGA)
- All 2025 tournament records, picks, tiers, and scores have been removed from Firestore
- The 2025 pool data lives **only** in the hardcoded constants in `standings.js`

**Implication:** For any past tournament (2025 and earlier), the picks/golfer selections for each entrant only survive as the `golfer` fields embedded in the `tierScores` of the hardcoded standings constants. There is no separate picks backup for 2025.

**Scripting against Firestore:** The web API key in `firebase-config.js` can be used directly with the Firestore REST API — no service account key required. The `picks` and `tournaments` collections have `allow read: if true` in the security rules, so they are publicly readable. See `archive-scripts/archive_picks.py` for the REST API pattern.

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
  — NOTE: email and phone will move to pickDetails once the PII split is implemented (see priority section above)

pickDetails/{same autoId}  ← does not exist yet; created by the PII split
  tournamentId, realName, entrantName, email, phone

scores/{tournamentId}
  {golferName}: { score (number, to-par), position, status ('active'|'cut'|'wd'), lastUpdated }
```

**Critical**: The `major` field values in Firestore come from admin.html's `<select id="tFormMajor">` — these are `masters`, `pga`, `us-open`, `the-open`. The picks.js `MAJORS` array must use these exact keys or the tournament selection grid won't match open tournaments.

## Major Key Normalization

Two parallel key systems exist — be careful not to confuse them:

| Context | Values |
|---------|--------|
| Firestore `major` field / picks.js MAJORS array | `masters`, `pga`, `us-open`, `the-open` |
| standings.js internal keys (for `tournamentsByMajor`, DOM IDs) | `masters`, `pga`, `usopen`, `theopen` |

`normalizeMajorKey()` in standings.js maps Firestore values → internal keys. `us-open` → `usopen`, `the-open` → `theopen`. This function is used every time a tournament is grouped or looked up by major in the leaderboard.

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

`loadTournamentData()` and `loadPgaTournamentData()` both hide the picks table while picks are still open. When `status === 'open'` and `Date.now() < pickDeadline`, the function returns early after showing:

> *"Standings are hidden while picks are open. Check back after [deadline]."*

The blind lifts automatically once the deadline passes. If no `pickDeadline` is set, the blind stays up indefinitely while status is `open`. The auto-refresh interval only starts when `status === 'locked'`.

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

**The Open Championship 2025** (Scheffler -17, Royal Portrush) — Scoreboard ✅ | Pool standings ❌ not yet hardcoded (`THEOPEN_2025_TOTAL` and rounds still needed)

**U.S. Open 2026** — Next upcoming tournament (ESPN event ID `401811952`)
**The Open Championship 2026** — Future (ESPN event ID `401811957`)

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
- Refresh button disabled when `status === 'final'` ✓ (both Masters and PGA have their own refresh buttons)
- ESPN API calls skipped for non-`locked` tournaments ✓
- Masters 2026 skips ESPN fetch entirely — `MASTERS_2026_TOTAL` served directly ✓

## Live Tournament Runbook (reuse for each new major)

### Known Failure Modes (learned from US Open 2026 launch)

**1. Firestore security rules block scores write → standings won't load**
The public page writes ESPN scores to Firestore to cache them. If the `scores` collection requires auth to write, the entire standings load silently fails (the catch block hides everything). The `scores` rule MUST be `allow write: if true`.
- Symptom: page stuck on "Loading standings..." forever
- Check: Firebase Console → Firestore → Rules — confirm `match /scores/{id} { allow write: if true; }`
- Full required rules are in the "Firestore security rules" section below

**2. firebase-config.js version mismatch → getDb() returns null**
`index.html` and `standings.js` must import `firebase-config.js` with the SAME `?v=` query string. Different strings = different module instances = `db` is never set in the instance that standings.js uses.
- Symptom: "Firestore unavailable — Expected first argument to collection() to be a CollectionReference" in browser console; page stuck on "Loading standings..."
- Fix: whenever `firebase-config.js?v=` is bumped in `index.html`, update the same string in line 1 of `standings.js` to match

**3. Wrong tournament status → nothing works**
Valid statuses are ONLY `"open"`, `"locked"`, `"final"`. Any other value (e.g. `"in-progress"`) is not recognized — auto-refresh won't start, ESPN won't be fetched on schedule.
- At tournament start: set status to `"locked"` — not anything else

**4. Status never auto-flips**
The site never automatically changes status in Firestore. The `pickDeadline` silently stops new pick submissions and lifts the standings blind, but the Firestore status field must always be flipped manually in admin.html. Build this into your pre-tournament checklist.

**5. Picks submission "Missing or insufficient permissions"**
The `picks` collection must have `allow write: if true`. If rules are ever re-published without this, submissions will fail for all users.

---

### Live Scoreboard Tab — Known Pitfalls (learned from US Open 2026)

These apply to any major's ESPN live scoreboard tab (`loadXxxScoreboard()`).

**1. Scoreboard never loads — function is never called**
`setYearTabActive()` only updates CSS tab button styles. It does NOT trigger `switchMajorYear()` or call the scoreboard loader. Two call sites are required:
- In `loadStandings()` preload block — so scoreboard fires on initial page load
- In `switchMajor()` in `index.html` — using a `xxxTabLoaded` boolean flag so the scoreboard fires on first tab click if the user skips the default tab

If either call site is missing, the scoreboard will never load. Replicate the `usOpenTabLoaded` pattern exactly for any future major.

**2. Scoreboard function not reachable from `switchMajor()`**
`switchMajor()` is a non-module `<script>` that runs before the ES module loads. It can only call `window.loadXxxScoreboard`. The function must be:
1. `export`ed from `standings.js`
2. Imported in the module `<script>` in `index.html`
3. Assigned to `window.loadXxxScoreboard` in that same module script

Missing any one of these three steps breaks the tab-click path silently.

**3. Total score shows "E" for all active players mid-round**
ESPN's top-level `c.score.displayValue` field shows `"E"` for all active players during a round — it does not update mid-round. Always compute the total by summing completed `linescores` entries:
```js
const completedRounds = rounds.filter(r => r !== null);
const total = completedRounds.length > 0
  ? completedRounds.reduce((sum, r) => sum + r, 0)
  : (totalStr === 'E' ? 0 : (parseFloat(totalStr) || 0));
```
`rounds` is built from `c.linescores` filtered by `period` (1–4), converting `"E"` → 0 and `"--"` → null.

**4. Status column shows no detail**
The `statusDetail` field must be explicitly computed per-player — ESPN does not provide a ready-made display string. Use `c.status.thru`, `c.status.period`, `c.teeTime`, and `c.status.type.name`:
- `thru === 18` or `statusTypeName.includes('PLAY_COMPLETE')` → `"R{period} F"`
- `thru > 0` → `"Hole {thru}"`
- `teeTime` exists → format to `"10:30 AM ET"`
- `statusTypeName.includes('SCHEDULED')` → `"Scheduled"`

See `loadPgaScoreboard()` for the reference implementation — copy it verbatim.

**5. Not-yet-started players sort to the top instead of the bottom**
Players who haven't teed off have `total = 0`, which sorts them above players at +1, +2, etc. Add a `notStarted` flag and secondary sort:
```js
const notStarted = dispStatus === 'Active' && completedRounds.length === 0;
// In sort:
if (a.notStarted !== b.notStarted) return a.notStarted ? 1 : -1;
```
Also add the same secondary sort in `renderXxxScoreboardRows()` so re-sorts after column header clicks respect it.

**6. Enrichment crash permanently freezes the loading spinner**
If `enrichXxxScoreboardWithPickData()` throws an error and the loading spinner was already hidden, the user sees a blank table with no error message and no way to know what happened. Fix: run enrichment **before** hiding the loading element, and wrap it in `try/catch`:
```js
try {
  enrichXxxScoreboardWithPickData();
  updateXxxSbSortHeaders();
} catch (e) { /* show raw table anyway */ }
if (loadingEl) loadingEl.classList.add('hidden');
table.classList.remove('hidden');
```

**7. Official scoreboard link**
`usopen.com/scoring/` returns 404. Use the ESPN leaderboard URL for the event:
`https://www.espn.com/golf/leaderboard/_/tournamentId/{espnEventId}`

**8. Diagnosing a blank scoreboard tab**
If the scoreboard sits on "Loading..." indefinitely with no errors in the console:
1. Run the ESPN fetch test in the browser console to confirm the API is responding (see Pre-Tournament Checklist Step 5)
2. Add a single `console.log('called')` at the very top of `loadXxxScoreboard()` — if it never prints, the function is never being called (go to pitfall #1)
3. If it prints but never renders, add a log after the fetch — the problem is in parsing or enrichment

---

### Pre-Tournament Checklist (day before or morning of)

**Step 1 — Verify Firestore security rules (most common failure)**
Go to Firebase Console → `basic-bros-majors-golf` → Firestore → Rules. Confirm these exact rules are published:
```js
match /picks/{id}       { allow read: if true; allow write: if true; }
match /scores/{id}      { allow read: if true; allow write: if true; }
match /tournaments/{id} { allow read: if true; allow write: if request.auth != null; }
match /tiers/{id}       { allow read: if true; allow write: if request.auth != null; }
```

**Step 2 — Verify firebase-config version strings match**
Open `js/standings.js` line 1. The `?v=` date on `firebase-config.js` must match what `index.html` line ~823 has. If they differ, update standings.js and push.

**Step 3 — Verify tournament record**
In admin.html or Firestore Console, confirm the tournament has:
- `espnEventId` — correct event ID (not blank)
- `pickDeadline` — set to correct date/time
- `mcPenalty: 20`
- `status: "open"`

**Step 4 — Test picks submission**
Submit a test pick on picks.html. If you get "Missing or insufficient permissions", the security rules are wrong — go back to Step 1.

**Step 5 — Verify ESPN event ID is active**
Run in browser console on the live site:
```js
fetch('https://site.api.espn.com/apis/site/v2/sports/golf/leaderboard?event=XXXXXXX').then(r=>r.json()).then(d=>console.log(d?.events?.[0]?.name, d?.events?.[0]?.competitions?.[0]?.competitors?.length))
```
Should return the tournament name and a player count > 0.

**Step 6 — Test standings blind**
With status `open` and a future `pickDeadline`, navigating to the major's tab should show "Standings are hidden while picks are open..." — not the standings table.

---

### At Pick Deadline (morning of tournament)
- **Manually flip status to `"locked"`** in admin.html — this is required, it never happens automatically
- Click the **Refresh** button on the major's tab immediately after — forces ESPN data to load
- Verify the Total tab shows all submitted picks within a few seconds

### During the Tournament
- Scores auto-refresh every 5 min when status is `locked` — no manual action needed
- Manual Refresh button available for immediate update
- Use admin → score override for any ESPN data that looks wrong
- Watch for players showing +20 who haven't missed the cut — that's a name mismatch. Check browser console for `PGA name auto-reconciled:` entries. Fix via admin score override while you investigate the correct ESPN name.

### After the Tournament
1. Flip status to `final` in admin
2. Hardcode R1–R4 round standings as `[MAJOR]_[YEAR]_R1` … `R4` constants in standings.js
3. Hardcode total standings as `[MAJOR]_[YEAR]_TOTAL` and add shortcut in the major's load function
4. Update `loadSeasonLeaderboard()` to include the new column if needed
5. **Run the data archive scripts** (before cleaning up Firestore):
   ```
   cd archive-scripts
   python archive_all.py
   ```
   This saves scoreboard CSVs (ESPN), picks CSVs (Firestore), and standings CSVs (standings.js) to `data-archive/`.
6. Update tournament completion status in this CLAUDE.md
7. Clean up old Firestore records if desired (tournament, picks, tiers, scores for that tournament)

### Still needs pool standings hardcoded
- **The Open Championship 2025** — `THEOPEN_2025_TOTAL` and `THEOPEN_2025_R1`–`R4` not yet added

## Data Archive System

All tournament data is backed up to `data-archive/` using Python scripts in `archive-scripts/`. This is the security backup in case Firestore is lost or the repo is corrupted.

### What gets archived

| File | Source | Auth needed |
|------|--------|-------------|
| `scoreboard.csv` | ESPN public API | None |
| `picks.csv` | Firestore REST API | None (public collections) |
| `standings_total.csv`, `standings_r1.csv` … `standings_r4.csv` | Hardcoded constants in `standings.js` | None |

### Folder structure
```
data-archive/
  {year}/{major}/
    scoreboard.csv        — all golfers, R1-R4 scores, position, status
    picks.csv             — entrant name, picks name, email, phone, T1-T6 golfer, submitted date
    standings_total.csv   — pool standings (full tournament)
    standings_r1.csv … standings_r4.csv — single-day pool standings
```

### Running the scripts
```
cd archive-scripts
python archive_all.py              # everything
python archive_all.py --no-picks   # scoreboard + standings only (no Firestore)
python archive_scoreboard.py       # ESPN scoreboards only
python archive_picks.py            # Firestore picks only
python archive_standings.py        # parse standings.js constants only
```

No dependencies beyond the standard library — `requirements.txt` only lists `requests` (optional convenience). The scripts use `urllib` directly and read `firebase-config.js` for credentials.

### 2025 archive state
- **Pool standings**: fully saved (all 5 constants × 5 rounds each = 25 CSV files) ✅
- **Picks**: not recoverable — 2025 Firestore picks were deleted after finalization. The T1–T6 golfer columns in the standings CSVs are the only surviving record of what each entrant picked. ⚠️
- **Scoreboards**: need 2025 ESPN event IDs added to `tournaments_config.json` ❌

### 2026 archive state
- **Masters 2026**: scoreboard ✅, picks ✅ (51 entries), standings ✅
- **PGA 2026**: scoreboard ✅, picks ✅ (41 entries), standings ✅

### Firebase credentials for scripting
The web API key in `js/firebase-config.js` works directly with the Firestore REST API:
```
https://firestore.googleapis.com/v1/projects/basic-bros-majors-golf/databases/(default)/documents/{collection}?key={apiKey}
```
No service account key required. `picks` and `tournaments` have `allow read: if true` in security rules.

## Prize Payout Logic
- Prize pool = $23.50 × entries (see Entry Fee Breakdown above)
- Admin defines payout % per place as JSON in tournament settings: `[{"place":1,"pct":45},{"place":2,"pct":25},{"place":3,"pct":15},{"place":4,"pct":10},{"place":5,"pct":5}]`
- If no prizePayouts JSON set, `DEFAULT_PAYOUT_SPLIT` (45/25/15/10/5) is used as fallback in standings.js
- Ties: tied entrants split the combined prize money for those places
- Prize display shows 2 decimal places
