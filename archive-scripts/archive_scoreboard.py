"""
Fetch the official PGA Tour scoreboard for each tournament from the ESPN API
and save a CSV to data-archive/{year}/{major}/scoreboard.csv.

No authentication required — ESPN API is public.

Run standalone:
    python archive_scoreboard.py

Or called automatically by archive_all.py.
"""

import csv
import json
import os
import urllib.request

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
CONFIG_PATH = os.path.join(SCRIPT_DIR, 'tournaments_config.json')
ARCHIVE_DIR = os.path.join(SCRIPT_DIR, '..', 'data-archive')

ESPN_URL = 'https://site.api.espn.com/apis/site/v2/sports/golf/leaderboard?event={}'

MAJOR_FOLDER = {
    'masters':  'masters',
    'pga':      'pga-championship',
    'us-open':  'us-open',
    'the-open': 'the-open',
}


def fetch_scoreboard(espn_event_id):
    url = ESPN_URL.format(espn_event_id)
    try:
        with urllib.request.urlopen(url, timeout=30) as r:
            return json.loads(r.read())
    except Exception as e:
        print(f'    ERROR fetching {url}: {e}')
        return None


def parse_scoreboard(data):
    try:
        competitors = data['events'][0]['competitions'][0]['competitors']
    except (KeyError, IndexError):
        print('    ERROR: unexpected ESPN response structure')
        return []

    rows = []
    for c in competitors:
        athlete = c.get('athlete', {})
        name = athlete.get('displayName', '')
        country = athlete.get('flag', {}).get('alt', '') or athlete.get('countryFlag', {}).get('alt', '')
        if not country:
            country = ''

        position = c.get('status', {}).get('position', {}).get('displayName', '') or c.get('sortOrder', '')
        total_display = c.get('score', {}).get('displayValue', 'E')

        status_obj = c.get('status', {})
        active = status_obj.get('type', {}).get('id', '')
        if active == 'cut':
            player_status = 'cut'
        elif active == 'wd':
            player_status = 'wd'
        else:
            player_status = 'active'

        linescores = sorted(c.get('linescores', []), key=lambda x: x.get('period', 0))
        rounds = {}
        for ls in linescores:
            period = ls.get('period')
            display = ls.get('displayValue', '')
            if period and period <= 4:
                rounds[period] = display

        rows.append({
            'Position':  position,
            'Player':    name,
            'Country':   country,
            'Total':     total_display,
            'R1':        rounds.get(1, ''),
            'R2':        rounds.get(2, ''),
            'R3':        rounds.get(3, ''),
            'R4':        rounds.get(4, ''),
            'Status':    player_status,
        })

    return rows


def save_scoreboard_csv(rows, out_path):
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    fieldnames = ['Position', 'Player', 'Country', 'Total', 'R1', 'R2', 'R3', 'R4', 'Status']
    with open(out_path, 'w', newline='', encoding='utf-8') as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)
    print(f'    Saved {len(rows)} golfers -> {os.path.relpath(out_path, SCRIPT_DIR)}')


def run():
    if not os.path.exists(CONFIG_PATH):
        print(f'ERROR: {CONFIG_PATH} not found. Run archive_picks.py first, or edit tournaments_config.json manually.')
        return []

    with open(CONFIG_PATH, encoding='utf-8') as f:
        tournaments = json.load(f)

    written = []
    skipped = []

    for t in tournaments:
        name = t.get('name', '')
        major = t.get('major', '')
        year = t.get('year', '')
        espn_id = t.get('espnEventId', '').strip()

        folder = MAJOR_FOLDER.get(major, major)
        out_path = os.path.join(ARCHIVE_DIR, str(year), folder, 'scoreboard.csv')

        print(f'  {name}')

        if not espn_id:
            print(f'    SKIPPED — no espnEventId in tournaments_config.json')
            skipped.append(name)
            continue

        data = fetch_scoreboard(espn_id)
        if not data:
            skipped.append(name)
            continue

        rows = parse_scoreboard(data)
        if not rows:
            skipped.append(name)
            continue

        save_scoreboard_csv(rows, out_path)
        written.append(out_path)

    return written, skipped


if __name__ == '__main__':
    print('=== Archiving scoreboards ===')
    written, skipped = run()
    print(f'\nDone. {len(written)} scoreboards saved.')
    if skipped:
        print(f'Skipped ({len(skipped)}): {", ".join(skipped)}')
        print('  -> Add espnEventId values to tournaments_config.json for missing tournaments.')
