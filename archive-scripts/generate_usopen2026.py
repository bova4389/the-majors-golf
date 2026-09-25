"""
Generate US_OPEN_2026_TOTAL (corrected) and US_OPEN_2026_R1-R4 constants.
Uses Firestore picks + Firestore scores (which include admin overrides).
"""
import json, re

API_KEY = "AIzaSyCf2VYqyhCRyf8hljnWyYhTDrbeQXlcfLg"
TOURNAMENT_ID = "Y4mgiIA4RJjF6JLaHuH0"
MC_PENALTY = 20

# ── Load scores from Firestore (already fetched) ──────────────────────────────
with open("data-archive/usopen2026_scores_raw.json", encoding="utf-8") as f:
    scores_doc = json.load(f)

scores_map = {}  # name -> {score, r1, r2, r3, r4, status}
for name, val in scores_doc["fields"].items():
    if name == "_lastUpdated":
        continue
    fields = val["mapValue"]["fields"]
    score  = int(fields["score"]["integerValue"])
    status = fields["status"]["stringValue"]
    def get_round(key):
        f = fields.get(key, {})
        v = f.get("integerValue") or f.get("doubleValue")
        return int(float(v)) if v is not None else None
    r1 = get_round("r1")
    r2 = get_round("r2")
    r3 = get_round("r3")
    r4 = get_round("r4")
    scores_map[name] = {"score": score, "status": status, "r1": r1, "r2": r2, "r3": r3, "r4": r4}

# ── Name normalization map (picks name → Firestore/scores name) ───────────────
# Picks use ASCII, Firestore has the accented originals.
NAME_MAP = {
    "Ludvig Aberg":     "Ludvig Åberg",
    "Niklas Norgaard":  "Niklas Nørgaard",
    "Hennie du Plessis":"Hennie Du Plessis",
    "Joaquin Niemann":  "Joaquín Niemann",
    "Nicolai Hojgaard": "Nicolai Højgaard",
}

def resolve(pick_name):
    return NAME_MAP.get(pick_name, pick_name)

def effective_score(pick_name, penalty=MC_PENALTY):
    name = resolve(pick_name)
    g = scores_map.get(name)
    if g is None:
        return penalty, "active"  # unknown → penalty
    if g["status"] in ("cut", "wd"):
        return g["score"] + penalty, g["status"]
    return g["score"], g["status"]

def round_score(pick_name, rnum):
    name = resolve(pick_name)
    g = scores_map.get(name)
    if g is None:
        return 10 if rnum >= 3 else 0   # unknown cut penalty approximation
    key = f"r{rnum}"
    r = g[key]
    if r is None:
        # cut/wd player with no round score for this period
        return 10 if g["status"] in ("cut", "wd") else 0
    return r

# ── Load picks from Firestore ─────────────────────────────────────────────────
with open("data-archive/usopen2026_picks_raw.json", encoding="utf-8") as f:
    raw = json.load(f)

picks = []
for doc in raw.get("documents", []):
    f = doc["fields"]
    tid = f.get("tournamentId", {}).get("stringValue", "")
    if tid != TOURNAMENT_ID:
        continue
    picks.append({
        "realName":    f.get("realName", {}).get("stringValue", ""),
        "entrantName": f.get("entrantName", {}).get("stringValue", ""),
        "t1": f.get("t1", {}).get("stringValue", ""),
        "t2": f.get("t2", {}).get("stringValue", ""),
        "t3": f.get("t3", {}).get("stringValue", ""),
        "t4": f.get("t4", {}).get("stringValue", ""),
        "t5": f.get("t5", {}).get("stringValue", ""),
        "t6": f.get("t6", {}).get("stringValue", ""),
    })

print(f"Loaded {len(picks)} picks for tournament {TOURNAMENT_ID}")

# ── Calculate standings for a given score function ────────────────────────────
def calc_standings(picks, score_fn):
    rows = []
    for p in picks:
        tiers = {}
        for i in range(1, 7):
            g = p[f"t{i}"]
            sc, st = score_fn(g)
            tiers[f"t{i}"] = {"golfer": g, "score": sc, "status": st}
        # best 4 of 6
        tier_list = list(tiers.values())
        all_scores = sorted(t["score"] for t in tier_list)
        best4_sum = sum(all_scores[:4])
        fifth  = all_scores[4]
        sixth  = all_scores[5]
        # mark isTop4
        threshold = all_scores[3]
        top4_assigned = 0
        for t in tier_list:
            if top4_assigned < 4 and t["score"] <= threshold:
                t["isTop4"] = True
                top4_assigned += 1
            else:
                t["isTop4"] = False
        rows.append({
            "entrantName": p["realName"] or p["entrantName"],
            "picksName":   p["entrantName"],
            "total":       best4_sum,
            "fifth":       fifth,
            "sixth":       sixth,
            "tierScores":  tiers,
        })
    # sort: total → 5th best → 6th best
    rows.sort(key=lambda r: (r["total"], r["fifth"], r["sixth"]))
    # assign ranks — same rank only when all three tiebreakers match
    ranked = []
    rank = 1
    for i, r in enumerate(rows):
        if i > 0 and (r["total"] != rows[i-1]["total"] or
                      r["fifth"]  != rows[i-1]["fifth"]  or
                      r["sixth"]  != rows[i-1]["sixth"]):
            rank = i + 1
        ranked.append({**r, "rank": rank})
    return ranked

def total_score_fn(g):
    return effective_score(g)

def round_score_fn(rnum):
    def fn(g):
        sc = round_score(g, rnum)
        name = resolve(g)
        st = scores_map.get(name, {}).get("status", "active")
        return sc, st
    return fn

# ── Generate JS row ───────────────────────────────────────────────────────────
def js_row(r):
    pick_js = (
        f"{{ entrantName: {json.dumps(r['entrantName'])}, "
        f"picksName: {json.dumps(r['picksName'])} }}"
    )
    tiers = []
    for i in range(1, 7):
        t = r["tierScores"][f"t{i}"]
        st = json.dumps(t["status"])
        it = "true" if t["isTop4"] else "false"
        tiers.append(
            f"t{i}: {{ score: {t['score']}, status: {st}, golfer: {json.dumps(t['golfer'])}, isTop4: {it} }}"
        )
    tier_js = "{ " + ", ".join(tiers) + " }"
    fifth = r.get("fifth", "null")
    sixth = r.get("sixth", "null")
    return (
        f"  {{ rank: {r['rank']}, total: {r['total']}, fifth: {fifth}, sixth: {sixth}, "
        f"pick: {pick_js}, tierScores: {tier_js} }}"
    )

# ── Generate all 5 constants ──────────────────────────────────────────────────
total_rows  = calc_standings(picks, total_score_fn)
round_rows  = [calc_standings(picks, round_score_fn(n)) for n in range(1, 5)]

def const_block(name, rows):
    lines = [f"const {name} = ["]
    lines += [js_row(r) + ("," if i < len(rows)-1 else "") for i, r in enumerate(rows)]
    lines.append("];")
    return "\n".join(lines)

output = "// US Open 2026 — generated from Firestore, corrected for name mismatches\n"
output += const_block("US_OPEN_2026_TOTAL", total_rows) + "\n"
for n in range(1, 5):
    output += const_block(f"US_OPEN_2026_R{n}", round_rows[n-1]) + "\n"

with open("data-archive/usopen2026_constants.js", "w", encoding="utf-8") as f:
    f.write(output)

print("Written to data-archive/usopen2026_constants.js")
print(f"Total entries: {len(total_rows)}")
for i, rn in enumerate(round_rows):
    print(f"R{i+1}: {len(rn)} entries")
