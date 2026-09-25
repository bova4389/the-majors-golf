"""
Generate PGA_2026_R1 through R4 constants for standings.js.
Fetches per-round scores from ESPN API, applies pool scoring logic,
and outputs ready-to-paste JS constants.
Each round constant shows SINGLE-DAY pool standings (best 4 of 6
golfers' individual round score), not cumulative.
"""
import json, re, urllib.request, unicodedata

# ── 1. Fetch ESPN per-round scores ────────────────────────────────────────────
URL = 'https://site.api.espn.com/apis/site/v2/sports/golf/leaderboard?event=401811947'
with urllib.request.urlopen(URL) as r:
    data = json.loads(r.read())

competitors = data['events'][0]['competitions'][0]['competitors']

# Build: name → {r1, r2, r3, r4} SINGLE-DAY to-par scores
# linescores: list of {period: 1-4, value: raw strokes, displayValue: "+1"/"E"/"-2"}
PAR = 70  # Aronimink par

def strokes_to_par(strokes):
    return strokes - PAR

espn_rounds = {}
for c in competitors:
    name = c['athlete']['displayName']
    ls = sorted(c.get('linescores', []), key=lambda x: x.get('period', 0))
    rounds_raw = {}
    for entry in ls:
        p = entry.get('period')
        v = entry.get('value')
        if p and p <= 4 and v is not None:
            try:
                rounds_raw[p] = int(v)
            except (ValueError, TypeError):
                pass
    # Store each round's individual score (not cumulative)
    single_day = {}
    for rnd in [1, 2, 3, 4]:
        if rnd in rounds_raw:
            single_day[rnd] = strokes_to_par(rounds_raw[rnd])
    espn_rounds[name] = single_day

# ── 2. Parse PGA_2026_TOTAL picks from standings.js ───────────────────────────
with open('js/standings.js', 'r', encoding='utf-8') as f:
    src = f.read()

# Extract the PGA_2026_TOTAL block
m = re.search(r'const PGA_2026_TOTAL\s*=\s*\[(.*?)\n\];', src, re.DOTALL)
if not m:
    raise RuntimeError('Could not find PGA_2026_TOTAL in standings.js')

block = m.group(1)
lines = [l.strip() for l in block.split('\n') if l.strip().startswith('{')]

picks = []
for line in lines:
    # Match JS single-quoted strings, handling \' escapes
    js_str = r"'((?:[^'\\]|\\.)*)'"
    rank_m    = re.search(r'rank:\s*(\d+)',                   line)
    real_m    = re.search(r'entrantName:\s*' + js_str,        line)
    picks_m   = re.search(r'picksName:\s*'   + js_str,        line)
    golfers_m = re.findall(r'golfer:\s*'     + js_str,        line)
    if rank_m and real_m and picks_m and len(golfers_m) == 6:
        # Unescape JS single-quoted string escapes so we store plain text
        def js_unescape(s):
            return s.replace("\\'", "'").replace('\\\\', '\\')
        picks.append({
            'rank': int(rank_m.group(1)),
            'realName': js_unescape(real_m.group(1)),
            'picksName': js_unescape(picks_m.group(1)),
            'golfers': golfers_m,  # [t1, t2, t3, t4, t5, t6]
        })

print(f'Loaded {len(picks)} picks from PGA_2026_TOTAL')

# ── 3. Name normalization helper ──────────────────────────────────────────────
# ESPN may use slightly different spellings; build a lookup with fuzzy fallback
espn_names = list(espn_rounds.keys())

def strip_accents(s):
    # Handle characters that don't decompose via NFD (e.g. Nordic ø/Ø)
    s = s.replace('ø', 'o').replace('Ø', 'O').replace('æ', 'ae').replace('Æ', 'AE')
    return ''.join(
        c for c in unicodedata.normalize('NFD', s)
        if unicodedata.category(c) != 'Mn'
    ).lower()

# Pre-build accent-stripped lookup
espn_stripped = {strip_accents(n): n for n in espn_names}

