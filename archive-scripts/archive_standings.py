"""
Parse hardcoded pool standings constants from standings.js and save CSVs to
data-archive/{year}/{major}/standings_{total|r1|r2|r3|r4}.csv.

No authentication required — reads the local standings.js file.

Run standalone:
    python archive_standings.py

Or called automatically by archive_all.py.

Handles two JS constant formats found in standings.js:

Format A (standard — used by all TOTAL constants and most R1-R4):
  { rank: N, total: N, pick: { entrantName: '...', picksName: '...' },
    tierScores: { t1: { score: N, status: null, golfer: '...', isTop4: bool }, ... t6 } }

Format B (Masters 2026 R1-R4 only):
  { team: '...', tiers: [{ player: '...', score: N }, ...] }
"""

import csv
import os
import re

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
STANDINGS_JS = os.path.join(SCRIPT_DIR, '..', 'js', 'standings.js')
ARCHIVE_DIR = os.path.join(SCRIPT_DIR, '..', 'data-archive')

# Map constant prefix → (year, folder)
CONST_MAP = {
    'MASTERS_2025':  (2025, 'masters'),
    'PGA_2025':      (2025, 'pga-championship'),
    'USOPEN_2025':   (2025, 'us-open'),
    'THEOPEN_2025':  (2025, 'the-open'),
    'MASTERS_2026':  (2026, 'masters'),
    'PGA_2026':      (2026, 'pga-championship'),
    'US_OPEN_2026':  (2026, 'us-open'),
    'THE_OPEN_2026': (2026, 'the-open'),
}

SUFFIX_MAP = {
    'TOTAL': 'standings_total',
    'R1':    'standings_r1',
    'R2':    'standings_r2',
    'R3':    'standings_r3',
    'R4':    'standings_r4',
}

JS_STR = r"'((?:[^'\\]|\\.)*)'"


def js_unescape(s):
    return s.replace("\\'", "'").replace('\\\\', '\\')


# ── Format A parser ────────────────────────────────────────────────────────────

def parse_tier_block(block, tier_num):
    """Extract score, golfer, isTop4 from a single tier object block."""
    score_m  = re.search(r'score:\s*(-?\d+)', block)
    golfer_m = re.search(r'golfer:\s*' + JS_STR, block)
    top4_m   = re.search(r'isTop4:\s*(true|false)', block)
    return {
        'score':   int(score_m.group(1)) if score_m else '',
        'golfer':  js_unescape(golfer_m.group(1)) if golfer_m else '',
        'is_top4': top4_m.group(1) if top4_m else '',
    }


def parse_format_a(line):
    """Parse one entry in the standard format. Returns dict or None."""
    rank_m  = re.search(r'rank:\s*(\d+)', line)
    total_m = re.search(r'total:\s*(-?\d+)', line)
    ename_m = re.search(r'entrantName:\s*' + JS_STR, line)
    pname_m = re.search(r'picksName:\s*'   + JS_STR, line)

    if not (rank_m and total_m and ename_m):
        return None

    entry = {
        'Rank':       int(rank_m.group(1)),
        'Total':      int(total_m.group(1)),
        'Picks Name': js_unescape(pname_m.group(1)) if pname_m else js_unescape(ename_m.group(1)),
        'Real Name':  js_unescape(ename_m.group(1)),
    }

    for i in range(1, 7):
        t_m = re.search(rf't{i}:\s*\{{([^}}]+)\}}', line)
        if t_m:
            tier = parse_tier_block(t_m.group(1), i)
            entry[f'T{i} Golfer']  = tier['golfer']
            entry[f'T{i} Score']   = tier['score']
            entry[f'T{i} Counts']  = tier['is_top4']
        else:
            entry[f'T{i} Golfer']  = ''
            entry[f'T{i} Score']   = ''
            entry[f'T{i} Counts']  = ''

    return entry


# ── Format B parser ────────────────────────────────────────────────────────────

