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
let mastersActiveYear = 2026;
let savedMastersFpHtml = null;

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
  // Masters 2025 always enabled — hardcoded scoreboard data available
  const hardcodedYears = major === 'masters' ? [2025] : [];
  bar.querySelectorAll('.year-tab').forEach(btn => {
    const y = parseInt(btn.dataset.year);
    const available = years.includes(y) || hardcodedYears.includes(y);
    btn.disabled = !available;
    btn.classList.toggle('year-tab-empty', !available);
  });
}

export function switchMajorYear(major, year) {
  const ts = tournamentsByMajor[major] || [];
  const t = ts.find(x => x.year === year);
  setYearTabActive(major, year);
  if (t) {
    currentTournamentId = t.id;
    loadTournamentData(t.id);
    if (major === 'masters') {
      restoreMastersPoolPanels();
    }
  } else {
    if (major === 'masters') {
      clearMastersPoolPanels();
    }
    const majorPanel = document.getElementById('panel-' + major);
    if (majorPanel) {
      majorPanel.querySelectorAll('.inner-panel').forEach(p => {
        p.classList.remove('inner-panel-active');
        p.classList.add('hidden');
      });
      majorPanel.querySelectorAll('.inner-tab').forEach(btn => btn.classList.remove('active'));
      if (major === 'masters' && year === 2025) {
        // Total tab has hardcoded 2025 standings
        const totalPanel = document.getElementById('masters-total');
        if (totalPanel) { totalPanel.classList.remove('hidden'); totalPanel.classList.add('inner-panel-active'); }
        const totalBtn = majorPanel.querySelector('.inner-tab[data-inner="total"]');
        if (totalBtn) totalBtn.classList.add('active');
      } else {
        // No pool data — jump to scoreboard tab
        const sbPanel = document.getElementById(major + '-scoreboard');
        if (sbPanel) { sbPanel.classList.remove('hidden'); sbPanel.classList.add('inner-panel-active'); }
        const sbBtn = majorPanel.querySelector('.inner-tab[data-inner="scoreboard"]');
        if (sbBtn) sbBtn.classList.add('active');
      }
    }
  }
  if (major === 'masters') {
    mastersActiveYear = year;
    loadMastersScoreboard();
    if (year === 2025) { loadMasters2025TotalStandings(); loadMasters2025Round1Standings(); loadMasters2025Round2Standings(); loadMasters2025Payouts(); }
  }
}

function clearMastersPoolPanels() {
  const placeholder = '<div class="coming-soon">2025 Masters pool data coming soon.</div>';

  // Total tab — clear table, show placeholder message
  const table = document.getElementById('standingsTable');
  const body  = document.getElementById('standingsBody');
  const loading = document.getElementById('loadingMsg');
  const noData  = document.getElementById('noDataMsg');
  if (table)   table.classList.add('hidden');
  if (body)    body.innerHTML = '';
  if (loading) loading.classList.add('hidden');
  if (noData)  { noData.textContent = '2025 Masters pool data coming soon.'; noData.classList.remove('hidden'); }

  // Round tabs
  ['masters-day1','masters-day2','masters-day3','masters-day4'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.innerHTML = placeholder;
  });

  // Final Payouts — save existing HTML then replace
  const fp = document.getElementById('masters-finalpayouts');
  if (fp) {
    if (!savedMastersFpHtml) savedMastersFpHtml = fp.innerHTML;
    fp.innerHTML = placeholder;
  }
}

