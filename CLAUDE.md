# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Identity
- **Site name**: Basic Bros — Majors Pick'em (BBRC)
- **GitHub repo**: https://github.com/bova4389/the-majors-golf.git
- **Firebase project**: `basic-bros-majors-golf` (projectId in `js/firebase-config.js`)
- **Domain**: https://basic-bros-pga-pickems.com
- **Hosting**: DreamHost (fully hosted) — push to `main` and GitHub Actions automatically deploys via SFTP
- **Deploy workflow**: `.github/workflows/deploy.yml` uses `wlixcc/SFTP-Deploy-Action` → uploads to `/home/mattbova/basic-bros-pga-pickems.com/` on DreamHost. A **"Stage deployable files"** step first rsyncs the repo into `_deploy/` minus `CLAUDE.md`, `docs/` (the `docs/claude/` reference files), `.github`, `.gitignore`, `data-archive/` and `archive-scripts/`, and both upload steps read from `_deploy/`. Without it the action publishes everything tracked — `/CLAUDE.md` used to be live on the domain. Add an `--exclude` when introducing a new internal-only file.
- **This repo is PUBLIC and deploys to a public webroot** — a committed file is published twice over (git history forever, plus a plain URL). Entrant emails/phones live in `data-archive/**/picks.csv`, `data-archive/*picks_raw*.json` and `Picks/`; all three are gitignored, and a `PreToolUse` hook scans staged blobs to block a PII commit as a backstop. The non-PII archives (standings/scoreboard CSVs) *are* tracked so the 2025 record — the only surviving copy of that year's picks — is backed up.
- **GitHub Actions secrets required**: `FTP_SERVER`, `FTP_USERNAME`, `FTP_PASSWORD` (set in repo Settings → Secrets → Actions)

## Key Contacts
- **Ryne** — Co-commissioner
- **Cody** — Co-commissioner
- **Matt** — Website Vibes Guy

## Cache Busting (Required — Do Not Remove)

Safari on mobile caches pages aggressively. To prevent users from seeing stale versions after a deployment:

1. **`.htaccess`** — sends `no-cache` headers for all HTML/JS/CSS files. Never delete it, and
   never add it to `.gitignore`. `deploy.yml` also needs its dedicated "Deploy .htaccess" step,
   because the sftp `put -r ./*` glob skips dotfiles — don't remove that step as redundant.
2. **`?v=` query string on local JS/CSS `<script src>` and `<link rel="stylesheet">` tags** —
   bumped on every change to that file. **Two exceptions, both mandatory:**
   `js/firebase-config.js` and `js/scoring.js` are shared ES modules imported by other modules,
   and must **never** carry a `?v=` — see Known Failure Mode 2 for why this breaks `getDb()`.

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

## Reference Docs — Read the Matching One Before Touching That Area

Detail that only some tasks need lives in `docs/claude/`, moved verbatim on 2026-11-11 so a
session only pays for what it uses. `docs/` is excluded from the DreamHost deploy, the same way
this file is. **Read the matching doc before you change that part.**

| Before… | Read |
|---|---|
| **Running a live major** (setup, pick deadline, during, after), the admin page, the standings blind | [`docs/claude/live-tournament-runbook.md`](docs/claude/live-tournament-runbook.md) |
| Editing `standings.js` or `scoring.js`, hardcoding a finished tournament, ESPN data, CSS bugs | [`docs/claude/standings-js-internals.md`](docs/claude/standings-js-internals.md) |
| Firestore collections, major keys, the `picks.html` form, the PII data split | [`docs/claude/firestore-and-entry-form.md`](docs/claude/firestore-and-entry-form.md) |
| Running or changing the archive scripts | [`docs/claude/data-archive.md`](docs/claude/data-archive.md) |


## Firestore Data Lifecycle — Critical

**Firestore only holds data for the CURRENT active season.** Once a tournament is fully finalized and its standings are hardcoded into `standings.js`, the Firestore records for that tournament (tournaments doc, picks, tiers, scores) are cleaned up and deleted. This is intentional — the hardcoded JS constants become the permanent record.

**As of May 2026:**
- Only the two 2026 tournaments exist in Firestore (`masters-2026` and `AMcWqXqIGQN605XypuDI` for PGA)
- All 2025 tournament records, picks, tiers, and scores have been removed from Firestore
- The 2025 pool data lives **only** in the hardcoded constants in `standings.js`

**Implication:** For any past tournament (2025 and earlier), the picks/golfer selections for each entrant only survive as the `golfer` fields embedded in the `tierScores` of the hardcoded standings constants. There is no separate picks backup for 2025.

**Scripting against Firestore:** The web API key in `firebase-config.js` can be used directly with the Firestore REST API — no service account key required. The `picks` and `tournaments` collections have `allow read: if true` in the security rules, so they are publicly readable. See `archive-scripts/archive_picks.py` for the REST API pattern.

## Completed Tournament Lockdown
- Auto-refresh skips non-`locked` tournaments ✓
- Refresh button disabled when `status === 'final'` ✓ (both Masters and PGA have their own refresh buttons)
- ESPN API calls skipped for non-`locked` tournaments ✓
- Masters 2026 skips ESPN fetch entirely — `MASTERS_2026_TOTAL` served directly ✓

## Prize Payout Logic
- Prize pool = $23.50 × entries (see Entry Fee Breakdown above)
- Admin defines payout % per place as JSON in tournament settings: `[{"place":1,"pct":45},{"place":2,"pct":25},{"place":3,"pct":15},{"place":4,"pct":10},{"place":5,"pct":5}]`
- If no prizePayouts JSON set, `DEFAULT_PAYOUT_SPLIT` (45/25/15/10/5) is used as fallback in standings.js
- Ties: tied entrants split the combined prize money for those places
- Prize display shows 2 decimal places
