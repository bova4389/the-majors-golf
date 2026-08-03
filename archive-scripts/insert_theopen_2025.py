# -*- coding: utf-8 -*-
"""
Inserts THEOPEN_2025_TOTAL/R1-R4 constants + render functions into standings.js
and updates switchMajorYear() for theopen year 2025.
"""

import os

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
STANDINGS_JS = os.path.join(SCRIPT_DIR, '..', 'js', 'standings.js')
CONSTANTS_JS = os.path.join(SCRIPT_DIR, 'theopen_2025_constants.js')

# Read files
with open(CONSTANTS_JS, 'r', encoding='utf-8') as f:
    constants_text = f.read().rstrip('\n')

with open(STANDINGS_JS, 'r', encoding='utf-8') as f:
    standings = f.read()

# Build render functions using actual emoji chars
GOLD   = '\U0001F947'
SILVER = '\U0001F948'
BRONZE = '\U0001F949'
TROPHY = '\U0001F3C6'

TOTAL_FN = (
"function loadTheOpen2025TotalStandings() {\n"
"  const container = document.getElementById('theopen-total');\n"
"  if (!container) return;\n"
"\n"
"  const medals = ['" + GOLD + "', '" + SILVER + "', '" + BRONZE + "'];\n"
"  const rows = THEOPEN_2025_TOTAL.map(entry => {\n"
"    const rankDisplay = entry.rank <= 3 ? medals[entry.rank - 1] : entry.rank;\n"
"    const rankClass   = entry.rank <= 3 ? `rank-${entry.rank}` : '';\n"
"    const totalCls    = scoreClass(entry.total, null);\n"
"    const tierCells   = [1,2,3,4,5,6].map(i => {\n"
"      const t = entry.tierScores[`t${i}`];\n"
"      const cls   = scoreClass(t.score, t.status);\n"
"      const label = formatScore(t.score, t.status);\n"
"      const top4Class = t.isTop4 ? 'top-4-pick' : '';\n"
"      return `<td class=\"col-tier ${top4Class}\" title=\"${escapeHtml(t.golfer)}\"><div class=\"tier-cell-card\"><span class=\"player-name-cell\">${shortName(t.golfer)}</span><small class=\"score-val ${cls}\">${label}</small></div></td>`;\n"
"    }).join('');\n"
"    const realName  = (entry.pick.entrantName).replace(/ \\d+$/, '');\n"
"    const picksName = entry.pick.picksName || entry.pick.entrantName;\n"
"    const allPlayers = [1,2,3,4,5,6].map(i => entry.tierScores[`t${i}`]?.golfer || '').join(' ');\n"
"    return `\n"
"      <tr data-entry=\"${escapeHtml(picksName).toLowerCase()} ${escapeHtml(realName).toLowerCase()}\" data-players=\"${escapeHtml(allPlayers).toLowerCase()}\">\n"
"        <td class=\"col-rank ${rankClass}\">${rankDisplay}</td>\n"
"        <td class=\"col-name\">${escapeHtml(realName)}</td>\n"
"        <td class=\"col-name col-picks-name\">${escapeHtml(picksName)}</td>\n"
"        <td class=\"col-total\"><span class=\"score-val ${totalCls}\">${formatScore(entry.total, null)}</span></td>\n"
"        ${tierCells}\n"
"      </tr>`;\n"
"  }).join('');\n"
"\n"
"  container.innerHTML = `\n"
"    <div class=\"search-bar\">\n"
"      <input type=\"text\" id=\"theopenTotalSearch\" class=\"standings-search\" placeholder=\"Search entry name or player...\" />\n"
"    </div>\n"
"    <div class=\"table-wrapper\">\n"
"      <table class=\"standings-table\">\n"
"        <thead>\n"
"          <tr>\n"
"            <th>Rank</th><th>Name</th><th>Picks Name</th><th>Total</th>\n"
"            <th class=\"col-tier\">Tier 1</th><th class=\"col-tier\">Tier 2</th><th class=\"col-tier\">Tier 3</th><th class=\"col-tier\">Tier 4</th><th class=\"col-tier\">Tier 5</th><th class=\"col-tier\">Tier 6</th>\n"
"          </tr>\n"
"        </thead>\n"
"        <tbody id=\"theopenTotalBody\">${rows}</tbody>\n"
"      </table>\n"
"    </div>`;\n"
"\n"
"  document.getElementById('theopenTotalSearch').addEventListener('input', e => {\n"
"    const q = e.target.value.toLowerCase().trim();\n"
"    document.querySelectorAll('#theopenTotalBody tr').forEach(row => {\n"
"      const entry = row.dataset.entry || '';\n"
"      const players = row.dataset.players || '';\n"
"      row.style.display = (!q || entry.includes(q) || players.includes(q)) ? '' : 'none';\n"
"    });\n"
"  });\n"
"}\n"
)