function restoreMastersPoolPanels() {
  // noDataMsg back to default hidden state
  const noData = document.getElementById('noDataMsg');
  if (noData) { noData.textContent = 'No picks found for this tournament.'; noData.classList.add('hidden'); }

  // Restore round tabs
  loadRound1Standings();
  loadRound2Standings();
  loadRound3Standings();
  loadRound4Standings();

  // Restore Final Payouts HTML and re-wire dynamic content
  const fp = document.getElementById('masters-finalpayouts');
  if (fp && savedMastersFpHtml) {
    fp.innerHTML = savedMastersFpHtml;
    loadMastersPayouts();
  }
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
  if (el) el.textContent = `Updated ${new Date().toLocaleTimeString()}`;
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

// ─── Masters 2025 PGA Scoreboard ─────────────────────────────────────────────
// Rory McIlroy won in playoff over Justin Rose (-11), completing career Grand Slam
const MASTERS_2025_FIELD = [
  // ── Made Cut ────────────────────────────────────────────────────────────────
  { pos: '1',   name: 'Rory McIlroy',       total: -11, r1:  0,  r2: -6,  r3: -6,  r4: +1,  status: 'Active' },
  { pos: 'T1',  name: 'Justin Rose',        total: -11, r1: -7,  r2: -1,  r3: +3,  r4: -6,  status: 'Active' },
  { pos: '3',   name: 'Patrick Reed',       total:  -9, r1: -1,  r2: -2,  r3: -3,  r4: -3,  status: 'Active' },
  { pos: '4',   name: 'Scottie Scheffler',  total:  -8, r1: -4,  r2: -1,  r3:  0,  r4: -3,  status: 'Active' },
  { pos: 'T5',  name: 'Bryson DeChambeau', total:  -7, r1: -3,  r2: -4,  r3: -3,  r4: +3,  status: 'Active' },
  { pos: 'T5',  name: 'Sungjae Im',         total:  -7, r1: -1,  r2: -2,  r3: -1,  r4: -3,  status: 'Active' },
  { pos: '7',   name: 'Ludvig Åberg',       total:  -6, r1: -4,  r2: +1,  r3: -3,  r4:  0,  status: 'Active' },
  { pos: 'T8',  name: 'Corey Conners',      total:  -5, r1: -4,  r2: -2,  r3: -2,  r4: +3,  status: 'Active' },
  { pos: 'T8',  name: 'Jason Day',          total:  -5, r1: -2,  r2: -2,  r3: -1,  r4:  0,  status: 'Active' },
  { pos: 'T8',  name: 'Zach Johnson',       total:  -5, r1:  0,  r2: +2,  r3: -6,  r4: -1,  status: 'Active' },
  { pos: 'T8',  name: 'Xander Schauffele',  total:  -5, r1: +1,  r2: -3,  r3: -2,  r4: -1,  status: 'Active' },
  { pos: 'T12', name: 'Harris English',     total:  -4, r1: null, r2: null, r3: null, r4: null, status: 'Active' },
  { pos: 'T12', name: 'Max Homa',           total:  -4, r1: null, r2: null, r3: null, r4: null, status: 'Active' },
  { pos: 'T14', name: 'Tyrrell Hatton',     total:  -3, r1: -3,  r2: -2,  r3: +2,  r4:  0,  status: 'Active' },
  { pos: 'T14', name: 'Tom Hoge',           total:  -3, r1: null, r2: null, r3: null, r4: null, status: 'Active' },
  { pos: 'T14', name: 'Matt McCarty',       total:  -3, r1: -1,  r2: -4,  r3: +2,  r4:  0,  status: 'Active' },
  { pos: 'T14', name: 'Collin Morikawa',    total:  -3, r1:  0,  r2: -3,  r3:  0,  r4:  0,  status: 'Active' },
  { pos: 'T14', name: 'Jon Rahm',           total:  -3, r1: null, r2: null, r3: null, r4: null, status: 'Active' },
  { pos: 'T14', name: 'Jordan Spieth',      total:  -3, r1: null, r2: null, r3: null, r4: null, status: 'Active' },
  { pos: 'T14', name: 'Bubba Watson',       total:  -3, r1: null, r2: null, r3: null, r4: null, status: 'Active' },
  { pos: 'T21', name: 'An Byeong-hun',      total:  -2, r1: null, r2: null, r3: null, r4: null, status: 'Active' },
  { pos: 'T21', name: 'Daniel Berger',      total:  -2, r1: null, r2: null, r3: null, r4: null, status: 'Active' },
  { pos: 'T21', name: 'Tommy Fleetwood',    total:  -2, r1: null, r2: null, r3: null, r4: null, status: 'Active' },
  { pos: 'T21', name: 'Viktor Hovland',     total:  -2, r1: -1,  r2: -3,  r3: +1,  r4: +1,  status: 'Active' },
  { pos: 'T21', name: 'Hideki Matsuyama',   total:  -2, r1: null, r2: null, r3: null, r4: null, status: 'Active' },
  { pos: 'T21', name: 'Davis Riley',        total:  -2, r1: +1,  r2: -3,  r3: +3,  r4: -3,  status: 'Active' },
  { pos: 'T27', name: 'Michael Kim',        total:  -1, r1: null, r2: null, r3: null, r4: null, status: 'Active' },
  { pos: 'T27', name: 'Aaron Rai',          total:  -1, r1: -2,  r2: +2,  r3: +1,  r4: -2,  status: 'Active' },
  { pos: 'T29', name: 'Denny McCarthy',     total:   0, r1: -1,  r2: +3,  r3: -1,  r4: -1,  status: 'Active' },
  { pos: 'T29', name: 'Joaquín Niemann',    total:   0, r1:  0,  r2: +2,  r3: -2,  r4:  0,  status: 'Active' },
  { pos: 'T29', name: 'Sahith Theegala',    total:   0, r1:  0,  r2:  0,  r3: +1,  r4: -1,  status: 'Active' },
  { pos: 'T32', name: 'Brian Campbell',     total:  +1, r1: null, r2: null, r3: null, r4: null, status: 'Active' },
  { pos: 'T32', name: 'Max Greyserman',     total:  +1, r1: -1,  r2: +3,  r3: -3,  r4: +2,  status: 'Active' },
  { pos: 'T32', name: 'Rasmus Højgaard',    total:  +1, r1: +1,  r2: -5,  r3: +3,  r4: +2,  status: 'Active' },
  { pos: 'T32', name: 'Maverick McNealy',   total:  +1, r1: null, r2: null, r3: null, r4: null, status: 'Active' },
  { pos: 'T36', name: 'Patrick Cantlay',    total:  +2, r1: null, r2: null, r3: null, r4: null, status: 'Active' },
  { pos: 'T36', name: 'Brian Harman',       total:  +2, r1: -1,  r2: -1,  r3: +5,  r4: -1,  status: 'Active' },
  { pos: 'T36', name: 'Charl Schwartzel',   total:  +2, r1: +2,  r2:  0,  r3:  0,  r4:  0,  status: 'Active' },
  { pos: 'T36', name: 'Justin Thomas',      total:  +2, r1: null, r2: null, r3: null, r4: null, status: 'Active' },
  { pos: 'T40', name: 'Matt Fitzpatrick',   total:  +3, r1: null, r2: null, r3: null, r4: null, status: 'Active' },
  { pos: 'T40', name: 'Nick Taylor',        total:  +3, r1: +1,  r2: -1,  r3: +2,  r4: +1,  status: 'Active' },
  { pos: 'T42', name: 'Akshay Bhatia',      total:  +4, r1: -2,  r2: +4,  r3: +3,  r4: -1,  status: 'Active' },
  { pos: 'T42', name: 'Shane Lowry',        total:  +4, r1: null, r2: null, r3: null, r4: null, status: 'Active' },
  { pos: 'T42', name: 'J.T. Poston',        total:  +4, r1: +2,  r2:  0,  r3: +1,  r4: +1,  status: 'Active' },
  { pos: 'T42', name: 'Danny Willett',      total:  +4, r1: +3,  r2: -1,  r3: +1,  r4: +1,  status: 'Active' },
  { pos: 'T46', name: 'Sam Burns',          total:  +5, r1: null, r2: null, r3: null, r4: null, status: 'Active' },
  { pos: 'T46', name: 'Wyndham Clark',      total:  +5, r1: +4,  r2: -4,  r3: +3,  r4: +2,  status: 'Active' },
  { pos: 'T46', name: 'Davis Thompson',     total:  +5, r1: null, r2: null, r3: null, r4: null, status: 'Active' },
  { pos: '49',  name: 'Min Woo Lee',        total:  +6, r1: -1,  r2:  0,  r3: +5,  r4: +2,  status: 'Active' },
  { pos: '50',  name: 'J.J. Spaun',         total:  +7, r1: +2,  r2:  0,  r3: +2,  r4: +3,  status: 'Active' },
  { pos: '51',  name: 'Nico Echavarría',    total:  +8, r1: +1,  r2: -2,  r3: -3,  r4: +12, status: 'Active' },
  { pos: 'T52', name: 'Stephan Jäger',      total:  +9, r1: null, r2: null, r3: null, r4: null, status: 'Active' },
  { pos: 'T52', name: 'Tom Kim',            total:  +9, r1: null, r2: null, r3: null, r4: null, status: 'Active' },
  // ── Missed Cut ──────────────────────────────────────────────────────────────
  { pos: 'CUT', name: 'Brooks Koepka',         total: null, r1: null, r2: null, r3: null, r4: null, status: 'CUT' },
  { pos: 'CUT', name: 'Tony Finau',             total: null, r1: null, r2: null, r3: null, r4: null, status: 'CUT' },
  { pos: 'CUT', name: 'Dustin Johnson',         total: null, r1: null, r2: null, r3: null, r4: null, status: 'CUT' },
  { pos: 'CUT', name: 'Adam Scott',             total: null, r1: null, r2: null, r3: null, r4: null, status: 'CUT' },
  { pos: 'CUT', name: 'Cameron Young',          total: null, r1: null, r2: null, r3: null, r4: null, status: 'CUT' },
  { pos: 'CUT', name: 'Cameron Smith',          total: null, r1: null, r2: null, r3: null, r4: null, status: 'CUT' },
  { pos: 'CUT', name: 'Robert MacIntyre',       total: null, r1: null, r2: null, r3: null, r4: null, status: 'CUT' },
  { pos: 'CUT', name: 'Sergio García',          total: null, r1: null, r2: null, r3: null, r4: null, status: 'CUT' },
  { pos: 'CUT', name: 'Billy Horschel',         total: null, r1: null, r2: null, r3: null, r4: null, status: 'CUT' },
  { pos: 'CUT', name: 'Phil Mickelson',         total: null, r1: null, r2: null, r3: null, r4: null, status: 'CUT' },
  { pos: 'CUT', name: 'Will Zalatoris',         total: null, r1: null, r2: null, r3: null, r4: null, status: 'CUT' },
  { pos: 'CUT', name: 'Sepp Straka',            total: null, r1: null, r2: null, r3: null, r4: null, status: 'CUT' },
  { pos: 'CUT', name: 'Keegan Bradley',         total: null, r1: null, r2: null, r3: null, r4: null, status: 'CUT' },
  { pos: 'CUT', name: 'Russell Henley',         total: null, r1: null, r2: null, r3: null, r4: null, status: 'CUT' },
  { pos: 'CUT', name: 'Bernhard Langer',        total: null, r1: null, r2: null, r3: null, r4: null, status: 'CUT' },
  { pos: 'CUT', name: 'Nicolai Højgaard',       total: null, r1: null, r2: null, r3: null, r4: null, status: 'CUT' },
  { pos: 'CUT', name: 'Jhonattan Vegas',        total: null, r1: null, r2: null, r3: null, r4: null, status: 'CUT' },
  { pos: 'CUT', name: 'Cameron Davis',          total: null, r1: null, r2: null, r3: null, r4: null, status: 'CUT' },
  { pos: 'CUT', name: 'Matthieu Pavon',         total: null, r1: null, r2: null, r3: null, r4: null, status: 'CUT' },
  { pos: 'CUT', name: 'Adam Schenk',            total: null, r1: null, r2: null, r3: null, r4: null, status: 'CUT' },
  { pos: 'CUT', name: 'Austin Eckroat',         total: null, r1: null, r2: null, r3: null, r4: null, status: 'CUT' },
  { pos: 'CUT', name: 'Thomas Detry',           total: null, r1: null, r2: null, r3: null, r4: null, status: 'CUT' },
  { pos: 'CUT', name: 'Kevin Yu',               total: null, r1: null, r2: null, r3: null, r4: null, status: 'CUT' },
  { pos: 'CUT', name: 'Chris Kirk',             total: null, r1: null, r2: null, r3: null, r4: null, status: 'CUT' },
  { pos: 'CUT', name: 'Mike Weir',              total: null, r1: null, r2: null, r3: null, r4: null, status: 'CUT' },
  { pos: 'CUT', name: 'Nick Dunlap',            total: null, r1: null, r2: null, r3: null, r4: null, status: 'CUT' },
  { pos: 'CUT', name: 'Patton Kizzire',         total: null, r1: null, r2: null, r3: null, r4: null, status: 'CUT' },
  { pos: 'CUT', name: 'Taylor Pendrith',        total: null, r1: null, r2: null, r3: null, r4: null, status: 'CUT' },
  { pos: 'CUT', name: 'Christiaan Bezuidenhout',total: null, r1: null, r2: null, r3: null, r4: null, status: 'CUT' },
  { pos: 'CUT', name: 'José María Olazábal',    total: null, r1: null, r2: null, r3: null, r4: null, status: 'CUT' },
  { pos: 'CUT', name: 'Ángel Cabrera',          total: null, r1: null, r2: null, r3: null, r4: null, status: 'CUT' },
  { pos: 'CUT', name: 'Fred Couples',           total: null, r1: null, r2: null, r3: null, r4: null, status: 'CUT' },
];

// ─── Masters 2025 Pool Total Standings ───────────────────────────────────────
const MASTERS_2025_TOTAL = [
  { rank:  1, total: -28, pick: { entrantName: 'Robert Stephenson 2' }, tierScores: { t1: { score: -11, status: null, golfer: 'Rory McIlroy',         isTop4: true  }, t2: { score:  -3, status: null, golfer: 'Jordan Spieth',    isTop4: true  }, t3: { score: -11, status: null, golfer: 'Justin Rose',        isTop4: true  }, t4: { score: 10, status: null, golfer: 'Adam Scott',        isTop4: false }, t5: { score:  -3, status: null, golfer: 'Tom Hoge',           isTop4: true  }, t6: { score:  4, status: null, golfer: 'Danny Willett',     isTop4: false } } },
  { rank:  2, total: -24, pick: { entrantName: 'Morgan 3' },           tierScores: { t1: { score: -11, status: null, golfer: 'Rory McIlroy',         isTop4: true  }, t2: { score:   0, status: null, golfer: 'Joaquín Niemann',  isTop4: false }, t3: { score:  -9, status: null, golfer: 'Patrick Reed',       isTop4: true  }, t4: { score:  6, status: null, golfer: 'Keegan Bradley',    isTop4: false }, t5: { score:  -1, status: null, golfer: 'Michael Kim',        isTop4: true  }, t6: { score: -3, status: null, golfer: 'Matt McCarty',      isTop4: true  } } },
  { rank:  3, total: -22, pick: { entrantName: 'Jake Bogardus' },      tierScores: { t1: { score:  -8, status: null, golfer: 'Scottie Scheffler',   isTop4: true  }, t2: { score:  -3, status: null, golfer: 'Jordan Spieth',    isTop4: true  }, t3: { score:  10, status: null, golfer: 'Cameron Smith',     isTop4: false }, t4: { score: -7, status: null, golfer: 'Sungjae Im',        isTop4: true  }, t5: { score:  -4, status: null, golfer: 'Max Homa',           isTop4: true  }, t6: { score: -3, status: null, golfer: 'Bubba Watson',      isTop4: false } } },
  { rank:  4, total: -20, pick: { entrantName: 'Erik Vermilyea' },     tierScores: { t1: { score:  -8, status: null, golfer: 'Scottie Scheffler',   isTop4: true  }, t2: { score:   4, status: null, golfer: 'Shane Lowry',      isTop4: false }, t3: { score:  -5, status: null, golfer: 'Jason Day',          isTop4: true  }, t4: { score: 10, status: null, golfer: 'Billy Horschel',    isTop4: false }, t5: { score:  -4, status: null, golfer: 'Max Homa',           isTop4: true  }, t6: { score: -3, status: null, golfer: 'Matt McCarty',      isTop4: true  } } },
  { rank:  5, total: -19, pick: { entrantName: 'Matt Bova 2' },        tierScores: { t1: { score:  -7, status: null, golfer: 'Bryson DeChambeau',   isTop4: true  }, t2: { score:  -3, status: null, golfer: 'Jordan Spieth',    isTop4: true  }, t3: { score:  -5, status: null, golfer: 'Corey Conners',     isTop4: true  }, t4: { score: -1, status: null, golfer: 'Aaron Rai',         isTop4: false }, t5: { score:  -4, status: null, golfer: 'Max Homa',           isTop4: true  }, t6: { score:  4, status: null, golfer: 'Danny Willett',     isTop4: false } } },
  { rank:  6, total: -18, pick: { entrantName: 'Matthew Tuckfield' },  tierScores: { t1: { score:  -8, status: null, golfer: 'Scottie Scheffler',   isTop4: true  }, t2: { score:   6, status: null, golfer: 'Russell Henley',   isTop4: false }, t3: { score:  -5, status: null, golfer: 'Corey Conners',     isTop4: true  }, t4: { score: -1, status: null, golfer: 'Aaron Rai',         isTop4: true  }, t5: { score:  -4, status: null, golfer: 'Harris English',     isTop4: true  }, t6: { score: 12, status: null, golfer: 'Jhonattan Vegas',   isTop4: false } } },
  { rank:  7, total: -17, pick: { entrantName: 'Paul Raymond' },       tierScores: { t1: { score:  -8, status: null, golfer: 'Scottie Scheffler',   isTop4: true  }, t2: { score:  -2, status: null, golfer: 'Viktor Hovland',   isTop4: true  }, t3: { score:   0, status: null, golfer: 'Sahith Theegala',   isTop4: false }, t4: { score: 10, status: null, golfer: 'Phil Mickelson',    isTop4: false }, t5: { score:  -4, status: null, golfer: 'Max Homa',           isTop4: true  }, t6: { score: -3, status: null, golfer: 'Bubba Watson',      isTop4: true  } } },
  { rank:  8, total: -16, pick: { entrantName: 'Ron Pannullo' },       tierScores: { t1: { score:  -7, status: null, golfer: 'Bryson DeChambeau',   isTop4: true  }, t2: { score:  -2, status: null, golfer: 'Viktor Hovland',   isTop4: true  }, t3: { score:  10, status: null, golfer: 'Cameron Smith',     isTop4: false }, t4: { score: 10, status: null, golfer: 'Adam Scott',        isTop4: false }, t5: { score:  -4, status: null, golfer: 'Max Homa',           isTop4: true  }, t6: { score: -3, status: null, golfer: 'Bubba Watson',      isTop4: true  } } },
  { rank:  9, total: -15, pick: { entrantName: 'Morgan Coleman' },     tierScores: { t1: { score:  -8, status: null, golfer: 'Scottie Scheffler',   isTop4: true  }, t2: { score:  -2, status: null, golfer: 'Tommy Fleetwood',  isTop4: true  }, t3: { score:  -5, status: null, golfer: 'Corey Conners',     isTop4: true  }, t4: { score:  6, status: null, golfer: 'Keegan Bradley',    isTop4: false }, t5: { score:   0, status: null, golfer: 'Denny McCarthy',     isTop4: true  }, t6: { score: 20, status: null, golfer: 'Jose Luis Ballester (a)', isTop4: false } } },
  { rank: 10, total: -14, pick: { entrantName: 'Robert Stephenson' },  tierScores: { t1: { score:  -7, status: null, golfer: 'Bryson DeChambeau',   isTop4: true  }, t2: { score:  -3, status: null, golfer: 'Jordan Spieth',    isTop4: true  }, t3: { score:  10, status: null, golfer: 'Sepp Straka',        isTop4: false }, t4: { score: 10, status: null, golfer: 'Phil Mickelson',    isTop4: false }, t5: { score:  -1, status: null, golfer: 'Michael Kim',        isTop4: true  }, t6: { score: -3, status: null, golfer: 'Bubba Watson',      isTop4: true  } } },
  { rank: 10, total: -14, pick: { entrantName: 'Brandon Syde 2' },     tierScores: { t1: { score:  -8, status: null, golfer: 'Scottie Scheffler',   isTop4: true  }, t2: { score:  -3, status: null, golfer: 'Jordan Spieth',    isTop4: true  }, t3: { score:  10, status: null, golfer: 'Sepp Straka',        isTop4: false }, t4: { score:  1, status: null, golfer: 'Maverick McNealy',  isTop4: true  }, t5: { score:  -4, status: null, golfer: 'Max Homa',           isTop4: true  }, t6: { score:  2, status: null, golfer: 'Charl Schwartzel',  isTop4: false } } },
  { rank: 12, total: -12, pick: { entrantName: 'Cody Esbrandt' },      tierScores: { t1: { score: -11, status: null, golfer: 'Rory McIlroy',         isTop4: true  }, t2: { score:  12, status: null, golfer: 'Robert MacIntyre', isTop4: false }, t3: { score:  -5, status: null, golfer: 'Corey Conners',     isTop4: true  }, t4: { score:  5, status: null, golfer: 'Sam Burns',         isTop4: true  }, t5: { score:  -1, status: null, golfer: 'Michael Kim',        isTop4: true  }, t6: { score: 20, status: null, golfer: 'Matthieu Pavon',    isTop4: false } } },
  { rank: 12, total: -12, pick: { entrantName: 'Myron Mayo' },         tierScores: { t1: { score:  -8, status: null, golfer: 'Scottie Scheffler',   isTop4: true  }, t2: { score:  -2, status: null, golfer: 'Tommy Fleetwood',  isTop4: true  }, t3: { score:   4, status: null, golfer: 'Akshay Bhatia',     isTop4: false }, t4: { score: -2, status: null, golfer: 'Daniel Berger',     isTop4: true  }, t5: { score:   0, status: null, golfer: 'Denny McCarthy',     isTop4: true  }, t6: { score: 12, status: null, golfer: 'Kevin Yu',          isTop4: false } } },
  { rank: 12, total: -12, pick: { entrantName: 'Gregory J Smith' },    tierScores: { t1: { score: -11, status: null, golfer: 'Rory McIlroy',         isTop4: true  }, t2: { score:  -3, status: null, golfer: 'Jordan Spieth',    isTop4: true  }, t3: { score:  16, status: null, golfer: 'Will Zalatoris',    isTop4: false }, t4: { score:  6, status: null, golfer: 'Keegan Bradley',    isTop4: true  }, t5: { score:  -4, status: null, golfer: 'Max Homa',           isTop4: true  }, t6: { score:  8, status: null, golfer: 'Rafael Campos',     isTop4: false } } },
  { rank: 12, total: -12, pick: { entrantName: 'Cassady Glenn' },      tierScores: { t1: { score:  -6, status: null, golfer: 'Ludvig Åberg',         isTop4: true  }, t2: { score:  -3, status: null, golfer: 'Jordan Spieth',    isTop4: true  }, t3: { score:  16, status: null, golfer: 'Will Zalatoris',    isTop4: false }, t4: { score: -2, status: null, golfer: 'Daniel Berger',     isTop4: true  }, t5: { score:  -1, status: null, golfer: 'Michael Kim',        isTop4: true  }, t6: { score: 12, status: null, golfer: 'Kevin Yu',          isTop4: false } } },
  { rank: 16, total: -11, pick: { entrantName: 'Chris Schumann' },     tierScores: { t1: { score: -11, status: null, golfer: 'Rory McIlroy',         isTop4: true  }, t2: { score:   0, status: null, golfer: 'Joaquín Niemann',  isTop4: true  }, t3: { score:   4, status: null, golfer: 'Akshay Bhatia',     isTop4: true  }, t4: { score: 16, status: null, golfer: 'Taylor Pendrith',   isTop4: false }, t5: { score:  -4, status: null, golfer: 'Max Homa',           isTop4: true  }, t6: { score: 34, status: null, golfer: 'Nick Dunlap',       isTop4: false } } },
  { rank: 17, total:  -9, pick: { entrantName: 'Mitch Pletcher' },     tierScores: { t1: { score:  -8, status: null, golfer: 'Scottie Scheffler',   isTop4: true  }, t2: { score:   6, status: null, golfer: 'Min Woo Lee',      isTop4: true  }, t3: { score:  16, status: null, golfer: 'Will Zalatoris',    isTop4: false }, t4: { score: 10, status: null, golfer: 'Billy Horschel',    isTop4: false }, t5: { score:  -4, status: null, golfer: 'Max Homa',           isTop4: true  }, t6: { score: -3, status: null, golfer: 'Bubba Watson',      isTop4: true  } } },
  { rank: 17, total:  -9, pick: { entrantName: 'Ian' },                tierScores: { t1: { score: -11, status: null, golfer: 'Rory McIlroy',         isTop4: true  }, t2: { score:  -2, status: null, golfer: 'Tommy Fleetwood',  isTop4: true  }, t3: { score:  16, status: null, golfer: 'Will Zalatoris',    isTop4: false }, t4: { score: 10, status: null, golfer: 'Billy Horschel',    isTop4: false }, t5: { score:   0, status: null, golfer: 'Denny McCarthy',     isTop4: true  }, t6: { score:  4, status: null, golfer: 'Danny Willett',     isTop4: true  } } },
  { rank: 17, total:  -9, pick: { entrantName: 'Bobby Cross' },        tierScores: { t1: { score:  -8, status: null, golfer: 'Scottie Scheffler',   isTop4: true  }, t2: { score:  -2, status: null, golfer: 'Viktor Hovland',   isTop4: true  }, t3: { score:   5, status: null, golfer: 'Wyndham Clark',     isTop4: true  }, t4: { score: 10, status: null, golfer: 'Adam Scott',        isTop4: false }, t5: { score:  -4, status: null, golfer: 'Max Homa',           isTop4: true  }, t6: { score:  8, status: null, golfer: 'Adam Schenk',       isTop4: false } } },
  { rank: 20, total:  -8, pick: { entrantName: 'Jaymes Cole' },        tierScores: { t1: { score:  -8, status: null, golfer: 'Scottie Scheffler',   isTop4: true  }, t2: { score:  -2, status: null, golfer: 'Tommy Fleetwood',  isTop4: true  }, t3: { score:   8, status: null, golfer: 'Tony Finau',         isTop4: false }, t4: { score:  6, status: null, golfer: 'Keegan Bradley',    isTop4: true  }, t5: { score:  -4, status: null, golfer: 'Max Homa',           isTop4: true  }, t6: { score: 34, status: null, golfer: 'Nick Dunlap',       isTop4: false } } },
  { rank: 20, total:  -8, pick: { entrantName: 'Brandon Syde' },       tierScores: { t1: { score:  -3, status: null, golfer: 'Collin Morikawa',     isTop4: true  }, t2: { score:   2, status: null, golfer: 'Patrick Cantlay',  isTop4: true  }, t3: { score:  16, status: null, golfer: 'Will Zalatoris',    isTop4: false }, t4: { score: 10, status: null, golfer: 'Billy Horschel',    isTop4: false }, t5: { score:  -4, status: null, golfer: 'Harris English',     isTop4: true  }, t6: { score: -3, status: null, golfer: 'Bubba Watson',      isTop4: true  } } },
  { rank: 22, total:  -7, pick: { entrantName: 'Robert Stephenson 3' },tierScores: { t1: { score:  -8, status: null, golfer: 'Scottie Scheffler',   isTop4: true  }, t2: { score:  -2, status: null, golfer: 'Tommy Fleetwood',  isTop4: true  }, t3: { score:  10, status: null, golfer: 'Sepp Straka',        isTop4: true  }, t4: { score: -7, status: null, golfer: 'Sungjae Im',        isTop4: true  }, t5: { score:  18, status: null, golfer: 'Thomas Detry',       isTop4: false }, t6: { score: 34, status: null, golfer: 'Nick Dunlap',       isTop4: false } } },
  { rank: 23, total:   4, pick: { entrantName: 'Jeff Bagnasco' },      tierScores: { t1: { score: -11, status: null, golfer: 'Rory McIlroy',         isTop4: true  }, t2: { score:  -2, status: null, golfer: 'Tommy Fleetwood',  isTop4: true  }, t3: { score:  10, status: null, golfer: 'Cameron Smith',     isTop4: true  }, t4: { score: 10, status: null, golfer: 'Adam Scott',        isTop4: true  }, t5: { score:  14, status: null, golfer: 'Cameron Young',      isTop4: false }, t6: { score: -3, status: null, golfer: 'Bubba Watson',      isTop4: true  } } },
  { rank: 24, total:  -5, pick: { entrantName: 'Mike Davis' },         tierScores: { t1: { score:  -3, status: null, golfer: 'Collin Morikawa',     isTop4: true  }, t2: { score:   0, status: null, golfer: 'Joaquín Niemann',  isTop4: true  }, t3: { score:   4, status: null, golfer: 'Akshay Bhatia',     isTop4: false }, t4: { score:  6, status: null, golfer: 'Keegan Bradley',    isTop4: false }, t5: { score:   1, status: null, golfer: 'Rasmus Højgaard',    isTop4: true  }, t6: { score: -3, status: null, golfer: 'Matt McCarty',      isTop4: true  } } },
  { rank: 24, total:  -5, pick: { entrantName: 'Nathan Wood' },        tierScores: { t1: { score: -11, status: null, golfer: 'Rory McIlroy',         isTop4: true  }, t2: { score:   6, status: null, golfer: 'Min Woo Lee',      isTop4: true  }, t3: { score:   8, status: null, golfer: 'Tony Finau',         isTop4: false }, t4: { score:  3, status: null, golfer: 'Matt Fitzpatrick',  isTop4: true  }, t5: { score:  12, status: null, golfer: 'Austin Eckroat',     isTop4: false }, t6: { score: -3, status: null, golfer: 'Bubba Watson',      isTop4: true  } } },
  { rank: 26, total:  -4, pick: { entrantName: 'Bobby Cross 2' },      tierScores: { t1: { score:  -7, status: null, golfer: 'Bryson DeChambeau',   isTop4: true  }, t2: { score:   6, status: null, golfer: 'Min Woo Lee',      isTop4: true  }, t3: { score:  16, status: null, golfer: 'Will Zalatoris',    isTop4: false }, t4: { score: 10, status: null, golfer: 'Billy Horschel',    isTop4: false }, t5: { score:  -1, status: null, golfer: 'Michael Kim',        isTop4: true  }, t6: { score: -2, status: null, golfer: 'Davis Riley',       isTop4: true  } } },
  { rank: 27, total:  -3, pick: { entrantName: 'Joe Bushey' },         tierScores: { t1: { score: -11, status: null, golfer: 'Rory McIlroy',         isTop4: true  }, t2: { score:   4, status: null, golfer: 'Shane Lowry',      isTop4: true  }, t3: { score:  10, status: null, golfer: 'Sepp Straka',        isTop4: false }, t4: { score:  7, status: null, golfer: 'J.J. Spaun',        isTop4: true  }, t5: { score:   8, status: null, golfer: 'Nicolas Echavarria', isTop4: false }, t6: { score: -3, status: null, golfer: 'Bubba Watson',      isTop4: true  } } },
  { rank: 27, total:  -3, pick: { entrantName: 'Ryne Stone 2' },       tierScores: { t1: { score:  -3, status: null, golfer: 'Jon Rahm',             isTop4: true  }, t2: { score:   2, status: null, golfer: 'Patrick Cantlay',  isTop4: true  }, t3: { score:  16, status: null, golfer: 'Will Zalatoris',    isTop4: false }, t4: { score:  6, status: null, golfer: 'Keegan Bradley',    isTop4: false }, t5: { score:  -4, status: null, golfer: 'Harris English',     isTop4: true  }, t6: { score:  2, status: null, golfer: 'Charl Schwartzel',  isTop4: true  } } },
  { rank: 29, total:  -2, pick: { entrantName: 'Ryne Stone' },         tierScores: { t1: { score:  -8, status: null, golfer: 'Scottie Scheffler',   isTop4: true  }, t2: { score:   0, status: null, golfer: 'Joaquín Niemann',  isTop4: true  }, t3: { score:  10, status: null, golfer: 'Cameron Smith',     isTop4: false }, t4: { score:  6, status: null, golfer: 'Keegan Bradley',    isTop4: false }, t5: { score:   4, status: null, golfer: 'J.T. Poston',        isTop4: true  }, t6: { score:  2, status: null, golfer: 'Charl Schwartzel',  isTop4: true  } } },
  { rank: 30, total:  -1, pick: { entrantName: 'Jeff Mersch' },        tierScores: { t1: { score:  -8, status: null, golfer: 'Scottie Scheffler',   isTop4: true  }, t2: { score:   6, status: null, golfer: 'Min Woo Lee',      isTop4: true  }, t3: { score:  10, status: null, golfer: 'Sepp Straka',        isTop4: false }, t4: { score:  1, status: null, golfer: 'Maverick McNealy',  isTop4: true  }, t5: { score:   0, status: null, golfer: 'Denny McCarthy',     isTop4: true  }, t6: { score: 20, status: null, golfer: 'Matthieu Pavon',    isTop4: false } } },
  { rank: 30, total:  -1, pick: { entrantName: 'Tim Hurst' },          tierScores: { t1: { score:  -3, status: null, golfer: 'Collin Morikawa',     isTop4: true  }, t2: { score:   6, status: null, golfer: 'Min Woo Lee',      isTop4: true  }, t3: { score:  10, status: null, golfer: 'Sepp Straka',        isTop4: false }, t4: { score: -1, status: null, golfer: 'Aaron Rai',         isTop4: true  }, t5: { score:  12, status: null, golfer: 'Nicolai Højgaard',   isTop4: false }, t6: { score: -3, status: null, golfer: 'Matt McCarty',      isTop4: true  } } },
  { rank: 32, total:   0, pick: { entrantName: 'Ed Angulo 2' },        tierScores: { t1: { score:  -3, status: null, golfer: 'Collin Morikawa',     isTop4: true  }, t2: { score:   0, status: null, golfer: 'Joaquín Niemann',  isTop4: true  }, t3: { score:  10, status: null, golfer: 'Sepp Straka',        isTop4: false }, t4: { score:  7, status: null, golfer: 'J.J. Spaun',        isTop4: false }, t5: { score:  -1, status: null, golfer: 'Michael Kim',        isTop4: true  }, t6: { score:  4, status: null, golfer: 'Danny Willett',     isTop4: true  } } },
  { rank: 33, total:   1, pick: { entrantName: 'Joseph Woodworth' },   tierScores: { t1: { score: -11, status: null, golfer: 'Rory McIlroy',         isTop4: true  }, t2: { score:   6, status: null, golfer: 'Russell Henley',   isTop4: true  }, t3: { score:  16, status: null, golfer: 'Will Zalatoris',    isTop4: false }, t4: { score:  6, status: null, golfer: 'Keegan Bradley',    isTop4: true  }, t5: { score:   0, status: null, golfer: 'Denny McCarthy',     isTop4: true  }, t6: { score: 12, status: null, golfer: 'Kevin Yu',          isTop4: false } } },
  { rank: 33, total:  11, pick: { entrantName: 'Kyle Sheldon' },       tierScores: { t1: { score:  -8, status: null, golfer: 'Scottie Scheffler',   isTop4: true  }, t2: { score:  -2, status: null, golfer: 'Tommy Fleetwood',  isTop4: true  }, t3: { score:  10, status: null, golfer: 'Cameron Smith',     isTop4: true  }, t4: { score: 10, status: null, golfer: 'Adam Scott',        isTop4: true  }, t5: { score:   1, status: null, golfer: 'Rasmus Højgaard',    isTop4: true  }, t6: { score: 12, status: null, golfer: 'Kevin Yu',          isTop4: false } } },
  { rank: 35, total:   2, pick: { entrantName: 'Nick Bova' },          tierScores: { t1: { score:  -6, status: null, golfer: 'Ludvig Åberg',         isTop4: true  }, t2: { score:   6, status: null, golfer: 'Min Woo Lee',      isTop4: true  }, t3: { score:   4, status: null, golfer: 'Akshay Bhatia',     isTop4: true  }, t4: { score: -2, status: null, golfer: 'Daniel Berger',     isTop4: true  }, t5: { score:  14, status: null, golfer: 'Cameron Young',      isTop4: false }, t6: { score: 20, status: null, golfer: 'Matthieu Pavon',    isTop4: false } } },
  { rank: 36, total:   3, pick: { entrantName: 'Jake Hammer' },        tierScores: { t1: { score:  -7, status: null, golfer: 'Bryson DeChambeau',   isTop4: true  }, t2: { score:   4, status: null, golfer: 'Shane Lowry',      isTop4: true  }, t3: { score:   5, status: null, golfer: 'Wyndham Clark',     isTop4: true  }, t4: { score: 10, status: null, golfer: 'Adam Scott',        isTop4: false }, t5: { score:  18, status: null, golfer: 'Cam Davis',          isTop4: false }, t6: { score:  1, status: null, golfer: 'Brian Campbell',    isTop4: true  } } },
  { rank: 36, total:   3, pick: { entrantName: 'Morgan 2' },           tierScores: { t1: { score:  -3, status: null, golfer: 'Collin Morikawa',     isTop4: true  }, t2: { score:   6, status: null, golfer: 'Russell Henley',   isTop4: true  }, t3: { score:  10, status: null, golfer: 'Sepp Straka',        isTop4: false }, t4: { score: -2, status: null, golfer: 'Byeong Hun An',     isTop4: true  }, t5: { score:  20, status: null, golfer: 'Laurie Canter',      isTop4: false }, t6: { score:  2, status: null, golfer: 'Charl Schwartzel',  isTop4: true  } } },
  { rank: 38, total:   6, pick: { entrantName: 'Ed Angulo' },          tierScores: { t1: { score: -11, status: null, golfer: 'Rory McIlroy',         isTop4: true  }, t2: { score:   0, status: null, golfer: 'Joaquín Niemann',  isTop4: true  }, t3: { score:  10, status: null, golfer: 'Sepp Straka',        isTop4: true  }, t4: { score:  7, status: null, golfer: 'J.J. Spaun',        isTop4: true  }, t5: { score:  18, status: null, golfer: 'Thomas Detry',       isTop4: false }, t6: { score: 34, status: null, golfer: 'Nick Dunlap',       isTop4: false } } },
  { rank: 38, total:   6, pick: { entrantName: 'Sean Susa' },          tierScores: { t1: { score:  -8, status: null, golfer: 'Scottie Scheffler',   isTop4: true  }, t2: { score:   0, status: null, golfer: 'Joaquín Niemann',  isTop4: true  }, t3: { score:  10, status: null, golfer: 'Sepp Straka',        isTop4: false }, t4: { score:  6, status: null, golfer: 'Keegan Bradley',    isTop4: true  }, t5: { score:  14, status: null, golfer: 'Cameron Young',      isTop4: false }, t6: { score:  8, status: null, golfer: 'Adam Schenk',       isTop4: true  } } },
  { rank: 40, total:   9, pick: { entrantName: 'Sarah Crowell' },      tierScores: { t1: { score:  -8, status: null, golfer: 'Scottie Scheffler',   isTop4: true  }, t2: { score:  -3, status: null, golfer: 'Jordan Spieth',    isTop4: true  }, t3: { score:  10, status: null, golfer: 'Cameron Smith',     isTop4: true  }, t4: { score: 10, status: null, golfer: 'Adam Scott',        isTop4: true  }, t5: { score:  14, status: null, golfer: 'Cameron Young',      isTop4: false }, t6: { score: 20, status: null, golfer: 'Matthieu Pavon',    isTop4: false } } },
  { rank: 40, total:   9, pick: { entrantName: 'Zach DelGandio' },     tierScores: { t1: { score:  -3, status: null, golfer: 'Collin Morikawa',     isTop4: true  }, t2: { score:   6, status: null, golfer: 'Russell Henley',   isTop4: true  }, t3: { score:  10, status: null, golfer: 'Sepp Straka',        isTop4: false }, t4: { score:  6, status: null, golfer: 'Keegan Bradley',    isTop4: true  }, t5: { score:   0, status: null, golfer: 'Denny McCarthy',     isTop4: true  }, t6: { score: 12, status: null, golfer: 'Kevin Yu',          isTop4: false } } },
  { rank: 40, total:  19, pick: { entrantName: 'Karsten Meyer' },      tierScores: { t1: { score:  -7, status: null, golfer: 'Bryson DeChambeau',   isTop4: true  }, t2: { score:  -2, status: null, golfer: 'Viktor Hovland',   isTop4: true  }, t3: { score:  10, status: null, golfer: 'Cameron Smith',     isTop4: true  }, t4: { score: 10, status: null, golfer: 'Phil Mickelson',    isTop4: true  }, t5: { score:  14, status: null, golfer: 'Christiaan Bezuidenhout', isTop4: false }, t6: { score:  8, status: null, golfer: 'Adam Schenk',       isTop4: true  } } },
  { rank: 43, total:  10, pick: { entrantName: 'Luke S' },             tierScores: { t1: { score:  -5, status: null, golfer: 'Xander Schauffele',   isTop4: true  }, t2: { score:  12, status: null, golfer: 'Robert MacIntyre', isTop4: true  }, t3: { score:  16, status: null, golfer: 'Will Zalatoris',    isTop4: false }, t4: { score:  6, status: null, golfer: 'Keegan Bradley',    isTop4: true  }, t5: { score:  14, status: null, golfer: 'Christiaan Bezuidenhout', isTop4: false }, t6: { score: -3, status: null, golfer: 'Bubba Watson',      isTop4: true  } } },
  { rank: 44, total:  12, pick: { entrantName: 'Jeff Stout' },         tierScores: { t1: { score:  -8, status: null, golfer: 'Scottie Scheffler',   isTop4: true  }, t2: { score:   2, status: null, golfer: 'Patrick Cantlay',  isTop4: true  }, t3: { score:  16, status: null, golfer: 'Will Zalatoris',    isTop4: false }, t4: { score: 10, status: null, golfer: 'Adam Scott',        isTop4: true  }, t5: { score:  18, status: null, golfer: 'Thomas Detry',       isTop4: false }, t6: { score:  8, status: null, golfer: 'Fred Couples',      isTop4: true  } } },
  { rank: 44, total:  20, pick: { entrantName: 'Ben Oliva' },          tierScores: { t1: { score:   2, status: null, golfer: 'Justin Thomas',        isTop4: true  }, t2: { score:  -2, status: null, golfer: 'Tommy Fleetwood',  isTop4: true  }, t3: { score:   8, status: null, golfer: 'Sergio Garcia',     isTop4: true  }, t4: { score: 10, status: null, golfer: 'Billy Horschel',    isTop4: false }, t5: { score:   8, status: null, golfer: 'Nicolas Echavarria', isTop4: true  }, t6: { score:  4, status: null, golfer: 'Danny Willett',     isTop4: true  } } },
  { rank: 46, total:  23, pick: { entrantName: 'Matt Bova' },          tierScores: { t1: { score:  -3, status: null, golfer: 'Collin Morikawa',     isTop4: true  }, t2: { score:   6, status: null, golfer: 'Russell Henley',   isTop4: true  }, t3: { score:  10, status: null, golfer: 'Sepp Straka',        isTop4: true  }, t4: { score: 10, status: null, golfer: 'Phil Mickelson',    isTop4: true  }, t5: { score:  18, status: null, golfer: 'Thomas Detry',       isTop4: false }, t6: { score: 12, status: null, golfer: 'Jhonattan Vegas',   isTop4: false } } },
  { rank: 47, total:  30, pick: { entrantName: 'Jacob Stout' },        tierScores: { t1: { score:  10, status: null, golfer: 'Brooks Koepka',        isTop4: true  }, t2: { score:   0, status: null, golfer: 'Joaquín Niemann',  isTop4: true  }, t3: { score:  10, status: null, golfer: 'Cameron Smith',     isTop4: true  }, t4: { score: 10, status: null, golfer: 'Billy Horschel',    isTop4: true  }, t5: { score:  18, status: null, golfer: 'Cam Davis',          isTop4: false }, t6: { score: 34, status: null, golfer: 'Nick Dunlap',       isTop4: false } } },
];

function loadMasters2025TotalStandings() {
  const table   = document.getElementById('standingsTable');
  const loading = document.getElementById('loadingMsg');
  const noData  = document.getElementById('noDataMsg');
  if (loading) loading.classList.add('hidden');
  if (noData)  noData.classList.add('hidden');
  if (table)   table.classList.remove('hidden');
  renderTable(MASTERS_2025_TOTAL, {});
}

function loadMasters2025Payouts() {
  const fp = document.getElementById('masters-finalpayouts');
  if (!fp) return;

  const finishers = [
    { display: '🥇 1st', name: 'Robert Stephenson 2', payout: '$475' },
    { display: '🥈 2nd', name: 'Morgan 3',            payout: '$265' },
    { display: '🥉 3rd', name: 'Jake Bogardus',       payout: '$160' },
    { display: '4th',    name: 'Erik Vermilyea',      payout: '$100' },
    { display: '5th',    name: 'Matt Bova 2',         payout: '$50'  },
  ];

  const dailyWinners = [
    { round: 'R1', name: 'Matthew Tuckfield', payout: '$25' },
    { round: 'R2', name: 'Joe Bushey',        payout: '$25' },
    { round: 'R3', name: 'Matt Bova 2',       payout: '$25' },
    { round: 'R4', name: 'Jake Bogardus',     payout: '$25' },
  ];

  const finisherCards = finishers.map(f => {
    const entry = MASTERS_2025_TOTAL.find(e => e.pick.entrantName === f.name);
    let chipsHtml = '';
    if (entry) {
      chipsHtml = '<div class="fp-picks-chips">' + [1,2,3,4,5,6].map(i => {
        const t = entry.tierScores[`t${i}`];
        const cls = t.score < 0 ? 'score-under' : t.score > 0 ? 'score-over' : 'score-even';
        const scoreStr = t.score === 0 ? 'E' : (t.score > 0 ? `+${t.score}` : `${t.score}`);
        const lastName = t.golfer.split(' ').slice(1).join(' ') || t.golfer;
        return `<span class="fp-pick-chip"><span class="fp-pick-name">${lastName}</span><span class="fp-pick-score ${cls}">${scoreStr}</span></span>`;
      }).join('') + '</div>';
    }
    return `
      <div class="fp-finisher-card">
        <div class="fp-finisher-top">
          <span class="fp-rank-badge">${f.display}</span>
          <span class="fp-finisher-name">${f.name}</span>
          <span class="fp-finisher-payout">${f.payout}</span>
        </div>
        <div class="fp-picks-row">${chipsHtml}</div>
      </div>`;
  }).join('');

  const dailyCards = dailyWinners.map(d => `
    <div class="fp-daily-card">
      <div class="fp-daily-card-top">
        <span class="fp-round-badge fp-round-badge-masters">${d.round}</span>
        <span class="fp-winner-name">${d.name}</span>
        <span class="fp-winner-payout">${d.payout}</span>
      </div>
      <div class="fp-picks-row"><span style="color:var(--text-muted);font-size:.8rem">Round scores coming soon</span></div>
    </div>`).join('');

  fp.innerHTML = `
    <div class="fp-header fp-header-masters">
      <div class="fp-header-left">
        <div class="fp-trophy-icon">🏆</div>
        <div>
          <h2 class="fp-title">The Masters 2025 — Final Results</h2>
          <p class="fp-subtitle">Augusta National Golf Club · April 10–13, 2025</p>
        </div>
      </div>
      <div class="fp-pool-stats">
        <div class="fp-stat">
          <span class="fp-stat-label">Place Payouts</span>
          <span class="fp-stat-val">$1,050</span>
        </div>
        <div class="fp-stat">
          <span class="fp-stat-label">Daily High Scores</span>
          <span class="fp-stat-val">$100</span>
        </div>
        <div class="fp-stat">
          <span class="fp-stat-label">Total Pool</span>
          <span class="fp-stat-val">$1,150</span>
        </div>
      </div>
    </div>
    <div class="fp-two-col">
      <div class="fp-section">
        <h3 class="fp-section-title fp-section-title-masters">Place Finishers</h3>
        <div class="fp-finishers">${finisherCards}</div>
      </div>
      <div class="fp-section">
        <h3 class="fp-section-title fp-section-title-masters">Daily High Score Winners</h3>
        <div class="fp-daily-winners">${dailyCards}</div>
      </div>
    </div>`;
}

// ─── Masters 2025 Round 1 Standings ──────────────────────────────────────────
const MASTERS_2025_R1 = [
  { rank:  1, total: -12, pick: { entrantName: 'Matthew Tuckfield' },  tierScores: { t1: { score:  -4, status: null, golfer: 'Scottie Scheffler',          isTop4: true  }, t2: { score:  7, status: null, golfer: 'Russell Henley',         isTop4: false }, t3: { score:  -4, status: null, golfer: 'Corey Conners',            isTop4: true  }, t4: { score:  -2, status: null, golfer: 'Aaron Rai',               isTop4: true  }, t5: { score:  -2, status: null, golfer: 'Harris English',          isTop4: true  }, t6: { score:   3, status: null, golfer: 'Jhonattan Vegas',         isTop4: false } } },
  { rank:  2, total:  -8, pick: { entrantName: 'Nick Bova' },          tierScores: { t1: { score:  -4, status: null, golfer: 'Ludvig Åberg',               isTop4: true  }, t2: { score: -1, status: null, golfer: 'Min Woo Lee',             isTop4: true  }, t3: { score:  -2, status: null, golfer: 'Akshay Bhatia',            isTop4: true  }, t4: { score:  -1, status: null, golfer: 'Daniel Berger',           isTop4: true  }, t5: { score:   0, status: null, golfer: 'Cameron Young',           isTop4: false }, t6: { score:   6, status: null, golfer: 'Matthieu Pavon',          isTop4: false } } },
  { rank:  2, total:  -8, pick: { entrantName: 'Myron Mayo' },         tierScores: { t1: { score:  -4, status: null, golfer: 'Scottie Scheffler',          isTop4: true  }, t2: { score:  1, status: null, golfer: 'Tommy Fleetwood',         isTop4: false }, t3: { score:  -2, status: null, golfer: 'Akshay Bhatia',            isTop4: true  }, t4: { score:  -1, status: null, golfer: 'Daniel Berger',           isTop4: true  }, t5: { score:  -1, status: null, golfer: 'Denny McCarthy',          isTop4: true  }, t6: { score:   4, status: null, golfer: 'Kevin Yu',               isTop4: false } } },
  { rank:  2, total:  -8, pick: { entrantName: 'Erik Vermilyea' },     tierScores: { t1: { score:  -4, status: null, golfer: 'Scottie Scheffler',          isTop4: true  }, t2: { score: -1, status: null, golfer: 'Shane Lowry',             isTop4: true  }, t3: { score:  -2, status: null, golfer: 'Jason Day',                isTop4: true  }, t4: { score:   5, status: null, golfer: 'Billy Horschel',          isTop4: false }, t5: { score:   2, status: null, golfer: 'Max Homa',               isTop4: false }, t6: { score:  -1, status: null, golfer: 'Matt McCarty',            isTop4: true  } } },
  { rank:  2, total:  -8, pick: { entrantName: 'Matt Bova 2' },        tierScores: { t1: { score:  -3, status: null, golfer: 'Bryson DeChambeau',          isTop4: true  }, t2: { score:  1, status: null, golfer: 'Jordan Spieth',           isTop4: true  }, t3: { score:  -4, status: null, golfer: 'Corey Conners',            isTop4: true  }, t4: { score:  -2, status: null, golfer: 'Aaron Rai',               isTop4: true  }, t5: { score:   2, status: null, golfer: 'Max Homa',               isTop4: false }, t6: { score:   3, status: null, golfer: 'Danny Willett',           isTop4: false } } },
  { rank:  2, total:  -8, pick: { entrantName: 'Morgan Coleman' },     tierScores: { t1: { score:  -4, status: null, golfer: 'Scottie Scheffler',          isTop4: true  }, t2: { score:  1, status: null, golfer: 'Tommy Fleetwood',         isTop4: true  }, t3: { score:  -4, status: null, golfer: 'Corey Conners',            isTop4: true  }, t4: { score:   2, status: null, golfer: 'Keegan Bradley',          isTop4: false }, t5: { score:  -1, status: null, golfer: 'Denny McCarthy',          isTop4: true  }, t6: { score:   4, status: null, golfer: 'Jose Luis Ballester (a)', isTop4: false } } },
  { rank:  7, total:  -7, pick: { entrantName: 'Jake Bogardus' },      tierScores: { t1: { score:  -4, status: null, golfer: 'Scottie Scheffler',          isTop4: true  }, t2: { score:  1, status: null, golfer: 'Jordan Spieth',           isTop4: false }, t3: { score:  -1, status: null, golfer: 'Cameron Smith',            isTop4: true  }, t4: { score:  -1, status: null, golfer: 'Sungjae Im',              isTop4: true  }, t5: { score:   2, status: null, golfer: 'Max Homa',               isTop4: false }, t6: { score:  -1, status: null, golfer: 'Bubba Watson',            isTop4: true  } } },
  { rank:  8, total:  -6, pick: { entrantName: 'Robert Stephenson 2' },tierScores: { t1: { score:   0, status: null, golfer: 'Rory McIlroy',               isTop4: true  }, t2: { score:  1, status: null, golfer: 'Jordan Spieth',           isTop4: true  }, t3: { score:  -7, status: null, golfer: 'Justin Rose',              isTop4: true  }, t4: { score:   5, status: null, golfer: 'Adam Scott',              isTop4: false }, t5: { score:   0, status: null, golfer: 'Tom Hoge',               isTop4: true  }, t6: { score:   3, status: null, golfer: 'Danny Willett',           isTop4: false } } },
  { rank:  8, total:  -6, pick: { entrantName: 'Jeff Mersch' },        tierScores: { t1: { score:  -4, status: null, golfer: 'Scottie Scheffler',          isTop4: true  }, t2: { score: -1, status: null, golfer: 'Min Woo Lee',             isTop4: true  }, t3: { score:   6, status: null, golfer: 'Sepp Straka',             isTop4: false }, t4: { score:   0, status: null, golfer: 'Maverick McNealy',       isTop4: true  }, t5: { score:  -1, status: null, golfer: 'Denny McCarthy',          isTop4: true  }, t6: { score:   6, status: null, golfer: 'Matthieu Pavon',          isTop4: false } } },
  { rank:  8, total:  -6, pick: { entrantName: 'Paul Raymond' },       tierScores: { t1: { score:  -4, status: null, golfer: 'Scottie Scheffler',          isTop4: true  }, t2: { score: -1, status: null, golfer: 'Viktor Hovland',          isTop4: true  }, t3: { score:   0, status: null, golfer: 'Sahith Theegala',         isTop4: true  }, t4: { score:   3, status: null, golfer: 'Phil Mickelson',          isTop4: false }, t5: { score:   2, status: null, golfer: 'Max Homa',               isTop4: false }, t6: { score:  -1, status: null, golfer: 'Bubba Watson',            isTop4: true  } } },
  { rank:  8, total:  -6, pick: { entrantName: 'Ron Pannullo' },       tierScores: { t1: { score:  -3, status: null, golfer: 'Bryson DeChambeau',          isTop4: true  }, t2: { score: -1, status: null, golfer: 'Viktor Hovland',          isTop4: true  }, t3: { score:  -1, status: null, golfer: 'Cameron Smith',            isTop4: true  }, t4: { score:   5, status: null, golfer: 'Adam Scott',              isTop4: false }, t5: { score:   2, status: null, golfer: 'Max Homa',               isTop4: false }, t6: { score:  -1, status: null, golfer: 'Bubba Watson',            isTop4: true  } } },
  { rank: 12, total:  -5, pick: { entrantName: 'Cassady Glenn' },      tierScores: { t1: { score:  -4, status: null, golfer: 'Ludvig Åberg',               isTop4: true  }, t2: { score:  1, status: null, golfer: 'Jordan Spieth',           isTop4: true  }, t3: { score:   2, status: null, golfer: 'Will Zalatoris',          isTop4: false }, t4: { score:  -1, status: null, golfer: 'Daniel Berger',           isTop4: true  }, t5: { score:  -1, status: null, golfer: 'Michael Kim',            isTop4: true  }, t6: { score:   4, status: null, golfer: 'Kevin Yu',               isTop4: false } } },
  { rank: 13, total:  -2, pick: { entrantName: 'Mitch Pletcher' },     tierScores: { t1: { score:  -4, status: null, golfer: 'Scottie Scheffler',          isTop4: true  }, t2: { score: -1, status: null, golfer: 'Min Woo Lee',             isTop4: true  }, t3: { score:   2, status: null, golfer: 'Will Zalatoris',          isTop4: true  }, t4: { score:   5, status: null, golfer: 'Billy Horschel',          isTop4: false }, t5: { score:   2, status: null, golfer: 'Max Homa',               isTop4: true  }, t6: { score:  -1, status: null, golfer: 'Bubba Watson',            isTop4: true  } } },
  { rank: 13, total:  -4, pick: { entrantName: 'Robert Stephenson' },  tierScores: { t1: { score:  -3, status: null, golfer: 'Bryson DeChambeau',          isTop4: true  }, t2: { score:  1, status: null, golfer: 'Jordan Spieth',           isTop4: true  }, t3: { score:   6, status: null, golfer: 'Sepp Straka',             isTop4: false }, t4: { score:   3, status: null, golfer: 'Phil Mickelson',          isTop4: false }, t5: { score:  -1, status: null, golfer: 'Michael Kim',            isTop4: true  }, t6: { score:  -1, status: null, golfer: 'Bubba Watson',            isTop4: true  } } },
  { rank: 13, total:  -4, pick: { entrantName: 'Cody Esbrandt' },      tierScores: { t1: { score:   0, status: null, golfer: 'Rory McIlroy',               isTop4: true  }, t2: { score:  3, status: null, golfer: 'Robert MacIntyre',       isTop4: false }, t3: { score:  -4, status: null, golfer: 'Corey Conners',            isTop4: true  }, t4: { score:   1, status: null, golfer: 'Sam Burns',              isTop4: true  }, t5: { score:  -1, status: null, golfer: 'Michael Kim',            isTop4: true  }, t6: { score:   6, status: null, golfer: 'Matthieu Pavon',          isTop4: false } } },
  { rank: 13, total:  -4, pick: { entrantName: 'Sarah Crowell' },      tierScores: { t1: { score:  -4, status: null, golfer: 'Scottie Scheffler',          isTop4: true  }, t2: { score:  1, status: null, golfer: 'Jordan Spieth',           isTop4: true  }, t3: { score:  -1, status: null, golfer: 'Cameron Smith',            isTop4: true  }, t4: { score:   5, status: null, golfer: 'Adam Scott',              isTop4: false }, t5: { score:   0, status: null, golfer: 'Cameron Young',           isTop4: true  }, t6: { score:   6, status: null, golfer: 'Matthieu Pavon',          isTop4: false } } },
  { rank: 13, total:  -4, pick: { entrantName: 'Bobby Cross 2' },      tierScores: { t1: { score:  -3, status: null, golfer: 'Bryson DeChambeau',          isTop4: true  }, t2: { score: -1, status: null, golfer: 'Min Woo Lee',             isTop4: true  }, t3: { score:   2, status: null, golfer: 'Will Zalatoris',          isTop4: false }, t4: { score:   5, status: null, golfer: 'Billy Horschel',          isTop4: false }, t5: { score:  -1, status: null, golfer: 'Michael Kim',            isTop4: true  }, t6: { score:   1, status: null, golfer: 'Davis Riley',             isTop4: true  } } },
  { rank: 13, total:  -4, pick: { entrantName: 'Karsten Meyer' },      tierScores: { t1: { score:  -3, status: null, golfer: 'Bryson DeChambeau',          isTop4: true  }, t2: { score: -1, status: null, golfer: 'Viktor Hovland',          isTop4: true  }, t3: { score:  -1, status: null, golfer: 'Cameron Smith',            isTop4: true  }, t4: { score:   3, status: null, golfer: 'Phil Mickelson',          isTop4: false }, t5: { score:   4, status: null, golfer: 'Christiaan Bezuidenhout', isTop4: false }, t6: { score:   1, status: null, golfer: 'Adam Schenk',             isTop4: true  } } },
  { rank: 13, total:  -4, pick: { entrantName: 'Tim Hurst' },          tierScores: { t1: { score:   0, status: null, golfer: 'Collin Morikawa',            isTop4: true  }, t2: { score: -1, status: null, golfer: 'Min Woo Lee',             isTop4: true  }, t3: { score:   6, status: null, golfer: 'Sepp Straka',             isTop4: false }, t4: { score:  -2, status: null, golfer: 'Aaron Rai',               isTop4: true  }, t5: { score:   4, status: null, golfer: 'Nicolai Højgaard',       isTop4: false }, t6: { score:  -1, status: null, golfer: 'Matt McCarty',            isTop4: true  } } },
  { rank: 20, total:   0, pick: { entrantName: 'Chris Schumann' },     tierScores: { t1: { score:   0, status: null, golfer: 'Rory McIlroy',               isTop4: true  }, t2: { score:  0, status: null, golfer: 'Joaquín Niemann',        isTop4: true  }, t3: { score:  -2, status: null, golfer: 'Akshay Bhatia',            isTop4: true  }, t4: { score:   5, status: null, golfer: 'Taylor Pendrith',        isTop4: false }, t5: { score:   2, status: null, golfer: 'Max Homa',               isTop4: true  }, t6: { score:  18, status: null, golfer: 'Nick Dunlap',             isTop4: false } } },
  { rank: 20, total:  -3, pick: { entrantName: 'Mike Davis' },         tierScores: { t1: { score:   0, status: null, golfer: 'Collin Morikawa',            isTop4: true  }, t2: { score:  0, status: null, golfer: 'Joaquín Niemann',        isTop4: true  }, t3: { score:  -2, status: null, golfer: 'Akshay Bhatia',            isTop4: true  }, t4: { score:   2, status: null, golfer: 'Keegan Bradley',          isTop4: false }, t5: { score:   1, status: null, golfer: 'Rasmus Højgaard',        isTop4: false }, t6: { score:  -1, status: null, golfer: 'Matt McCarty',            isTop4: true  } } },
  { rank: 20, total:  -3, pick: { entrantName: 'Nathan Wood' },        tierScores: { t1: { score:   0, status: null, golfer: 'Rory McIlroy',               isTop4: true  }, t2: { score: -1, status: null, golfer: 'Min Woo Lee',             isTop4: true  }, t3: { score:   3, status: null, golfer: 'Tony Finau',              isTop4: false }, t4: { score:  -1, status: null, golfer: 'Matt Fitzpatrick',        isTop4: true  }, t5: { score:   4, status: null, golfer: 'Austin Eckroat',         isTop4: false }, t6: { score:  -1, status: null, golfer: 'Bubba Watson',            isTop4: true  } } },
  { rank: 20, total:  -3, pick: { entrantName: 'Kyle Sheldon' },       tierScores: { t1: { score:  -4, status: null, golfer: 'Scottie Scheffler',          isTop4: true  }, t2: { score:  1, status: null, golfer: 'Tommy Fleetwood',         isTop4: true  }, t3: { score:  -1, status: null, golfer: 'Cameron Smith',            isTop4: true  }, t4: { score:   5, status: null, golfer: 'Adam Scott',              isTop4: false }, t5: { score:   1, status: null, golfer: 'Rasmus Højgaard',        isTop4: true  }, t6: { score:   4, status: null, golfer: 'Kevin Yu',               isTop4: false } } },
  { rank: 20, total:  -3, pick: { entrantName: 'Sean Susa' },          tierScores: { t1: { score:  -4, status: null, golfer: 'Scottie Scheffler',          isTop4: true  }, t2: { score:  0, status: null, golfer: 'Joaquín Niemann',        isTop4: true  }, t3: { score:   6, status: null, golfer: 'Sepp Straka',             isTop4: false }, t4: { score:   2, status: null, golfer: 'Keegan Bradley',          isTop4: false }, t5: { score:   0, status: null, golfer: 'Cameron Young',           isTop4: true  }, t6: { score:   1, status: null, golfer: 'Adam Schenk',             isTop4: true  } } },
  { rank: 20, total:   1, pick: { entrantName: 'Ryne Stone' },         tierScores: { t1: { score:  -4, status: null, golfer: 'Scottie Scheffler',          isTop4: true  }, t2: { score:  0, status: null, golfer: 'Joaquín Niemann',        isTop4: true  }, t3: { score:  -1, status: null, golfer: 'Cameron Smith',            isTop4: true  }, t4: { score:   2, status: null, golfer: 'Keegan Bradley',          isTop4: true  }, t5: { score:   2, status: null, golfer: 'J.T. Poston',            isTop4: true  }, t6: { score:   2, status: null, golfer: 'Charl Schwartzel',        isTop4: true  } } },
  { rank: 20, total:  -3, pick: { entrantName: 'Morgan 3' },           tierScores: { t1: { score:   0, status: null, golfer: 'Rory McIlroy',               isTop4: true  }, t2: { score:  0, status: null, golfer: 'Joaquín Niemann',        isTop4: true  }, t3: { score:  -1, status: null, golfer: 'Patrick Reed',             isTop4: true  }, t4: { score:   2, status: null, golfer: 'Keegan Bradley',          isTop4: false }, t5: { score:  -1, status: null, golfer: 'Michael Kim',            isTop4: true  }, t6: { score:  -1, status: null, golfer: 'Matt McCarty',            isTop4: true  } } },
  { rank: 27, total:  -2, pick: { entrantName: 'Jake Hammer' },        tierScores: { t1: { score:  -3, status: null, golfer: 'Bryson DeChambeau',          isTop4: true  }, t2: { score: -1, status: null, golfer: 'Shane Lowry',             isTop4: true  }, t3: { score:   4, status: null, golfer: 'Wyndham Clark',           isTop4: false }, t4: { score:   5, status: null, golfer: 'Adam Scott',              isTop4: false }, t5: { score:   2, status: null, golfer: 'Cam Davis',              isTop4: true  }, t6: { score:   0, status: null, golfer: 'Brian Campbell',          isTop4: true  } } },
  { rank: 27, total:  -2, pick: { entrantName: 'Bobby Cross' },        tierScores: { t1: { score:  -4, status: null, golfer: 'Scottie Scheffler',          isTop4: true  }, t2: { score: -1, status: null, golfer: 'Viktor Hovland',          isTop4: true  }, t3: { score:   4, status: null, golfer: 'Wyndham Clark',           isTop4: false }, t4: { score:   5, status: null, golfer: 'Adam Scott',              isTop4: false }, t5: { score:   2, status: null, golfer: 'Max Homa',               isTop4: true  }, t6: { score:   1, status: null, golfer: 'Adam Schenk',             isTop4: true  } } },
  { rank: 27, total:  -2, pick: { entrantName: 'Jeff Bagnasco' },      tierScores: { t1: { score:   0, status: null, golfer: 'Rory McIlroy',               isTop4: true  }, t2: { score:  1, status: null, golfer: 'Tommy Fleetwood',         isTop4: false }, t3: { score:  -1, status: null, golfer: 'Cameron Smith',            isTop4: true  }, t4: { score:   5, status: null, golfer: 'Adam Scott',              isTop4: false }, t5: { score:   0, status: null, golfer: 'Cameron Young',           isTop4: true  }, t6: { score:  -1, status: null, golfer: 'Bubba Watson',            isTop4: true  } } },
  { rank: 30, total:  -1, pick: { entrantName: 'Joe Bushey' },         tierScores: { t1: { score:   0, status: null, golfer: 'Rory McIlroy',               isTop4: true  }, t2: { score: -1, status: null, golfer: 'Shane Lowry',             isTop4: true  }, t3: { score:   6, status: null, golfer: 'Sepp Straka',             isTop4: false }, t4: { score:   2, status: null, golfer: 'J.J. Spaun',             isTop4: false }, t5: { score:   1, status: null, golfer: 'Nicolas Echavarria',     isTop4: true  }, t6: { score:  -1, status: null, golfer: 'Bubba Watson',            isTop4: true  } } },
  { rank: 30, total:   1, pick: { entrantName: 'Brandon Syde' },       tierScores: { t1: { score:   0, status: null, golfer: 'Collin Morikawa',            isTop4: true  }, t2: { score:  2, status: null, golfer: 'Patrick Cantlay',         isTop4: true  }, t3: { score:   2, status: null, golfer: 'Will Zalatoris',          isTop4: true  }, t4: { score:   5, status: null, golfer: 'Billy Horschel',          isTop4: false }, t5: { score:  -2, status: null, golfer: 'Harris English',          isTop4: true  }, t6: { score:  -1, status: null, golfer: 'Bubba Watson',            isTop4: true  } } },
  { rank: 30, total:   1, pick: { entrantName: 'Brandon Syde 2' },     tierScores: { t1: { score:  -4, status: null, golfer: 'Scottie Scheffler',          isTop4: true  }, t2: { score:  1, status: null, golfer: 'Jordan Spieth',           isTop4: true  }, t3: { score:   6, status: null, golfer: 'Sepp Straka',             isTop4: false }, t4: { score:   0, status: null, golfer: 'Maverick McNealy',       isTop4: true  }, t5: { score:   2, status: null, golfer: 'Max Homa',               isTop4: true  }, t6: { score:   2, status: null, golfer: 'Charl Schwartzel',        isTop4: true  } } },
  { rank: 30, total:  -1, pick: { entrantName: 'Jeff Stout' },         tierScores: { t1: { score:  -4, status: null, golfer: 'Scottie Scheffler',          isTop4: true  }, t2: { score:  2, status: null, golfer: 'Patrick Cantlay',         isTop4: true  }, t3: { score:   2, status: null, golfer: 'Will Zalatoris',          isTop4: true  }, t4: { score:   5, status: null, golfer: 'Adam Scott',              isTop4: false }, t5: { score:   7, status: null, golfer: 'Thomas Detry',           isTop4: false }, t6: { score:  -1, status: null, golfer: 'Fred Couples',            isTop4: true  } } },
  { rank: 34, total:   1, pick: { entrantName: 'Ed Angulo 2' },        tierScores: { t1: { score:   0, status: null, golfer: 'Collin Morikawa',            isTop4: true  }, t2: { score:  0, status: null, golfer: 'Joaquín Niemann',        isTop4: true  }, t3: { score:   6, status: null, golfer: 'Sepp Straka',             isTop4: false }, t4: { score:   2, status: null, golfer: 'J.J. Spaun',             isTop4: true  }, t5: { score:  -1, status: null, golfer: 'Michael Kim',            isTop4: true  }, t6: { score:   3, status: null, golfer: 'Danny Willett',           isTop4: false } } },
  { rank: 34, total:   1, pick: { entrantName: 'Jaymes Cole' },        tierScores: { t1: { score:  -4, status: null, golfer: 'Scottie Scheffler',          isTop4: true  }, t2: { score:  1, status: null, golfer: 'Tommy Fleetwood',         isTop4: true  }, t3: { score:   3, status: null, golfer: 'Tony Finau',              isTop4: false }, t4: { score:   2, status: null, golfer: 'Keegan Bradley',          isTop4: true  }, t5: { score:   2, status: null, golfer: 'Max Homa',               isTop4: true  }, t6: { score:  18, status: null, golfer: 'Nick Dunlap',             isTop4: false } } },
  { rank: 36, total:   2, pick: { entrantName: 'Ian' },                tierScores: { t1: { score:   0, status: null, golfer: 'Rory McIlroy',               isTop4: true  }, t2: { score:  1, status: null, golfer: 'Tommy Fleetwood',         isTop4: true  }, t3: { score:   2, status: null, golfer: 'Will Zalatoris',          isTop4: true  }, t4: { score:   5, status: null, golfer: 'Billy Horschel',          isTop4: false }, t5: { score:  -1, status: null, golfer: 'Denny McCarthy',          isTop4: true  }, t6: { score:   3, status: null, golfer: 'Danny Willett',           isTop4: false } } },
  { rank: 36, total:   2, pick: { entrantName: 'Robert Stephenson 3' },tierScores: { t1: { score:  -4, status: null, golfer: 'Scottie Scheffler',          isTop4: true  }, t2: { score:  1, status: null, golfer: 'Tommy Fleetwood',         isTop4: true  }, t3: { score:   6, status: null, golfer: 'Sepp Straka',             isTop4: true  }, t4: { score:  -1, status: null, golfer: 'Sungjae Im',              isTop4: true  }, t5: { score:   7, status: null, golfer: 'Thomas Detry',           isTop4: false }, t6: { score:  18, status: null, golfer: 'Nick Dunlap',             isTop4: false } } },
  { rank: 38, total:   3, pick: { entrantName: 'Ben Oliva' },          tierScores: { t1: { score:   1, status: null, golfer: 'Justin Thomas',              isTop4: true  }, t2: { score:  1, status: null, golfer: 'Tommy Fleetwood',         isTop4: true  }, t3: { score:   0, status: null, golfer: 'Sergio Garcia',           isTop4: true  }, t4: { score:   5, status: null, golfer: 'Billy Horschel',          isTop4: false }, t5: { score:   1, status: null, golfer: 'Nicolas Echavarria',     isTop4: true  }, t6: { score:   3, status: null, golfer: 'Danny Willett',           isTop4: false } } },
  { rank: 38, total:   3, pick: { entrantName: 'Jacob Stout' },        tierScores: { t1: { score:   2, status: null, golfer: 'Brooks Koepka',              isTop4: true  }, t2: { score:  0, status: null, golfer: 'Joaquín Niemann',        isTop4: true  }, t3: { score:  -1, status: null, golfer: 'Cameron Smith',            isTop4: true  }, t4: { score:   5, status: null, golfer: 'Billy Horschel',          isTop4: false }, t5: { score:   2, status: null, golfer: 'Cam Davis',              isTop4: true  }, t6: { score:  18, status: null, golfer: 'Nick Dunlap',             isTop4: false } } },
  { rank: 38, total:   3, pick: { entrantName: 'Joseph Woodworth' },   tierScores: { t1: { score:   0, status: null, golfer: 'Rory McIlroy',               isTop4: true  }, t2: { score:  7, status: null, golfer: 'Russell Henley',         isTop4: false }, t3: { score:   2, status: null, golfer: 'Will Zalatoris',          isTop4: true  }, t4: { score:   2, status: null, golfer: 'Keegan Bradley',          isTop4: true  }, t5: { score:  -1, status: null, golfer: 'Denny McCarthy',          isTop4: true  }, t6: { score:   4, status: null, golfer: 'Kevin Yu',               isTop4: false } } },
  { rank: 41, total:   6, pick: { entrantName: 'Ryne Stone 2' },       tierScores: { t1: { score:   3, status: null, golfer: 'Jon Rahm',                   isTop4: false }, t2: { score:  2, status: null, golfer: 'Patrick Cantlay',         isTop4: true  }, t3: { score:   2, status: null, golfer: 'Will Zalatoris',          isTop4: true  }, t4: { score:   2, status: null, golfer: 'Keegan Bradley',          isTop4: true  }, t5: { score:  -2, status: null, golfer: 'Harris English',          isTop4: true  }, t6: { score:   2, status: null, golfer: 'Charl Schwartzel',        isTop4: true  } } },
  { rank: 41, total:   4, pick: { entrantName: 'Luke S' },             tierScores: { t1: { score:   1, status: null, golfer: 'Xander Schauffele',          isTop4: true  }, t2: { score:  3, status: null, golfer: 'Robert MacIntyre',       isTop4: false }, t3: { score:   2, status: null, golfer: 'Will Zalatoris',          isTop4: true  }, t4: { score:   2, status: null, golfer: 'Keegan Bradley',          isTop4: true  }, t5: { score:   4, status: null, golfer: 'Christiaan Bezuidenhout', isTop4: false }, t6: { score:  -1, status: null, golfer: 'Bubba Watson',            isTop4: true  } } },
  { rank: 43, total:   5, pick: { entrantName: 'Zach DelGandio' },     tierScores: { t1: { score:   0, status: null, golfer: 'Collin Morikawa',            isTop4: true  }, t2: { score:  7, status: null, golfer: 'Russell Henley',         isTop4: false }, t3: { score:   6, status: null, golfer: 'Sepp Straka',             isTop4: false }, t4: { score:   2, status: null, golfer: 'Keegan Bradley',          isTop4: true  }, t5: { score:  -1, status: null, golfer: 'Denny McCarthy',          isTop4: true  }, t6: { score:   4, status: null, golfer: 'Kevin Yu',               isTop4: true  } } },
  { rank: 43, total:   7, pick: { entrantName: 'Gregory J Smith' },    tierScores: { t1: { score:   0, status: null, golfer: 'Rory McIlroy',               isTop4: true  }, t2: { score:  1, status: null, golfer: 'Jordan Spieth',           isTop4: true  }, t3: { score:   2, status: null, golfer: 'Will Zalatoris',          isTop4: true  }, t4: { score:   2, status: null, golfer: 'Keegan Bradley',          isTop4: true  }, t5: { score:   2, status: null, golfer: 'Max Homa',               isTop4: true  }, t6: { score:   3, status: null, golfer: 'Rafael Campos',           isTop4: false } } },
  { rank: 45, total:   8, pick: { entrantName: 'Ed Angulo' },          tierScores: { t1: { score:   0, status: null, golfer: 'Rory McIlroy',               isTop4: true  }, t2: { score:  0, status: null, golfer: 'Joaquín Niemann',        isTop4: true  }, t3: { score:   6, status: null, golfer: 'Sepp Straka',             isTop4: true  }, t4: { score:   2, status: null, golfer: 'J.J. Spaun',             isTop4: true  }, t5: { score:   7, status: null, golfer: 'Thomas Detry',           isTop4: false }, t6: { score:  18, status: null, golfer: 'Nick Dunlap',             isTop4: false } } },
  { rank: 46, total:   9, pick: { entrantName: 'Morgan 2' },           tierScores: { t1: { score:   0, status: null, golfer: 'Collin Morikawa',            isTop4: true  }, t2: { score:  7, status: null, golfer: 'Russell Henley',         isTop4: false }, t3: { score:   6, status: null, golfer: 'Sepp Straka',             isTop4: false }, t4: { score:   2, status: null, golfer: 'Byeong Hun An',           isTop4: true  }, t5: { score:   5, status: null, golfer: 'Laurie Canter',          isTop4: true  }, t6: { score:   2, status: null, golfer: 'Charl Schwartzel',        isTop4: true  } } },
  { rank: 47, total:  12, pick: { entrantName: 'Matt Bova' },          tierScores: { t1: { score:   0, status: null, golfer: 'Collin Morikawa',            isTop4: true  }, t2: { score:  7, status: null, golfer: 'Russell Henley',         isTop4: false }, t3: { score:   6, status: null, golfer: 'Sepp Straka',             isTop4: true  }, t4: { score:   3, status: null, golfer: 'Phil Mickelson',          isTop4: true  }, t5: { score:   7, status: null, golfer: 'Thomas Detry',           isTop4: false }, t6: { score:   3, status: null, golfer: 'Jhonattan Vegas',         isTop4: true  } } },
];

// ─── Masters 2025 Round 2 Standings ──────────────────────────────────────────
const MASTERS_2025_R2 = [
  { rank:  1, total: -13, pick: { entrantName: 'Joe Bushey' },           tierScores: { t1: { score: -6, status: null, golfer: 'Rory McIlroy',               isTop4: true  }, t2: { score: -4, status: null, golfer: 'Shane Lowry',             isTop4: true  }, t3: { score: -1, status: null, golfer: 'Sepp Straka',             isTop4: true  }, t4: { score:  0, status: null, golfer: 'J.J. Spaun',             isTop4: false }, t5: { score: -2, status: null, golfer: 'Nicolas Echavarria',     isTop4: true  }, t6: { score:  0, status: null, golfer: 'Bubba Watson',            isTop4: false } } },
  { rank:  2, total: -13, pick: { entrantName: 'Morgan 3' },             tierScores: { t1: { score: -6, status: null, golfer: 'Rory McIlroy',               isTop4: true  }, t2: { score:  2, status: null, golfer: 'Joaquín Niemann',        isTop4: false }, t3: { score: -2, status: null, golfer: 'Patrick Reed',            isTop4: true  }, t4: { score:  1, status: null, golfer: 'Keegan Bradley',          isTop4: false }, t5: { score: -1, status: null, golfer: 'Michael Kim',            isTop4: true  }, t6: { score: -4, status: null, golfer: 'Matt McCarty',            isTop4: true  } } },
  { rank:  3, total: -12, pick: { entrantName: 'Jake Hammer' },          tierScores: { t1: { score: -4, status: null, golfer: 'Bryson DeChambeau',          isTop4: true  }, t2: { score: -4, status: null, golfer: 'Shane Lowry',             isTop4: true  }, t3: { score: -4, status: null, golfer: 'Wyndham Clark',           isTop4: true  }, t4: { score:  0, status: null, golfer: 'Adam Scott',              isTop4: true  }, t5: { score:  7, status: null, golfer: 'Cam Davis',              isTop4: false }, t6: { score:  1, status: null, golfer: 'Brian Campbell',          isTop4: false } } },
  { rank:  3, total: -12, pick: { entrantName: 'Erik Vermilyea' },       tierScores: { t1: { score: -1, status: null, golfer: 'Scottie Scheffler',          isTop4: false }, t2: { score: -4, status: null, golfer: 'Shane Lowry',             isTop4: true  }, t3: { score: -2, status: null, golfer: 'Jason Day',                isTop4: true  }, t4: { score:  0, status: null, golfer: 'Billy Horschel',          isTop4: false }, t5: { score: -2, status: null, golfer: 'Max Homa',               isTop4: true  }, t6: { score: -4, status: null, golfer: 'Matt McCarty',            isTop4: true  } } },
  { rank:  5, total: -11, pick: { entrantName: 'Mike Davis' },           tierScores: { t1: { score: -3, status: null, golfer: 'Collin Morikawa',            isTop4: true  }, t2: { score:  2, status: null, golfer: 'Joaquín Niemann',        isTop4: false }, t3: { score:  4, status: null, golfer: 'Akshay Bhatia',            isTop4: false }, t4: { score:  1, status: null, golfer: 'Keegan Bradley',          isTop4: true  }, t5: { score: -5, status: null, golfer: 'Rasmus Højgaard',        isTop4: true  }, t6: { score: -4, status: null, golfer: 'Matt McCarty',            isTop4: true  } } },
  { rank:  5, total: -11, pick: { entrantName: 'Cody Esbrandt' },        tierScores: { t1: { score: -6, status: null, golfer: 'Rory McIlroy',               isTop4: true  }, t2: { score:  3, status: null, golfer: 'Robert MacIntyre',       isTop4: false }, t3: { score: -2, status: null, golfer: 'Corey Conners',            isTop4: true  }, t4: { score: -2, status: null, golfer: 'Sam Burns',              isTop4: true  }, t5: { score: -1, status: null, golfer: 'Michael Kim',            isTop4: true  }, t6: { score:  4, status: null, golfer: 'Matthieu Pavon',          isTop4: false } } },
  { rank:  7, total: -10, pick: { entrantName: 'Ian' },                  tierScores: { t1: { score: -6, status: null, golfer: 'Rory McIlroy',               isTop4: true  }, t2: { score: -3, status: null, golfer: 'Tommy Fleetwood',         isTop4: true  }, t3: { score:  6, status: null, golfer: 'Will Zalatoris',          isTop4: false }, t4: { score:  0, status: null, golfer: 'Billy Horschel',          isTop4: true  }, t5: { score:  3, status: null, golfer: 'Denny McCarthy',          isTop4: false }, t6: { score: -1, status: null, golfer: 'Danny Willett',           isTop4: true  } } },
  { rank:  7, total: -10, pick: { entrantName: 'Bobby Cross' },          tierScores: { t1: { score: -1, status: null, golfer: 'Scottie Scheffler',          isTop4: true  }, t2: { score: -3, status: null, golfer: 'Viktor Hovland',          isTop4: true  }, t3: { score: -4, status: null, golfer: 'Wyndham Clark',           isTop4: true  }, t4: { score:  0, status: null, golfer: 'Adam Scott',              isTop4: false }, t5: { score: -2, status: null, golfer: 'Max Homa',               isTop4: true  }, t6: { score:  3, status: null, golfer: 'Adam Schenk',             isTop4: false } } },
  { rank:  9, total:  -9, pick: { entrantName: 'Kyle Sheldon' },         tierScores: { t1: { score: -1, status: null, golfer: 'Scottie Scheffler',          isTop4: true  }, t2: { score: -3, status: null, golfer: 'Tommy Fleetwood',         isTop4: true  }, t3: { score:  6, status: null, golfer: 'Cameron Smith',            isTop4: false }, t4: { score:  0, status: null, golfer: 'Adam Scott',              isTop4: true  }, t5: { score: -5, status: null, golfer: 'Rasmus Højgaard',        isTop4: true  }, t6: { score:  2, status: null, golfer: 'Kevin Yu',               isTop4: false } } },
  { rank:  9, total:  -9, pick: { entrantName: 'Matt Bova 2' },          tierScores: { t1: { score: -4, status: null, golfer: 'Bryson DeChambeau',          isTop4: true  }, t2: { score:  1, status: null, golfer: 'Jordan Spieth',           isTop4: false }, t3: { score: -2, status: null, golfer: 'Corey Conners',            isTop4: true  }, t4: { score:  2, status: null, golfer: 'Aaron Rai',               isTop4: false }, t5: { score: -2, status: null, golfer: 'Max Homa',               isTop4: true  }, t6: { score: -1, status: null, golfer: 'Danny Willett',           isTop4: true  } } },
  { rank:  9, total:  -9, pick: { entrantName: 'Morgan 2' },             tierScores: { t1: { score: -3, status: null, golfer: 'Collin Morikawa',            isTop4: true  }, t2: { score: -4, status: null, golfer: 'Russell Henley',         isTop4: true  }, t3: { score: -1, status: null, golfer: 'Sepp Straka',             isTop4: true  }, t4: { score: -1, status: null, golfer: 'Byeong Hun An',           isTop4: true  }, t5: { score:  5, status: null, golfer: 'Laurie Canter',          isTop4: false }, t6: { score:  0, status: null, golfer: 'Charl Schwartzel',        isTop4: false } } },
  { rank:  9, total:  -9, pick: { entrantName: 'Jeff Bagnasco' },        tierScores: { t1: { score: -6, status: null, golfer: 'Rory McIlroy',               isTop4: true  }, t2: { score: -3, status: null, golfer: 'Tommy Fleetwood',         isTop4: true  }, t3: { score:  6, status: null, golfer: 'Cameron Smith',            isTop4: false }, t4: { score:  0, status: null, golfer: 'Adam Scott',              isTop4: true  }, t5: { score:  7, status: null, golfer: 'Cameron Young',           isTop4: false }, t6: { score:  0, status: null, golfer: 'Bubba Watson',            isTop4: false } } },
  { rank:  9, total:  -9, pick: { entrantName: 'Ron Pannullo' },         tierScores: { t1: { score: -4, status: null, golfer: 'Bryson DeChambeau',          isTop4: true  }, t2: { score: -3, status: null, golfer: 'Viktor Hovland',          isTop4: true  }, t3: { score:  6, status: null, golfer: 'Cameron Smith',            isTop4: false }, t4: { score:  0, status: null, golfer: 'Adam Scott',              isTop4: true  }, t5: { score: -2, status: null, golfer: 'Max Homa',               isTop4: true  }, t6: { score:  0, status: null, golfer: 'Bubba Watson',            isTop4: true  } } },
  { rank: 14, total:  -8, pick: { entrantName: 'Ed Angulo' },            tierScores: { t1: { score: -6, status: null, golfer: 'Rory McIlroy',               isTop4: true  }, t2: { score:  2, status: null, golfer: 'Joaquín Niemann',        isTop4: false }, t3: { score: -1, status: null, golfer: 'Sepp Straka',             isTop4: true  }, t4: { score:  0, status: null, golfer: 'J.J. Spaun',             isTop4: true  }, t5: { score:  2, status: null, golfer: 'Thomas Detry',           isTop4: false }, t6: { score: -1, status: null, golfer: 'Nick Dunlap',             isTop4: true  } } },
  { rank: 14, total:  -8, pick: { entrantName: 'Bobby Cross 2' },        tierScores: { t1: { score: -4, status: null, golfer: 'Bryson DeChambeau',          isTop4: true  }, t2: { score:  0, status: null, golfer: 'Min Woo Lee',             isTop4: true  }, t3: { score:  6, status: null, golfer: 'Will Zalatoris',          isTop4: false }, t4: { score:  0, status: null, golfer: 'Billy Horschel',          isTop4: true  }, t5: { score: -1, status: null, golfer: 'Michael Kim',            isTop4: true  }, t6: { score: -3, status: null, golfer: 'Davis Riley',             isTop4: true  } } },
  { rank: 14, total:  -8, pick: { entrantName: 'Robert Stephenson 2' },  tierScores: { t1: { score: -6, status: null, golfer: 'Rory McIlroy',               isTop4: true  }, t2: { score:  1, status: null, golfer: 'Jordan Spieth',           isTop4: false }, t3: { score: -1, status: null, golfer: 'Justin Rose',              isTop4: true  }, t4: { score:  0, status: null, golfer: 'Adam Scott',              isTop4: true  }, t5: { score:  0, status: null, golfer: 'Tom Hoge',               isTop4: true  }, t6: { score: -1, status: null, golfer: 'Danny Willett',           isTop4: true  } } },
  { rank: 14, total:  -8, pick: { entrantName: 'Tim Hurst' },            tierScores: { t1: { score: -3, status: null, golfer: 'Collin Morikawa',            isTop4: true  }, t2: { score:  0, status: null, golfer: 'Min Woo Lee',             isTop4: true  }, t3: { score: -1, status: null, golfer: 'Sepp Straka',             isTop4: true  }, t4: { score:  2, status: null, golfer: 'Aaron Rai',               isTop4: false }, t5: { score:  2, status: null, golfer: 'Nicolai Højgaard',       isTop4: false }, t6: { score: -4, status: null, golfer: 'Matt McCarty',            isTop4: true  } } },
  { rank: 18, total:  -7, pick: { entrantName: 'Chris Schumann' },       tierScores: { t1: { score: -6, status: null, golfer: 'Rory McIlroy',               isTop4: true  }, t2: { score:  2, status: null, golfer: 'Joaquín Niemann',        isTop4: true  }, t3: { score:  4, status: null, golfer: 'Akshay Bhatia',            isTop4: false }, t4: { score:  3, status: null, golfer: 'Taylor Pendrith',        isTop4: false }, t5: { score: -2, status: null, golfer: 'Max Homa',               isTop4: true  }, t6: { score: -1, status: null, golfer: 'Nick Dunlap',             isTop4: true  } } },
  { rank: 18, total:  -7, pick: { entrantName: 'Jaymes Cole' },          tierScores: { t1: { score: -1, status: null, golfer: 'Scottie Scheffler',          isTop4: true  }, t2: { score: -3, status: null, golfer: 'Tommy Fleetwood',         isTop4: true  }, t3: { score:  1, status: null, golfer: 'Tony Finau',              isTop4: false }, t4: { score:  1, status: null, golfer: 'Keegan Bradley',          isTop4: false }, t5: { score: -2, status: null, golfer: 'Max Homa',               isTop4: true  }, t6: { score: -1, status: null, golfer: 'Nick Dunlap',             isTop4: true  } } },
  { rank: 18, total:  -7, pick: { entrantName: 'Ben Oliva' },            tierScores: { t1: { score: -1, status: null, golfer: 'Justin Thomas',              isTop4: true  }, t2: { score: -3, status: null, golfer: 'Tommy Fleetwood',         isTop4: true  }, t3: { score:  4, status: null, golfer: 'Sergio Garcia',           isTop4: false }, t4: { score:  0, status: null, golfer: 'Billy Horschel',          isTop4: false }, t5: { score: -2, status: null, golfer: 'Nicolas Echavarria',     isTop4: true  }, t6: { score: -1, status: null, golfer: 'Danny Willett',           isTop4: true  } } },
  { rank: 18, total:  -7, pick: { entrantName: 'Zach DelGandio' },       tierScores: { t1: { score: -3, status: null, golfer: 'Collin Morikawa',            isTop4: true  }, t2: { score: -4, status: null, golfer: 'Russell Henley',         isTop4: true  }, t3: { score: -1, status: null, golfer: 'Sepp Straka',             isTop4: true  }, t4: { score:  1, status: null, golfer: 'Keegan Bradley',          isTop4: true  }, t5: { score:  3, status: null, golfer: 'Denny McCarthy',          isTop4: false }, t6: { score:  2, status: null, golfer: 'Kevin Yu',               isTop4: false } } },
  { rank: 18, total:  -8, pick: { entrantName: 'Robert Stephenson 3' },  tierScores: { t1: { score: -1, status: null, golfer: 'Scottie Scheffler',          isTop4: true  }, t2: { score: -3, status: null, golfer: 'Tommy Fleetwood',         isTop4: true  }, t3: { score: -1, status: null, golfer: 'Sepp Straka',             isTop4: true  }, t4: { score: -2, status: null, golfer: 'Sungjae Im',              isTop4: true  }, t5: { score:  2, status: null, golfer: 'Thomas Detry',           isTop4: false }, t6: { score: -1, status: null, golfer: 'Nick Dunlap',             isTop4: true  } } },
  { rank: 18, total:  -7, pick: { entrantName: 'Joseph Woodworth' },     tierScores: { t1: { score: -6, status: null, golfer: 'Rory McIlroy',               isTop4: true  }, t2: { score: -4, status: null, golfer: 'Russell Henley',         isTop4: true  }, t3: { score:  6, status: null, golfer: 'Will Zalatoris',          isTop4: false }, t4: { score:  1, status: null, golfer: 'Keegan Bradley',          isTop4: true  }, t5: { score:  3, status: null, golfer: 'Denny McCarthy',          isTop4: false }, t6: { score:  2, status: null, golfer: 'Kevin Yu',               isTop4: true  } } },
  { rank: 24, total:  -6, pick: { entrantName: 'Ed Angulo 2' },          tierScores: { t1: { score: -3, status: null, golfer: 'Collin Morikawa',            isTop4: true  }, t2: { score:  2, status: null, golfer: 'Joaquín Niemann',        isTop4: false }, t3: { score: -1, status: null, golfer: 'Sepp Straka',             isTop4: true  }, t4: { score:  0, status: null, golfer: 'J.J. Spaun',             isTop4: false }, t5: { score: -1, status: null, golfer: 'Michael Kim',            isTop4: true  }, t6: { score: -1, status: null, golfer: 'Danny Willett',           isTop4: true  } } },
  { rank: 24, total:  -6, pick: { entrantName: 'Robert Stephenson' },    tierScores: { t1: { score: -4, status: null, golfer: 'Bryson DeChambeau',          isTop4: true  }, t2: { score:  1, status: null, golfer: 'Jordan Spieth',           isTop4: false }, t3: { score: -1, status: null, golfer: 'Sepp Straka',             isTop4: true  }, t4: { score:  2, status: null, golfer: 'Phil Mickelson',          isTop4: false }, t5: { score: -1, status: null, golfer: 'Michael Kim',            isTop4: true  }, t6: { score:  0, status: null, golfer: 'Bubba Watson',            isTop4: true  } } },
  { rank: 24, total:  -4, pick: { entrantName: 'Matt Bova' },            tierScores: { t1: { score: -3, status: null, golfer: 'Collin Morikawa',            isTop4: true  }, t2: { score: -4, status: null, golfer: 'Russell Henley',         isTop4: true  }, t3: { score: -1, status: null, golfer: 'Sepp Straka',             isTop4: true  }, t4: { score:  2, status: null, golfer: 'Phil Mickelson',          isTop4: true  }, t5: { score:  2, status: null, golfer: 'Thomas Detry',           isTop4: true  }, t6: { score:  3, status: null, golfer: 'Jhonattan Vegas',         isTop4: false } } },
  { rank: 24, total:  -5, pick: { entrantName: 'Gregory J Smith' },      tierScores: { t1: { score: -6, status: null, golfer: 'Rory McIlroy',               isTop4: true  }, t2: { score:  1, status: null, golfer: 'Jordan Spieth',           isTop4: true  }, t3: { score:  6, status: null, golfer: 'Will Zalatoris',          isTop4: false }, t4: { score:  1, status: null, golfer: 'Keegan Bradley',          isTop4: true  }, t5: { score: -2, status: null, golfer: 'Max Homa',               isTop4: true  }, t6: { score:  1, status: null, golfer: 'Rafael Campos',           isTop4: true  } } },
  { rank: 24, total:  -6, pick: { entrantName: 'Matthew Tuckfield' },    tierScores: { t1: { score: -1, status: null, golfer: 'Scottie Scheffler',          isTop4: true  }, t2: { score: -4, status: null, golfer: 'Russell Henley',         isTop4: true  }, t3: { score: -2, status: null, golfer: 'Corey Conners',            isTop4: true  }, t4: { score:  2, status: null, golfer: 'Aaron Rai',               isTop4: false }, t5: { score:  1, status: null, golfer: 'Harris English',          isTop4: true  }, t6: { score:  3, status: null, golfer: 'Jhonattan Vegas',         isTop4: false } } },
  { rank: 24, total:  -6, pick: { entrantName: 'Paul Raymond' },         tierScores: { t1: { score: -1, status: null, golfer: 'Scottie Scheffler',          isTop4: true  }, t2: { score: -3, status: null, golfer: 'Viktor Hovland',          isTop4: true  }, t3: { score:  0, status: null, golfer: 'Sahith Theegala',         isTop4: true  }, t4: { score:  2, status: null, golfer: 'Phil Mickelson',          isTop4: false }, t5: { score: -2, status: null, golfer: 'Max Homa',               isTop4: true  }, t6: { score:  0, status: null, golfer: 'Bubba Watson',            isTop4: true  } } },
  { rank: 30, total:  -5, pick: { entrantName: 'Jake Bogardus' },        tierScores: { t1: { score: -1, status: null, golfer: 'Scottie Scheffler',          isTop4: true  }, t2: { score:  1, status: null, golfer: 'Jordan Spieth',           isTop4: false }, t3: { score:  6, status: null, golfer: 'Cameron Smith',            isTop4: false }, t4: { score: -2, status: null, golfer: 'Sungjae Im',              isTop4: true  }, t5: { score: -2, status: null, golfer: 'Max Homa',               isTop4: true  }, t6: { score:  0, status: null, golfer: 'Bubba Watson',            isTop4: true  } } },
  { rank: 30, total:  -4, pick: { entrantName: 'Nathan Wood' },          tierScores: { t1: { score: -6, status: null, golfer: 'Rory McIlroy',               isTop4: true  }, t2: { score:  0, status: null, golfer: 'Min Woo Lee',             isTop4: true  }, t3: { score:  1, status: null, golfer: 'Tony Finau',              isTop4: true  }, t4: { score:  1, status: null, golfer: 'Matt Fitzpatrick',        isTop4: true  }, t5: { score:  2, status: null, golfer: 'Austin Eckroat',         isTop4: false }, t6: { score:  0, status: null, golfer: 'Bubba Watson',            isTop4: true  } } },
  { rank: 30, total:  -5, pick: { entrantName: 'Morgan Coleman' },       tierScores: { t1: { score: -1, status: null, golfer: 'Scottie Scheffler',          isTop4: true  }, t2: { score: -3, status: null, golfer: 'Tommy Fleetwood',         isTop4: true  }, t3: { score: -2, status: null, golfer: 'Corey Conners',            isTop4: true  }, t4: { score:  1, status: null, golfer: 'Keegan Bradley',          isTop4: true  }, t5: { score:  3, status: null, golfer: 'Denny McCarthy',          isTop4: false }, t6: { score:  6, status: null, golfer: 'Jose Luis Ballester (a)', isTop4: false } } },
  { rank: 33, total:  -4, pick: { entrantName: 'Brandon Syde 2' },       tierScores: { t1: { score: -1, status: null, golfer: 'Scottie Scheffler',          isTop4: true  }, t2: { score:  1, status: null, golfer: 'Jordan Spieth',           isTop4: false }, t3: { score: -1, status: null, golfer: 'Sepp Straka',             isTop4: true  }, t4: { score:  1, status: null, golfer: 'Maverick McNealy',       isTop4: false }, t5: { score: -2, status: null, golfer: 'Max Homa',               isTop4: true  }, t6: { score:  0, status: null, golfer: 'Charl Schwartzel',        isTop4: true  } } },
  { rank: 34, total:  -3, pick: { entrantName: 'Mitch Pletcher' },       tierScores: { t1: { score: -1, status: null, golfer: 'Scottie Scheffler',          isTop4: true  }, t2: { score:  0, status: null, golfer: 'Min Woo Lee',             isTop4: true  }, t3: { score:  6, status: null, golfer: 'Will Zalatoris',          isTop4: false }, t4: { score:  0, status: null, golfer: 'Billy Horschel',          isTop4: true  }, t5: { score: -2, status: null, golfer: 'Max Homa',               isTop4: true  }, t6: { score:  0, status: null, golfer: 'Bubba Watson',            isTop4: true  } } },
  { rank: 34, total:  -3, pick: { entrantName: 'Brandon Syde' },         tierScores: { t1: { score: -3, status: null, golfer: 'Collin Morikawa',            isTop4: true  }, t2: { score:  0, status: null, golfer: 'Patrick Cantlay',         isTop4: true  }, t3: { score:  6, status: null, golfer: 'Will Zalatoris',          isTop4: false }, t4: { score:  0, status: null, golfer: 'Billy Horschel',          isTop4: true  }, t5: { score:  1, status: null, golfer: 'Harris English',          isTop4: false }, t6: { score:  0, status: null, golfer: 'Bubba Watson',            isTop4: true  } } },
  { rank: 36, total:   1, pick: { entrantName: 'Karsten Meyer' },        tierScores: { t1: { score: -4, status: null, golfer: 'Bryson DeChambeau',          isTop4: true  }, t2: { score: -3, status: null, golfer: 'Viktor Hovland',          isTop4: true  }, t3: { score:  6, status: null, golfer: 'Cameron Smith',            isTop4: false }, t4: { score:  2, status: null, golfer: 'Phil Mickelson',          isTop4: true  }, t5: { score:  3, status: null, golfer: 'Christiaan Bezuidenhout', isTop4: true  }, t6: { score:  3, status: null, golfer: 'Adam Schenk',             isTop4: true  } } },
  { rank: 37, total:  -1, pick: { entrantName: 'Myron Mayo' },           tierScores: { t1: { score: -1, status: null, golfer: 'Scottie Scheffler',          isTop4: true  }, t2: { score: -3, status: null, golfer: 'Tommy Fleetwood',         isTop4: true  }, t3: { score:  4, status: null, golfer: 'Akshay Bhatia',            isTop4: false }, t4: { score:  1, status: null, golfer: 'Daniel Berger',           isTop4: true  }, t5: { score:  3, status: null, golfer: 'Denny McCarthy',          isTop4: false }, t6: { score:  2, status: null, golfer: 'Kevin Yu',               isTop4: true  } } },
  { rank: 37, total:  -1, pick: { entrantName: 'Jeff Mersch' },          tierScores: { t1: { score: -1, status: null, golfer: 'Scottie Scheffler',          isTop4: true  }, t2: { score:  0, status: null, golfer: 'Min Woo Lee',             isTop4: true  }, t3: { score: -1, status: null, golfer: 'Sepp Straka',             isTop4: true  }, t4: { score:  1, status: null, golfer: 'Maverick McNealy',       isTop4: true  }, t5: { score:  3, status: null, golfer: 'Denny McCarthy',          isTop4: false }, t6: { score:  4, status: null, golfer: 'Matthieu Pavon',          isTop4: false } } },
  { rank: 39, total:   0, pick: { entrantName: 'Ryne Stone' },           tierScores: { t1: { score: -1, status: null, golfer: 'Scottie Scheffler',          isTop4: true  }, t2: { score:  2, status: null, golfer: 'Joaquín Niemann',        isTop4: false }, t3: { score:  6, status: null, golfer: 'Cameron Smith',            isTop4: false }, t4: { score:  1, status: null, golfer: 'Keegan Bradley',          isTop4: true  }, t5: { score:  0, status: null, golfer: 'J.T. Poston',            isTop4: true  }, t6: { score:  0, status: null, golfer: 'Charl Schwartzel',        isTop4: true  } } },
  { rank: 39, total:   1, pick: { entrantName: 'Ryne Stone 2' },         tierScores: { t1: { score: -1, status: null, golfer: 'Jon Rahm',                   isTop4: true  }, t2: { score:  0, status: null, golfer: 'Patrick Cantlay',         isTop4: true  }, t3: { score:  6, status: null, golfer: 'Will Zalatoris',          isTop4: false }, t4: { score:  1, status: null, golfer: 'Keegan Bradley',          isTop4: true  }, t5: { score:  1, status: null, golfer: 'Harris English',          isTop4: true  }, t6: { score:  0, status: null, golfer: 'Charl Schwartzel',        isTop4: true  } } },
  { rank: 41, total:   1, pick: { entrantName: 'Sean Susa' },            tierScores: { t1: { score: -1, status: null, golfer: 'Scottie Scheffler',          isTop4: true  }, t2: { score:  2, status: null, golfer: 'Joaquín Niemann',        isTop4: true  }, t3: { score: -1, status: null, golfer: 'Sepp Straka',             isTop4: true  }, t4: { score:  1, status: null, golfer: 'Keegan Bradley',          isTop4: true  }, t5: { score:  7, status: null, golfer: 'Cameron Young',           isTop4: false }, t6: { score:  3, status: null, golfer: 'Adam Schenk',             isTop4: false } } },
  { rank: 41, total:   4, pick: { entrantName: 'Luke S' },               tierScores: { t1: { score: -3, status: null, golfer: 'Xander Schauffele',          isTop4: true  }, t2: { score:  3, status: null, golfer: 'Robert MacIntyre',       isTop4: true  }, t3: { score:  6, status: null, golfer: 'Will Zalatoris',          isTop4: false }, t4: { score:  1, status: null, golfer: 'Keegan Bradley',          isTop4: true  }, t5: { score:  3, status: null, golfer: 'Christiaan Bezuidenhout', isTop4: true  }, t6: { score:  0, status: null, golfer: 'Bubba Watson',            isTop4: true  } } },
  { rank: 41, total:   1, pick: { entrantName: 'Jeff Stout' },           tierScores: { t1: { score: -1, status: null, golfer: 'Scottie Scheffler',          isTop4: true  }, t2: { score:  0, status: null, golfer: 'Patrick Cantlay',         isTop4: true  }, t3: { score:  6, status: null, golfer: 'Will Zalatoris',          isTop4: false }, t4: { score:  0, status: null, golfer: 'Adam Scott',              isTop4: true  }, t5: { score:  2, status: null, golfer: 'Thomas Detry',           isTop4: true  }, t6: { score:  5, status: null, golfer: 'Fred Couples',            isTop4: false } } },
  { rank: 44, total:   2, pick: { entrantName: 'Cassady Glenn' },        tierScores: { t1: { score:  1, status: null, golfer: 'Ludvig Åberg',               isTop4: true  }, t2: { score:  1, status: null, golfer: 'Jordan Spieth',           isTop4: true  }, t3: { score:  6, status: null, golfer: 'Will Zalatoris',          isTop4: false }, t4: { score:  1, status: null, golfer: 'Daniel Berger',           isTop4: true  }, t5: { score: -1, status: null, golfer: 'Michael Kim',            isTop4: true  }, t6: { score:  2, status: null, golfer: 'Kevin Yu',               isTop4: false } } },
  { rank: 45, total:   4, pick: { entrantName: 'Sarah Crowell' },        tierScores: { t1: { score: -1, status: null, golfer: 'Scottie Scheffler',          isTop4: true  }, t2: { score:  1, status: null, golfer: 'Jordan Spieth',           isTop4: true  }, t3: { score:  6, status: null, golfer: 'Cameron Smith',            isTop4: false }, t4: { score:  0, status: null, golfer: 'Adam Scott',              isTop4: true  }, t5: { score:  7, status: null, golfer: 'Cameron Young',           isTop4: false }, t6: { score:  4, status: null, golfer: 'Matthieu Pavon',          isTop4: true  } } },
  { rank: 45, total:   4, pick: { entrantName: 'Jacob Stout' },          tierScores: { t1: { score:  3, status: null, golfer: 'Brooks Koepka',              isTop4: true  }, t2: { score:  2, status: null, golfer: 'Joaquín Niemann',        isTop4: true  }, t3: { score:  6, status: null, golfer: 'Cameron Smith',            isTop4: false }, t4: { score:  0, status: null, golfer: 'Billy Horschel',          isTop4: true  }, t5: { score:  7, status: null, golfer: 'Cam Davis',              isTop4: false }, t6: { score: -1, status: null, golfer: 'Nick Dunlap',             isTop4: true  } } },
  { rank: 47, total:  10, pick: { entrantName: 'Nick Bova' },            tierScores: { t1: { score:  1, status: null, golfer: 'Ludvig Åberg',               isTop4: true  }, t2: { score:  0, status: null, golfer: 'Min Woo Lee',             isTop4: true  }, t3: { score:  4, status: null, golfer: 'Akshay Bhatia',            isTop4: true  }, t4: { score:  1, status: null, golfer: 'Daniel Berger',           isTop4: true  }, t5: { score:  7, status: null, golfer: 'Cameron Young',           isTop4: false }, t6: { score:  4, status: null, golfer: 'Matthieu Pavon',          isTop4: true  } } },
];

function loadMasters2025Round2Standings() {
  const container = document.getElementById('masters-day2');
  if (!container) return;

  const medals = ['🥇', '🥈', '🥉'];
  const rows = MASTERS_2025_R2.map(entry => {
    const rankDisplay = entry.rank <= 3 ? medals[entry.rank - 1] : entry.rank;
    const rankClass   = entry.rank <= 3 ? `rank-${entry.rank}` : '';
    const totalCls    = scoreClass(entry.total, null);
    const tierCells   = [1,2,3,4,5,6].map(i => {
      const t = entry.tierScores[`t${i}`];
      const cls   = scoreClass(t.score, t.status);
      const label = formatScore(t.score, t.status);
      const top4Class = t.isTop4 ? 'top-4-pick' : '';
      return `<td class="col-tier ${top4Class}" title="${escapeHtml(t.golfer)}"><div class="tier-cell-card"><span class="player-name-cell">${shortName(t.golfer)}</span><small class="score-val ${cls}">${label}</small></div></td>`;
    }).join('');
    const allPlayers = [1,2,3,4,5,6].map(i => entry.tierScores[`t${i}`]?.golfer || '').join(' ');
    return `
      <tr data-entry="${escapeHtml(entry.pick.entrantName).toLowerCase()}" data-players="${escapeHtml(allPlayers).toLowerCase()}">
        <td class="col-rank ${rankClass}">${rankDisplay}</td>
        <td class="col-name">${escapeHtml(entry.pick.entrantName)}</td>
        <td class="col-total"><span class="score-val ${totalCls}">${formatScore(entry.total, null)}</span></td>
        ${tierCells}
      </tr>`;
  }).join('');

  container.innerHTML = `
    <div class="search-bar">
      <input type="text" id="r2Search" class="standings-search" placeholder="Search entry name or player..." />
    </div>
    <div class="table-wrapper">
      <table class="standings-table">
        <thead>
          <tr>
            <th>Rank</th><th>Entry</th><th>R2 Total</th>
            <th>Tier 1</th><th>Tier 2</th><th>Tier 3</th><th>Tier 4</th><th>Tier 5</th><th>Tier 6</th>
          </tr>
        </thead>
        <tbody id="r2StandingsBody">${rows}</tbody>
      </table>
    </div>`;

  document.getElementById('r2Search').addEventListener('input', e => {
    const q = e.target.value.toLowerCase().trim();
    document.querySelectorAll('#r2StandingsBody tr').forEach(row => {
      const entry = row.dataset.entry || '';
      const players = row.dataset.players || '';
      row.style.display = (!q || entry.includes(q) || players.includes(q)) ? '' : 'none';
    });
  });
}

function loadMasters2025Round1Standings() {
  const container = document.getElementById('masters-day1');
  if (!container) return;

  const medals = ['🥇', '🥈', '🥉'];
  const rows = MASTERS_2025_R1.map(entry => {
    const rankDisplay = entry.rank <= 3 ? medals[entry.rank - 1] : entry.rank;
    const rankClass   = entry.rank <= 3 ? `rank-${entry.rank}` : '';
    const totalCls    = scoreClass(entry.total, null);
    const tierCells   = [1,2,3,4,5,6].map(i => {
      const t = entry.tierScores[`t${i}`];
      const cls   = scoreClass(t.score, t.status);
      const label = formatScore(t.score, t.status);
      const top4Class = t.isTop4 ? 'top-4-pick' : '';
      return `<td class="col-tier ${top4Class}" title="${escapeHtml(t.golfer)}"><div class="tier-cell-card"><span class="player-name-cell">${shortName(t.golfer)}</span><small class="score-val ${cls}">${label}</small></div></td>`;
    }).join('');
    const allPlayers = [1,2,3,4,5,6].map(i => entry.tierScores[`t${i}`]?.golfer || '').join(' ');
    return `
      <tr data-entry="${escapeHtml(entry.pick.entrantName).toLowerCase()}" data-players="${escapeHtml(allPlayers).toLowerCase()}">
        <td class="col-rank ${rankClass}">${rankDisplay}</td>
        <td class="col-name">${escapeHtml(entry.pick.entrantName)}</td>
        <td class="col-total"><span class="score-val ${totalCls}">${formatScore(entry.total, null)}</span></td>
        ${tierCells}
      </tr>`;
  }).join('');

  container.innerHTML = `
    <div class="search-bar">
      <input type="text" id="r1Search" class="standings-search" placeholder="Search entry name or player..." />
    </div>
    <div class="table-wrapper">
      <table class="standings-table">
        <thead>
          <tr>
            <th>Rank</th><th>Entry</th><th>R1 Total</th>
            <th>Tier 1</th><th>Tier 2</th><th>Tier 3</th><th>Tier 4</th><th>Tier 5</th><th>Tier 6</th>
          </tr>
        </thead>
        <tbody id="r1StandingsBody">${rows}</tbody>
      </table>
    </div>`;

  document.getElementById('r1Search').addEventListener('input', e => {
    const q = e.target.value.toLowerCase().trim();
    document.querySelectorAll('#r1StandingsBody tr').forEach(row => {
      const entry = row.dataset.entry || '';
      const players = row.dataset.players || '';
      row.style.display = (!q || entry.includes(q) || players.includes(q)) ? '' : 'none';
    });
  });
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

  if (mastersActiveYear === 2025) {
    players = MASTERS_2025_FIELD;
  } else {
    // Try ESPN API first (2026 event 401811941)
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
            const statusOrder = { 'Active': 0, 'CUT': 1, 'WD': 2 };
            const sa = statusOrder[a.status] ?? 0;
            const sb = statusOrder[b.status] ?? 0;
            if (sa !== sb) return sa - sb;
            return a.total - b.total;
          });
        }
      }
    } catch { /* fall through to hardcoded */ }
    if (!players.length) players = MASTERS_2026_FIELD;
  }

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

    // Daily winner picks — show actual per-round scores from hardcoded round data
    function renderPicksFromRoundData(targetId, entrantName, roundData) {
      const row = document.getElementById(targetId);
      if (!row) return;
      const entry = roundData.find(e => e.team.toLowerCase().trim() === entrantName.toLowerCase().trim());
      if (!entry) return;
      row.innerHTML = `<div class="fp-picks-chips">${entry.tiers.map(t => {
        const cls = t.score < 0 ? 'score-under' : t.score > 0 ? 'score-over' : 'score-even';
        const scoreStr = t.score === 0 ? 'E' : (t.score > 0 ? `+${t.score}` : `${t.score}`);
        const lastName = t.player.split(' ').slice(1).join(' ') || t.player;
        return `<span class="fp-pick-chip"><span class="fp-pick-name">${lastName}</span><span class="fp-pick-score ${cls}">${scoreStr}</span></span>`;
      }).join('')}</div>`;
    }

    // Populate place finisher picks with actual scores
    for (const f of MASTERS_2026_FINISHERS) {
      renderPicksWithScores(`fp-chips-${f.name.replace(/\s+/g, '-').toLowerCase()}`, f.name);
    }

    // Populate daily high score winner picks with actual round scores
    renderPicksFromRoundData('fp-daily-r1', 'Nick Bova 2',      MASTERS_2026_R1);
    renderPicksFromRoundData('fp-daily-r2', 'Brandon Sullivan',  MASTERS_2026_R2);
    renderPicksFromRoundData('fp-daily-r3', 'Sarah Crowell',     MASTERS_2026_R3);
    renderPicksFromRoundData('fp-daily-r4', 'Ron Pannullo',      MASTERS_2026_R4);

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