def find_espn_score(golfer_name, rnd):
    """Return single-day to-par score for `rnd`, or None if not played/not found."""
    # Exact match
    if golfer_name in espn_rounds:
        return espn_rounds[golfer_name].get(rnd)
    # Accent-stripped exact match
    key = strip_accents(golfer_name)
    if key in espn_stripped:
        return espn_rounds[espn_stripped[key]].get(rnd)
    # Last-name match (accent-stripped)
    last = key.split()[-1]
    candidates = [n for n in espn_names if strip_accents(n).split()[-1] == last]
    if len(candidates) == 1:
        return espn_rounds[candidates[0]].get(rnd)
    # Partial first-name match
    first = key.split()[0]
    candidates2 = [n for n in candidates if strip_accents(n).split()[0].startswith(first[:3])]
    if len(candidates2) == 1:
        return espn_rounds[candidates2[0]].get(rnd)
    return None  # not found

MC_PENALTY = 20

# ── 4. Calculate pool standings for each round ───────────────────────────────
def best4(scores):
    return sum(sorted(scores)[:4])

def calc_round_standings(rnd):
    entries = []
    for p in picks:
        tier_scores = []
        tier_details = []
        for i, golfer in enumerate(p['golfers'], 1):
            score = find_espn_score(golfer, rnd)
            if score is None:
                # Player missed cut or not in ESPN data — use MC penalty
                # (use final score + penalty approach: we use MC penalty as score)
                score = MC_PENALTY
                status = 'mc'
            else:
                status = 'active'
            tier_scores.append((score, i, golfer, status))

        tier_scores_sorted = sorted(tier_scores, key=lambda x: x[0])
        top4_idxs = {tier_scores_sorted[j][1] for j in range(4)}

        total = best4([s[0] for s in tier_scores])

        tier_detail = {}
        for score, tier_idx, golfer, status in tier_scores:
            tier_detail[f't{tier_idx}'] = {
                'score': score,
                'status': None,  # hardcoded data uses null
                'golfer': golfer,
                'isTop4': tier_idx in top4_idxs,
            }

        entries.append({
            'realName': p['realName'],
            'picksName': p['picksName'],
            'total': total,
            'tierScores': tier_detail,
        })

    # Sort by total, then tiebreak by 5th best, then 6th best
    def sort_key(e):
        scores = sorted(ts['score'] for ts in e['tierScores'].values())
        t5 = scores[4] if len(scores) > 4 else 999
        t6 = scores[5] if len(scores) > 5 else 999
        return (e['total'], t5, t6)

    entries.sort(key=sort_key)

    # Assign ranks (tied entries share rank)
    ranked = []
    rank = 1
    for j, e in enumerate(entries):
        if j > 0 and sort_key(e) == sort_key(entries[j-1]):
            e['rank'] = ranked[-1]['rank']
        else:
            e['rank'] = rank
        rank += 1
        ranked.append(e)

    return ranked

# ── 5. Format as JS constants ─────────────────────────────────────────────────
def q(s):
    return "'" + str(s).replace("\\", "\\\\").replace("'", "\\'") + "'"

def format_const(name, entries):
    rows = []
    for e in entries:
        ts = e['tierScores']
        tiers = ', '.join(
            f"t{i}: {{ score: {ts[f't{i}']['score']}, status: null, golfer: {q(ts[f't{i}']['golfer'])}, isTop4: {str(ts[f't{i}']['isTop4']).lower()} }}"
            for i in range(1, 7)
        )
        rows.append(
            f"  {{ rank: {e['rank']:2d}, total: {e['total']:4d}, "
            f"pick: {{ entrantName: {q(e['realName'])}, picksName: {q(e['picksName'])} }}, "
            f"tierScores: {{ {tiers} }} }}"
        )
    return f"const {name} = [\n" + ',\n'.join(rows) + "\n];"

# ── 6. Output ─────────────────────────────────────────────────────────────────
import sys, io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

print()
print('// --- Checking name matches ---')
missing = set()
for p in picks:
    for golfer in p['golfers']:
        if find_espn_score(golfer, 1) is None:
            missing.add(golfer)
        elif golfer not in espn_rounds:
            # Matched via fuzzy/accent stripping
            key = strip_accents(golfer)
            matched = espn_stripped.get(key) or next(
                (n for n in espn_names if strip_accents(n).split()[-1] == key.split()[-1]), None)
            if matched:
                print(f'  Fuzzy match: "{golfer}" -> "{matched}"')

if missing:
    print(f'  WARNING - no ESPN match found for: {missing}')
else:
    print('  All golfer names matched.')

print()
for rnd in [1, 2, 3, 4]:
    standings = calc_round_standings(rnd)
    const_name = f'PGA_2026_R{rnd}'
    print(format_const(const_name, standings))
    print()