def round_fn(rnum, container_id, const_name, search_id, tbody_id, header_label):
    return (
f"function loadTheOpen2025Round{rnum}Standings() {{\n"
f"  const container = document.getElementById('{container_id}');\n"
f"  if (!container) return;\n"
f"\n"
f"  const sorted = [...{const_name}].sort((a, b) => a.rank - b.rank || a.total - b.total);\n"
f"  const medals = ['{GOLD}', '{SILVER}', '{BRONZE}'];\n"
f"  const rows = sorted.map(entry => {{\n"
f"    const rankDisplay = entry.rank <= 3 ? medals[entry.rank - 1] : entry.rank;\n"
f"    const rankClass   = entry.rank <= 3 ? `rank-${{entry.rank}}` : '';\n"
f"    const totalCls    = scoreClass(entry.total, null);\n"
f"    const tierCells   = [1,2,3,4,5,6].map(i => {{\n"
f"      const t = entry.tierScores[`t${{i}}`];\n"
f"      const cls   = scoreClass(t.score, t.status);\n"
f"      const label = formatScore(t.score, t.status);\n"
f"      const top4Class = t.isTop4 ? 'top-4-pick' : '';\n"
f'      return `<td class="col-tier ${{top4Class}}" title="${{escapeHtml(t.golfer)}}"><div class="tier-cell-card"><span class="player-name-cell">${{shortName(t.golfer)}}</span><small class="score-val ${{cls}}">${{label}}</small></div></td>`;\n'
f"    }}).join('');\n"
f"    const realName  = (entry.pick.entrantName).replace(/ \\d+$/, '');\n"
f"    const picksName = entry.pick.picksName || entry.pick.entrantName;\n"
f"    const allPlayers = [1,2,3,4,5,6].map(i => entry.tierScores[`t${{i}}`]?.golfer || '').join(' ');\n"
f'    return `\n'
f'      <tr data-entry="${{escapeHtml(picksName).toLowerCase()}} ${{escapeHtml(realName).toLowerCase()}}" data-players="${{escapeHtml(allPlayers).toLowerCase()}}">\n'
f'        <td class="col-rank ${{rankClass}}">${{rankDisplay}}</td>\n'
f'        <td class="col-name">${{escapeHtml(realName)}}</td>\n'
f'        <td class="col-name col-picks-name">${{escapeHtml(picksName)}}</td>\n'
f'        <td class="col-total"><span class="score-val ${{totalCls}}">${{formatScore(entry.total, null)}}</span></td>\n'
f'        ${{tierCells}}\n'
f'      </tr>`;\n'
f"  }}).join('');\n"
f"\n"
f"  container.innerHTML = `\n"
f'    <div class="search-bar">\n'
f'      <input type="text" id="{search_id}" class="standings-search" placeholder="Search entry name or player..." />\n'
f'    </div>\n'
f'    <div class="table-wrapper">\n'
f'      <table class="standings-table">\n'
f'        <thead>\n'
f'          <tr>\n'
f'            <th>Rank</th><th>Name</th><th>Picks Name</th><th>{header_label}</th>\n'
f'            <th class="col-tier">Tier 1</th><th class="col-tier">Tier 2</th><th class="col-tier">Tier 3</th><th class="col-tier">Tier 4</th><th class="col-tier">Tier 5</th><th class="col-tier">Tier 6</th>\n'
f'          </tr>\n'
f'        </thead>\n'
f'        <tbody id="{tbody_id}">${{rows}}</tbody>\n'
f'      </table>\n'
f'    </div>`;\n'
f"\n"
f"  document.getElementById('{search_id}').addEventListener('input', e => {{\n"
f"    const q = e.target.value.toLowerCase().trim();\n"
f"    document.querySelectorAll('#{tbody_id} tr').forEach(row => {{\n"
f"      const entry = row.dataset.entry || '';\n"
f"      const players = row.dataset.players || '';\n"
f"      row.style.display = (!q || entry.includes(q) || players.includes(q)) ? '' : 'none';\n"
f"    }});\n"
f"  }});\n"
f"}}\n"
    )


R1_FN = round_fn(1, 'theopen-day1', 'THEOPEN_2025_R1', 'theopenR1Search', 'theopenR1Body', 'R1 Total')
R2_FN = round_fn(2, 'theopen-day2', 'THEOPEN_2025_R2', 'theopenR2Search', 'theopenR2Body', 'R2 Total')
R3_FN = round_fn(3, 'theopen-day3', 'THEOPEN_2025_R3', 'theopenR3Search', 'theopenR3Body', 'R3 Total')
R4_FN = round_fn(4, 'theopen-day4', 'THEOPEN_2025_R4', 'theopenR4Search', 'theopenR4Body', 'R4 Total')