// ─── Masters 2026 Round 1 Standings ──────────────────────────────────────────
const MASTERS_2026_R1 = [
  { team: 'Bobby Cross',         tiers: [{ player: 'Scottie Scheffler', score: -2 }, { player: 'Tommy Fleetwood', score: -1 }, { player: 'Si Woo Kim', score: 3 },       { player: 'J.J. Spaun', score: 2 },          { player: 'Wyndham Clark', score: 0 },      { player: 'Zach Johnson', score: 3 }] },
  { team: 'Bobby Cross 2',       tiers: [{ player: 'Ludvig Åberg', score: 2 },       { player: 'Brooks Koepka', score: 0 },       { player: 'Akshay Bhatia', score: 1 },      { player: 'Daniel Berger', score: 4 },        { player: 'Alex Noren', score: 5 },         { player: 'Michael Kim', score: 3 }] },
  { team: 'Brandon Sullivan',    tiers: [{ player: 'Ludvig Åberg', score: 2 },       { player: 'Tommy Fleetwood', score: -1 },    { player: 'Jake Knapp', score: 1 },         { player: 'Max Homa', score: 0 },             { player: 'Brian Harman', score: 7 },       { player: 'Andrew Novak', score: 3 }] },
  { team: 'Brandon Syde',        tiers: [{ player: 'Jon Rahm', score: 6 },           { player: 'Justin Rose', score: -2 },        { player: 'Akshay Bhatia', score: 1 },      { player: 'Max Homa', score: 0 },             { player: 'Keegan Bradley', score: 0 },     { player: 'Charl Schwartzel', score: 3 }] },
  { team: 'Brandon Syde 2',      tiers: [{ player: 'Scottie Scheffler', score: -2 }, { player: 'Collin Morikawa', score: 2 },     { player: 'Sepp Straka', score: 1 },        { player: 'Ben Griffin', score: 0 },          { player: 'Dustin Johnson', score: 1 },     { player: 'Bubba Watson', score: 4 }] },
  { team: 'Cassady Glenn',       tiers: [{ player: 'Jon Rahm', score: 6 },           { player: 'Cameron Young', score: 1 },       { player: 'Min Woo Lee', score: 6 },        { player: 'Corey Conners', score: 3 },        { player: 'Kurt Kitayama', score: -3 },     { player: 'Michael Kim', score: 3 }] },
  { team: 'Chris Merkel',        tiers: [{ player: 'Rory McIlroy', score: -5 },      { player: 'Collin Morikawa', score: 2 },     { player: 'Akshay Bhatia', score: 1 },      { player: 'Daniel Berger', score: 4 },        { player: 'Brian Harman', score: 7 },       { player: 'Davis Riley', score: 10 }] },
  { team: 'Chris schumann',      tiers: [{ player: 'Ludvig Åberg', score: 2 },       { player: 'Tommy Fleetwood', score: -1 },    { player: 'Min Woo Lee', score: 6 },        { player: 'Nicolai Højgaard', score: 4 },     { player: 'Sam Stevens', score: 0 },        { player: 'Michael Kim', score: 3 }] },
  { team: 'Cody Esbrandt',       tiers: [{ player: 'Bryson DeChambeau', score: 4 },  { player: 'Justin Rose', score: -2 },        { player: 'Adam Scott', score: 0 },         { player: 'Sungjae Im', score: 4 },           { player: 'Sergio García', score: 0 },      { player: 'Ethan Fang (a)', score: 2 }] },
  { team: 'Erik Vermilyea',      tiers: [{ player: 'Scottie Scheffler', score: -2 }, { player: 'Cameron Young', score: 1 },       { player: 'Chris Gotterup', score: 0 },     { player: 'Jacob Bridgeman', score: -1 },     { player: 'Keegan Bradley', score: 0 },     { player: 'Michael Brennan', score: 0 }] },
  { team: 'Greg Smith',          tiers: [{ player: 'Scottie Scheffler', score: -2 }, { player: 'Collin Morikawa', score: 2 },     { player: 'Justin Thomas', score: 0 },      { player: 'Gary Woodland', score: -1 },       { player: 'Sergio García', score: 0 },      { player: 'Bubba Watson', score: 4 }] },
  { team: 'Jake Bogardus',       tiers: [{ player: 'Bryson DeChambeau', score: 4 },  { player: 'Justin Rose', score: -2 },        { player: 'Si Woo Kim', score: 3 },         { player: 'Max Homa', score: 0 },             { player: 'Wyndham Clark', score: 0 },      { player: 'Bubba Watson', score: 4 }] },
  { team: 'Jake Hammer',         tiers: [{ player: 'Bryson DeChambeau', score: 4 },  { player: 'Justin Rose', score: -2 },        { player: 'Justin Thomas', score: 0 },      { player: 'J.J. Spaun', score: 2 },           { player: 'Dustin Johnson', score: 1 },     { player: 'Bubba Watson', score: 4 }] },
  { team: 'Jake Hammer 2',       tiers: [{ player: 'Ludvig Åberg', score: 2 },       { player: 'Matt Fitzpatrick', score: 2 },    { player: 'Justin Thomas', score: 0 },      { player: 'Gary Woodland', score: -1 },       { player: 'Dustin Johnson', score: 1 },     { player: 'Zach Johnson', score: 3 }] },
  { team: 'Jake Hammer 3',       tiers: [{ player: 'Scottie Scheffler', score: -2 }, { player: 'Jordan Spieth', score: 0 },       { player: 'Akshay Bhatia', score: 1 },      { player: 'Nicolai Højgaard', score: 4 },     { player: 'Sergio García', score: 0 },      { player: 'Bubba Watson', score: 4 }] },
  { team: 'Jason Damiani',       tiers: [{ player: 'Scottie Scheffler', score: -2 }, { player: 'Tommy Fleetwood', score: -1 },    { player: 'Patrick Cantlay', score: 5 },    { player: 'Corey Conners', score: 3 },        { player: 'Harry Hall', score: 5 },         { player: 'Rasmus Neergaard-Petersen', score: 5 }] },
  { team: 'Jaymes Cole',         tiers: [{ player: 'Xander Schauffele', score: -2 }, { player: 'Matt Fitzpatrick', score: 2 },    { player: 'Chris Gotterup', score: 0 },     { player: 'Cameron Smith', score: 2 },        { player: 'Nick Taylor', score: -1 },       { player: 'Bubba Watson', score: 4 }] },
  { team: 'Jeff Bagnasco',       tiers: [{ player: 'Xander Schauffele', score: -2 }, { player: 'Brooks Koepka', score: 0 },       { player: 'Chris Gotterup', score: 0 },     { player: 'Gary Woodland', score: -1 },       { player: 'Nico Echavarria', score: 7 },    { player: 'Danny Willett', score: 4 }] },
  { team: 'Jeff Bagnasco 2',     tiers: [{ player: 'Bryson DeChambeau', score: 4 },  { player: 'Tommy Fleetwood', score: -1 },    { player: 'Justin Thomas', score: 0 },      { player: 'Harris English', score: 1 },       { player: 'Keegan Bradley', score: 0 },     { player: 'Mason Howell (a)', score: 5 }] },
  { team: 'Jeff Mersch',         tiers: [{ player: 'Scottie Scheffler', score: -2 }, { player: 'Matt Fitzpatrick', score: 2 },    { player: 'Jake Knapp', score: 1 },         { player: 'Harris English', score: 1 },       { player: 'Ryan Fox', score: 5 },           { player: 'Michael Kim', score: 3 }] },
  { team: 'John Vodacek',        tiers: [{ player: 'Jon Rahm', score: 6 },           { player: 'Tommy Fleetwood', score: -1 },    { player: 'Russell Henley', score: 1 },     { player: 'Jacob Bridgeman', score: -1 },     { player: 'Matt McCarty', score: 0 },       { player: 'Rasmus Neergaard-Petersen', score: 5 }] },
  { team: 'Keith Waters',        tiers: [{ player: 'Xander Schauffele', score: -2 }, { player: 'Patrick Reed', score: -3 },       { player: 'Russell Henley', score: 1 },     { player: 'Nicolai Højgaard', score: 4 },     { player: 'Harry Hall', score: 5 },         { player: 'Bubba Watson', score: 4 }] },
  { team: 'Kevin Guilfoy',       tiers: [{ player: 'Bryson DeChambeau', score: 4 },  { player: 'Cameron Young', score: 1 },       { player: 'Viktor Hovland', score: 3 },     { player: 'J.J. Spaun', score: 2 },           { player: 'Kurt Kitayama', score: -3 },     { player: 'Charl Schwartzel', score: 3 }] },
  { team: 'Kyle sheldon',        tiers: [{ player: 'Xander Schauffele', score: -2 }, { player: 'Tommy Fleetwood', score: -1 },    { player: 'Justin Thomas', score: 0 },      { player: 'Cameron Smith', score: 2 },        { player: 'Keegan Bradley', score: 0 },     { player: 'Michael Kim', score: 3 }] },
  { team: 'Luke Stewart',        tiers: [{ player: 'Bryson DeChambeau', score: 4 },  { player: 'Tommy Fleetwood', score: -1 },    { player: 'Jake Knapp', score: 1 },         { player: 'Max Homa', score: 0 },             { player: 'Brian Harman', score: 7 },       { player: 'Bubba Watson', score: 4 }] },
  { team: 'Matt Bova',           tiers: [{ player: 'Scottie Scheffler', score: -2 }, { player: 'Hideki Matsuyama', score: 0 },    { player: 'Shane Lowry', score: -2 },       { player: 'Corey Conners', score: 3 },        { player: 'Brian Harman', score: 7 },       { player: 'Davis Riley', score: 10 }] },
  { team: 'Matt Bova 2',         tiers: [{ player: 'Ludvig Åberg', score: 2 },       { player: 'Jordan Spieth', score: 0 },       { player: 'Tyrrell Hatton', score: 2 },     { player: 'Sungjae Im', score: 4 },           { player: 'Keegan Bradley', score: 0 },     { player: 'Michael Kim', score: 3 }] },
  { team: 'matt tuck',           tiers: [{ player: 'Scottie Scheffler', score: -2 }, { player: 'Patrick Reed', score: -3 },       { player: 'Akshay Bhatia', score: 1 },      { player: 'Marco Penge', score: 4 },          { player: 'Brian Harman', score: 7 },       { player: 'Zach Johnson', score: 3 }] },
  { team: 'Mike Davis 1',        tiers: [{ player: 'Bryson DeChambeau', score: 4 },  { player: 'Justin Rose', score: -2 },        { player: 'Sepp Straka', score: 1 },        { player: 'Maverick McNealy', score: 5 },     { player: 'Keegan Bradley', score: 0 },     { player: 'Zach Johnson', score: 3 }] },
  { team: 'Mike Davis 2',        tiers: [{ player: 'Jon Rahm', score: 6 },           { player: 'Tommy Fleetwood', score: -1 },    { player: 'Shane Lowry', score: -2 },       { player: 'Max Homa', score: 0 },             { player: 'Nick Taylor', score: -1 },       { player: 'Michael Kim', score: 3 }] },
  { team: 'Mitch Pletcher',      tiers: [{ player: 'Scottie Scheffler', score: -2 }, { player: 'Brooks Koepka', score: 0 },       { player: 'Viktor Hovland', score: 3 },     { player: 'Max Homa', score: 0 },             { player: 'Alex Noren', score: 5 },         { player: 'Bubba Watson', score: 4 }] },
  { team: 'Morgan C',            tiers: [{ player: 'Jon Rahm', score: 6 },           { player: 'Patrick Reed', score: -3 },       { player: 'Jake Knapp', score: 1 },         { player: 'Nicolai Højgaard', score: 4 },     { player: 'Kurt Kitayama', score: -3 },     { player: 'Michael Kim', score: 3 }] },
  { team: 'Morgan C 2',          tiers: [{ player: 'Xander Schauffele', score: -2 }, { player: 'Matt Fitzpatrick', score: 2 },    { player: 'Min Woo Lee', score: 6 },        { player: 'Nicolai Højgaard', score: 4 },     { player: 'Casey Jarvis', score: 5 },       { player: 'Andrew Novak', score: 3 }] },
  { team: 'Myron Mayo',          tiers: [{ player: 'Jon Rahm', score: 6 },           { player: 'Patrick Reed', score: -3 },       { player: 'Min Woo Lee', score: 6 },        { player: 'Gary Woodland', score: -1 },       { player: 'Brian Harman', score: 7 },       { player: 'Michael Kim', score: 3 }] },
  { team: 'Nathan Wood',         tiers: [{ player: 'Xander Schauffele', score: -2 }, { player: 'Cameron Young', score: 1 },       { player: 'Min Woo Lee', score: 6 },        { player: 'Jacob Bridgeman', score: -1 },     { player: 'Alex Noren', score: 5 },         { player: 'Rasmus Neergaard-Petersen', score: 5 }] },
  { team: 'Nick Bova',           tiers: [{ player: 'Jon Rahm', score: 6 },           { player: 'Matt Fitzpatrick', score: 2 },    { player: 'Chris Gotterup', score: 0 },     { player: 'Nicolai Højgaard', score: 4 },     { player: 'Sergio García', score: 0 },      { player: 'Bubba Watson', score: 4 }] },
  { team: 'Nick Bova 2',         tiers: [{ player: 'Xander Schauffele', score: -2 }, { player: 'Justin Rose', score: -2 },        { player: 'Shane Lowry', score: -2 },       { player: 'Gary Woodland', score: -1 },       { player: 'Brian Harman', score: 7 },       { player: 'Michael Brennan', score: 0 }] },
  { team: 'Nik Ritter',          tiers: [{ player: 'Ludvig Åberg', score: 2 },       { player: 'Jordan Spieth', score: 0 },       { player: 'Si Woo Kim', score: 3 },         { player: 'Max Homa', score: 0 },             { player: 'Dustin Johnson', score: 1 },     { player: 'Bubba Watson', score: 4 }] },
  { team: 'Paul Raymond',        tiers: [{ player: 'Scottie Scheffler', score: -2 }, { player: 'Matt Fitzpatrick', score: 2 },    { player: 'Viktor Hovland', score: 3 },     { player: 'J.J. Spaun', score: 2 },           { player: 'Keegan Bradley', score: 0 },     { player: 'Michael Kim', score: 3 }] },
  { team: 'Paul VanDusen',       tiers: [{ player: 'Bryson DeChambeau', score: 4 },  { player: 'Justin Rose', score: -2 },        { player: 'Viktor Hovland', score: 3 },     { player: 'Jacob Bridgeman', score: -1 },     { player: 'Keegan Bradley', score: 0 },     { player: 'Johnny Keefer', score: 4 }] },
  { team: 'Robert Stephenson',   tiers: [{ player: 'Bryson DeChambeau', score: 4 },  { player: 'Justin Rose', score: -2 },        { player: 'Akshay Bhatia', score: 1 },      { player: 'Harris English', score: 1 },       { player: 'Brian Harman', score: 7 },       { player: 'Aldrich Potgieter', score: 12 }] },
  { team: 'Robert Stephenson 2', tiers: [{ player: 'Jon Rahm', score: 6 },           { player: 'Jordan Spieth', score: 0 },       { player: 'Akshay Bhatia', score: 1 },      { player: 'Max Homa', score: 0 },             { player: 'Aaron Rai', score: -1 },         { player: 'Fifa Laopakdee (a)', score: 8 }] },
  { team: 'Ron Pannullo',        tiers: [{ player: 'Scottie Scheffler', score: -2 }, { player: 'Brooks Koepka', score: 0 },       { player: 'Jake Knapp', score: 1 },         { player: 'Gary Woodland', score: -1 },       { player: 'Keegan Bradley', score: 0 },     { player: 'Bubba Watson', score: 4 }] },
  { team: 'Ryne Stone',          tiers: [{ player: 'Xander Schauffele', score: -2 }, { player: 'Tommy Fleetwood', score: -1 },    { player: 'Min Woo Lee', score: 6 },        { player: 'Corey Conners', score: 3 },        { player: 'Ryan Fox', score: 5 },           { player: 'Michael Kim', score: 3 }] },
  { team: 'Ryne Stone 2',        tiers: [{ player: 'Scottie Scheffler', score: -2 }, { player: 'Patrick Reed', score: -3 },       { player: 'Russell Henley', score: 1 },     { player: 'Corey Conners', score: 3 },        { player: 'Kurt Kitayama', score: -3 },     { player: 'Zach Johnson', score: 3 }] },
  { team: 'Sarah Crowell',       tiers: [{ player: 'Scottie Scheffler', score: -2 }, { player: 'Cameron Young', score: 1 },       { player: 'Viktor Hovland', score: 3 },     { player: 'Max Homa', score: 0 },             { player: 'Brian Harman', score: 7 },       { player: 'Bubba Watson', score: 4 }] },
  { team: 'Sean Susa',           tiers: [{ player: 'Ludvig Åberg', score: 2 },       { player: 'Tommy Fleetwood', score: -1 },    { player: 'Jake Knapp', score: 1 },         { player: 'Cameron Smith', score: 2 },        { player: 'Aaron Rai', score: -1 },         { player: 'Aldrich Potgieter', score: 12 }] },
  { team: 'Sean Susa 2',         tiers: [{ player: 'Xander Schauffele', score: -2 }, { player: 'Hideki Matsuyama', score: 0 },    { player: 'Si Woo Kim', score: 3 },         { player: 'Sungjae Im', score: 4 },           { player: 'Aaron Rai', score: -1 },         { player: 'Sami Välimäki', score: 8 }] },
  { team: 'Will letson',         tiers: [{ player: 'Ludvig Åberg', score: 2 },       { player: 'Justin Rose', score: -2 },        { player: 'Chris Gotterup', score: 0 },     { player: 'J.J. Spaun', score: 2 },           { player: 'Keegan Bradley', score: 0 },     { player: 'Vijay Singh', score: 7 }] },
  { team: 'Zach DelGandio',      tiers: [{ player: 'Xander Schauffele', score: -2 }, { player: 'Cameron Young', score: 1 },       { player: 'Min Woo Lee', score: 6 },        { player: 'Nicolai Højgaard', score: 4 },     { player: 'Casey Jarvis', score: 5 },       { player: 'Michael Kim', score: 3 }] },
  { team: 'Zach DelGandio 2',    tiers: [{ player: 'Ludvig Åberg', score: 2 },       { player: 'Matt Fitzpatrick', score: 2 },    { player: 'Jake Knapp', score: 1 },         { player: 'Corey Conners', score: 3 },        { player: 'Ryan Fox', score: 5 },           { player: 'Rasmus Neergaard-Petersen', score: 5 }] },
];

