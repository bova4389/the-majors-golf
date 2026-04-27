import { getDb } from './firebase-config.js';
import {
  collection, addDoc, getDocs, getDoc, doc, query, where, serverTimestamp
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';

// ─── Entry point ─────────────────────────────────────────────────────────────
export async function loadPickForm() {
  const db = getDb();
  document.getElementById('loadingMsg').classList.remove('hidden');

  // Find the active (open) tournament
  const snap = await getDocs(collection(db, 'tournaments'));
  let activeTournament = null;
  snap.forEach(d => {
    const t = { id: d.id, ...d.data() };
    if (t.status === 'open') activeTournament = t;
  });

  document.getElementById('loadingMsg').classList.add('hidden');

  if (!activeTournament) {
    document.getElementById('noTournament').classList.remove('hidden');
    return;
  }

  // Check if picks are locked
  const deadline = activeTournament.pickDeadline ? new Date(activeTournament.pickDeadline) : null;
  const isLocked = activeTournament.status !== 'open' || (deadline && Date.now() > deadline);
  if (isLocked) {
    document.getElementById('lockedMsg').classList.remove('hidden');
    return;
  }

  // Show form
  document.getElementById('formTournamentName').textContent = activeTournament.name;
  document.getElementById('formDeadline').textContent = deadline
    ? `Picks due by ${deadline.toLocaleString()}`
    : '';

  // Load tiers
  const tierSnap = await getDoc(doc(db, 'tiers', activeTournament.id));
  if (!tierSnap.exists()) {
    document.getElementById('noTournament').classList.remove('hidden');
    return;
  }
  const tiers = tierSnap.data();
  renderTierSelects(tiers, activeTournament.id);

  document.getElementById('pickForm').classList.remove('hidden');
}

// ─── Render tier dropdowns ────────────────────────────────────────────────────
function renderTierSelects(tiers, tournamentId) {
  const container = document.getElementById('tierPicksContainer');
  container.innerHTML = '';

  for (let i = 1; i <= 6; i++) {
    const golfers = tiers[`tier${i}`] ?? [];
    const row = document.createElement('div');
    row.className = 'tier-row';

    const label = document.createElement('span');
    label.className = 'tier-label';
    label.textContent = `Tier ${i}`;

    const select = document.createElement('select');
    select.id = `tierPick${i}`;
    select.required = true;
    select.innerHTML = `<option value="">— Select Tier ${i} golfer —</option>` +
      golfers.map(g => `<option value="${escapeHtml(g.name)}">${escapeHtml(g.name)}</option>`).join('');

    row.appendChild(label);
    row.appendChild(select);
    container.appendChild(row);
  }
}

// ─── Submit picks ─────────────────────────────────────────────────────────────
export async function submitPicks(event) {
  event.preventDefault();
  const db = getDb();

  const btn = document.getElementById('submitBtn');
  const errEl = document.getElementById('formError');
  errEl.classList.add('hidden');
  btn.disabled = true;
  btn.textContent = 'Submitting...';

  try {
    // Get active tournament again to validate password + deadline
    const snap = await getDocs(collection(db, 'tournaments'));
    let tournament = null;
    snap.forEach(d => { if (d.data().status === 'open') tournament = { id: d.id, ...d.data() }; });

    if (!tournament) throw new Error('No active tournament found.');

    const deadline = tournament.pickDeadline ? new Date(tournament.pickDeadline) : null;
    if (deadline && Date.now() > deadline) throw new Error('Picks are now locked. The deadline has passed.');

    const entrantName = document.getElementById('entrantName').value.trim();
    const entrantEmail = document.getElementById('entrantEmail').value.trim();
    const entryPassword = document.getElementById('entryPassword').value.trim();

    if (!entrantName) throw new Error('Please enter your name.');
    if (entryPassword !== tournament.entryPassword) throw new Error('Incorrect entry code. Check with the pool admin.');

    // Check for duplicate entry name
    const dupSnap = await getDocs(
      query(collection(db, 'picks'),
        where('tournamentId', '==', tournament.id),
        where('entrantName', '==', entrantName)
      )
    );
    if (!dupSnap.empty) throw new Error(`Picks already submitted for "${entrantName}". Contact admin to update.`);

    // Collect tier picks
    const picks = { tournamentId: tournament.id, entrantName, email: entrantEmail, submittedAt: serverTimestamp() };
    for (let i = 1; i <= 6; i++) {
      const val = document.getElementById(`tierPick${i}`)?.value;
      if (!val) throw new Error(`Please select a golfer for Tier ${i}.`);
      picks[`t${i}`] = val;
    }

    await addDoc(collection(db, 'picks'), picks);

    // Show success
    document.getElementById('pickForm').classList.add('hidden');
    document.getElementById('successDetail').textContent =
      `${entrantName}'s picks for ${tournament.name} have been saved. Good luck!`;
    document.getElementById('successMsg').classList.remove('hidden');

  } catch (err) {
    errEl.textContent = err.message;
    errEl.classList.remove('hidden');
    btn.disabled = false;
    btn.textContent = 'Submit My Picks';
  }
}

function escapeHtml(str) {
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
