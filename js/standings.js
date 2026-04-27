import { getDb } from './firebase-config.js';
import {
  collection, doc, getDocs, getDoc, query, where, setDoc
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';
import { calculateStandings, formatScore, scoreClass } from './scoring.js';

const REFRESH_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
let currentTournamentId = null;
let sortColumn = 'rank';
let sortAsc = true;
let cachedResults = [];
let refreshTimer = null;

// ─── Entry point ─────────────────────────────────────────────────────────────
export async function loadStandings() {
  await populateTournamentSelect();
  const select = document.getElementById('tournamentSelect');
  select.addEventListener('change', () => {
    currentTournamentId = select.value;
    if (currentTournamentId) loadTournamentData(currentTournamentId);
  });
  if (currentTournamentId) loadTournamentData(currentTournamentId);
}

// ─── Populate tournament dropdown ────────────────────────────────────────────
async function populateTournamentSelect() {
  const db = getDb();
  const snap = await getDocs(collection(db, 'tournaments'));
  const tournaments = [];
  snap.forEach(d => tournaments.push({ id: d.id, ...d.data() }));

  // Sort: open first, then locked, then final; within group sort by year desc
  const order = { open: 0, locked: 1, final: 2 };
  tournaments.sort((a, b) =>
    (order[a.status] ?? 3) - (order[b.status] ?? 3) || b.year - a.year
  );

  const select = document.getElementById('tournamentSelect');
  select.innerHTML = tournaments.length
    ? tournaments.map(t => `<option value="${t.id}">${t.name} (${t.year})</option>`).join('')
    : '<option value="">No tournaments found</option>';

  if (tournaments.length) {
    currentTournamentId = tournaments[0].id;
    select.value = currentTournamentId;
  }
}

// ─── Load full tournament data ────────────────────────────────────────────────
async function loadTournamentData(tournamentId) {
  showLoading(true);
  clearInterval(refreshTimer);

  try {
    const db = getDb();

    // Fetch tournament doc
    const tSnap = await getDoc(doc(db, 'tournaments', tournamentId));
    if (!tSnap.exists()) { showLoading(false); return; }
    const tournament = { id: tSnap.id, ...tSnap.data() };

    // Show status label + countdown
    renderStatusLabel(tournament);
    renderCountdown(tournament);
    renderPrizes(tournament);

    // Fetch picks
    const picksSnap = await getDocs(
      query(collection(db, 'picks'), where('tournamentId', '==', tournamentId))
    );
    const picks = [];
    picksSnap.forEach(d => picks.push({ id: d.id, ...d.data() }));

    // Fetch or refresh scores from ESPN
    const scoresMap = await fetchOrRefreshScores(tournament);

    // Calculate and render
    cachedResults = calculateStandings(picks, scoresMap, tournament.mcPenalty ?? 20);
    renderTable(cachedResults, scoresMap);
    updateLastUpdated();
    showLoading(false);

    // Auto-refresh during active tournament
    if (tournament.status === 'locked') {
      refreshTimer = setInterval(() => refreshScores(tournament), REFRESH_INTERVAL_MS);
    }
  } catch (err) {
    console.error('Error loading standings:', err);
    showLoading(false);
    document.getElementById('noDataMsg').classList.remove('hidden');
  }
}

// ─── ESPN API: fetch scores, cache in Firestore ───────────────────────────────
async function fetchOrRefreshScores(tournament) {
  const db = getDb();
  const scoreDoc = doc(db, 'scores', tournament.id);
  const scoreSnap = await getDoc(scoreDoc);

  // Use cached scores if less than 5 min old (during locked/active tournament)
  if (scoreSnap.exists()) {
    const data = scoreSnap.data();
    const lastUpdated = data._lastUpdated?.toMillis?.() ?? 0;
    const age = Date.now() - lastUpdated;
    if (tournament.status !== 'locked' || age < REFRESH_INTERVAL_MS) {
      const { _lastUpdated, ...scores } = data;
      return scores;
    }
  }

  // Fetch from ESPN API
  if (!tournament.espnEventId) return scoreSnap.exists() ? scoreSnap.data() : {};
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
    if (scoreStr === 'E') score = 0;
    else if (!isNaN(Number(scoreStr))) score = Number(scoreStr);

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
    const { _lastUpdated, ...scoresMap } = fresh;
    cachedResults = calculateStandings(
      cachedResults.map(r => r.pick),
      scoresMap,
      tournament.mcPenalty ?? 20
    );
    renderTable(cachedResults, scoresMap);
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
    const totalClass = scoreClass(r.total, null);

    const tierCells = [1,2,3,4,5,6].map(i => {
      const t = r.tierScores[`t${i}`];
      const cls = scoreClass(t.score, t.status);
      const label = t.status === 'cut' ? 'MC' : t.status === 'wd' ? 'WD' : formatScore(t.score, t.status);
      return `<td class="col-tier ${cls}" title="${t.golfer}">${shortName(t.golfer)}<br><small>${label}</small></td>`;
    }).join('');

    return `
      <tr>
        <td class="col-rank ${rankClass}">${rankDisplay}</td>
        <td class="col-name"><strong>${escapeHtml(r.pick.entrantName)}</strong></td>
        <td class="col-total ${totalClass}">${formatScore(r.total, null)}</td>
        ${tierCells}
      </tr>
    `;
  }).join('');
}

function renderPrizes(tournament) {
  const section = document.getElementById('prizeSection');
  const grid = document.getElementById('prizeGrid');
  if (!tournament.prizePayouts || !tournament.entryFee) { section.classList.add('hidden'); return; }

  section.classList.remove('hidden');
  const total = tournament.entryFee * (tournament.entryCount ?? 0);
  if (!total) { section.classList.add('hidden'); return; }

  const payouts = tournament.prizePayouts;
  grid.innerHTML = payouts.map(p => {
    const amt = Math.round(total * p.pct / 100);
    return `<div class="prize-item"><strong>$${amt}</strong> — ${ordinal(p.place)}</div>`;
  }).join('');
}

function renderStatusLabel(tournament) {
  const el = document.getElementById('statusLabel');
  const labels = { open: 'Picks Open', locked: 'In Progress', final: 'Final' };
  const cls = { open: 'status-open', locked: 'status-locked', final: 'status-final' };
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
    if (col === 'rank') { va = a.rank; vb = b.rank; }
    else if (col === 'total') { va = a.total; vb = b.total; }
    else if (col === 'name') { va = a.pick.entrantName.toLowerCase(); vb = b.pick.entrantName.toLowerCase(); }
    if (va < vb) return sortAsc ? -1 : 1;
    if (va > vb) return sortAsc ? 1 : -1;
    return 0;
  });

  // Update sort icons in header
  document.querySelectorAll('.standings-table th[data-col]').forEach(th => {
    th.querySelector('.sort-icon').textContent =
      th.dataset.col === col ? (sortAsc ? '▲' : '▼') : '';
  });

  const tbody = document.getElementById('standingsBody');
  const rows = sorted.map(r => tbody.querySelector(`tr`) ); // re-render
  renderTable(sorted, {});
}

export function manualRefresh() {
  if (currentTournamentId) loadTournamentData(currentTournamentId);
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