export function loadRound1Standings() {
  const container = document.getElementById('masters-day1');
  if (!container) return;

  // Compute totals, tiebreakers, and isTop4 flags for each entry
  const processed = MASTERS_2026_R1.map(entry => {
    const scores = entry.tiers.map(t => t.score);
    const sorted = [...scores].sort((a, b) => a - b);
    const total = sorted[0] + sorted[1] + sorted[2] + sorted[3];
    const fifth = sorted[4];
    const sixth = sorted[5];
    // Mark which 4 tiers count — lowest 4 scores; on ties, pick first in tier order
    const remaining = [...scores];
    const top4Indices = new Set();
    for (let pick = 0; pick < 4; pick++) {
      const min = Math.min(...remaining.filter((_, i) => !top4Indices.has(i)));
      const idx = remaining.findIndex((s, i) => s === min && !top4Indices.has(i));
      top4Indices.add(idx);
    }
    return { ...entry, total, fifth, sixth, top4Indices };
  });

  // Sort: total → 5th best → 6th best
  processed.sort((a, b) =>
    a.total !== b.total ? a.total - b.total :
    a.fifth !== b.fifth ? a.fifth - b.fifth :
    a.sixth - b.sixth
  );

  // Assign ranks — same rank only when all three tiebreakers match
  let rank = 1;
  for (let i = 0; i < processed.length; i++) {
    if (i > 0 && (
      processed[i].total !== processed[i - 1].total ||
      processed[i].fifth !== processed[i - 1].fifth ||
      processed[i].sixth !== processed[i - 1].sixth
    )) rank = i + 1;
    processed[i].rank = rank;
  }

  const medals = ['🥇', '🥈', '🥉'];
  const rows = processed.map(entry => {
    const rankDisplay = entry.rank <= 3 ? medals[entry.rank - 1] : entry.rank;
    const rankClass = entry.rank <= 3 ? `rank-${entry.rank}` : '';
    const totalCls = scoreClass(entry.total, null);
    const tierCells = entry.tiers.map((t, i) => {
      const cls = scoreClass(t.score, null);
      const label = formatScore(t.score, null);
      const top4Class = entry.top4Indices.has(i) ? 'top-4-pick' : '';
      return `<td class="col-tier ${top4Class}" title="${escapeHtml(t.player)}"><div class="tier-cell-card"><span class="player-name-cell">${shortName(t.player)}</span><small class="score-val ${cls}">${label}</small></div></td>`;
    }).join('');
    const allPlayers = entry.tiers.map(t => t.player).join(' ');
    return `
      <tr data-entry="${escapeHtml(entry.team).toLowerCase()}" data-players="${escapeHtml(allPlayers).toLowerCase()}">
        <td class="col-rank ${rankClass}">${rankDisplay}</td>
        <td class="col-name">${escapeHtml(entry.team)}</td>
        <td class="col-total"><span class="score-val ${totalCls}">${formatScore(entry.total, null)}</span></td>
        ${tierCells}
      </tr>`;
  }).join('');

  container.innerHTML = `
    <div class="search-bar">
      <input type="text" id="r1Search" class="standings-search" placeholder="Search entry name or player..." />
    </div>
    <div class="table-wrapper">
      <table class="standings-table">
        <thead>
          <tr>
            <th>Rank</th><th>Entry</th><th>R1 Total</th>
            <th>Tier 1</th><th>Tier 2</th><th>Tier 3</th><th>Tier 4</th><th>Tier 5</th><th>Tier 6</th>
          </tr>
        </thead>
        <tbody id="r1StandingsBody">${rows}</tbody>
      </table>
    </div>`;

  document.getElementById('r1Search').addEventListener('input', e => {
    const q = e.target.value.toLowerCase().trim();
    document.querySelectorAll('#r1StandingsBody tr').forEach(row => {
      const entry = row.dataset.entry || '';
      const players = row.dataset.players || '';
      row.style.display = (!q || entry.includes(q) || players.includes(q)) ? '' : 'none';
    });
  });
}

