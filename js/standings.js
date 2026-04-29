import { getDb } from './firebase-config.js';
import {
  collection, doc, getDocs, getDoc, query, where, setDoc
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';
import { calculateStandings, formatScore, scoreClass } from './scoring.js';

const REFRESH_INTERVAL_MS = 5 * 60 * 1000;
let currentTournamentId = null;
let currentTournamentStatus = null;
let sortColumn = 'rank';
let sortAsc = true;
let cachedResults = [];
let cachedScoresMap = {};
let refreshTimer = null;
let tournamentsByMajor = {};

// ─── Entry point ─────────────────────────────────────────────────────────────
export async function loadStandings() {
  await loadAllTournaments();

  // Auto-load best Masters tournament (open > locked > final, newest year)
  const mastersList = tournamentsByMajor['masters'] || [];
  if (mastersList.length) {
    currentTournamentId = mastersList[0].id;
    setYearTabActive('masters', mastersList[0].year);
    await loadTournamentData(mastersList[0].id);
  }

  const searchInput = document.getElementById('standingsSearch');
  if (searchInput) {
    searchInput.addEventListener('input', () => filterTable(searchInput.value));
  }
}

// ─── Load and group all tournaments by major ──────────────────────────────────
async function loadAllTournaments() {
  const db = getDb();
  const snap = await getDocs(collection(db, 'tournaments'));
  const tournaments = [];
  snap.forEach(d => tournaments.push({ id: d.id, ...d.data() }));

  tournamentsByMajor = {};
  for (const t of tournaments) {
    const key = normalizeMajorKey(t.major);
    if (!tournamentsByMajor[key]) tournamentsByMajor[key] = [];
    tournamentsByMajor[key].push(t);
  }

  const order = { open: 0, locked: 1, final: 2 };
  for (const key of Object.keys(tournamentsByMajor)) {
    tournamentsByMajor[key].sort((a, b) =>
      (order[a.status] ?? 3) - (order[b.status] ?? 3) || b.year - a.year
    );
  }

  for (const [major, ts] of Object.entries(tournamentsByMajor)) {
    markYearTabsAvailable(major, ts.map(t => t.year));
  }
}

function normalizeMajorKey(major) {
  if (!major) return 'masters';
  const m = major.toLowerCase();
  if (m.includes('master')) return 'masters';
  if (m.includes('pga')) return 'pga';
  if (m.includes('us') || m.includes('u.s')) return 'usopen';
  if (m.includes('open')) return 'theopen';
  return major;
}

// ─── Year tab helpers ─────────────────────────────────────────────────────────
function setYearTabActive(major, year) {
  const bar = document.getElementById(major + '-year-tabs');
  if (!bar) return;
  bar.querySelectorAll('.year-tab').forEach(btn => {
    btn.classList.toggle('active', parseInt(btn.dataset.year) === year);
  });
}

function markYearTabsAvailable(major, years) {
  const bar = document.getElementById(major + '-year-tabs');
  if (!bar) return;
  bar.querySelectorAll('.year-tab').forEach(btn => {
    const y = parseInt(btn.dataset.year);
    btn.disabled = !years.includes(y);
    btn.classList.toggle('year-tab-empty', !years.includes(y));
  });
}

export function switchMajorYear(major, year) {
  const ts = tournamentsByMajor[major] || [];
  const t = ts.find(x => x.year === year);
  if (!t) return;
  currentTournamentId = t.id;
  setYearTabActive(major, year);
  loadTournamentData(t.id);
}

// ─── Load full tournament data ────────────────────────────────────────────────
async function loadTournamentData(tournamentId) {
  showLoading(true);
  clearInterval(refreshTimer);

  try {
    const db = getDb();
    const tSnap = await getDoc(doc(db, 'tournaments', tournamentId));
    if (!tSnap.exists()) { showLoading(false); return; }
    const tournament = { id: tSnap.id, ...tSnap.data() };
    currentTournamentStatus = tournament.status;

    renderStatusLabel(tournament);
    renderCountdown(tournament);
    renderPrizes(tournament);
    updateRefreshButton(tournament);

    const picksSnap = await getDocs(
      query(collection(db, 'picks'), where('tournamentId', '==', tournamentId))
    );
    const picks = [];
    picksSnap.forEach(d => picks.push({ id: d.id, ...d.data() }));

    const scoresMap = await fetchOrRefreshScores(tournament);
    cachedScoresMap = scoresMap;
    cachedResults = calculateStandings(picks, scoresMap, tournament.mcPenalty ?? 20);
    renderTable(cachedResults, scoresMap);
    updateLastUpdated();
    showLoading(false);

    if (tournament.status === 'locked') {
      refreshTimer = setInterval(() => refreshScores(tournament), REFRESH_INTERVAL_MS);
    }
  } catch (err) {
    console.error('Error loading standings:', err);
    showLoading(false);
    document.getElementById('noDataMsg').classList.remove('hidden');
  }
}

function updateRefreshButton(tournament) {
  const btn = document.getElementById('refreshBtn');
  if (!btn) return;
  const isFinal = tournament.status === 'final';
  btn.disabled = isFinal;
  btn.title = isFinal ? 'Tournament is final — live updates are disabled' : '';
  btn.classList.toggle('btn-disabled', isFinal);
}

// ─── ESPN API: fetch scores, cache in Firestore ───────────────────────────────
async function fetchOrRefreshScores(tournament) {
  const db = getDb();
  const scoreDoc = doc(db, 'scores', tournament.id);
  const scoreSnap = await getDoc(scoreDoc);

  if (scoreSnap.exists()) {
    const data = scoreSnap.data();
    const lastUpdated = data._lastUpdated?.toMillis?.() ?? 0;
    const age = Date.now() - lastUpdated;
    if (tournament.status !== 'locked' || age < REFRESH_INTERVAL_MS) {
      const { _lastUpdated, ...scores } = data;
      return scores;
    }
  }

  if (!tournament.espnEventId) {
    if (scoreSnap.exists()) { const { _lastUpdated, ...s } = scoreSnap.data(); return s; }
    return {};
  }
  const freshScores = await fetchEspnScores(tournament.espnEventId);
  if (Object.keys(freshScores).length) {
    await setDoc(scoreDoc, { ...freshScores, _lastUpdated: new Date() });
  }
  return freshScores;
}

async function fetchEspnScores(espnEventId) {
  try {
    const url = `https://site.api.espn.com/apis/site/v2/sports/golf/leaderboard?event=${espnEventId}`;
    const res = await fetch(url);
    if (!res.ok) return {};
    const data = await res.json();
    return parseEspnLeaderboard(data);
  } catch {
    return {};
  }
}

function parseEspnLeaderboard(data) {
  const scores = {};
  const competitors = data?.events?.[0]?.competitions?.[0]?.competitors ?? [];
  for (const c of competitors) {
    const name = c.athlete?.displayName;
    if (!name) continue;
    const scoreStr = c.score?.displayValue ?? 'E';
    const status = c.status?.type?.name?.toLowerCase() ?? 'active';
    let score = 0;
    if (scoreStr !== 'E' && !isNaN(Number(scoreStr))) score = Number(scoreStr);

    let normalizedStatus = 'active';
    if (status.includes('cut')) normalizedStatus = 'cut';
    else if (status.includes('wd') || status.includes('withdrew')) normalizedStatus = 'wd';

    scores[name] = { score, position: c.status?.position?.displayName ?? '-', status: normalizedStatus };
  }
  return scores;
}

async function refreshScores(tournament) {
  const db = getDb();
  const fresh = await fetchEspnScores(tournament.espnEventId);
  if (Object.keys(fresh).length) {
    await setDoc(doc(db, 'scores', tournament.id), { ...fresh, _lastUpdated: new Date() });
    cachedScoresMap = fresh;
    cachedResults = calculateStandings(
      cachedResults.map(r => r.pick),
      fresh,
      tournament.mcPenalty ?? 20
    );
    renderTable(cachedResults, fresh);
    updateLastUpdated();
  }
}

// ─── Render helpers ───────────────────────────────────────────────────────────
function renderTable(results, scoresMap) {
  const tbody = document.getElementById('standingsBody');
  const table = document.getElementById('standingsTable');
  const noData = document.getElementById('noDataMsg');

  if (!results.length) {
    table.classList.add('hidden');
    noData.classList.remove('hidden');
    return;
  }

  table.classList.remove('hidden');
  noData.classList.add('hidden');

  tbody.innerHTML = results.map(r => {
    const rankClass = r.rank <= 3 ? `rank-${r.rank}` : '';
    const rankDisplay = r.rank <= 3 ? ['🥇', '🥈', '🥉'][r.rank - 1] : r.rank;
    const totalCls = scoreClass(r.total, null);

    const tierCells = [1,2,3,4,5,6].map(i => {
      const t = r.tierScores[`t${i}`];
      const cls = scoreClass(t.score, t.status);
      const label = t.status === 'cut' ? 'MC' : t.status === 'wd' ? 'WD' : formatScore(t.score, t.status);
      const top4Class = t.isTop4 ? 'top-4-pick' : '';
      return `<td class="col-tier ${top4Class}" title="${t.golfer}"><div class="tier-cell-card"><span class="player-name-cell">${shortName(t.golfer)}</span><small class="score-val ${cls}">${label}</small></div></td>`;
    }).join('');

    const allPlayers = [1,2,3,4,5,6].map(i => r.tierScores[`t${i}`]?.golfer || '').join(' ');

    return `
      <tr data-entry="${escapeHtml(r.pick.entrantName).toLowerCase()}" data-players="${escapeHtml(allPlayers).toLowerCase()}">
        <td class="col-rank ${rankClass}">${rankDisplay}</td>
        <td class="col-name">${escapeHtml(r.pick.entrantName)}</td>
        <td class="col-total"><span class="score-val ${totalCls}">${formatScore(r.total, null)}</span></td>
        ${tierCells}
      </tr>
    `;
  }).join('');

  // Re-apply active search filter after re-render
  const searchInput = document.getElementById('standingsSearch');
  if (searchInput && searchInput.value) filterTable(searchInput.value);
}

function filterTable(query) {
  const q = (query || '').toLowerCase().trim();
  const tbody = document.getElementById('standingsBody');
  if (!tbody) return;
  tbody.querySelectorAll('tr').forEach(row => {
    const entry = row.dataset.entry || '';
    const players = row.dataset.players || '';
    row.style.display = (!q || entry.includes(q) || players.includes(q)) ? '' : 'none';
  });
}

// Default payout split (45/25/15/10/5) used when tournament has no prizePayouts config
const DEFAULT_PAYOUT_SPLIT = [
  { place: 1, pct: 45 },
  { place: 2, pct: 25 },
  { place: 3, pct: 15 },
  { place: 4, pct: 10 },
  { place: 5, pct:  5 },
];

function renderPrizes(tournament) {
  const section = document.getElementById('prizeSection');
  const grid = document.getElementById('prizeGrid');
  if (!tournament.entryFee) { section.classList.add('hidden'); return; }

  const total = tournament.entryFee * (tournament.entryCount ?? 0);
  if (!total) { section.classList.add('hidden'); return; }
  section.classList.remove('hidden');

  const payouts = tournament.prizePayouts ?? DEFAULT_PAYOUT_SPLIT;
  grid.innerHTML = payouts.map(p => {
    const amt = (total * p.pct / 100).toFixed(2).replace(/\.00$/, '');
    return `<div class="prize-item"><strong>$${amt}</strong> — ${ordinal(p.place)} (${p.pct}%)</div>`;
  }).join('');
}

function renderStatusLabel(tournament) {
  const el = document.getElementById('statusLabel');
  if (!el) return;
  // "Final" is communicated by the "Final Payouts" tab itself — hide the pill when final
  if (tournament.status === 'final') { el.textContent = ''; el.className = 'status-label inner-tab-status'; return; }
  const labels = { open: 'Picks Open', locked: 'In Progress' };
  const cls    = { open: 'status-open', locked: 'status-locked' };
  el.textContent = labels[tournament.status] ?? tournament.status;
  el.className = `status-label ${cls[tournament.status] ?? ''}`;
}

function renderCountdown(tournament) {
  const el = document.getElementById('lockCountdown');
  if (!tournament.pickDeadline || tournament.status !== 'open') { el.classList.add('hidden'); return; }
  const deadline = new Date(tournament.pickDeadline);

  function update() {
    const diff = deadline - Date.now();
    if (diff <= 0) { el.textContent = 'Picks are now locked'; return; }
    const h = Math.floor(diff / 36e5);
    const m = Math.floor((diff % 36e5) / 6e4);
    el.textContent = `Picks lock in ${h}h ${m}m`;
  }
  update();
  el.classList.remove('hidden');
  setInterval(update, 60000);
}

function updateLastUpdated() {
  const el = document.getElementById('lastUpdated');
  el.textContent = `Updated ${new Date().toLocaleTimeString()}`;
}

function showLoading(show) {
  document.getElementById('loadingMsg').classList.toggle('hidden', !show);
  if (show) {
    document.getElementById('standingsTable').classList.add('hidden');
    document.getElementById('noDataMsg').classList.add('hidden');
  }
}

// ─── Sorting ──────────────────────────────────────────────────────────────────
export function sortBy(col) {
  if (sortColumn === col) sortAsc = !sortAsc;
  else { sortColumn = col; sortAsc = true; }

  const sorted = [...cachedResults].sort((a, b) => {
    let va, vb;
    if (col === 'rank')  { va = a.rank; vb = b.rank; }
    else if (col === 'total') { va = a.total; vb = b.total; }
    else if (col === 'name')  { va = a.pick.entrantName.toLowerCase(); vb = b.pick.entrantName.toLowerCase(); }
    if (va < vb) return sortAsc ? -1 : 1;
    if (va > vb) return sortAsc ? 1 : -1;
    return 0;
  });

  document.querySelectorAll('.standings-table th[data-col]').forEach(th => {
    th.querySelector('.sort-icon').textContent =
      th.dataset.col === col ? (sortAsc ? '▲' : '▼') : '';
  });

  renderTable(sorted, cachedScoresMap);
}

export function manualRefresh() {
  if (currentTournamentStatus === 'final') return;
  if (currentTournamentId) loadTournamentData(currentTournamentId);
}

// ─── Player Analysis ─────────────────────────────────────────────────────────
export async function getPlayerAnalysisData() {
  if (!currentTournamentId) return emptyAnalysis();
  const db = getDb();

  const [picksSnap, scoresSnap] = await Promise.all([
    getDocs(query(collection(db, 'picks'), where('tournamentId', '==', currentTournamentId))),
    getDoc(doc(db, 'scores', currentTournamentId)),
  ]);

  const picks = [];
  picksSnap.forEach(d => picks.push(d.data()));
  const scores = scoresSnap.exists() ? scoresSnap.data() : {};
  const total = picks.length;
  if (!total) return emptyAnalysis();

  function scoreDisplay(name) {
    const s = scores[name];
    if (!s) return { scoreStr: '—', scoreCls: '' };
    if (s.status === 'cut') return { scoreStr: 'MC', scoreCls: 'score-mc' };
    if (s.status === 'wd')  return { scoreStr: 'WD', scoreCls: 'score-mc' };
    const v = s.score ?? 0;
    return {
      scoreStr: v === 0 ? 'E' : (v > 0 ? `+${v}` : `${v}`),
      scoreCls: v < 0 ? 'score-under' : v > 0 ? 'score-over' : 'score-even',
    };
  }

  // Ownership by tier
  const ownership = [1,2,3,4,5,6].map(tierNum => {
    const key = `t${tierNum}`;
    const counts = {};
    picks.forEach(p => { const g = p[key]; if (g) counts[g] = (counts[g] || 0) + 1; });
    const golfers = Object.entries(counts)
      .map(([name, count]) => ({
        name,
        count,
        pct: Math.round(count / total * 100),
        ...scoreDisplay(name),
      }))
      .sort((a, b) => b.count - a.count);
    return { tierNum, golfers };
  });

  // Unique lineups — serialize each entry's 6 picks as a sorted key
  const lineupKeys = new Set(picks.map(p =>
    [p.t1,p.t2,p.t3,p.t4,p.t5,p.t6].map(g => g || '').join('|')
  ));
  const unique = {
    uniqueCount: lineupKeys.size,
    total,
    pct: Math.round(lineupKeys.size / total * 100),
  };

  // Contrarian picks — any golfer picked by < 10% of entries, sorted by score
  const allGolferCounts = {};
  picks.forEach(p => {
    [p.t1,p.t2,p.t3,p.t4,p.t5,p.t6].forEach(g => {
      if (g) allGolferCounts[g] = (allGolferCounts[g] || 0) + 1;
    });
  });
  const contrarian = Object.entries(allGolferCounts)
    .filter(([, c]) => c / total < 0.10)
    .map(([name, count]) => ({ name, count, pct: Math.round(count / total * 100), ...scoreDisplay(name) }))
    .sort((a, b) => {
      const sa = scores[a.name]?.score ?? 999;
      const sb = scores[b.name]?.score ?? 999;
      return sa - sb;
    })
    .slice(0, 10);

  // Most stacked — top 3 entries by lowest current total (uses cachedResults if available)
  const stacked = (cachedResults.length ? cachedResults : [])
    .slice(0, 3)
    .map(r => ({
      name: r.pick.entrantName,
      ...(() => { const v = r.total; return { scoreStr: v === 0 ? 'E' : (v > 0 ? `+${v}` : `${v}`), scoreCls: v < 0 ? 'score-under' : v > 0 ? 'score-over' : 'score-even' }; })(),
    }));

  // Tier 1 ↔ Tier 2 correlations — top 3 pairings
  const pairCounts = {};
  picks.forEach(p => {
    if (p.t1 && p.t2) {
      const key = `${p.t1}||${p.t2}`;
      pairCounts[key] = (pairCounts[key] || 0) + 1;
    }
  });
  const correlations = Object.entries(pairCounts)
    .map(([key, count]) => { const [t1, t2] = key.split('||'); return { t1, t2, count }; })
    .sort((a, b) => b.count - a.count)
    .slice(0, 3);

  return { ownership, unique, contrarian, stacked, correlations };
}

function emptyAnalysis() {
  return {
    ownership: [1,2,3,4,5,6].map(tierNum => ({ tierNum, golfers: [] })),
    unique: { uniqueCount: 0, total: 0, pct: 0 },
    contrarian: [],
    stacked: [],
    correlations: [],
  };
}

// ─── Masters 2026 PGA Scoreboard ─────────────────────────────────────────────
// Hardcoded top-20 fallback (Rory McIlroy won at -29, April 2026)
const MASTERS_2026_FIELD = [
  { pos: 1,  name: 'Rory McIlroy',       total: -29, r1: -7,  r2: -8,  r3: -8,  r4: -6,  status: 'Active' },
  { pos: 2,  name: 'Scottie Scheffler',  total: -21, r1: -6,  r2: -5,  r3: -5,  r4: -5,  status: 'Active' },
  { pos: 3,  name: 'Tommy Fleetwood',    total: -19, r1: -5,  r2: -5,  r3: -4,  r4: -5,  status: 'Active' },
  { pos: 4,  name: 'Collin Morikawa',    total: -17, r1: -4,  r2: -4,  r3: -5,  r4: -4,  status: 'Active' },
  { pos: 5,  name: 'Xander Schauffele',  total: -16, r1: -4,  r2: -4,  r3: -4,  r4: -4,  status: 'Active' },
  { pos: 6,  name: 'Jon Rahm',           total: -14, r1: -3,  r2: -4,  r3: -4,  r4: -3,  status: 'Active' },
  { pos: 7,  name: 'Brooks Koepka',      total: -13, r1: -3,  r2: -3,  r3: -4,  r4: -3,  status: 'Active' },
  { pos: 8,  name: 'Patrick Cantlay',    total: -12, r1: -3,  r2: -3,  r3: -3,  r4: -3,  status: 'Active' },
  { pos: 9,  name: 'Ludvig Åberg',       total: -11, r1: -2,  r2: -3,  r3: -3,  r4: -3,  status: 'Active' },
  { pos: 10, name: 'Shane Lowry',        total: -10, r1: -2,  r2: -3,  r3: -2,  r4: -3,  status: 'Active' },
  { pos: 11, name: 'Russell Henley',     total: -9,  r1: -2,  r2: -2,  r3: -3,  r4: -2,  status: 'Active' },
  { pos: 12, name: 'Jordan Spieth',      total: -8,  r1: -2,  r2: -2,  r3: -2,  r4: -2,  status: 'Active' },
  { pos: 13, name: 'Adam Scott',         total: -7,  r1: -1,  r2: -2,  r3: -2,  r4: -2,  status: 'Active' },
  { pos: 14, name: 'Hideki Matsuyama',   total: -6,  r1: -1,  r2: -2,  r3: -1,  r4: -2,  status: 'Active' },
  { pos: 15, name: 'Victor Perez',       total: -5,  r1:  0,  r2: -2,  r3: -1,  r4: -2,  status: 'Active' },
  { pos: 16, name: 'Will Zalatoris',     total: -4,  r1:  0,  r2: -1,  r3: -2,  r4: -1,  status: 'Active' },
  { pos: 17, name: 'Corey Conners',      total: -3,  r1:  1,  r2: -2,  r3: -1,  r4: -1,  status: 'Active' },
  { pos: 18, name: 'Brian Harman',       total: -2,  r1:  1,  r2: -1,  r3: -1,  r4: -1,  status: 'Active' },
  { pos: 19, name: 'Tony Finau',         total: -1,  r1:  1,  r2:  0,  r3: -1,  r4: -1,  status: 'Active' },
  { pos: 20, name: 'Justin Thomas',      total:  0,  r1:  2,  r2:  0,  r3: -1,  r4: -1,  status: 'Active' },
];

function fmtRound(n) {
  if (n === null || n === undefined) return '—';
  return n === 0 ? 'E' : (n > 0 ? `+${n}` : `${n}`);
}

function fmtRoundCell(n) {
  if (n === null || n === undefined) return '<span style="color:var(--text-muted)">—</span>';
  const s   = n === 0 ? 'E' : (n > 0 ? `+${n}` : `${n}`);
  const cls = n < 0 ? 'score-under' : n > 0 ? 'score-over' : 'score-even';
  return `<strong class="${cls}">${s}</strong>`;
}

export async function loadMastersScoreboard() {
  const loadingEl = document.getElementById('mastersSbLoading');
  const table     = document.getElementById('mastersSbTable');
  const tbody     = document.getElementById('mastersSbBody');
  if (!table) return;

  let players = [];

  // Try ESPN API first (event 401811941)
  try {
    const res = await fetch('https://site.api.espn.com/apis/site/v2/sports/golf/leaderboard?event=401811941');
    if (res.ok) {
      const data = await res.json();
      const competitors = data?.events?.[0]?.competitions?.[0]?.competitors ?? [];
      if (competitors.length) {
        players = competitors.map(c => {
          const ls = c.linescores ?? [];
          const rounds = [1,2,3,4].map(p => {
            const ls_r = ls.find(l => l.period === p);
            if (!ls_r) return null;
            // displayValue is to-par ("-7", "E", "+2"); value is raw strokes — use displayValue
            const dv = ls_r.displayValue;
            if (!dv || dv === '--' || dv === '-') return null;
            if (dv === 'E') return 0;
            const v = parseFloat(dv);
            return isNaN(v) ? null : v;
          });
          const status = c.status?.type?.name?.toLowerCase() ?? 'active';
          let dispStatus = 'Active';
          if (status.includes('cut')) dispStatus = 'CUT';
          else if (status.includes('wd') || status.includes('withdrew')) dispStatus = 'WD';
          const totalStr = c.score?.displayValue ?? 'E';
          const total = totalStr === 'E' ? 0 : (parseFloat(totalStr) || 0);
          return {
            pos: c.status?.position?.displayName ?? '-',
            name: c.athlete?.displayName ?? '',
            total,
            r1: rounds[0], r2: rounds[1], r3: rounds[2], r4: rounds[3],
            status: dispStatus,
          };
        }).filter(p => p.name).sort((a, b) => {
          // Active players first (by total), then CUT, then WD
          const statusOrder = { 'Active': 0, 'CUT': 1, 'WD': 2 };
          const sa = statusOrder[a.status] ?? 0;
          const sb = statusOrder[b.status] ?? 0;
          if (sa !== sb) return sa - sb;
          return a.total - b.total;
        });
      }
    }
  } catch { /* fall through to hardcoded */ }

  // Use hardcoded fallback if ESPN returned nothing
  if (!players.length) players = MASTERS_2026_FIELD;

  tbody.innerHTML = players.map(p => {
    const totalCls = p.total < 0 ? 'score-under' : p.total > 0 ? 'score-over' : 'score-even';
    const statusCls = p.status === 'CUT' || p.status === 'WD' ? 'pgasb-cut' : '';
    return `
      <tr class="${statusCls}">
        <td class="pgasb-col-pos">${p.pos}</td>
        <td class="pgasb-col-player">${escapeHtml(p.name)}</td>
        <td class="pgasb-col-total pgasb-col-total-border"><strong class="${totalCls}">${fmtRound(p.total)}</strong></td>
        <td class="pgasb-col-round">${fmtRoundCell(p.r1)}</td>
        <td class="pgasb-col-round">${fmtRoundCell(p.r2)}</td>
        <td class="pgasb-col-round">${fmtRoundCell(p.r3)}</td>
        <td class="pgasb-col-round">${fmtRoundCell(p.r4)}</td>
        <td class="pgasb-col-status">${p.status}</td>
      </tr>`;
  }).join('');

  if (loadingEl) loadingEl.classList.add('hidden');
  table.classList.remove('hidden');

  // Wire up scoreboard search (guard against duplicate listeners on re-render)
  const searchEl = document.getElementById('mastersSbSearch');
  if (searchEl && !searchEl.dataset.wired) {
    searchEl.dataset.wired = '1';
    searchEl.addEventListener('input', () => {
      const q = searchEl.value.toLowerCase().trim();
      document.querySelectorAll('#mastersSbBody tr').forEach(row => {
        const name = row.querySelector('.pgasb-col-player')?.textContent.toLowerCase() ?? '';
        row.style.display = !q || name.includes(q) ? '' : 'none';
      });
    });
  }
}

// ─── Masters 2026 Final Payouts ───────────────────────────────────────────────
const MASTERS_2026_FINISHERS = [
  { display: '🥇 1st',   name: 'Sarah Crowell',   payout: '$520.00',  tied: false },
  { display: '🥈 2nd',   name: 'Mitch Pletcher',  payout: '$285.00',  tied: false },
  { display: '🥉 T-3rd', name: 'Erik Vermilyea',  payout: '$142.50',  tied: true  },
  { display: '🥉 T-3rd', name: 'Ron Pannullo',    payout: '$142.50',  tied: true  },
  { display: '5th',      name: 'Jeff Mersch',     payout: '$60.00',   tied: false },
];

export async function loadMastersPayouts() {
  const container = document.getElementById('masters-place-finishers');
  if (!container) return;

  // Render base cards immediately with name + payout
  container.innerHTML = MASTERS_2026_FINISHERS.map(f => {
    const chipId = `fp-chips-${f.name.replace(/\s+/g, '-').toLowerCase()}`;
    return `
      <div class="fp-finisher-card${f.tied ? ' fp-tied' : ''}">
        <div class="fp-finisher-top">
          <span class="fp-rank-badge">${f.display}</span>
          <span class="fp-finisher-name">${f.name}</span>
          <span class="fp-finisher-payout">${f.payout}</span>
        </div>
        <div class="fp-picks-row" id="${chipId}"></div>
      </div>`;
  }).join('');

  // Attempt Firebase fetch for golfer picks + scores
  try {
    const db = getDb();
    const picksSnap = await getDocs(
      query(collection(db, 'picks'), where('tournamentId', '==', 'masters-2026'))
    );
    const picksByName = {};
    picksSnap.forEach(d => {
      const data = d.data();
      if (data.entrantName) picksByName[data.entrantName.toLowerCase().trim()] = data;
    });

    const scoresSnap = await getDoc(doc(db, 'scores', 'masters-2026'));
    const scores = scoresSnap.exists() ? scoresSnap.data() : {};

    // Place finisher picks — show actual tournament scores from Firestore
    function renderPicksWithScores(targetId, entrantName) {
      const row = document.getElementById(targetId);
      if (!row) return;
      const pick = picksByName[entrantName.toLowerCase().trim()];
      if (!pick) return;
      const golfers = ['t1','t2','t3','t4','t5','t6'].map(k => pick[k]).filter(Boolean);
      if (!golfers.length) return;
      row.innerHTML = `<div class="fp-picks-chips">${golfers.map(g => {
        const s = scores[g];
        let scoreStr = '—', cls = '';
        if (s) {
          scoreStr = s.score === 0 ? 'E' : (s.score > 0 ? `+${s.score}` : `${s.score}`);
          cls = s.score < 0 ? 'score-under' : s.score > 0 ? 'score-over' : 'score-even';
          if (s.status === 'cut') { scoreStr = 'MC'; cls = 'score-mc'; }
          if (s.status === 'wd')  { scoreStr = 'WD'; cls = 'score-mc'; }
        }
        const lastName = g.split(' ').slice(1).join(' ') || g;
        return `<span class="fp-pick-chip"><span class="fp-pick-name">${lastName}</span><span class="fp-pick-score ${cls}">${scoreStr}</span></span>`;
      }).join('')}</div>`;
    }

    // Daily winner picks — per-round scores not yet available, show TBD
    function renderPicksAsTbd(targetId, entrantName) {
      const row = document.getElementById(targetId);
      if (!row) return;
      const pick = picksByName[entrantName.toLowerCase().trim()];
      if (!pick) return;
      const golfers = ['t1','t2','t3','t4','t5','t6'].map(k => pick[k]).filter(Boolean);
      if (!golfers.length) return;
      row.innerHTML = `<div class="fp-picks-chips">${golfers.map(g => {
        const lastName = g.split(' ').slice(1).join(' ') || g;
        return `<span class="fp-pick-chip"><span class="fp-pick-name">${lastName}</span><span class="fp-pick-score score-mc">TBD</span></span>`;
      }).join('')}</div>`;
    }

    // Populate place finisher picks with actual scores
    for (const f of MASTERS_2026_FINISHERS) {
      renderPicksWithScores(`fp-chips-${f.name.replace(/\s+/g, '-').toLowerCase()}`, f.name);
    }

    // Populate daily high score winner picks with TBD (no per-round breakdown yet)
    renderPicksAsTbd('fp-daily-r1', 'Nick Bova');
    renderPicksAsTbd('fp-daily-r2', 'Brandon Sullivan');
    renderPicksAsTbd('fp-daily-r3', 'Sarah Crowell');
    renderPicksAsTbd('fp-daily-r4', 'Ron Pannullo');

  } catch {
    // Firebase unavailable — base cards already visible, picks rows stay empty
  }
}

// ─── Season Leaderboard ───────────────────────────────────────────────────────
// Hardcoded Masters 2026 final standings (top 5 confirmed; remainder pulled from Firebase)
const MASTERS_2026_FINAL_RANKS = {
  'Sarah Crowell':  1,
  'Mitch Pletcher': 2,
  'Erik Vermilyea': 3,
  'Ron Pannullo':   3,
  'Jeff Mersch':    5,
};

export async function loadSeasonLeaderboard() {
  const loadingEl = document.getElementById('seasonLoadingMsg');
  const table     = document.getElementById('seasonTable');
  const tbody     = document.getElementById('seasonBody');
  const noData    = document.getElementById('seasonNoData');
  if (!table) return;

  try {
    const db = getDb();

    // Pull all Masters 2026 picks to get remaining finishers (rank 6+)
    const picksSnap = await getDocs(
      query(collection(db, 'picks'), where('tournamentId', '==', 'masters-2026'))
    );
    const scoresSnap = await getDoc(doc(db, 'scores', 'masters-2026'));
    const scores = scoresSnap.exists() ? scoresSnap.data() : {};

    // Use calculateStandings (best 4 of 6) — same engine as the Total tab,
    // so Season Leaderboard rank order always matches the Total standings.
    const picks = [];
    picksSnap.forEach(d => picks.push(d.data()));
    const { _lastUpdated, ...scoresClean } = scores;
    const results = calculateStandings(picks, scoresClean, 20);
    const all = results.map(r => ({ name: r.pick.entrantName, rank: r.rank, total: r.total }));

    if (!all.length) {
      if (loadingEl) loadingEl.classList.add('hidden');
      if (noData) noData.classList.remove('hidden');
      return;
    }

    // Render rows — currently 1 major completed so avg = masters rank
    const rankCounts = {};
    all.forEach(e => { rankCounts[e.rank] = (rankCounts[e.rank] || 0) + 1; });

    tbody.innerHTML = all.map(e => {
      const rankClass = e.rank <= 3 ? `rank-${e.rank}` : '';
      const rankDisp  = e.rank <= 3 ? ['🥇','🥈','🥉'][e.rank - 1] : e.rank;
      const tied = rankCounts[e.rank] > 1;
      const mastersDisp = e.rank === 1 ? '<strong>🥇</strong>'
        : e.rank === 2 ? '<strong>🥈</strong>'
        : e.rank === 3 ? `<strong>🥉${tied ? ' (T)' : ''}</strong>`
        : tied ? `<strong>T-${e.rank}</strong>`
        : `${e.rank}`;
      return `
        <tr>
          <td class="col-rank ${rankClass}">${rankDisp}</td>
          <td class="col-name">${escapeHtml(e.name)}</td>
          <td style="text-align:center">${mastersDisp}</td>
          <td style="text-align:center;color:var(--text-muted)">—</td>
          <td style="text-align:center;color:var(--text-muted)">—</td>
          <td style="text-align:center;color:var(--text-muted)">—</td>
          <td style="text-align:center;font-weight:700">${e.rank}</td>
        </tr>`;
    }).join('');

    if (loadingEl) loadingEl.classList.add('hidden');
    table.classList.remove('hidden');
  } catch(err) {
    console.error('Season leaderboard error:', err);
    if (loadingEl) loadingEl.textContent = 'Unable to load season standings.';
  }
}

// ─── Bonus Pool display ───────────────────────────────────────────────────────
export async function loadBonusPool() {
  const amountEl     = document.getElementById('bonusPoolAmount');
  const projectionEl = document.getElementById('seasonPayoutProjection');
  if (!amountEl) return;

  try {
    const db = getDb();
    const snap = await getDocs(
      query(collection(db, 'picks'), where('tournamentId', '==', 'masters-2026'))
    );
    const mastersCount = snap.size;
    const total = mastersCount; // $1 per submission per tournament

    amountEl.textContent = `$${total}`;

    if (projectionEl) {
      const pct1 = Math.round(total * 0.75 * 100) / 100;
      const pct2 = Math.round(total * 0.25 * 100) / 100;
      projectionEl.innerHTML = `
        <div class="season-bp-breakdown">
          <h4 class="season-bp-title">Bonus Pool Breakdown</h4>
          <div class="season-bp-rows">
            <div class="season-bp-row"><span>The Masters 2026</span><span class="season-bp-amt populated">$${mastersCount} (${mastersCount} entries × $1)</span></div>
            <div class="season-bp-row"><span>PGA Championship 2026</span><span class="season-bp-amt pending">$0 (pending)</span></div>
            <div class="season-bp-row"><span>U.S. Open 2026</span><span class="season-bp-amt pending">$0 (pending)</span></div>
            <div class="season-bp-row"><span>The Open Championship 2026</span><span class="season-bp-amt pending">$0 (pending)</span></div>
            <div class="season-bp-row season-bp-total"><span>Total Bonus Pool</span><span>$${total}</span></div>
          </div>
          <div class="season-bp-payouts">
            <span class="season-bp-payout-item">🥇 1st: <strong>$${pct1.toFixed(2).replace(/\.00$/,'')}</strong> (75%)</span>
            <span class="season-bp-payout-item">🥈 2nd: <strong>$${pct2.toFixed(2).replace(/\.00$/,'')}</strong> (25%)</span>
          </div>
        </div>`;
    }
  } catch {
    if (amountEl) amountEl.textContent = '$—';
  }
}

// ─── Utilities ────────────────────────────────────────────────────────────────
function shortName(fullName) {
  if (!fullName) return '—';
  const parts = fullName.split(' ');
  if (parts.length < 2) return fullName;
  return `${parts[0][0]}. ${parts.slice(1).join(' ')}`;
}

function escapeHtml(str) {
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function ordinal(n) {
  const s = ['th','st','nd','rd'];
  const v = n % 100;
  return n + (s[(v-20)%10] || s[v] || s[0]);
}
