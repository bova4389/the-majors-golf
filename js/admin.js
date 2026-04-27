import { getDb, getAuthInstance } from './firebase-config.js';
import {
  collection, doc, getDocs, getDoc, setDoc, addDoc, updateDoc, deleteDoc,
  query, where, serverTimestamp
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';
import {
  signInWithEmailAndPassword, signOut, onAuthStateChanged
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';
import { calculateStandings, calculatePrizes } from './scoring.js';

// ─── Auth ─────────────────────────────────────────────────────────────────────
export function adminLogin(event) {
  event.preventDefault();
  const auth = getAuthInstance();
  const email = document.getElementById('loginEmail').value;
  const pass = document.getElementById('loginPassword').value;
  const errEl = document.getElementById('loginError');
  errEl.classList.add('hidden');

  signInWithEmailAndPassword(auth, email, pass)
    .then(() => showDashboard())
    .catch(err => {
      errEl.textContent = 'Login failed: ' + err.message;
      errEl.classList.remove('hidden');
    });
}

export function adminLogout() {
  signOut(getAuthInstance()).then(() => {
    document.getElementById('adminDashboard').classList.add('hidden');
    document.getElementById('loginPanel').classList.remove('hidden');
    document.getElementById('logoutBtn').classList.add('hidden');
  });
}

// Check auth state on load
setTimeout(() => {
  onAuthStateChanged(getAuthInstance(), user => {
    if (user) showDashboard();
  });
}, 100);

async function showDashboard() {
  document.getElementById('loginPanel').classList.add('hidden');
  document.getElementById('adminDashboard').classList.remove('hidden');
  document.getElementById('logoutBtn').classList.remove('hidden');
  await loadAllTournamentSelects();
  await loadTournamentList();
}

// ─── Tabs ─────────────────────────────────────────────────────────────────────
export function showTab(name) {
  document.querySelectorAll('.tab-panel').forEach(el => {
    el.classList.toggle('active', el.id === `tab-${name}`);
    el.classList.toggle('hidden', el.id !== `tab-${name}`);
  });
  document.querySelectorAll('.tab-btn').forEach((btn, i) => {
    const tabs = ['tournaments','tiers','picks','scores','prizes'];
    btn.classList.toggle('active', tabs[i] === name);
  });
}

// ─── Load tournament selects across tabs ──────────────────────────────────────
async function loadAllTournamentSelects() {
  const db = getDb();
  const snap = await getDocs(collection(db, 'tournaments'));
  const tournaments = [];
  snap.forEach(d => tournaments.push({ id: d.id, ...d.data() }));
  tournaments.sort((a, b) => b.year - a.year);

  const optionHtml = tournaments.map(t =>
    `<option value="${t.id}">${t.name} (${t.year})</option>`
  ).join('');

  ['tierTournamentSelect','picksTournamentSelect','scoresTournamentSelect','prizeTournamentSelect']
    .forEach(id => {
      const el = document.getElementById(id);
      if (el) el.innerHTML = '<option value="">Select a tournament...</option>' + optionHtml;
    });
}

// ─── TOURNAMENT LIST ──────────────────────────────────────────────────────────
async function loadTournamentList() {
  const db = getDb();
  const snap = await getDocs(collection(db, 'tournaments'));
  const tournaments = [];
  snap.forEach(d => tournaments.push({ id: d.id, ...d.data() }));
  tournaments.sort((a, b) => b.year - a.year);

  const list = document.getElementById('tournamentList');
  if (!tournaments.length) {
    list.innerHTML = '<p class="muted">No tournaments yet. Create one to get started.</p>';
    return;
  }
  list.innerHTML = tournaments.map(t => `
    <div class="card">
      <div class="card-info">
        <h3>${escapeHtml(t.name)}</h3>
        <p>Status: <strong>${t.status}</strong> &bull; Entry: $${t.entryFee ?? 0} &bull; MC Penalty: +${t.mcPenalty ?? 20}</p>
        <p>Deadline: ${t.pickDeadline ? new Date(t.pickDeadline).toLocaleString() : '—'}</p>
      </div>
      <div class="card-actions">
        <button class="btn btn-sm" onclick="openTournamentModal('${t.id}')">Edit</button>
        <button class="btn btn-sm btn-danger" onclick="deleteTournament('${t.id}')">Delete</button>
      </div>
    </div>
  `).join('');
}

// ─── TOURNAMENT MODAL ─────────────────────────────────────────────────────────
export async function openTournamentModal(tournamentId = null) {
  document.getElementById('modalTitle').textContent = tournamentId ? 'Edit Tournament' : 'New Tournament';
  document.getElementById('tFormId').value = tournamentId ?? '';

  if (tournamentId) {
    const snap = await getDoc(doc(getDb(), 'tournaments', tournamentId));
    if (snap.exists()) {
      const t = snap.data();
      document.getElementById('tFormName').value = t.name ?? '';
      document.getElementById('tFormMajor').value = t.major ?? 'masters';
      document.getElementById('tFormYear').value = t.year ?? new Date().getFullYear();
      document.getElementById('tFormEntryFee').value = t.entryFee ?? '';
      document.getElementById('tFormMcPenalty').value = t.mcPenalty ?? 20;
      document.getElementById('tFormDeadline').value = t.pickDeadline
        ? t.pickDeadline.slice(0, 16) : '';
      document.getElementById('tFormPassword').value = t.entryPassword ?? '';
      document.getElementById('tFormEspnId').value = t.espnEventId ?? '';
      document.getElementById('tFormStatus').value = t.status ?? 'open';
      document.getElementById('tFormPrizes').value = t.prizePayouts
        ? JSON.stringify(t.prizePayouts) : '';
    }
  } else {
    document.getElementById('tournamentForm').reset();
    document.getElementById('tFormYear').value = new Date().getFullYear();
    document.getElementById('tFormMcPenalty').value = 20;
  }

  document.getElementById('tournamentModal').classList.remove('hidden');
  document.getElementById('modalOverlay').classList.remove('hidden');
}

export function closeTournamentModal() {
  document.getElementById('tournamentModal').classList.add('hidden');
  document.getElementById('modalOverlay').classList.add('hidden');
}

export async function saveTournament(event) {
  event.preventDefault();
  const db = getDb();
  const id = document.getElementById('tFormId').value;

  let prizePayouts = [];
  try {
    const raw = document.getElementById('tFormPrizes').value.trim();
    if (raw) prizePayouts = JSON.parse(raw);
  } catch { alert('Prize Payouts JSON is invalid. Please fix and retry.'); return; }

  const data = {
    name: document.getElementById('tFormName').value.trim(),
    major: document.getElementById('tFormMajor').value,
    year: Number(document.getElementById('tFormYear').value),
    entryFee: Number(document.getElementById('tFormEntryFee').value) || 0,
    mcPenalty: Number(document.getElementById('tFormMcPenalty').value) || 20,
    pickDeadline: document.getElementById('tFormDeadline').value || null,
    entryPassword: document.getElementById('tFormPassword').value.trim(),
    espnEventId: document.getElementById('tFormEspnId').value.trim(),
    status: document.getElementById('tFormStatus').value,
    prizePayouts,
    updatedAt: serverTimestamp()
  };

  if (id) {
    await updateDoc(doc(db, 'tournaments', id), data);
  } else {
    await addDoc(collection(db, 'tournaments'), { ...data, createdAt: serverTimestamp() });
  }

  closeTournamentModal();
  await loadTournamentList();
  await loadAllTournamentSelects();
}

async function deleteTournament(id) {
  if (!confirm('Delete this tournament? This cannot be undone.')) return;
  await deleteDoc(doc(getDb(), 'tournaments', id));
  await loadTournamentList();
  await loadAllTournamentSelects();
}
window.deleteTournament = deleteTournament;

// ─── TIERS EDITOR ─────────────────────────────────────────────────────────────
export async function loadTiersForAdmin() {
  const tournamentId = document.getElementById('tierTournamentSelect').value;
  const container = document.getElementById('tiersEditor');
  if (!tournamentId) { container.innerHTML = '<p class="muted">Select a tournament above.</p>'; return; }

  const db = getDb();
  const snap = await getDoc(doc(db, 'tiers', tournamentId));
  const tiers = snap.exists() ? snap.data() : {};

  container.innerHTML = [1,2,3,4,5,6].map(i => {
    const golfers = tiers[`tier${i}`] ?? [];
    return `
      <div class="tier-editor-block">
        <div class="tier-editor-header">
          <h3>Tier ${i}</h3>
        </div>
        <div class="golfer-list" id="golferList${i}">
          ${golfers.map(g => golferTag(i, g.name)).join('')}
        </div>
        <div class="add-golfer-row">
          <input type="text" id="newGolfer${i}" placeholder="Golfer name..." />
          <button class="btn btn-sm btn-primary" onclick="addGolfer(${i}, '${tournamentId}')">Add</button>
        </div>
      </div>
    `;
  }).join('');
}

function golferTag(tier, name) {
  return `<span class="golfer-tag">${escapeHtml(name)}<button class="remove-golfer" onclick="removeGolfer(${tier}, '${escapeHtml(name)}')" title="Remove">×</button></span>`;
}

window.addGolfer = async function(tier, tournamentId) {
  const input = document.getElementById(`newGolfer${tier}`);
  const name = input.value.trim();
  if (!name) return;

  const db = getDb();
  const ref = doc(db, 'tiers', tournamentId);
  const snap = await getDoc(ref);
  const data = snap.exists() ? snap.data() : {};
  const key = `tier${tier}`;
  const existing = data[key] ?? [];
  if (existing.find(g => g.name === name)) { alert('Golfer already in this tier.'); return; }

  existing.push({ name, worldRank: null });
  await setDoc(ref, { ...data, [key]: existing });
  input.value = '';
  const list = document.getElementById(`golferList${tier}`);
  list.insertAdjacentHTML('beforeend', golferTag(tier, name));
};

window.removeGolfer = async function(tier, name) {
  const tournamentId = document.getElementById('tierTournamentSelect').value;
  if (!tournamentId) return;
  const db = getDb();
  const ref = doc(db, 'tiers', tournamentId);
  const snap = await getDoc(ref);
  if (!snap.exists()) return;
  const data = snap.data();
  const key = `tier${tier}`;
  data[key] = (data[key] ?? []).filter(g => g.name !== name);
  await setDoc(ref, data);
  await loadTiersForAdmin();
};

// ─── PICKS ADMIN ──────────────────────────────────────────────────────────────
export async function loadPicksForAdmin() {
  const tournamentId = document.getElementById('picksTournamentSelect').value;
  const container = document.getElementById('picksAdminTable');
  if (!tournamentId) { container.innerHTML = '<p class="muted">Select a tournament.</p>'; return; }

  const db = getDb();
  const snap = await getDocs(query(collection(db, 'picks'), where('tournamentId', '==', tournamentId)));
  const picks = [];
  snap.forEach(d => picks.push({ id: d.id, ...d.data() }));

  if (!picks.length) {
    container.innerHTML = '<p class="muted">No picks submitted yet.</p>';
    return;
  }

  container.innerHTML = `
    <table class="admin-table">
      <thead><tr>
        <th>Name</th><th>T1</th><th>T2</th><th>T3</th><th>T4</th><th>T5</th><th>T6</th><th>Submitted</th><th></th>
      </tr></thead>
      <tbody>
        ${picks.map(p => `
          <tr>
            <td>${escapeHtml(p.entrantName)}</td>
            <td>${escapeHtml(p.t1 ?? '—')}</td>
            <td>${escapeHtml(p.t2 ?? '—')}</td>
            <td>${escapeHtml(p.t3 ?? '—')}</td>
            <td>${escapeHtml(p.t4 ?? '—')}</td>
            <td>${escapeHtml(p.t5 ?? '—')}</td>
            <td>${escapeHtml(p.t6 ?? '—')}</td>
            <td>${p.submittedAt?.toDate ? p.submittedAt.toDate().toLocaleDateString() : '—'}</td>
            <td>
              <button class="btn btn-sm" onclick="openAddPickModal('${p.id}')">Edit</button>
              <button class="btn btn-sm btn-danger" onclick="deletePick('${p.id}')">Del</button>
            </td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;
}

export async function openAddPickModal(pickId = null) {
  const tournamentId = document.getElementById('picksTournamentSelect').value;
  if (!tournamentId && !pickId) { alert('Select a tournament first.'); return; }

  document.getElementById('apFormId').value = pickId ?? '';
  document.getElementById('apFormTournament').value = tournamentId;

  if (pickId) {
    const snap = await getDoc(doc(getDb(), 'picks', pickId));
    if (snap.exists()) {
      const p = snap.data();
      document.getElementById('apFormName').value = p.entrantName ?? '';
      document.getElementById('apFormEmail').value = p.email ?? '';
      document.getElementById('apFormTournament').value = p.tournamentId;
    }
  } else {
    document.getElementById('addPickForm').reset();
    document.getElementById('apFormTournament').value = tournamentId;
  }

  // Build tier dropdowns for this tournament
  const tid = document.getElementById('apFormTournament').value;
  const tierSnap = await getDoc(doc(getDb(), 'tiers', tid));
  const tiers = tierSnap.exists() ? tierSnap.data() : {};
  const pickData = pickId ? (await getDoc(doc(getDb(), 'picks', pickId))).data() : {};

  const container = document.getElementById('apTierSelects');
  container.innerHTML = [1,2,3,4,5,6].map(i => {
    const golfers = tiers[`tier${i}`] ?? [];
    const current = pickData[`t${i}`] ?? '';
    return `
      <div class="form-row">
        <label>Tier ${i}</label>
        <select id="apTier${i}">
          <option value="">— Select —</option>
          ${golfers.map(g => `<option value="${escapeHtml(g.name)}" ${g.name===current?'selected':''}>${escapeHtml(g.name)}</option>`).join('')}
        </select>
      </div>
    `;
  }).join('');

  document.getElementById('addPickModal').classList.remove('hidden');
  document.getElementById('modalOverlay').classList.remove('hidden');
}

export function closeAddPickModal() {
  document.getElementById('addPickModal').classList.add('hidden');
  document.getElementById('modalOverlay').classList.add('hidden');
}

export async function saveAdminPick(event) {
  event.preventDefault();
  const db = getDb();
  const id = document.getElementById('apFormId').value;
  const tournamentId = document.getElementById('apFormTournament').value;

  const data = {
    tournamentId,
    entrantName: document.getElementById('apFormName').value.trim(),
    email: document.getElementById('apFormEmail').value.trim(),
  };
  for (let i = 1; i <= 6; i++) {
    data[`t${i}`] = document.getElementById(`apTier${i}`)?.value ?? '';
  }

  if (id) {
    await updateDoc(doc(db, 'picks', id), data);
  } else {
    await addDoc(collection(db, 'picks'), { ...data, submittedAt: serverTimestamp() });
  }

  closeAddPickModal();
  await loadPicksForAdmin();
}

window.deletePick = async function(id) {
  if (!confirm('Delete this pick?')) return;
  await deleteDoc(doc(getDb(), 'picks', id));
  await loadPicksForAdmin();
};

// ─── SCORE OVERRIDES ──────────────────────────────────────────────────────────
export async function loadScoresForAdmin() {
  const tournamentId = document.getElementById('scoresTournamentSelect').value;
  const container = document.getElementById('scoresAdminTable');
  if (!tournamentId) { container.innerHTML = '<p class="muted">Select a tournament.</p>'; return; }

  const db = getDb();
  const snap = await getDoc(doc(db, 'scores', tournamentId));
  if (!snap.exists()) {
    container.innerHTML = '<p class="muted">No scores loaded yet. Scores are fetched automatically from the ESPN API during the tournament.</p>';
    return;
  }

  const { _lastUpdated, ...scores } = snap.data();
  const entries = Object.entries(scores).sort((a, b) => (a[1].score ?? 0) - (b[1].score ?? 0));

  container.innerHTML = `
    <table class="admin-table">
      <thead><tr><th>Golfer</th><th>Score</th><th>Position</th><th>Status</th><th>Override</th></tr></thead>
      <tbody>
        ${entries.map(([name, g]) => `
          <tr>
            <td>${escapeHtml(name)}</td>
            <td>${g.score >= 0 ? '+'+g.score : g.score}</td>
            <td>${escapeHtml(g.position ?? '—')}</td>
            <td>${escapeHtml(g.status ?? 'active')}</td>
            <td>
              <input type="number" id="override_${name.replace(/\s/g,'_')}" value="${g.score}" style="width:70px" />
              <select id="overrideStatus_${name.replace(/\s/g,'_')}">
                <option value="active" ${g.status==='active'?'selected':''}>active</option>
                <option value="cut" ${g.status==='cut'?'selected':''}>cut</option>
                <option value="wd" ${g.status==='wd'?'selected':''}>wd</option>
              </select>
              <button class="btn btn-sm" onclick="saveScoreOverride('${tournamentId}','${escapeHtml(name)}')">Save</button>
            </td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;
}

window.saveScoreOverride = async function(tournamentId, name) {
  const key = name.replace(/\s/g,'_');
  const score = Number(document.getElementById(`override_${key}`)?.value ?? 0);
  const status = document.getElementById(`overrideStatus_${key}`)?.value ?? 'active';
  const db = getDb();
  const ref = doc(db, 'scores', tournamentId);
  const snap = await getDoc(ref);
  const data = snap.exists() ? snap.data() : {};
  data[name] = { ...(data[name] ?? {}), score, status };
  await setDoc(ref, data);
  alert(`Score updated for ${name}.`);
};

// ─── PRIZE CALCULATOR ─────────────────────────────────────────────────────────
export async function loadPrizesForAdmin() {
  const tournamentId = document.getElementById('prizeTournamentSelect').value;
  const container = document.getElementById('prizeCalcResults');
  if (!tournamentId) { container.innerHTML = '<p class="muted">Select a tournament.</p>'; return; }

  const db = getDb();
  const [tSnap, picksSnap, scoreSnap] = await Promise.all([
    getDoc(doc(db, 'tournaments', tournamentId)),
    getDocs(query(collection(db, 'picks'), where('tournamentId', '==', tournamentId))),
    getDoc(doc(db, 'scores', tournamentId))
  ]);

  if (!tSnap.exists()) { container.innerHTML = '<p class="muted">Tournament not found.</p>'; return; }
  const tournament = tSnap.data();
  const picks = [];
  picksSnap.forEach(d => picks.push({ id: d.id, ...d.data() }));

  const { _lastUpdated, ...scoresMap } = scoreSnap.exists() ? scoreSnap.data() : {};
  const standings = calculateStandings(picks, scoresMap ?? {}, tournament.mcPenalty ?? 20);
  const totalPool = (tournament.entryFee ?? 0) * picks.length;
  const payouts = calculatePrizes(standings, totalPool, tournament.prizePayouts ?? []);

  container.innerHTML = `
    <p><strong>Total Pool: $${totalPool}</strong> (${picks.length} entries × $${tournament.entryFee ?? 0})</p>
    <table>
      <thead><tr><th>Rank</th><th>Entrant</th><th>Total</th><th>Prize</th></tr></thead>
      <tbody>
        ${payouts.map(p => `
          <tr>
            <td>${p.rank}</td>
            <td>${escapeHtml(p.entrantName)}</td>
            <td>${p.total >= 0 ? '+'+p.total : p.total}</td>
            <td>${p.prize > 0 ? '$'+Math.round(p.prize) : '—'}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;
}

// ─── Modals ───────────────────────────────────────────────────────────────────
export function closeAllModals() {
  document.querySelectorAll('.modal').forEach(m => m.classList.add('hidden'));
  document.getElementById('modalOverlay').classList.add('hidden');
}

// ─── Utility ──────────────────────────────────────────────────────────────────
function escapeHtml(str) {
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
