"""
Fetch all user picks from Firestore and save a CSV per tournament to
data-archive/{year}/{major}/picks.csv.

Also writes tournaments_config.json so archive_scoreboard.py can find
ESPN event IDs without any separate auth.

Uses the Firestore REST API with the web API key from firebase-config.js.
The picks and tournaments collections are publicly readable — no service
account key required.

Run standalone:
    python archive_picks.py

Or called automatically by archive_all.py.
"""

import csv
import json
import os
import re
import urllib.request
import urllib.parse

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
CONFIG_PATH = os.path.join(SCRIPT_DIR, 'tournaments_config.json')
FIREBASE_CONFIG_JS = os.path.join(SCRIPT_DIR, '..', 'js', 'firebase-config.js')
ARCHIVE_DIR = os.path.join(SCRIPT_DIR, '..', 'data-archive')

MAJOR_FOLDER = {
    'masters':  'masters',
    'pga':      'pga-championship',
    'us-open':  'us-open',
    'the-open': 'the-open',
}


# ── Firebase credentials from firebase-config.js ──────────────────────────────

def load_firebase_config():
    with open(FIREBASE_CONFIG_JS, encoding='utf-8') as f:
        src = f.read()
    api_key    = re.search(r'apiKey:\s*"([^"]+)"', src).group(1)
    project_id = re.search(r'projectId:\s*"([^"]+)"', src).group(1)
    return api_key, project_id


# ── Firestore REST helpers ─────────────────────────────────────────────────────

def firestore_get(url):
    try:
        with urllib.request.urlopen(url, timeout=30) as r:
            return json.loads(r.read())
    except Exception as e:
        print(f'    ERROR: {e}')
        return None


def decode_value(v):
    """Convert a Firestore REST API value object to a Python value."""
    if 'stringValue' in v:
        return v['stringValue']
    if 'integerValue' in v:
        return int(v['integerValue'])
    if 'doubleValue' in v:
        return float(v['doubleValue'])
    if 'booleanValue' in v:
        return v['booleanValue']
    if 'timestampValue' in v:
        return v['timestampValue']  # ISO string e.g. "2026-05-13T18:45:22Z"
    if 'nullValue' in v:
        return None
    return str(v)


def doc_to_dict(doc):
    """Convert a Firestore REST document to a plain dict."""
    fields = doc.get('fields', {})
    return {k: decode_value(v) for k, v in fields.items()}


def fetch_collection(base_url, api_key, collection):
    """Fetch all documents in a collection via REST (handles pagination)."""
    docs = []
    page_token = None
    while True:
        url = f'{base_url}/{collection}?key={api_key}&pageSize=300'
        if page_token:
            url += f'&pageToken={urllib.parse.quote(page_token)}'
        data = firestore_get(url)
        if not data:
            break
        for doc in data.get('documents', []):
            doc_id = doc['name'].split('/')[-1]
            d = doc_to_dict(doc)
            d['__id__'] = doc_id
            docs.append(d)
        page_token = data.get('nextPageToken')
        if not page_token:
            break
    return docs


def fetch_picks_for_tournament(base_url, api_key, tournament_id):
    """Fetch picks for a specific tournament using a structured query."""
    url = f'{base_url}:runQuery?key={api_key}'
    query = {
        "structuredQuery": {
            "from": [{"collectionId": "picks"}],
            "where": {
                "fieldFilter": {
                    "field": {"fieldPath": "tournamentId"},
                    "op": "EQUAL",
                    "value": {"stringValue": tournament_id}
                }
            }
        }
    }
    body = json.dumps(query).encode('utf-8')
    req = urllib.request.Request(url, data=body, headers={'Content-Type': 'application/json'})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            results = json.loads(r.read())
    except Exception as e:
        print(f'    ERROR fetching picks: {e}')
        return []

    picks = []
    for item in results:
        doc = item.get('document')
        if not doc:
            continue
        d = doc_to_dict(doc)
        submitted = d.get('submittedAt', '')
        if submitted and 'T' in str(submitted):
            # Format "2026-05-13T18:45:22Z" -> "5/13/2026"
            try:
                parts = submitted.split('T')[0].split('-')
                submitted = f'{int(parts[1])}/{int(parts[2])}/{parts[0]}'
            except Exception:
                pass
        picks.append({
            'Real Name':  d.get('realName', ''),
            'Picks Name': d.get('entrantName', ''),
            'Email':      d.get('email', ''),
            'Phone':      d.get('phone', ''),
            'T1':         d.get('t1', ''),
            'T2':         d.get('t2', ''),
            'T3':         d.get('t3', ''),
            'T4':         d.get('t4', ''),
            'T5':         d.get('t5', ''),
            'T6':         d.get('t6', ''),
            'Submitted':  submitted,
        })
    picks.sort(key=lambda p: p['Real Name'].lower())
    return picks


