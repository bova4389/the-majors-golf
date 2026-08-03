# Majors Golf Pool — Data Archive Scripts

These scripts export all tournament data to CSV files in `data-archive/` for security backup purposes.

## What Gets Archived

| File | Source | Auth |
|------|--------|------|
| `scoreboard.csv` | ESPN public API | None |
| `picks.csv` | Firestore `picks` collection | Firebase Admin SDK |
| `standings_total.csv` | Hardcoded in `standings.js` | None |
| `standings_r1.csv` … `standings_r4.csv` | Hardcoded in `standings.js` | None |

## Output Folder Structure

```
data-archive/
├── 2025/
│   ├── masters/
│   │   ├── scoreboard.csv
│   │   ├── picks.csv
│   │   ├── standings_total.csv
│   │   ├── standings_r1.csv … standings_r4.csv
│   ├── pga-championship/
│   ├── us-open/
│   └── the-open/
└── 2026/
    ├── masters/
    └── pga-championship/
```

---

## Setup

### 1. Install Python dependencies

```
pip install -r requirements.txt
```

Python 3.8+ required.

### 2. Fill in 2025 ESPN event IDs (for scoreboard archive)

Open `tournaments_config.json` and add the ESPN event IDs for 2025 tournaments.
You can find these IDs in the Firestore `tournaments` collection (the `espnEventId` field on each doc).

The 2026 IDs are already filled in.

### 3. Get a Firebase service account key (for picks archive)

1. Go to [Firebase Console](https://console.firebase.google.com/) → select **basic-bros-majors-golf** project
2. Click the gear icon → **Project settings** → **Service accounts** tab
3. Click **Generate new private key** → Download the JSON file
4. Rename it to `service-account.json` and place it in this `archive-scripts/` folder

> **Security**: `service-account.json` is gitignored and will never be committed.

---

## Running the Scripts

### Run everything (recommended)

```
cd archive-scripts
python archive_all.py
```

### Run without picks (no Firebase auth needed)

```
python archive_all.py --no-picks
```

This still exports scoreboards (ESPN API) and pool standings (standings.js).

### Run individual scripts

```
python archive_scoreboard.py    # ESPN scoreboards only
python archive_picks.py         # Firestore picks only (requires service-account.json)
python archive_standings.py     # Pool standings from standings.js only
```

---

## CSV Column Reference

### scoreboard.csv

| Column | Description |
|--------|-------------|
| Position | Final leaderboard position (e.g. `1`, `T5`, `CUT`) |
| Player | Golfer's full name |
| Country | Country code (e.g. `USA`, `NIR`) |
| Total | Total to-par score (e.g. `-11`, `E`, `+3`) |
| R1–R4 | Individual round scores |
| Status | `active`, `cut`, or `wd` |

### picks.csv

| Column | Description |
|--------|-------------|
| Real Name | Entrant's actual name |
| Picks Name | Unique entry name for the tournament |
| Email | Contact email |
| Phone | Contact phone |
| T1–T6 | Golfer name selected for each tier |
| Submitted | Submission date |

### standings_total.csv / standings_r1.csv … standings_r4.csv

| Column | Description |
|--------|-------------|
| Rank | Pool finishing position |
| Picks Name | Entry display name |
| Real Name | Entrant's actual name |
| Total | Best-4-of-6 to-par score |
| T1–T6 Golfer | Golfer picked for that tier |
| T1–T6 Score | Golfer's score for that round/total |
| T1–T6 Counts | `true` if this tier counts in best-4, `false` otherwise |

---

## Adding Future Tournaments

After each major is finalized:

1. **Scoreboard**: Add the ESPN event ID to `tournaments_config.json` (or run `archive_picks.py` first — it auto-populates the config from Firestore)
2. **Picks**: Re-run `archive_picks.py` — it fetches all tournaments automatically
3. **Standings**: After the hardcoded constants are added to `standings.js`, re-run `archive_standings.py`
