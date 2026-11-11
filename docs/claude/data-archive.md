# Data Archive System — Majors Golf Pool reference

Moved verbatim out of `CLAUDE.md` on 2026-11-11 so it loads only when needed. A cross-reference to another section may now point to a different `docs/claude/` file; grep the folder for the heading.

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
- **U.S. Open 2026**: scoreboard ✅, picks ✅ (43 entries), standings ❌ — `archive_standings.py`'s parser reports "found but no entries parsed" for `US_OPEN_2026_*`; the constants use double-quoted strings which the current regex doesn't handle. Needs a parser fix.
- **The Open 2026**: scoreboard ✅, picks ✅ (47 entries), standings ✅ (archived 2026-07-31)

### Firebase credentials for scripting
The web API key in `js/firebase-config.js` works directly with the Firestore REST API:
```
https://firestore.googleapis.com/v1/projects/basic-bros-majors-golf/databases/(default)/documents/{collection}?key={apiKey}
```
No service account key required. `picks` and `tournaments` have `allow read: if true` in security rules.