# ── Config updater ─────────────────────────────────────────────────────────────

def update_config(tournaments):
    existing = []
    if os.path.exists(CONFIG_PATH):
        with open(CONFIG_PATH, encoding='utf-8') as f:
            try:
                existing = json.load(f)
            except json.JSONDecodeError:
                existing = []

    existing_map = {(t.get('major'), t.get('year')): t for t in existing}

    merged = []
    for t in tournaments:
        key = (t['major'], t['year'])
        entry = dict(existing_map.get(key, {}))
        for k, v in t.items():
            if v:
                entry[k] = v
        merged.append(entry)

    # Keep any in existing that weren't in Firestore results
    for t in existing:
        if (t.get('major'), t.get('year')) not in {(m['major'], m['year']) for m in tournaments}:
            merged.append(t)

    merged.sort(key=lambda t: (t.get('year', 0), t.get('major', '')))
    with open(CONFIG_PATH, 'w', encoding='utf-8') as f:
        json.dump(merged, f, indent=2)
    print(f'  Updated tournaments_config.json with {len(merged)} tournaments')


# ── CSV writer ─────────────────────────────────────────────────────────────────

def save_picks_csv(picks, out_path):
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    fieldnames = ['Real Name', 'Picks Name', 'Email', 'Phone',
                  'T1', 'T2', 'T3', 'T4', 'T5', 'T6', 'Submitted']
    with open(out_path, 'w', newline='', encoding='utf-8') as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(picks)
    print(f'    Saved {len(picks)} picks -> {os.path.relpath(out_path, SCRIPT_DIR)}')


# ── Main ───────────────────────────────────────────────────────────────────────

def run():
    api_key, project_id = load_firebase_config()
    base_url = f'https://firestore.googleapis.com/v1/projects/{project_id}/databases/(default)/documents'
    print(f'  Project: {project_id}')

    print('  Fetching tournaments...')
    raw_tournaments = fetch_collection(base_url, api_key, 'tournaments')
    tournaments = []
    for d in raw_tournaments:
        tournaments.append({
            'firestoreId': d.get('__id__', ''),
            'name':        d.get('name', ''),
            'major':       d.get('major', ''),
            'year':        int(d.get('year', 0)),
            'espnEventId': str(d.get('espnEventId', '')),
            'status':      d.get('status', ''),
        })
    tournaments.sort(key=lambda t: (t['year'], t['major']))
    print(f'  Found {len(tournaments)} tournaments.')
    update_config(tournaments)

    written = []
    for t in tournaments:
        name   = t['name']
        major  = t['major']
        year   = t['year']
        tid    = t['firestoreId']
        folder = MAJOR_FOLDER.get(major, major)
        out_path = os.path.join(ARCHIVE_DIR, str(year), folder, 'picks.csv')

        print(f'  {name}')
        if not tid:
            print('    SKIPPED — no Firestore document ID')
            continue

        picks = fetch_picks_for_tournament(base_url, api_key, tid)
        if not picks:
            print('    No picks found.')
            continue

        save_picks_csv(picks, out_path)
        written.append(out_path)

    return written


if __name__ == '__main__':
    print('=== Archiving picks ===')
    written = run()
    print(f'\nDone. {len(written)} picks files saved.')