def parse_format_b(line):
    """Parse one entry in the Masters 2026 R-round format. Returns dict or None."""
    team_m = re.search(r'team:\s*' + JS_STR, line)
    if not team_m:
        return None

    entry = {
        'Rank':       '',
        'Total':      '',
        'Picks Name': js_unescape(team_m.group(1)),
        'Real Name':  js_unescape(team_m.group(1)),
    }

    tier_pairs = re.findall(r'\{\s*player:\s*' + JS_STR + r'\s*,\s*score:\s*(-?\d+)\s*\}', line)
    for i, (player, score) in enumerate(tier_pairs, 1):
        if i > 6:
            break
        entry[f'T{i} Golfer']  = js_unescape(player)
        entry[f'T{i} Score']   = int(score)
        entry[f'T{i} Counts']  = ''
    for i in range(len(tier_pairs) + 1, 7):
        entry[f'T{i} Golfer']  = ''
        entry[f'T{i} Score']   = ''
        entry[f'T{i} Counts']  = ''

    return entry


# ── Block extractor ────────────────────────────────────────────────────────────

def extract_constant_block(src, const_name):
    """Return the list body of `const CONST_NAME = [ ... ];`."""
    m = re.search(
        r'const\s+' + re.escape(const_name) + r'\s*=\s*\[(.*?)\n\];',
        src, re.DOTALL
    )
    return m.group(1) if m else None


def parse_entries(block):
    """Parse all entry lines from a constant block. Auto-detects format."""
    lines = [l.strip() for l in block.split('\n') if l.strip().startswith('{')]
    entries = []
    for line in lines:
        if 'team:' in line and 'tiers:' in line:
            entry = parse_format_b(line)
        else:
            entry = parse_format_a(line)
        if entry:
            entries.append(entry)
    return entries


# ── CSV writer ─────────────────────────────────────────────────────────────────

FIELDNAMES = [
    'Rank', 'Picks Name', 'Real Name', 'Total',
    'T1 Golfer', 'T1 Score', 'T1 Counts',
    'T2 Golfer', 'T2 Score', 'T2 Counts',
    'T3 Golfer', 'T3 Score', 'T3 Counts',
    'T4 Golfer', 'T4 Score', 'T4 Counts',
    'T5 Golfer', 'T5 Score', 'T5 Counts',
    'T6 Golfer', 'T6 Score', 'T6 Counts',
]


def save_standings_csv(entries, out_path):
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    with open(out_path, 'w', newline='', encoding='utf-8') as f:
        writer = csv.DictWriter(f, fieldnames=FIELDNAMES)
        writer.writeheader()
        writer.writerows(entries)
    print(f'    Saved {len(entries)} entries -> {os.path.relpath(out_path, SCRIPT_DIR)}')


# ── Main ───────────────────────────────────────────────────────────────────────

def run():
    if not os.path.exists(STANDINGS_JS):
        print(f'ERROR: standings.js not found at {STANDINGS_JS}')
        return []

    with open(STANDINGS_JS, encoding='utf-8') as f:
        src = f.read()

    written = []
    missing = []

    for prefix, (year, folder) in CONST_MAP.items():
        for suffix, file_stem in SUFFIX_MAP.items():
            const_name = f'{prefix}_{suffix}'
            block = extract_constant_block(src, const_name)

            if block is None:
                missing.append(const_name)
                continue

            entries = parse_entries(block)
            if not entries:
                print(f'  WARNING: {const_name} found but no entries parsed')
                continue

            out_path = os.path.join(ARCHIVE_DIR, str(year), folder, f'{file_stem}.csv')
            print(f'  {const_name}')
            save_standings_csv(entries, out_path)
            written.append(out_path)

    return written, missing


if __name__ == '__main__':
    print('=== Archiving standings ===')
    written, missing = run()
    print(f'\nDone. {len(written)} standings files saved.')
    if missing:
        print(f'Not yet in standings.js ({len(missing)}):')
        for c in missing:
            print(f'  {c}')
