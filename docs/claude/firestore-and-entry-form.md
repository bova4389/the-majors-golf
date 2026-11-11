# Firestore Model, Entry Form, and the PII Split Plan — Majors Golf Pool reference

Moved verbatim out of `CLAUDE.md` on 2026-11-11 so it loads only when needed. A cross-reference to another section may now point to a different `docs/claude/` file; grep the folder for the heading.

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