// ─── Masters 2026 Round 2 Standings ──────────────────────────────────────────
const MASTERS_2026_R2 = [
  { team: 'Bobby Cross',         tiers: [{ player: 'Scottie Scheffler', score: 2 },  { player: 'Tommy Fleetwood', score: -4 },    { player: 'Si Woo Kim', score: 1 },         { player: 'J.J. Spaun', score: 3 },           { player: 'Wyndham Clark', score: -4 },     { player: 'Zach Johnson', score: 3 }] },
  { team: 'Bobby Cross 2',       tiers: [{ player: 'Ludvig Åberg', score: -2 },      { player: 'Brooks Koepka', score: -3 },      { player: 'Akshay Bhatia', score: 5 },      { player: 'Daniel Berger', score: 4 },        { player: 'Alex Noren', score: -1 },        { player: 'Michael Kim', score: 5 }] },
  { team: 'Brandon Sullivan',    tiers: [{ player: 'Ludvig Åberg', score: -2 },      { player: 'Tommy Fleetwood', score: -4 },    { player: 'Jake Knapp', score: -3 },        { player: 'Max Homa', score: -2 },            { player: 'Brian Harman', score: -3 },      { player: 'Andrew Novak', score: 4 }] },
  { team: 'Brandon Syde',        tiers: [{ player: 'Jon Rahm', score: -2 },          { player: 'Justin Rose', score: -3 },        { player: 'Akshay Bhatia', score: 5 },      { player: 'Max Homa', score: -2 },            { player: 'Keegan Bradley', score: 2 },     { player: 'Charl Schwartzel', score: 1 }] },
  { team: 'Brandon Syde 2',      tiers: [{ player: 'Scottie Scheffler', score: 2 },  { player: 'Collin Morikawa', score: -3 },    { player: 'Sepp Straka', score: 0 },        { player: 'Ben Griffin', score: -3 },         { player: 'Dustin Johnson', score: -1 },    { player: 'Bubba Watson', score: 1 }] },
  { team: 'Cassady Glenn',       tiers: [{ player: 'Jon Rahm', score: -2 },          { player: 'Cameron Young', score: -5 },      { player: 'Min Woo Lee', score: 5 },        { player: 'Corey Conners', score: 1 },        { player: 'Kurt Kitayama', score: 7 },      { player: 'Michael Kim', score: 5 }] },
  { team: 'Chris Merkel',        tiers: [{ player: 'Rory McIlroy', score: -7 },      { player: 'Collin Morikawa', score: -3 },    { player: 'Akshay Bhatia', score: 5 },      { player: 'Daniel Berger', score: 4 },        { player: 'Brian Harman', score: -3 },      { player: 'Davis Riley', score: 8 }] },
  { team: 'Chris schumann',      tiers: [{ player: 'Ludvig Åberg', score: -2 },      { player: 'Tommy Fleetwood', score: -4 },    { player: 'Min Woo Lee', score: 5 },        { player: 'Nicolai Højgaard', score: 2 },     { player: 'Sam Stevens', score: 2 },        { player: 'Michael Kim', score: 5 }] },
  { team: 'Cody Esbrandt',       tiers: [{ player: 'Bryson DeChambeau', score: 2 },  { player: 'Justin Rose', score: -3 },        { player: 'Adam Scott', score: 2 },         { player: 'Sungjae Im', score: -3 },          { player: 'Sergio García', score: 3 },      { player: 'Ethan Fang (a)', score: 6 }] },
  { team: 'Erik Vermilyea',      tiers: [{ player: 'Scottie Scheffler', score: 2 },  { player: 'Cameron Young', score: -5 },      { player: 'Chris Gotterup', score: -3 },    { player: 'Jacob Bridgeman', score: 2 },      { player: 'Keegan Bradley', score: 2 },     { player: 'Michael Brennan', score: -1 }] },
  { team: 'Greg Smith',          tiers: [{ player: 'Scottie Scheffler', score: 2 },  { player: 'Collin Morikawa', score: -3 },    { player: 'Justin Thomas', score: 2 },      { player: 'Gary Woodland', score: 3 },        { player: 'Sergio García', score: 3 },      { player: 'Bubba Watson', score: 1 }] },
  { team: 'Jake Bogardus',       tiers: [{ player: 'Bryson DeChambeau', score: 2 },  { player: 'Justin Rose', score: -3 },        { player: 'Si Woo Kim', score: 1 },         { player: 'Max Homa', score: -2 },            { player: 'Wyndham Clark', score: -4 },     { player: 'Bubba Watson', score: 1 }] },
  { team: 'Jake Hammer',         tiers: [{ player: 'Bryson DeChambeau', score: 2 },  { player: 'Justin Rose', score: -3 },        { player: 'Justin Thomas', score: 2 },      { player: 'J.J. Spaun', score: 3 },           { player: 'Dustin Johnson', score: -1 },    { player: 'Bubba Watson', score: 1 }] },
  { team: 'Jake Hammer 2',       tiers: [{ player: 'Ludvig Åberg', score: -2 },      { player: 'Matt Fitzpatrick', score: -3 },   { player: 'Justin Thomas', score: 2 },      { player: 'Gary Woodland', score: 3 },        { player: 'Dustin Johnson', score: -1 },    { player: 'Zach Johnson', score: 3 }] },
  { team: 'Jake Hammer 3',       tiers: [{ player: 'Scottie Scheffler', score: 2 },  { player: 'Jordan Spieth', score: 1 },       { player: 'Akshay Bhatia', score: 5 },      { player: 'Nicolai Højgaard', score: 2 },     { player: 'Sergio García', score: 3 },      { player: 'Bubba Watson', score: 1 }] },
  { team: 'Jason Damiani',       tiers: [{ player: 'Scottie Scheffler', score: 2 },  { player: 'Tommy Fleetwood', score: -4 },    { player: 'Patrick Cantlay', score: -5 },   { player: 'Corey Conners', score: 1 },        { player: 'Harry Hall', score: 0 },         { player: 'Rasmus Neergaard-Petersen', score: 2 }] },
  { team: 'Jaymes Cole',         tiers: [{ player: 'Xander Schauffele', score: 0 },  { player: 'Matt Fitzpatrick', score: -3 },   { player: 'Chris Gotterup', score: -3 },    { player: 'Cameron Smith', score: 5 },        { player: 'Nick Taylor', score: 0 },        { player: 'Bubba Watson', score: 1 }] },
  { team: 'Jeff Bagnasco',       tiers: [{ player: 'Xander Schauffele', score: 0 },  { player: 'Brooks Koepka', score: -3 },      { player: 'Chris Gotterup', score: -3 },    { player: 'Gary Woodland', score: 3 },        { player: 'Nico Echavarria', score: 6 },    { player: 'Danny Willett', score: 1 }] },
  { team: 'Jeff Bagnasco 2',     tiers: [{ player: 'Bryson DeChambeau', score: 2 },  { player: 'Tommy Fleetwood', score: -4 },    { player: 'Justin Thomas', score: 2 },      { player: 'Harris English', score: -1 },      { player: 'Keegan Bradley', score: 2 },     { player: 'Mason Howell (a)', score: 4 }] },
  { team: 'Jeff Mersch',         tiers: [{ player: 'Scottie Scheffler', score: 2 },  { player: 'Matt Fitzpatrick', score: -3 },   { player: 'Jake Knapp', score: -3 },        { player: 'Harris English', score: -1 },      { player: 'Ryan Fox', score: 0 },           { player: 'Michael Kim', score: 5 }] },
  { team: 'John Vodacek',        tiers: [{ player: 'Jon Rahm', score: -2 },          { player: 'Tommy Fleetwood', score: -4 },    { player: 'Russell Henley', score: -1 },    { player: 'Jacob Bridgeman', score: 2 },      { player: 'Matt McCarty', score: 1 },       { player: 'Rasmus Neergaard-Petersen', score: 2 }] },
  { team: 'Keith Waters',        tiers: [{ player: 'Xander Schauffele', score: 0 },  { player: 'Patrick Reed', score: -3 },       { player: 'Russell Henley', score: -1 },    { player: 'Nicolai Højgaard', score: 2 },     { player: 'Harry Hall', score: 0 },         { player: 'Bubba Watson', score: 1 }] },
  { team: 'Kevin Guilfoy',       tiers: [{ player: 'Bryson DeChambeau', score: 2 },  { player: 'Cameron Young', score: -5 },      { player: 'Viktor Hovland', score: -1 },    { player: 'J.J. Spaun', score: 3 },           { player: 'Kurt Kitayama', score: 7 },      { player: 'Charl Schwartzel', score: 1 }] },
  { team: 'Kyle sheldon',        tiers: [{ player: 'Xander Schauffele', score: 0 },  { player: 'Tommy Fleetwood', score: -4 },    { player: 'Justin Thomas', score: 2 },      { player: 'Cameron Smith', score: 5 },        { player: 'Keegan Bradley', score: 2 },     { player: 'Michael Kim', score: 5 }] },
  { team: 'Luke Stewart',        tiers: [{ player: 'Bryson DeChambeau', score: 2 },  { player: 'Tommy Fleetwood', score: -4 },    { player: 'Jake Knapp', score: -3 },        { player: 'Max Homa', score: -2 },            { player: 'Brian Harman', score: -3 },      { player: 'Bubba Watson', score: 1 }] },
  { team: 'Matt Bova',           tiers: [{ player: 'Scottie Scheffler', score: 2 },  { player: 'Hideki Matsuyama', score: -2 },   { player: 'Shane Lowry', score: -3 },       { player: 'Corey Conners', score: 1 },        { player: 'Brian Harman', score: -3 },      { player: 'Davis Riley', score: 8 }] },
  { team: 'Matt Bova 2',         tiers: [{ player: 'Ludvig Åberg', score: -2 },      { player: 'Jordan Spieth', score: 1 },       { player: 'Tyrrell Hatton', score: -6 },    { player: 'Sungjae Im', score: -3 },          { player: 'Keegan Bradley', score: 2 },     { player: 'Michael Kim', score: 5 }] },
  { team: 'matt tuck',           tiers: [{ player: 'Scottie Scheffler', score: 2 },  { player: 'Patrick Reed', score: -3 },       { player: 'Akshay Bhatia', score: 5 },      { player: 'Marco Penge', score: -3 },         { player: 'Brian Harman', score: -3 },      { player: 'Zach Johnson', score: 3 }] },
  { team: 'Mike Davis 1',        tiers: [{ player: 'Bryson DeChambeau', score: 2 },  { player: 'Justin Rose', score: -3 },        { player: 'Sepp Straka', score: 0 },        { player: 'Maverick McNealy', score: -2 },    { player: 'Keegan Bradley', score: 2 },     { player: 'Zach Johnson', score: 3 }] },
  { team: 'Mike Davis 2',        tiers: [{ player: 'Jon Rahm', score: -2 },          { player: 'Tommy Fleetwood', score: -4 },    { player: 'Shane Lowry', score: -3 },       { player: 'Max Homa', score: -2 },            { player: 'Nick Taylor', score: 0 },        { player: 'Michael Kim', score: 5 }] },
  { team: 'Mitch Pletcher',      tiers: [{ player: 'Scottie Scheffler', score: 2 },  { player: 'Brooks Koepka', score: -3 },      { player: 'Viktor Hovland', score: -1 },    { player: 'Max Homa', score: -2 },            { player: 'Alex Noren', score: -1 },        { player: 'Bubba Watson', score: 1 }] },
  { team: 'Morgan C',            tiers: [{ player: 'Jon Rahm', score: -2 },          { player: 'Patrick Reed', score: -3 },       { player: 'Jake Knapp', score: -3 },        { player: 'Nicolai Højgaard', score: 2 },     { player: 'Kurt Kitayama', score: 7 },      { player: 'Michael Kim', score: 5 }] },
  { team: 'Morgan C 2',          tiers: [{ player: 'Xander Schauffele', score: 0 },  { player: 'Matt Fitzpatrick', score: -3 },   { player: 'Min Woo Lee', score: 5 },        { player: 'Nicolai Højgaard', score: 2 },     { player: 'Casey Jarvis', score: 3 },       { player: 'Andrew Novak', score: 4 }] },
  { team: 'Myron Mayo',          tiers: [{ player: 'Jon Rahm', score: -2 },          { player: 'Patrick Reed', score: -3 },       { player: 'Min Woo Lee', score: 5 },        { player: 'Gary Woodland', score: 3 },        { player: 'Brian Harman', score: -3 },      { player: 'Michael Kim', score: 5 }] },
  { team: 'Nathan Wood',         tiers: [{ player: 'Xander Schauffele', score: 0 },  { player: 'Cameron Young', score: -5 },      { player: 'Min Woo Lee', score: 5 },        { player: 'Jacob Bridgeman', score: 2 },      { player: 'Alex Noren', score: -1 },        { player: 'Rasmus Neergaard-Petersen', score: 2 }] },
  { team: 'Nick Bova',           tiers: [{ player: 'Jon Rahm', score: -2 },          { player: 'Matt Fitzpatrick', score: -3 },   { player: 'Chris Gotterup', score: -3 },    { player: 'Nicolai Højgaard', score: 2 },     { player: 'Sergio García', score: 3 },      { player: 'Bubba Watson', score: 1 }] },
  { team: 'Nick Bova 2',         tiers: [{ player: 'Xander Schauffele', score: 0 },  { player: 'Justin Rose', score: -3 },        { player: 'Shane Lowry', score: -3 },       { player: 'Gary Woodland', score: 3 },        { player: 'Brian Harman', score: -3 },      { player: 'Michael Brennan', score: -1 }] },
  { team: 'Nik Ritter',          tiers: [{ player: 'Ludvig Åberg', score: -2 },      { player: 'Jordan Spieth', score: 1 },       { player: 'Si Woo Kim', score: 1 },         { player: 'Max Homa', score: -2 },            { player: 'Dustin Johnson', score: -1 },    { player: 'Bubba Watson', score: 1 }] },
  { team: 'Paul Raymond',        tiers: [{ player: 'Scottie Scheffler', score: 2 },  { player: 'Matt Fitzpatrick', score: -3 },   { player: 'Viktor Hovland', score: -1 },    { player: 'J.J. Spaun', score: 3 },           { player: 'Keegan Bradley', score: 2 },     { player: 'Michael Kim', score: 5 }] },
  { team: 'Paul VanDusen',       tiers: [{ player: 'Bryson DeChambeau', score: 2 },  { player: 'Justin Rose', score: -3 },        { player: 'Viktor Hovland', score: -1 },    { player: 'Jacob Bridgeman', score: 2 },      { player: 'Keegan Bradley', score: 2 },     { player: 'Johnny Keefer', score: 7 }] },
  { team: 'Robert Stephenson',   tiers: [{ player: 'Bryson DeChambeau', score: 2 },  { player: 'Justin Rose', score: -3 },        { player: 'Akshay Bhatia', score: 5 },      { player: 'Harris English', score: -1 },      { player: 'Brian Harman', score: -3 },      { player: 'Aldrich Potgieter', score: 3 }] },
  { team: 'Robert Stephenson 2', tiers: [{ player: 'Jon Rahm', score: -2 },          { player: 'Jordan Spieth', score: 1 },       { player: 'Akshay Bhatia', score: 5 },      { player: 'Max Homa', score: -2 },            { player: 'Aaron Rai', score: 2 },          { player: 'Fifa Laopakdee (a)', score: 3 }] },
  { team: 'Ron Pannullo',        tiers: [{ player: 'Scottie Scheffler', score: 2 },  { player: 'Brooks Koepka', score: -3 },      { player: 'Jake Knapp', score: -3 },        { player: 'Gary Woodland', score: 3 },        { player: 'Keegan Bradley', score: 2 },     { player: 'Bubba Watson', score: 1 }] },
  { team: 'Ryne Stone',          tiers: [{ player: 'Xander Schauffele', score: 0 },  { player: 'Tommy Fleetwood', score: -4 },    { player: 'Min Woo Lee', score: 5 },        { player: 'Corey Conners', score: 1 },        { player: 'Ryan Fox', score: 0 },           { player: 'Michael Kim', score: 5 }] },
  { team: 'Ryne Stone 2',        tiers: [{ player: 'Scottie Scheffler', score: 2 },  { player: 'Patrick Reed', score: -3 },       { player: 'Russell Henley', score: -1 },    { player: 'Corey Conners', score: 1 },        { player: 'Kurt Kitayama', score: 7 },      { player: 'Zach Johnson', score: 3 }] },
  { team: 'Sarah Crowell',       tiers: [{ player: 'Scottie Scheffler', score: 2 },  { player: 'Cameron Young', score: -5 },      { player: 'Viktor Hovland', score: -1 },    { player: 'Max Homa', score: -2 },            { player: 'Brian Harman', score: -3 },      { player: 'Bubba Watson', score: 1 }] },
  { team: 'Sean Susa',           tiers: [{ player: 'Ludvig Åberg', score: -2 },      { player: 'Tommy Fleetwood', score: -4 },    { player: 'Jake Knapp', score: -3 },        { player: 'Cameron Smith', score: 5 },        { player: 'Aaron Rai', score: 2 },          { player: 'Aldrich Potgieter', score: 3 }] },
  { team: 'Sean Susa 2',         tiers: [{ player: 'Xander Schauffele', score: 0 },  { player: 'Hideki Matsuyama', score: -2 },   { player: 'Si Woo Kim', score: 1 },         { player: 'Sungjae Im', score: -3 },          { player: 'Aaron Rai', score: 2 },          { player: 'Sami Välimäki', score: 3 }] },
  { team: 'Will letson',         tiers: [{ player: 'Ludvig Åberg', score: -2 },      { player: 'Justin Rose', score: -3 },        { player: 'Chris Gotterup', score: -3 },    { player: 'J.J. Spaun', score: 3 },           { player: 'Keegan Bradley', score: 2 },     { player: 'Vijay Singh', score: 3 }] },
  { team: 'Zach DelGandio',      tiers: [{ player: 'Xander Schauffele', score: 0 },  { player: 'Cameron Young', score: -5 },      { player: 'Min Woo Lee', score: 5 },        { player: 'Nicolai Højgaard', score: 2 },     { player: 'Casey Jarvis', score: 3 },       { player: 'Michael Kim', score: 5 }] },
  { team: 'Zach DelGandio 2',    tiers: [{ player: 'Ludvig Åberg', score: -2 },      { player: 'Matt Fitzpatrick', score: -3 },   { player: 'Jake Knapp', score: -3 },        { player: 'Corey Conners', score: 1 },        { player: 'Ryan Fox', score: 0 },           { player: 'Rasmus Neergaard-Petersen', score: 2 }] },
];