PAYOUTS_FN = (
"function loadTheOpen2025Payouts() {\n"
"  const fp = document.getElementById('theopen-finalpayouts');\n"
"  if (!fp) return;\n"
"\n"
"  const finishers = [\n"
"    { display: '" + GOLD   + " 1st', name: 'Erik Vermilyea', payout: '$330' },\n"
"    { display: '" + SILVER + " 2nd', name: 'Bob Cross',      payout: '$180' },\n"
"    { display: '" + BRONZE + " 3rd', name: 'Cassady Glenn',  payout: '$105' },\n"
"    { display: '4th',                name: 'Ron Pannullo',   payout: '$70'  },\n"
"    { display: '5th',                name: 'Nathan Wood',    payout: '$40'  },\n"
"  ];\n"
"\n"
"  const dailyWinners = [\n"
"    { round: 'R1', name: 'Paul Raymond',   payout: '$25' },\n"
"    { round: 'R2', name: 'Erik Vermilyea', payout: '$25' },\n"
"    { round: 'R3', name: 'Nathan Wood',    payout: '$25' },\n"
"    { round: 'R4', name: 'Ron Pannullo',   payout: '$25' },\n"
"  ];\n"
"\n"
"  const finisherCards = finishers.map(f => {\n"
"    const entry = THEOPEN_2025_TOTAL.find(e => e.pick.picksName === f.name);\n"
"    let chipsHtml = '';\n"
"    if (entry) {\n"
"      chipsHtml = '<div class=\"fp-picks-chips\">' + [1,2,3,4,5,6].map(i => {\n"
"        const t = entry.tierScores[`t${i}`];\n"
"        const cls = t.score < 0 ? 'score-under' : t.score > 0 ? 'score-over' : 'score-even';\n"
"        const scoreStr = t.score === 0 ? 'E' : (t.score > 0 ? `+${t.score}` : `${t.score}`);\n"
"        const lastName = t.golfer.split(' ').slice(1).join(' ') || t.golfer;\n"
"        return `<span class=\"fp-pick-chip\"><span class=\"fp-pick-name\">${lastName}</span><span class=\"fp-pick-score ${cls}\">${scoreStr}</span></span>`;\n"
"      }).join('') + '</div>';\n"
"    }\n"
"    return `\n"
"      <div class=\"fp-finisher-card\">\n"
"        <div class=\"fp-finisher-top\">\n"
"          <span class=\"fp-rank-badge\">${f.display}</span>\n"
"          <span class=\"fp-finisher-name\">${f.name}</span>\n"
"          <span class=\"fp-finisher-payout\">${f.payout}</span>\n"
"        </div>\n"
"        <div class=\"fp-picks-row\">${chipsHtml}</div>\n"
"      </div>`;\n"
"  }).join('');\n"
"\n"
"  const roundDataMap = { R1: THEOPEN_2025_R1, R2: THEOPEN_2025_R2, R3: THEOPEN_2025_R3, R4: THEOPEN_2025_R4 };\n"
"\n"
"  const dailyCards = dailyWinners.map(d => {\n"
"    const entries = roundDataMap[d.round] || [];\n"
"    const entry = entries.find(e => e.pick.picksName === d.name);\n"
"    let chipsHtml = '';\n"
"    if (entry) {\n"
"      chipsHtml = '<div class=\"fp-picks-chips\">' + [1,2,3,4,5,6].map(i => {\n"
"        const t = entry.tierScores[`t${i}`];\n"
"        const cls = t.score < 0 ? 'score-under' : t.score > 0 ? 'score-over' : 'score-even';\n"
"        const scoreStr = t.score === 0 ? 'E' : (t.score > 0 ? `+${t.score}` : `${t.score}`);\n"
"        const lastName = t.golfer.split(' ').slice(1).join(' ') || t.golfer;\n"
"        return `<span class=\"fp-pick-chip\"><span class=\"fp-pick-name\">${lastName}</span><span class=\"fp-pick-score ${cls}\">${scoreStr}</span></span>`;\n"
"      }).join('') + '</div>';\n"
"    }\n"
"    return `\n"
"    <div class=\"fp-daily-card\">\n"
"      <div class=\"fp-daily-card-top\">\n"
"        <span class=\"fp-round-badge fp-round-badge-theopen\">${d.round}</span>\n"
"        <span class=\"fp-winner-name\">${d.name}</span>\n"
"        <span class=\"fp-winner-payout\">${d.payout}</span>\n"
"      </div>\n"
"      <div class=\"fp-picks-row\">${chipsHtml}</div>\n"
"    </div>`;\n"
"  }).join('');\n"
"\n"
"  fp.innerHTML = `\n"
"    <div class=\"fp-header fp-header-theopen\">\n"
"      <div class=\"fp-header-left\">\n"
"        <div class=\"fp-trophy-icon\">" + TROPHY + "</div>\n"
"        <div>\n"
"          <h2 class=\"fp-title\">The Open Championship 2025 — Final Results</h2>\n"
"          <p class=\"fp-subtitle\">Royal Portrush · Portrush, Northern Ireland · July 17—20, 2025</p>\n"
"        </div>\n"
"      </div>\n"
"      <div class=\"fp-pool-stats\">\n"
"        <div class=\"fp-stat\">\n"
"          <span class=\"fp-stat-label\">Place Payouts</span>\n"
"          <span class=\"fp-stat-val\">$725</span>\n"
"        </div>\n"
"        <div class=\"fp-stat\">\n"
"          <span class=\"fp-stat-label\">Daily High Scores</span>\n"
"          <span class=\"fp-stat-val\">$100</span>\n"
"        </div>\n"
"        <div class=\"fp-stat\">\n"
"          <span class=\"fp-stat-label\">Total Pool</span>\n"
"          <span class=\"fp-stat-val\">$825</span>\n"
"        </div>\n"
"      </div>\n"
"    </div>\n"
"    <div class=\"fp-two-col\">\n"
"      <div class=\"fp-section\">\n"
"        <h3 class=\"fp-section-title fp-section-title-theopen\">Place Finishers</h3>\n"
"        <div class=\"fp-finishers\">${finisherCards}</div>\n"
"      </div>\n"
"      <div class=\"fp-section\">\n"
"        <h3 class=\"fp-section-title fp-section-title-theopen\">Daily High Score Winners</h3>\n"
"        <div class=\"fp-daily-winners\">${dailyCards}</div>\n"
"      </div>\n"
"    </div>`;\n"
"}\n"
)

