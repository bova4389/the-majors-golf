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
- Each entrant's score = sum of their 6 golfers' scores (strokes relative to par)
- Lower total = better (golf scoring)
- WD / MC (missed cut) = **+20 stroke penalty** (configurable per tournament)
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
The `espnEventId` for each tournament is set by the admin when creating the tournament.
Scores are cached in Firestore to avoid hammering the API; browser refreshes pull from Firestore.

## Admin Workflow
1. Log in at `admin.html` with Firebase email/password
2. Create tournament → fills in name, dates, prize pool, entry fee, entry password, ESPN event ID
3. Add golfers → assign each to a tier (1–6)
4. Set status to `open` → picks form becomes active
5. Picks auto-lock at `pickDeadline`; admin can also manually flip to `locked`
6. During tournament: scores refresh automatically; admin can override individual scores
7. After final round: flip status to `final` → prize calculator shows payouts

## Prize Payout Logic
- Total pool = entryFee × number of entries
- Admin defines payout percentages per place (e.g., 1st 40%, 2nd 25%, 3rd 15%, ...)
- Ties: tied entrants split the combined prize money for those places