export function loadRound2Standings() {
  const container = document.getElementById('masters-day2');
  if (!container) return;

  const processed = MASTERS_2026_R2.map(entry => {
    const scores = entry.tiers.map(t => t.score);
    const sorted = [...scores].sort((a, b) => a - b);
    const total = sorted[0] + sorted[1] + sorted[2] + sorted[3];
    const fifth = sorted[4];
    const sixth = sorted[5];
    const top4Indices = new Set();
    for (let pick = 0; pick < 4; pick++) {
      const min = Math.min(...scores.filter((_, i) => !top4Indices.has(i)));
      const idx = scores.findIndex((s, i) => s === min && !top4Indices.has(i));
      top4Indices.add(idx);
    }
    return { ...entry, total, fifth, sixth, top4Indices };
  });

  processed.sort((a, b) =>
    a.total !== b.total ? a.total - b.total :
    a.fifth !== b.fifth ? a.fifth - b.fifth :
    a.sixth - b.sixth
  );

  let rank = 1;
  for (let i = 0; i < processed.length; i++) {
    if (i > 0 && (
      processed[i].total !== processed[i - 1].total ||
      processed[i].fifth !== processed[i - 1].fifth ||
      processed[i].sixth !== processed[i - 1].sixth
    )) rank = i + 1;
    processed[i].rank = rank;
  }

  const medals = ['🥇', '🥈', '🥉'];
  const rows = processed.map(entry => {
    const rankDisplay = entry.rank <= 3 ? medals[entry.rank - 1] : entry.rank;
    const rankClass = entry.rank <= 3 ? `rank-${entry.rank}` : '';
    const totalCls = scoreClass(entry.total, null);
    const tierCells = entry.tiers.map((t, i) => {
      const cls = scoreClass(t.score, null);
      const label = formatScore(t.score, null);
      const top4Class = entry.top4Indices.has(i) ? 'top-4-pick' : '';
      return `<td class="col-tier ${top4Class}" title="${escapeHtml(t.player)}"><div class="tier-cell-card"><span class="player-name-cell">${shortName(t.player)}</span><small class="score-val ${cls}">${label}</small></div></td>`;
    }).join('');
    const allPlayers = entry.tiers.map(t => t.player).join(' ');
    return `
      <tr data-entry="${escapeHtml(entry.team).toLowerCase()}" data-players="${escapeHtml(allPlayers).toLowerCase()}">
        <td class="col-rank ${rankClass}">${rankDisplay}</td>
        <td class="col-name">${escapeHtml(entry.team)}</td>
        <td class="col-total"><span class="score-val ${totalCls}">${formatScore(entry.total, null)}</span></td>
        ${tierCells}
      </tr>`;
  }).join('');

  container.innerHTML = `
    <div class="search-bar">
      <input type="text" id="r2Search" class="standings-search" placeholder="Search entry name or player..." />
    </div>
    <div class="table-wrapper">
      <table class="standings-table">
        <thead>
          <tr>
            <th>Rank</th><th>Entry</th><th>R2 Total</th>
            <th>Tier 1</th><th>Tier 2</th><th>Tier 3</th><th>Tier 4</th><th>Tier 5</th><th>Tier 6</th>
          </tr>
        </thead>
        <tbody id="r2StandingsBody">${rows}</tbody>
      </table>
    </div>`;

  document.getElementById('r2Search').addEventListener('input', e => {
    const q = e.target.value.toLowerCase().trim();
    document.querySelectorAll('#r2StandingsBody tr').forEach(row => {
      const entry = row.dataset.entry || '';
      const players = row.dataset.players || '';
      row.style.display = (!q || entry.includes(q) || players.includes(q)) ? '' : 'none';
    });
  });
}