functions_block = TOTAL_FN + '\n' + R1_FN + '\n' + R2_FN + '\n' + R3_FN + '\n' + R4_FN + '\n' + PAYOUTS_FN

# Build insertion block
insertion = constants_text + '\n\n' + functions_block + '\n'

# Insert before the THEOPEN_2025_FIELD comment
anchor = '// Scottie Scheffler won at -17, played at Royal Portrush, Northern Ireland'
if anchor not in standings:
    print("ERROR: anchor not found in standings.js")
    exit(1)

new_standings = standings.replace(anchor, insertion + anchor, 1)

# Update switchMajorYear() theopen year===2025 block
old_switch = "    if (year === 2025) {\n      // 2025 is scoreboard-only \\u2014 nothing more to do\n    } else {"
new_switch = (
"    if (year === 2025) {\n"
"      loadTheOpen2025TotalStandings();\n"
"      loadTheOpen2025Round1Standings();\n"
"      loadTheOpen2025Round2Standings();\n"
"      loadTheOpen2025Round3Standings();\n"
"      loadTheOpen2025Round4Standings();\n"
"      loadTheOpen2025Payouts();\n"
"      const theOpenPanel2025 = document.getElementById('panel-theopen');\n"
"      if (theOpenPanel2025) {\n"
"        theOpenPanel2025.querySelectorAll('.inner-panel').forEach(p => { p.classList.remove('inner-panel-active'); p.classList.add('hidden'); });\n"
"        theOpenPanel2025.querySelectorAll('.inner-tab').forEach(btn => btn.classList.remove('active'));\n"
"        const totalPanel = document.getElementById('theopen-total');\n"
"        if (totalPanel) { totalPanel.classList.remove('hidden'); totalPanel.classList.add('inner-panel-active'); }\n"
"        const totalBtn = theOpenPanel2025.querySelector('.inner-tab[data-inner=\"total\"]');\n"
"        if (totalBtn) totalBtn.classList.add('active');\n"
"      }\n"
"    } else {"
)

if old_switch not in new_standings:
    print("ERROR: switchMajorYear theopen 2025 block not found")
    print("Looking for:", repr(old_switch[:100]))
    # Try to find nearby context
    idx = new_standings.find("2025 is scoreboard-only")
    if idx >= 0:
        print("Found 'scoreboard-only' at index", idx)
        print("Context:", repr(new_standings[idx-50:idx+80]))
    exit(1)

new_standings = new_standings.replace(old_switch, new_switch, 1)

# Write out
with open(STANDINGS_JS, 'w', encoding='utf-8') as f:
    f.write(new_standings)

print("Done. standings.js updated.")
print(f"  New file size: {len(new_standings):,} chars / {new_standings.count(chr(10)):,} lines")
