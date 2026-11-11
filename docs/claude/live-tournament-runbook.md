# Live Tournament Runbook, Admin Workflow, and Standings Blind — Majors Golf Pool reference

Moved verbatim out of `CLAUDE.md` on 2026-11-11 so it loads only when needed. A cross-reference to another section may now point to a different `docs/claude/` file; grep the folder for the heading.

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

## Live Tournament Runbook (reuse for each new major)

### Known Failure Modes (learned from US Open 2026 launch)

**1. Firestore security rules block scores write → standings won't load**
The public page writes ESPN scores to Firestore to cache them. If the `scores` collection requires auth to write, the entire standings load silently fails (the catch block hides everything). The `scores` rule MUST be `allow write: if true`.
- Symptom: page stuck on "Loading standings..." forever
- Check: Firebase Console → Firestore → Rules — confirm `match /scores/{id} { allow write: if true; }`
- Full required rules are in the "Firestore security rules" section below

**2. firebase-config.js import mismatch → getDb() returns null**
A query string is part of an ES module's identity, so `firebase-config.js?v=1` and
`firebase-config.js` are two *separate instances* with separate module-level variables.
`index.html` calls `initFirebase()` on whichever instance it imported; if `standings.js`
imported a differently-spelled URL, its `getDb()` reads a different `db` that was never set.
- Symptom: "Firestore unavailable — Expected first argument to collection() to be a CollectionReference" in browser console; page stuck on "Loading standings..."
- **Resolved structurally as of 2026-07-31:** `firebase-config.js` and `scoring.js` are now
  imported with **no `?v=` at all** — from `index.html`, `admin.html`, `picks.html`,
  `standings.js`, `admin.js` and `picks.js` alike. With nothing to keep in sync, the mismatch
  cannot recur. The `.htaccess` no-cache headers keep both files fresh.
- **Never re-add a `?v=` to a `firebase-config.js` or `scoring.js` import.** Doing so
  reintroduces this outage. Entry-point modules (`standings.js`, `admin.js`) are still
  versioned normally — only shared/stateful modules must stay unversioned.

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

**Step 2 — Verify no `?v=` has crept onto a shared module import**
Run `grep -rn "firebase-config.js?v=\|scoring.js?v=" *.html js/` — it must return **nothing**.
Any hit means someone re-added a version string to a shared stateful module, which breaks
`getDb()` and takes the standings page down (see Known Failure Mode 2). Remove it.
While you're there, confirm one file never carries two different versions across pages:
`grep -rn "styles.css?v=" *.html` should show the same value on all three.

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
- None — all 2025 and 2026 majors are hardcoded as of 2026-07-31.