// ─── Masters 2026 Round 3 Standings ──────────────────────────────────────────
const MASTERS_2026_R3 = [
  { team: 'Bobby Cross',         tiers: [{ player: 'Scottie Scheffler', score: -7 }, { player: 'Tommy Fleetwood', score: 1 },     { player: 'Si Woo Kim', score: 0 },         { player: 'J.J. Spaun', score: 3 },           { player: 'Wyndham Clark', score: 0 },      { player: 'Zach Johnson', score: 3 }] },
  { team: 'Bobby Cross 2',       tiers: [{ player: 'Ludvig Åberg', score: -3 },      { player: 'Brooks Koepka', score: -1 },      { player: 'Akshay Bhatia', score: 3 },      { player: 'Daniel Berger', score: 4 },        { player: 'Alex Noren', score: -3 },        { player: 'Michael Kim', score: 4 }] },
  { team: 'Brandon Sullivan',    tiers: [{ player: 'Ludvig Åberg', score: -3 },      { player: 'Tommy Fleetwood', score: 1 },     { player: 'Jake Knapp', score: -3 },        { player: 'Max Homa', score: -1 },            { player: 'Brian Harman', score: -5 },      { player: 'Andrew Novak', score: 4 }] },
  { team: 'Brandon Syde',        tiers: [{ player: 'Jon Rahm', score: 1 },           { player: 'Justin Rose', score: -3 },        { player: 'Akshay Bhatia', score: 3 },      { player: 'Max Homa', score: -1 },            { player: 'Keegan Bradley', score: 1 },     { player: 'Charl Schwartzel', score: 5 }] },
  { team: 'Brandon Syde 2',      tiers: [{ player: 'Scottie Scheffler', score: -7 }, { player: 'Collin Morikawa', score: -4 },    { player: 'Sepp Straka', score: -3 },       { player: 'Ben Griffin', score: -2 },         { player: 'Dustin Johnson', score: 3 },     { player: 'Bubba Watson', score: 3 }] },
  { team: 'Cassady Glenn',       tiers: [{ player: 'Jon Rahm', score: 1 },           { player: 'Cameron Young', score: -7 },      { player: 'Min Woo Lee', score: 6 },        { player: 'Corey Conners', score: -1 },       { player: 'Kurt Kitayama', score: 3 },      { player: 'Michael Kim', score: 4 }] },
  { team: 'Chris Merkel',        tiers: [{ player: 'Rory McIlroy', score: 1 },       { player: 'Collin Morikawa', score: -4 },    { player: 'Akshay Bhatia', score: 3 },      { player: 'Daniel Berger', score: 4 },        { player: 'Brian Harman', score: -5 },      { player: 'Davis Riley', score: 9 }] },
  { team: 'Chris schumann',      tiers: [{ player: 'Ludvig Åberg', score: -3 },      { player: 'Tommy Fleetwood', score: 1 },     { player: 'Min Woo Lee', score: 6 },        { player: 'Nicolai Højgaard', score: 3 },     { player: 'Sam Stevens', score: -2 },       { player: 'Michael Kim', score: 4 }] },
  { team: 'Cody Esbrandt',       tiers: [{ player: 'Bryson DeChambeau', score: 3 },  { player: 'Justin Rose', score: -3 },        { player: 'Adam Scott', score: -2 },        { player: 'Sungjae Im', score: -3 },          { player: 'Sergio García', score: 2 },      { player: 'Ethan Fang (a)', score: 4 }] },
  { team: 'Erik Vermilyea',      tiers: [{ player: 'Scottie Scheffler', score: -7 }, { player: 'Cameron Young', score: -7 },      { player: 'Chris Gotterup', score: 0 },     { player: 'Jacob Bridgeman', score: -3 },     { player: 'Keegan Bradley', score: 1 },     { player: 'Michael Brennan', score: -2 }] },
  { team: 'Greg Smith',          tiers: [{ player: 'Scottie Scheffler', score: -7 }, { player: 'Collin Morikawa', score: -4 },    { player: 'Justin Thomas', score: -1 },     { player: 'Gary Woodland', score: 4 },        { player: 'Sergio García', score: 2 },      { player: 'Bubba Watson', score: 3 }] },
  { team: 'Jake Bogardus',       tiers: [{ player: 'Bryson DeChambeau', score: 3 },  { player: 'Justin Rose', score: -3 },        { player: 'Si Woo Kim', score: 0 },         { player: 'Max Homa', score: -1 },            { player: 'Wyndham Clark', score: 0 },      { player: 'Bubba Watson', score: 3 }] },
  { team: 'Jake Hammer',         tiers: [{ player: 'Bryson DeChambeau', score: 3 },  { player: 'Justin Rose', score: -3 },        { player: 'Justin Thomas', score: -1 },     { player: 'J.J. Spaun', score: 3 },           { player: 'Dustin Johnson', score: 3 },     { player: 'Bubba Watson', score: 3 }] },
  { team: 'Jake Hammer 2',       tiers: [{ player: 'Ludvig Åberg', score: -3 },      { player: 'Matt Fitzpatrick', score: -2 },   { player: 'Justin Thomas', score: -1 },     { player: 'Gary Woodland', score: 4 },        { player: 'Dustin Johnson', score: 3 },     { player: 'Zach Johnson', score: 3 }] },
  { team: 'Jake Hammer 3',       tiers: [{ player: 'Scottie Scheffler', score: -7 }, { player: 'Jordan Spieth', score: -2 },      { player: 'Akshay Bhatia', score: 3 },      { player: 'Nicolai Højgaard', score: 3 },     { player: 'Sergio García', score: 2 },      { player: 'Bubba Watson', score: 3 }] },
  { team: 'Jason Damiani',       tiers: [{ player: 'Scottie Scheffler', score: -7 }, { player: 'Tommy Fleetwood', score: 1 },     { player: 'Patrick Cantlay', score: -6 },   { player: 'Corey Conners', score: -1 },       { player: 'Harry Hall', score: 3 },         { player: 'Rasmus Neergaard-Petersen', score: 4 }] },
  { team: 'Jaymes Cole',         tiers: [{ player: 'Xander Schauffele', score: -2 }, { player: 'Matt Fitzpatrick', score: -2 },   { player: 'Chris Gotterup', score: 0 },     { player: 'Cameron Smith', score: 4 },        { player: 'Nick Taylor', score: -2 },       { player: 'Bubba Watson', score: 3 }] },
  { team: 'Jeff Bagnasco',       tiers: [{ player: 'Xander Schauffele', score: -2 }, { player: 'Brooks Koepka', score: -1 },      { player: 'Chris Gotterup', score: 0 },     { player: 'Gary Woodland', score: 4 },        { player: 'Nico Echavarria', score: 7 },    { player: 'Danny Willett', score: 3 }] },
  { team: 'Jeff Bagnasco 2',     tiers: [{ player: 'Bryson DeChambeau', score: 3 },  { player: 'Tommy Fleetwood', score: 1 },     { player: 'Justin Thomas', score: -1 },     { player: 'Harris English', score: -1 },      { player: 'Keegan Bradley', score: 1 },     { player: 'Mason Howell (a)', score: 5 }] },
  { team: 'Jeff Mersch',         tiers: [{ player: 'Scottie Scheffler', score: -7 }, { player: 'Matt Fitzpatrick', score: -2 },   { player: 'Jake Knapp', score: -3 },        { player: 'Harris English', score: -1 },      { player: 'Ryan Fox', score: 3 },           { player: 'Michael Kim', score: 4 }] },
  { team: 'John Vodacek',        tiers: [{ player: 'Jon Rahm', score: 1 },           { player: 'Tommy Fleetwood', score: 1 },     { player: 'Russell Henley', score: -6 },    { player: 'Jacob Bridgeman', score: -3 },     { player: 'Matt McCarty', score: 0 },       { player: 'Rasmus Neergaard-Petersen', score: 4 }] },
  { team: 'Keith Waters',        tiers: [{ player: 'Xander Schauffele', score: -2 }, { player: 'Patrick Reed', score: 0 },        { player: 'Russell Henley', score: -6 },    { player: 'Nicolai Højgaard', score: 3 },     { player: 'Harry Hall', score: 3 },         { player: 'Bubba Watson', score: 3 }] },
  { team: 'Kevin Guilfoy',       tiers: [{ player: 'Bryson DeChambeau', score: 3 },  { player: 'Cameron Young', score: -7 },      { player: 'Viktor Hovland', score: -1 },    { player: 'J.J. Spaun', score: 3 },           { player: 'Kurt Kitayama', score: 3 },      { player: 'Charl Schwartzel', score: 5 }] },
  { team: 'Kyle sheldon',        tiers: [{ player: 'Xander Schauffele', score: -2 }, { player: 'Tommy Fleetwood', score: 1 },     { player: 'Justin Thomas', score: -1 },     { player: 'Cameron Smith', score: 4 },        { player: 'Keegan Bradley', score: 1 },     { player: 'Michael Kim', score: 4 }] },
  { team: 'Luke Stewart',        tiers: [{ player: 'Bryson DeChambeau', score: 3 },  { player: 'Tommy Fleetwood', score: 1 },     { player: 'Jake Knapp', score: -3 },        { player: 'Max Homa', score: -1 },            { player: 'Brian Harman', score: -5 },      { player: 'Bubba Watson', score: 3 }] },
  { team: 'Matt Bova',           tiers: [{ player: 'Scottie Scheffler', score: -7 }, { player: 'Hideki Matsuyama', score: 0 },    { player: 'Shane Lowry', score: -4 },       { player: 'Corey Conners', score: -1 },       { player: 'Brian Harman', score: -5 },      { player: 'Davis Riley', score: 9 }] },
  { team: 'Matt Bova 2',         tiers: [{ player: 'Ludvig Åberg', score: -3 },      { player: 'Jordan Spieth', score: -2 },      { player: 'Tyrrell Hatton', score: 0 },     { player: 'Sungjae Im', score: -3 },          { player: 'Keegan Bradley', score: 1 },     { player: 'Michael Kim', score: 4 }] },
  { team: 'matt tuck',           tiers: [{ player: 'Scottie Scheffler', score: -7 }, { player: 'Patrick Reed', score: 0 },        { player: 'Akshay Bhatia', score: 3 },      { player: 'Marco Penge', score: -1 },         { player: 'Brian Harman', score: -5 },      { player: 'Zach Johnson', score: 3 }] },
  { team: 'Mike Davis 1',        tiers: [{ player: 'Bryson DeChambeau', score: 3 },  { player: 'Justin Rose', score: -3 },        { player: 'Sepp Straka', score: -3 },       { player: 'Maverick McNealy', score: -2 },    { player: 'Keegan Bradley', score: 1 },     { player: 'Zach Johnson', score: 3 }] },
  { team: 'Mike Davis 2',        tiers: [{ player: 'Jon Rahm', score: 1 },           { player: 'Tommy Fleetwood', score: 1 },     { player: 'Shane Lowry', score: -4 },       { player: 'Max Homa', score: -1 },            { player: 'Nick Taylor', score: -2 },       { player: 'Michael Kim', score: 4 }] },
  { team: 'Mitch Pletcher',      tiers: [{ player: 'Scottie Scheffler', score: -7 }, { player: 'Brooks Koepka', score: -1 },      { player: 'Viktor Hovland', score: -1 },    { player: 'Max Homa', score: -1 },            { player: 'Alex Noren', score: -3 },        { player: 'Bubba Watson', score: 3 }] },
  { team: 'Morgan C',            tiers: [{ player: 'Jon Rahm', score: 1 },           { player: 'Patrick Reed', score: 0 },        { player: 'Jake Knapp', score: -3 },        { player: 'Nicolai Højgaard', score: 3 },     { player: 'Kurt Kitayama', score: 3 },      { player: 'Michael Kim', score: 4 }] },
  { team: 'Morgan C 2',          tiers: [{ player: 'Xander Schauffele', score: -2 }, { player: 'Matt Fitzpatrick', score: -2 },   { player: 'Min Woo Lee', score: 6 },        { player: 'Nicolai Højgaard', score: 3 },     { player: 'Casey Jarvis', score: 4 },       { player: 'Andrew Novak', score: 4 }] },
  { team: 'Myron Mayo',          tiers: [{ player: 'Jon Rahm', score: 1 },           { player: 'Patrick Reed', score: 0 },        { player: 'Min Woo Lee', score: 6 },        { player: 'Gary Woodland', score: 4 },        { player: 'Brian Harman', score: -5 },      { player: 'Michael Kim', score: 4 }] },
  { team: 'Nathan Wood',         tiers: [{ player: 'Xander Schauffele', score: -2 }, { player: 'Cameron Young', score: -7 },      { player: 'Min Woo Lee', score: 6 },        { player: 'Jacob Bridgeman', score: -3 },     { player: 'Alex Noren', score: -3 },        { player: 'Rasmus Neergaard-Petersen', score: 4 }] },
  { team: 'Nick Bova',           tiers: [{ player: 'Jon Rahm', score: 1 },           { player: 'Matt Fitzpatrick', score: -2 },   { player: 'Chris Gotterup', score: 0 },     { player: 'Nicolai Højgaard', score: 3 },     { player: 'Sergio García', score: 2 },      { player: 'Bubba Watson', score: 3 }] },
  { team: 'Nick Bova 2',         tiers: [{ player: 'Xander Schauffele', score: -2 }, { player: 'Justin Rose', score: -3 },        { player: 'Shane Lowry', score: -4 },       { player: 'Gary Woodland', score: 4 },        { player: 'Brian Harman', score: -5 },      { player: 'Michael Brennan', score: -2 }] },
  { team: 'Nik Ritter',          tiers: [{ player: 'Ludvig Åberg', score: -3 },      { player: 'Jordan Spieth', score: -2 },      { player: 'Si Woo Kim', score: 0 },         { player: 'Max Homa', score: -1 },            { player: 'Dustin Johnson', score: 3 },     { player: 'Bubba Watson', score: 3 }] },
  { team: 'Paul Raymond',        tiers: [{ player: 'Scottie Scheffler', score: -7 }, { player: 'Matt Fitzpatrick', score: -2 },   { player: 'Viktor Hovland', score: -1 },    { player: 'J.J. Spaun', score: 3 },           { player: 'Keegan Bradley', score: 1 },     { player: 'Michael Kim', score: 4 }] },
  { team: 'Paul VanDusen',       tiers: [{ player: 'Bryson DeChambeau', score: 3 },  { player: 'Justin Rose', score: -3 },        { player: 'Viktor Hovland', score: -1 },    { player: 'Jacob Bridgeman', score: -3 },     { player: 'Keegan Bradley', score: 1 },     { player: 'Johnny Keefer', score: 6 }] },
  { team: 'Robert Stephenson',   tiers: [{ player: 'Bryson DeChambeau', score: 3 },  { player: 'Justin Rose', score: -3 },        { player: 'Akshay Bhatia', score: 3 },      { player: 'Harris English', score: -1 },      { player: 'Brian Harman', score: -5 },      { player: 'Aldrich Potgieter', score: 8 }] },
  { team: 'Robert Stephenson 2', tiers: [{ player: 'Jon Rahm', score: 1 },           { player: 'Jordan Spieth', score: -2 },      { player: 'Akshay Bhatia', score: 3 },      { player: 'Max Homa', score: -1 },            { player: 'Aaron Rai', score: 6 },          { player: 'Fifa Laopakdee (a)', score: 6 }] },
  { team: 'Ron Pannullo',        tiers: [{ player: 'Scottie Scheffler', score: -7 }, { player: 'Brooks Koepka', score: -1 },      { player: 'Jake Knapp', score: -3 },        { player: 'Gary Woodland', score: 4 },        { player: 'Keegan Bradley', score: 1 },     { player: 'Bubba Watson', score: 3 }] },
  { team: 'Ryne Stone',          tiers: [{ player: 'Xander Schauffele', score: -2 }, { player: 'Tommy Fleetwood', score: 1 },     { player: 'Min Woo Lee', score: 6 },        { player: 'Corey Conners', score: -1 },       { player: 'Ryan Fox', score: 3 },           { player: 'Michael Kim', score: 4 }] },
  { team: 'Ryne Stone 2',        tiers: [{ player: 'Scottie Scheffler', score: -7 }, { player: 'Patrick Reed', score: 0 },        { player: 'Russell Henley', score: -6 },    { player: 'Corey Conners', score: -1 },       { player: 'Kurt Kitayama', score: 3 },      { player: 'Zach Johnson', score: 3 }] },
  { team: 'Sarah Crowell',       tiers: [{ player: 'Scottie Scheffler', score: -7 }, { player: 'Cameron Young', score: -7 },      { player: 'Viktor Hovland', score: -1 },    { player: 'Max Homa', score: -1 },            { player: 'Brian Harman', score: -5 },      { player: 'Bubba Watson', score: 3 }] },
  { team: 'Sean Susa',           tiers: [{ player: 'Ludvig Åberg', score: -3 },      { player: 'Tommy Fleetwood', score: 1 },     { player: 'Jake Knapp', score: -3 },        { player: 'Cameron Smith', score: 4 },        { player: 'Aaron Rai', score: 6 },          { player: 'Aldrich Potgieter', score: 8 }] },
  { team: 'Sean Susa 2',         tiers: [{ player: 'Xander Schauffele', score: -2 }, { player: 'Hideki Matsuyama', score: 0 },    { player: 'Si Woo Kim', score: 0 },         { player: 'Sungjae Im', score: -3 },          { player: 'Aaron Rai', score: 6 },          { player: 'Sami Välimäki', score: 6 }] },
  { team: 'Will letson',         tiers: [{ player: 'Ludvig Åberg', score: -3 },      { player: 'Justin Rose', score: -3 },        { player: 'Chris Gotterup', score: 0 },     { player: 'J.J. Spaun', score: 3 },           { player: 'Keegan Bradley', score: 1 },     { player: 'Vijay Singh', score: 5 }] },
  { team: 'Zach DelGandio',      tiers: [{ player: 'Xander Schauffele', score: -2 }, { player: 'Cameron Young', score: -7 },      { player: 'Min Woo Lee', score: 6 },        { player: 'Nicolai Højgaard', score: 3 },     { player: 'Casey Jarvis', score: 4 },       { player: 'Michael Kim', score: 4 }] },
  { team: 'Zach DelGandio 2',    tiers: [{ player: 'Ludvig Åberg', score: -3 },      { player: 'Matt Fitzpatrick', score: -2 },   { player: 'Jake Knapp', score: -3 },        { player: 'Corey Conners', score: -1 },       { player: 'Ryan Fox', score: 3 },           { player: 'Rasmus Neergaard-Petersen', score: 4 }] },
];

export function loadRound3Standings() {
  const container = document.getElementById('masters-day3');
  if (!container) return;

  const processed = MASTERS_2026_R3.map(entry => {
    const scores = entry.tiers.map(t => t.score);
    const sorted = [...scores].sort((a, b) => a - b);
    const total = sorted[0] + sorted[1] + sorted[2] + sorted[3];
    const fifth = sorted[4];
    const sixth = sorted[5];
    const top4Indices = new Set();
    for (let pick = 0; pick < 4; pick++) {
      const min = Math.min(...scores.filter((_, i) => !top4Indices.has(i)));
      const idx = scores.findIndex((s, i) => s === min && !top4Indices.has(i));
      top4Indices.add(idx);
    }
    return { ...entry, total, fifth, sixth, top4Indices };
  });

  processed.sort((a, b) =>
    a.total !== b.total ? a.total - b.total :
    a.fifth !== b.fifth ? a.fifth - b.fifth :
    a.sixth - b.sixth
  );

  let rank = 1;
  for (let i = 0; i < processed.length; i++) {
    if (i > 0 && (
      processed[i].total !== processed[i - 1].total ||
      processed[i].fifth !== processed[i - 1].fifth ||
      processed[i].sixth !== processed[i - 1].sixth
    )) rank = i + 1;
    processed[i].rank = rank;
  }

  const medals = ['🥇', '🥈', '🥉'];
  const rows = processed.map(entry => {
    const rankDisplay = entry.rank <= 3 ? medals[entry.rank - 1] : entry.rank;
    const rankClass = entry.rank <= 3 ? `rank-${entry.rank}` : '';
    const totalCls = scoreClass(entry.total, null);
    const tierCells = entry.tiers.map((t, i) => {
      const cls = scoreClass(t.score, null);
      const label = formatScore(t.score, null);
      const top4Class = entry.top4Indices.has(i) ? 'top-4-pick' : '';
      return `<td class="col-tier ${top4Class}" title="${escapeHtml(t.player)}"><div class="tier-cell-card"><span class="player-name-cell">${shortName(t.player)}</span><small class="score-val ${cls}">${label}</small></div></td>`;
    }).join('');
    const allPlayers = entry.tiers.map(t => t.player).join(' ');
    return `
      <tr data-entry="${escapeHtml(entry.team).toLowerCase()}" data-players="${escapeHtml(allPlayers).toLowerCase()}">
        <td class="col-rank ${rankClass}">${rankDisplay}</td>
        <td class="col-name">${escapeHtml(entry.team)}</td>
        <td class="col-total"><span class="score-val ${totalCls}">${formatScore(entry.total, null)}</span></td>
        ${tierCells}
      </tr>`;
  }).join('');

  container.innerHTML = `
    <div class="search-bar">
      <input type="text" id="r3Search" class="standings-search" placeholder="Search entry name or player..." />
    </div>
    <div class="table-wrapper">
      <table class="standings-table">
        <thead>
          <tr>
            <th>Rank</th><th>Entry</th><th>R3 Total</th>
            <th>Tier 1</th><th>Tier 2</th><th>Tier 3</th><th>Tier 4</th><th>Tier 5</th><th>Tier 6</th>
          </tr>
        </thead>
        <tbody id="r3StandingsBody">${rows}</tbody>
      </table>
    </div>`;

  document.getElementById('r3Search').addEventListener('input', e => {
    const q = e.target.value.toLowerCase().trim();
    document.querySelectorAll('#r3StandingsBody tr').forEach(row => {
      const entry = row.dataset.entry || '';
      const players = row.dataset.players || '';
      row.style.display = (!q || entry.includes(q) || players.includes(q)) ? '' : 'none';
    });
  });
}

// ─── Masters 2026 Round 4 Standings ──────────────────────────────────────────
const MASTERS_2026_R4 = [
  { team: 'Bobby Cross',         tiers: [{ player: 'Scottie Scheffler', score: -4 }, { player: 'Tommy Fleetwood', score: 4 },     { player: 'Si Woo Kim', score: 0 },         { player: 'J.J. Spaun', score: 3 },           { player: 'Wyndham Clark', score: 1 },      { player: 'Zach Johnson', score: 3 }] },
  { team: 'Bobby Cross 2',       tiers: [{ player: 'Ludvig Åberg', score: 0 },        { player: 'Brooks Koepka', score: -1 },      { player: 'Akshay Bhatia', score: 3 },      { player: 'Daniel Berger', score: 4 },        { player: 'Alex Noren', score: -2 },        { player: 'Michael Kim', score: 4 }] },
  { team: 'Brandon Sullivan',    tiers: [{ player: 'Ludvig Åberg', score: 0 },        { player: 'Tommy Fleetwood', score: 4 },     { player: 'Jake Knapp', score: -2 },        { player: 'Max Homa', score: -5 },            { player: 'Brian Harman', score: 1 },       { player: 'Andrew Novak', score: 4 }] },
  { team: 'Brandon Syde',        tiers: [{ player: 'Jon Rahm', score: -4 },           { player: 'Justin Rose', score: -2 },        { player: 'Akshay Bhatia', score: 3 },      { player: 'Max Homa', score: -5 },            { player: 'Keegan Bradley', score: -6 },    { player: 'Charl Schwartzel', score: 3 }] },
  { team: 'Brandon Syde 2',      tiers: [{ player: 'Scottie Scheffler', score: -4 },  { player: 'Collin Morikawa', score: -4 },    { player: 'Sepp Straka', score: 4 },        { player: 'Ben Griffin', score: 5 },          { player: 'Dustin Johnson', score: -3 },    { player: 'Bubba Watson', score: 3 }] },
  { team: 'Cassady Glenn',       tiers: [{ player: 'Jon Rahm', score: -4 },           { player: 'Cameron Young', score: 1 },       { player: 'Min Woo Lee', score: 6 },        { player: 'Corey Conners', score: 3 },        { player: 'Kurt Kitayama', score: 0 },      { player: 'Michael Kim', score: 4 }] },
  { team: 'Chris Merkel',        tiers: [{ player: 'Rory McIlroy', score: -1 },       { player: 'Collin Morikawa', score: -4 },    { player: 'Akshay Bhatia', score: 3 },      { player: 'Daniel Berger', score: 4 },        { player: 'Brian Harman', score: 1 },       { player: 'Davis Riley', score: 9 }] },
  { team: 'Chris schumann',      tiers: [{ player: 'Ludvig Åberg', score: 0 },        { player: 'Tommy Fleetwood', score: 4 },     { player: 'Min Woo Lee', score: 6 },        { player: 'Nicolai Højgaard', score: 3 },     { player: 'Sam Stevens', score: -2 },       { player: 'Michael Kim', score: 4 }] },
  { team: 'Cody Esbrandt',       tiers: [{ player: 'Bryson DeChambeau', score: 3 },   { player: 'Justin Rose', score: -2 },        { player: 'Adam Scott', score: -2 },        { player: 'Sungjae Im', score: 5 },           { player: 'Sergio García', score: 3 },      { player: 'Ethan Fang (a)', score: 4 }] },
  { team: 'Erik Vermilyea',      tiers: [{ player: 'Scottie Scheffler', score: -4 },  { player: 'Cameron Young', score: 1 },       { player: 'Chris Gotterup', score: 1 },     { player: 'Jacob Bridgeman', score: 4 },      { player: 'Keegan Bradley', score: -6 },    { player: 'Michael Brennan', score: 1 }] },
  { team: 'Greg Smith',          tiers: [{ player: 'Scottie Scheffler', score: -4 },  { player: 'Collin Morikawa', score: -4 },    { player: 'Justin Thomas', score: 1 },      { player: 'Gary Woodland', score: -6 },       { player: 'Sergio García', score: 3 },      { player: 'Bubba Watson', score: 3 }] },
  { team: 'Jake Bogardus',       tiers: [{ player: 'Bryson DeChambeau', score: 3 },   { player: 'Justin Rose', score: -2 },        { player: 'Si Woo Kim', score: 0 },         { player: 'Max Homa', score: -5 },            { player: 'Wyndham Clark', score: 1 },      { player: 'Bubba Watson', score: 3 }] },
  { team: 'Jake Hammer',         tiers: [{ player: 'Bryson DeChambeau', score: 3 },   { player: 'Justin Rose', score: -2 },        { player: 'Justin Thomas', score: 1 },      { player: 'J.J. Spaun', score: 3 },           { player: 'Dustin Johnson', score: -3 },    { player: 'Bubba Watson', score: 3 }] },
  { team: 'Jake Hammer 2',       tiers: [{ player: 'Ludvig Åberg', score: 0 },        { player: 'Matt Fitzpatrick', score: -1 },   { player: 'Justin Thomas', score: 1 },      { player: 'Gary Woodland', score: -6 },       { player: 'Dustin Johnson', score: -3 },    { player: 'Zach Johnson', score: 3 }] },
  { team: 'Jake Hammer 3',       tiers: [{ player: 'Scottie Scheffler', score: -4 },  { player: 'Jordan Spieth', score: -4 },      { player: 'Akshay Bhatia', score: 3 },      { player: 'Nicolai Højgaard', score: 3 },     { player: 'Sergio García', score: 3 },      { player: 'Bubba Watson', score: 3 }] },
  { team: 'Jason Damiani',       tiers: [{ player: 'Scottie Scheffler', score: -4 },  { player: 'Tommy Fleetwood', score: 4 },     { player: 'Patrick Cantlay', score: 1 },    { player: 'Corey Conners', score: 3 },        { player: 'Harry Hall', score: 3 },         { player: 'Rasmus Neergaard-Petersen', score: 4 }] },
  { team: 'Jaymes Cole',         tiers: [{ player: 'Xander Schauffele', score: -4 },  { player: 'Matt Fitzpatrick', score: -1 },   { player: 'Chris Gotterup', score: 1 },     { player: 'Cameron Smith', score: 4 },        { player: 'Nick Taylor', score: 5 },        { player: 'Bubba Watson', score: 3 }] },
  { team: 'Jeff Bagnasco',       tiers: [{ player: 'Xander Schauffele', score: -4 },  { player: 'Brooks Koepka', score: -1 },      { player: 'Chris Gotterup', score: 1 },     { player: 'Gary Woodland', score: -6 },       { player: 'Nico Echavarria', score: 7 },    { player: 'Danny Willett', score: 3 }] },
  { team: 'Jeff Bagnasco 2',     tiers: [{ player: 'Bryson DeChambeau', score: 3 },   { player: 'Tommy Fleetwood', score: 4 },     { player: 'Justin Thomas', score: 1 },      { player: 'Harris English', score: 0 },       { player: 'Keegan Bradley', score: -6 },    { player: 'Mason Howell (a)', score: 5 }] },
  { team: 'Jeff Mersch',         tiers: [{ player: 'Scottie Scheffler', score: -4 },  { player: 'Matt Fitzpatrick', score: -1 },   { player: 'Jake Knapp', score: -2 },        { player: 'Harris English', score: 0 },       { player: 'Ryan Fox', score: 3 },           { player: 'Michael Kim', score: 4 }] },
  { team: 'John Vodacek',        tiers: [{ player: 'Jon Rahm', score: -4 },           { player: 'Tommy Fleetwood', score: 4 },     { player: 'Russell Henley', score: -4 },    { player: 'Jacob Bridgeman', score: 4 },      { player: 'Matt McCarty', score: -3 },      { player: 'Rasmus Neergaard-Petersen', score: 4 }] },
  { team: 'Keith Waters',        tiers: [{ player: 'Xander Schauffele', score: -4 },  { player: 'Patrick Reed', score: 1 },        { player: 'Russell Henley', score: -4 },    { player: 'Nicolai Højgaard', score: 3 },     { player: 'Harry Hall', score: 3 },         { player: 'Bubba Watson', score: 3 }] },
  { team: 'Kevin Guilfoy',       tiers: [{ player: 'Bryson DeChambeau', score: 3 },   { player: 'Cameron Young', score: 1 },       { player: 'Viktor Hovland', score: -5 },    { player: 'J.J. Spaun', score: 3 },           { player: 'Kurt Kitayama', score: 0 },      { player: 'Charl Schwartzel', score: 3 }] },
  { team: 'Kyle sheldon',        tiers: [{ player: 'Xander Schauffele', score: -4 },  { player: 'Tommy Fleetwood', score: 4 },     { player: 'Justin Thomas', score: 1 },      { player: 'Cameron Smith', score: 4 },        { player: 'Keegan Bradley', score: -6 },    { player: 'Michael Kim', score: 4 }] },
  { team: 'Luke Stewart',        tiers: [{ player: 'Bryson DeChambeau', score: 3 },   { player: 'Tommy Fleetwood', score: 4 },     { player: 'Jake Knapp', score: -2 },        { player: 'Max Homa', score: -5 },            { player: 'Brian Harman', score: 1 },       { player: 'Bubba Watson', score: 3 }] },
  { team: 'Matt Bova',           tiers: [{ player: 'Scottie Scheffler', score: -4 },  { player: 'Hideki Matsuyama', score: -3 },   { player: 'Shane Lowry', score: 8 },        { player: 'Corey Conners', score: 3 },        { player: 'Brian Harman', score: 1 },       { player: 'Davis Riley', score: 9 }] },
  { team: 'Matt Bova 2',         tiers: [{ player: 'Ludvig Åberg', score: 0 },        { player: 'Jordan Spieth', score: -4 },      { player: 'Tyrrell Hatton', score: -6 },    { player: 'Sungjae Im', score: 5 },           { player: 'Keegan Bradley', score: -6 },    { player: 'Michael Kim', score: 4 }] },
  { team: 'matt tuck',           tiers: [{ player: 'Scottie Scheffler', score: -4 },  { player: 'Patrick Reed', score: 1 },        { player: 'Akshay Bhatia', score: 3 },      { player: 'Marco Penge', score: 6 },          { player: 'Brian Harman', score: 1 },       { player: 'Zach Johnson', score: 3 }] },
  { team: 'Mike Davis 1',        tiers: [{ player: 'Bryson DeChambeau', score: 3 },   { player: 'Justin Rose', score: -2 },        { player: 'Sepp Straka', score: 4 },        { player: 'Maverick McNealy', score: -5 },    { player: 'Keegan Bradley', score: -6 },    { player: 'Zach Johnson', score: 3 }] },
  { team: 'Mike Davis 2',        tiers: [{ player: 'Jon Rahm', score: -4 },           { player: 'Tommy Fleetwood', score: 4 },     { player: 'Shane Lowry', score: 8 },        { player: 'Max Homa', score: -5 },            { player: 'Nick Taylor', score: 5 },        { player: 'Michael Kim', score: 4 }] },
  { team: 'Mitch Pletcher',      tiers: [{ player: 'Scottie Scheffler', score: -4 },  { player: 'Brooks Koepka', score: -1 },      { player: 'Viktor Hovland', score: -5 },    { player: 'Max Homa', score: -5 },            { player: 'Alex Noren', score: -2 },        { player: 'Bubba Watson', score: 3 }] },
  { team: 'Morgan C',            tiers: [{ player: 'Jon Rahm', score: -4 },           { player: 'Patrick Reed', score: 1 },        { player: 'Jake Knapp', score: -2 },        { player: 'Nicolai Højgaard', score: 3 },     { player: 'Kurt Kitayama', score: 0 },      { player: 'Michael Kim', score: 4 }] },
  { team: 'Morgan C 2',          tiers: [{ player: 'Xander Schauffele', score: -4 },  { player: 'Matt Fitzpatrick', score: -1 },   { player: 'Min Woo Lee', score: 6 },        { player: 'Nicolai Højgaard', score: 3 },     { player: 'Casey Jarvis', score: 4 },       { player: 'Andrew Novak', score: 4 }] },
  { team: 'Myron Mayo',          tiers: [{ player: 'Jon Rahm', score: -4 },           { player: 'Patrick Reed', score: 1 },        { player: 'Min Woo Lee', score: 6 },        { player: 'Gary Woodland', score: -6 },       { player: 'Brian Harman', score: 1 },       { player: 'Michael Kim', score: 4 }] },
  { team: 'Nathan Wood',         tiers: [{ player: 'Xander Schauffele', score: -4 },  { player: 'Cameron Young', score: 1 },       { player: 'Min Woo Lee', score: 6 },        { player: 'Jacob Bridgeman', score: 4 },      { player: 'Alex Noren', score: -2 },        { player: 'Rasmus Neergaard-Petersen', score: 4 }] },
  { team: 'Nick Bova',           tiers: [{ player: 'Jon Rahm', score: -4 },           { player: 'Matt Fitzpatrick', score: -1 },   { player: 'Chris Gotterup', score: 1 },     { player: 'Nicolai Højgaard', score: 3 },     { player: 'Sergio García', score: 3 },      { player: 'Bubba Watson', score: 3 }] },
  { team: 'Nick Bova 2',         tiers: [{ player: 'Xander Schauffele', score: -4 },  { player: 'Justin Rose', score: -2 },        { player: 'Shane Lowry', score: 8 },        { player: 'Gary Woodland', score: -6 },       { player: 'Brian Harman', score: 1 },       { player: 'Michael Brennan', score: 1 }] },
  { team: 'Nik Ritter',          tiers: [{ player: 'Ludvig Åberg', score: 0 },        { player: 'Jordan Spieth', score: -4 },      { player: 'Si Woo Kim', score: 0 },         { player: 'Max Homa', score: -5 },            { player: 'Dustin Johnson', score: -3 },    { player: 'Bubba Watson', score: 3 }] },
  { team: 'Paul Raymond',        tiers: [{ player: 'Scottie Scheffler', score: -4 },  { player: 'Matt Fitzpatrick', score: -1 },   { player: 'Viktor Hovland', score: -5 },    { player: 'J.J. Spaun', score: 3 },           { player: 'Keegan Bradley', score: -6 },    { player: 'Michael Kim', score: 4 }] },
  { team: 'Paul VanDusen',       tiers: [{ player: 'Bryson DeChambeau', score: 3 },   { player: 'Justin Rose', score: -2 },        { player: 'Viktor Hovland', score: -5 },    { player: 'Jacob Bridgeman', score: 4 },      { player: 'Keegan Bradley', score: -6 },    { player: 'Johnny Keefer', score: 6 }] },
  { team: 'Robert Stephenson',   tiers: [{ player: 'Bryson DeChambeau', score: 3 },   { player: 'Justin Rose', score: -2 },        { player: 'Akshay Bhatia', score: 3 },      { player: 'Harris English', score: 0 },       { player: 'Brian Harman', score: 1 },       { player: 'Aldrich Potgieter', score: 8 }] },
  { team: 'Robert Stephenson 2', tiers: [{ player: 'Jon Rahm', score: -4 },           { player: 'Jordan Spieth', score: -4 },      { player: 'Akshay Bhatia', score: 3 },      { player: 'Max Homa', score: -5 },            { player: 'Aaron Rai', score: -2 },         { player: 'Fifa Laopakdee (a)', score: 6 }] },
  { team: 'Ron Pannullo',        tiers: [{ player: 'Scottie Scheffler', score: -4 },  { player: 'Brooks Koepka', score: -1 },      { player: 'Jake Knapp', score: -2 },        { player: 'Gary Woodland', score: -6 },       { player: 'Keegan Bradley', score: -6 },    { player: 'Bubba Watson', score: 3 }] },
  { team: 'Ryne Stone',          tiers: [{ player: 'Xander Schauffele', score: -4 },  { player: 'Tommy Fleetwood', score: 4 },     { player: 'Min Woo Lee', score: 6 },        { player: 'Corey Conners', score: 3 },        { player: 'Ryan Fox', score: 3 },           { player: 'Michael Kim', score: 4 }] },
  { team: 'Ryne Stone 2',        tiers: [{ player: 'Scottie Scheffler', score: -4 },  { player: 'Patrick Reed', score: 1 },        { player: 'Russell Henley', score: -4 },    { player: 'Corey Conners', score: 3 },        { player: 'Kurt Kitayama', score: 0 },      { player: 'Zach Johnson', score: 3 }] },
  { team: 'Sarah Crowell',       tiers: [{ player: 'Scottie Scheffler', score: -4 },  { player: 'Cameron Young', score: 1 },       { player: 'Viktor Hovland', score: -5 },    { player: 'Max Homa', score: -5 },            { player: 'Brian Harman', score: 1 },       { player: 'Bubba Watson', score: 3 }] },
  { team: 'Sean Susa',           tiers: [{ player: 'Ludvig Åberg', score: 0 },        { player: 'Tommy Fleetwood', score: 4 },     { player: 'Jake Knapp', score: -2 },        { player: 'Cameron Smith', score: 4 },        { player: 'Aaron Rai', score: -2 },         { player: 'Aldrich Potgieter', score: 8 }] },
  { team: 'Sean Susa 2',         tiers: [{ player: 'Xander Schauffele', score: -4 },  { player: 'Hideki Matsuyama', score: -3 },   { player: 'Si Woo Kim', score: 0 },         { player: 'Sungjae Im', score: 5 },           { player: 'Aaron Rai', score: -2 },         { player: 'Sami Välimäki', score: 6 }] },
  { team: 'Will letson',         tiers: [{ player: 'Ludvig Åberg', score: 0 },        { player: 'Justin Rose', score: -2 },        { player: 'Chris Gotterup', score: 1 },     { player: 'J.J. Spaun', score: 3 },           { player: 'Keegan Bradley', score: -6 },    { player: 'Vijay Singh', score: 5 }] },
  { team: 'Zach DelGandio',      tiers: [{ player: 'Xander Schauffele', score: -4 },  { player: 'Cameron Young', score: 1 },       { player: 'Min Woo Lee', score: 6 },        { player: 'Nicolai Højgaard', score: 3 },     { player: 'Casey Jarvis', score: 4 },       { player: 'Michael Kim', score: 4 }] },
  { team: 'Zach DelGandio 2',    tiers: [{ player: 'Ludvig Åberg', score: 0 },        { player: 'Matt Fitzpatrick', score: -1 },   { player: 'Jake Knapp', score: -2 },        { player: 'Corey Conners', score: 3 },        { player: 'Ryan Fox', score: 3 },           { player: 'Rasmus Neergaard-Petersen', score: 4 }] },
];

export function loadRound4Standings() {
  const container = document.getElementById('masters-day4');
  if (!container) return;

  const processed = MASTERS_2026_R4.map(entry => {
    const scores = entry.tiers.map(t => t.score);
    const sorted = [...scores].sort((a, b) => a - b);
    const total = sorted[0] + sorted[1] + sorted[2] + sorted[3];
    const fifth = sorted[4];
    const sixth = sorted[5];
    const top4Indices = new Set();
    for (let pick = 0; pick < 4; pick++) {
      const min = Math.min(...scores.filter((_, i) => !top4Indices.has(i)));
      const idx = scores.findIndex((s, i) => s === min && !top4Indices.has(i));
      top4Indices.add(idx);
    }
    return { ...entry, total, fifth, sixth, top4Indices };
  });

  processed.sort((a, b) =>
    a.total !== b.total ? a.total - b.total :
    a.fifth !== b.fifth ? a.fifth - b.fifth :
    a.sixth - b.sixth
  );

  let rank = 1;
  for (let i = 0; i < processed.length; i++) {
    if (i > 0 && (
      processed[i].total !== processed[i - 1].total ||
      processed[i].fifth !== processed[i - 1].fifth ||
      processed[i].sixth !== processed[i - 1].sixth
    )) rank = i + 1;
    processed[i].rank = rank;
  }

  const medals = ['🥇', '🥈', '🥉'];
  const rows = processed.map(entry => {
    const rankDisplay = entry.rank <= 3 ? medals[entry.rank - 1] : entry.rank;
    const rankClass = entry.rank <= 3 ? `rank-${entry.rank}` : '';
    const totalCls = scoreClass(entry.total, null);
    const tierCells = entry.tiers.map((t, i) => {
      const cls = scoreClass(t.score, null);
      const label = formatScore(t.score, null);
      const top4Class = entry.top4Indices.has(i) ? 'top-4-pick' : '';
      return `<td class="col-tier ${top4Class}" title="${escapeHtml(t.player)}"><div class="tier-cell-card"><span class="player-name-cell">${shortName(t.player)}</span><small class="score-val ${cls}">${label}</small></div></td>`;
    }).join('');
    const allPlayers = entry.tiers.map(t => t.player).join(' ');
    return `
      <tr data-entry="${escapeHtml(entry.team).toLowerCase()}" data-players="${escapeHtml(allPlayers).toLowerCase()}">
        <td class="col-rank ${rankClass}">${rankDisplay}</td>
        <td class="col-name">${escapeHtml(entry.team)}</td>
        <td class="col-total"><span class="score-val ${totalCls}">${formatScore(entry.total, null)}</span></td>
        ${tierCells}
      </tr>`;
  }).join('');

  container.innerHTML = `
    <div class="search-bar">
      <input type="text" id="r4Search" class="standings-search" placeholder="Search entry name or player..." />
    </div>
    <div class="table-wrapper">
      <table class="standings-table">
        <thead>
          <tr>
            <th>Rank</th><th>Entry</th><th>R4 Total</th>
            <th>Tier 1</th><th>Tier 2</th><th>Tier 3</th><th>Tier 4</th><th>Tier 5</th><th>Tier 6</th>
          </tr>
        </thead>
        <tbody id="r4StandingsBody">${rows}</tbody>
      </table>
    </div>`;

  document.getElementById('r4Search').addEventListener('input', e => {
    const q = e.target.value.toLowerCase().trim();
    document.querySelectorAll('#r4StandingsBody tr').forEach(row => {
      const entry = row.dataset.entry || '';
      const players = row.dataset.players || '';
      row.style.display = (!q || entry.includes(q) || players.includes(q)) ? '' : 'none';
    });
  });
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
