import { getDb } from './firebase-config.js';
import {
  collection, addDoc, getDocs, getDoc, doc, query, where, serverTimestamp, updateDoc
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';

// Keys must match the values in admin.html's tFormMajor <select>
const MAJORS = [
  { key: 'masters',  label: 'The Masters',           short: 'Masters'  },
  { key: 'pga',      label: 'PGA Championship',       short: 'PGA'      },
  { key: 'us-open',  label: 'U.S. Open',              short: 'US Open'  },
  { key: 'the-open', label: 'The Open Championship',  short: 'The Open' },
];

let _allTournaments = [];
let _activeTournament = null;

// Edit flow state
let _editTournament = null;
let _editFoundPicks = [];
let _editingPick = null;
let _editTiersData = null;
let _pendingEditPicks = null;

// ─── Entry point ──────────────────────────────────────────────────────────────
export async function loadPickForm() {
  const db = getDb();
  show('loadingMsg');

  try {
    const snap = await getDocs(collection(db, 'tournaments'));
    _allTournaments = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  } catch (err) {
    hide('loadingMsg');
    const el = document.getElementById('noTournament');
    el.querySelector('p').textContent = 'Could not load tournament data. Please try refreshing the page.';
    show('noTournament');
    return;
  }

  hide('loadingMsg');
  renderTournamentSelect();
  show('tournamentSelect');
}

// ─── Tournament selection grid ────────────────────────────────────────────────
function renderTournamentSelect() {
  const grid = document.getElementById('majorCards');
  grid.innerHTML = '';

  MAJORS.forEach(({ key, label, short }) => {
    // Most-recent tournament for this major
    const t = _allTournaments
      .filter(x => x.major === key)
      .sort((a, b) => (b.year ?? 0) - (a.year ?? 0))[0];

    const isOpen = t && t.status === 'open' && !isPastDeadline(t);
    const deadline = t?.pickDeadline ? new Date(t.pickDeadline) : null;

    const card = document.createElement('div');
    card.className = `major-card major-card--${key}${isOpen ? ' major-card--open' : ' major-card--locked'}`;

    if (isOpen) {
      card.addEventListener('click', () => openPicksForm(t));
      card.setAttribute('role', 'button');
      card.setAttribute('tabindex', '0');
      card.addEventListener('keydown', e => {
        if (e.key === 'Enter' || e.key === ' ') openPicksForm(t);
      });
    }

    card.innerHTML = `
      <div class="major-card-badge">${escapeHtml(short)}</div>
      <div class="major-card-name">${escapeHtml(label)}</div>
      <div class="major-card-year">2026</div>
      <div class="major-card-status">
        ${isOpen
          ? '<span class="major-card-open-label">Submit Picks →</span>'
          : '<span class="major-card-locked-label">🔒 Closed</span>'}
      </div>
      ${isOpen && deadline
        ? `<div class="major-card-deadline">Due ${deadline.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</div>`
        : ''}
    `;

    grid.appendChild(card);
  });
}

// ─── Return to tournament selection ──────────────────────────────────────────
export function backToTournamentSelect() {
  _activeTournament = null;
  _editTournament = null;
  _editFoundPicks = [];
  _editingPick = null;
  _editTiersData = null;
  _pendingEditPicks = null;
  ['pickForm', 'lockedMsg', 'noTournament', 'loadingMsg', 'successMsg', 'editFlow'].forEach(id => hide(id));
  document.getElementById('successMailtoBtn')?.classList.add('hidden');
  const errEl = document.getElementById('formError');
  if (errEl) errEl.classList.add('hidden');
  document.getElementById('picksForm')?.reset();
  show('tournamentSelect');
}

// ─── Load picks form for selected tournament ──────────────────────────────────
async function openPicksForm(tournament) {
  hide('tournamentSelect');
  show('loadingMsg');

  if (tournament.status !== 'open' || isPastDeadline(tournament)) {
    hide('loadingMsg');
    show('lockedMsg');
    return;
  }

  let tierSnap;
  try {
    const db = getDb();
    tierSnap = await getDoc(doc(db, 'tiers', tournament.id));
  } catch (err) {
    hide('loadingMsg');
    const el = document.getElementById('noTournament');
    el.querySelector('p').textContent = 'Could not load tier data. Please try refreshing.';
    show('noTournament');
    return;
  }

  hide('loadingMsg');

  if (!tierSnap.exists()) {
    const el = document.getElementById('noTournament');
    el.querySelector('p').textContent = 'Golfer tiers have not been set up yet. Check back soon.';
    show('noTournament');
    return;
  }

  _activeTournament = tournament;

  // Always reset submit button — may still be disabled from a prior submission
  const submitBtn = document.getElementById('submitBtn');
  if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'Submit My Picks'; }

  document.getElementById('formTournamentName').textContent = tournament.name;
  const deadline = tournament.pickDeadline ? new Date(tournament.pickDeadline) : null;
  document.getElementById('formDeadline').textContent = deadline
    ? `Picks due by ${deadline.toLocaleString()}`
    : '';

  renderTierSelects(tierSnap.data());
  show('pickForm');
}

// ─── Render tier dropdowns ────────────────────────────────────────────────────
function renderTierSelects(tiers) {
  const container = document.getElementById('tierPicksContainer');
  container.innerHTML = '';

  for (let i = 1; i <= 6; i++) {
    const golfers = (tiers[`tier${i}`] ?? []).slice().sort((a, b) => a.name.localeCompare(b.name));
    const row = document.createElement('div');
    row.className = 'tier-row';

    const label = document.createElement('span');
    label.className = 'tier-label';
    label.textContent = `Tier ${i}`;

    const select = document.createElement('select');
    select.id = `tierPick${i}`;
    select.required = true;
    select.innerHTML = `<option value="">— Select a golfer —</option>` +
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
    if (!_activeTournament) throw new Error('No tournament selected.');

    // Re-fetch to validate current state before writing
    const tSnap = await getDoc(doc(db, 'tournaments', _activeTournament.id));
    const tournament = tSnap.exists() ? { id: tSnap.id, ...tSnap.data() } : null;

    if (!tournament || tournament.status !== 'open') throw new Error('This tournament is no longer accepting picks.');

    const deadline = tournament.pickDeadline ? new Date(tournament.pickDeadline) : null;
    if (deadline && Date.now() > deadline) throw new Error('Picks are now locked. The deadline has passed.');

    const realName    = document.getElementById('entrantRealName').value.trim();
    const entrantName = document.getElementById('entrantName').value.trim();
    const entrantEmail = document.getElementById('entrantEmail').value.trim();
    const entrantPhone = document.getElementById('entrantPhone').value.trim();
    const entrantPin   = document.getElementById('entrantPin').value.trim();

    if (!realName)     throw new Error('Please enter your name.');
    if (!entrantName)  throw new Error('Please enter a Picks Name.');
    if (!entrantEmail) throw new Error('Please enter your email.');
    if (!entrantPhone) throw new Error('Please enter your cell phone number.');
    if (!/^\d{4}$/.test(entrantPin)) throw new Error('Please create a 4-digit PIN (numbers only).');

    const dupSnap = await getDocs(
      query(collection(db, 'picks'),
        where('tournamentId', '==', tournament.id),
        where('entrantName', '==', entrantName)
      )
    );
    if (!dupSnap.empty) throw new Error(`Picks Name "${entrantName}" is already taken for this tournament. Choose a different Picks Name.`);

    const pinHash = await hashPin(entrantPin, entrantEmail);
    const picks = { tournamentId: tournament.id, realName, entrantName, email: entrantEmail, phone: entrantPhone, pinHash, submittedAt: serverTimestamp() };
    for (let i = 1; i <= 6; i++) {
      const val = document.getElementById(`tierPick${i}`)?.value;
      if (!val) throw new Error(`Please select a golfer for Tier ${i}.`);
      picks[`t${i}`] = val;
    }

    // Capture golfer selections before the form resets
    const tierSelections = [];
    for (let i = 1; i <= 6; i++) {
      tierSelections.push({ tier: i, golfer: picks[`t${i}`] });
    }

    await addDoc(collection(db, 'picks'), picks);

    btn.disabled = false;
    btn.textContent = 'Submit My Picks';
    hide('pickForm');
    showSuccessSummary(entrantName, tournament.name, entrantEmail, tierSelections, entrantPin);
    show('successMsg');
    _activeTournament = null;

  } catch (err) {
    errEl.textContent = err.message;
    errEl.classList.remove('hidden');
    btn.disabled = false;
    btn.textContent = 'Submit My Picks';
  }
}

// ─── Success summary ──────────────────────────────────────────────────────────
function showSuccessSummary(picksName, tournamentName, email, tierSelections, pin) {
  document.getElementById('successDetail').textContent =
    `${picksName}'s picks for ${tournamentName} have been saved. Good luck!`;

  // Render picks summary table
  const summaryEl = document.getElementById('successPicksSummary');
  if (summaryEl) {
    summaryEl.innerHTML = tierSelections.map(({ tier, golfer }) =>
      `<tr><td class="success-tier-label">Tier ${tier}</td><td>${escapeHtml(golfer)}</td></tr>`
    ).join('');
  }

  // Show PIN reminder
  const pinEl = document.getElementById('successPinReminder');
  if (pinEl && pin) {
    pinEl.innerHTML = `<strong>Your Pick PIN: ${escapeHtml(pin)}</strong> — Save this! You'll need your email + this PIN to edit your picks before the tournament starts.`;
    pinEl.classList.remove('hidden');
  }

  // Build mailto link so they can email themselves a copy
  const mailtoEl = document.getElementById('successMailtoBtn');
  if (mailtoEl && email) {
    const subject = encodeURIComponent(`Your ${tournamentName} Picks — ${picksName}`);
    const body = encodeURIComponent(
      `Here are your picks for ${tournamentName}:\n\n` +
      tierSelections.map(({ tier, golfer }) => `Tier ${tier}: ${golfer}`).join('\n') +
      `\n\nPicks Name: ${picksName}\nYour Pick PIN: ${pin ?? ''}` +
      `\n\nTo edit your picks before the tournament starts, visit the site, click "Submit Picks", then "Edit a Previous Submission".\n\nGood luck!`
    );
    mailtoEl.href = `mailto:${encodeURIComponent(email)}?subject=${subject}&body=${body}`;
    mailtoEl.classList.remove('hidden');
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function isPastDeadline(t) {
  const d = t.pickDeadline ? new Date(t.pickDeadline) : null;
  return d && Date.now() > d;
}

function show(id) { document.getElementById(id)?.classList.remove('hidden'); }
function hide(id) { document.getElementById(id)?.classList.add('hidden'); }

function escapeHtml(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

async function hashPin(pin, email) {
  const data = new TextEncoder().encode(pin.trim() + ':' + email.trim().toLowerCase());
  const buf = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

// ─── Edit flow ────────────────────────────────────────────────────────────────

export function openEditFlow() {
  hide('pickForm');
  document.getElementById('editFlowTournamentName').textContent = _activeTournament?.name ?? '';
  document.getElementById('editEmail').value = '';
  document.getElementById('editPin').value = '';
  document.getElementById('editLookupError').classList.add('hidden');
  _editTournament = _activeTournament;
  _editFoundPicks = [];
  _editingPick = null;
  _editTiersData = null;
  _pendingEditPicks = null;
  _showEditStep('editLookup');
  show('editFlow');
}

export function closeEditFlow() {
  hide('editFlow');
  show('pickForm');
}

function _showEditStep(stepId) {
  ['editLookup', 'editPicksList', 'editPicksForm', 'editSuccess'].forEach(id => hide(id));
  show(stepId);
}

export function showEditLookup() {
  document.getElementById('editLookupError').classList.add('hidden');
  _showEditStep('editLookup');
}

export function backToEditList() {
  if (_editFoundPicks.length > 1) {
    _showEditStep('editPicksList');
  } else {
    _showEditStep('editLookup');
  }
}

export async function lookupPicksForEdit() {
  const errEl = document.getElementById('editLookupError');
  errEl.classList.add('hidden');

  const email = document.getElementById('editEmail').value.trim();
  const pin   = document.getElementById('editPin').value.trim();

  if (!email) { errEl.textContent = 'Please enter your email.'; errEl.classList.remove('hidden'); return; }
  if (!/^\d{4}$/.test(pin)) { errEl.textContent = 'Please enter your 4-digit PIN.'; errEl.classList.remove('hidden'); return; }

  const tournament = _editTournament;
  if (!tournament) { errEl.textContent = 'No tournament selected.'; errEl.classList.remove('hidden'); return; }

  const findBtn = document.getElementById('editFindBtn');
  if (findBtn) { findBtn.disabled = true; findBtn.textContent = 'Searching…'; }

  try {
    const db = getDb();
    const pinHash = await hashPin(pin, email);

    const snap = await getDocs(
      query(collection(db, 'picks'),
        where('tournamentId', '==', tournament.id),
        where('email', '==', email)
      )
    );

    const matches = snap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .filter(p => p.pinHash === pinHash);

    if (matches.length === 0) {
      errEl.textContent = 'Please check your email and PIN — no matching submissions were found. If you\'re still having issues, please reach out to the Commissioner.';
      errEl.classList.remove('hidden');
      return;
    }

    _editFoundPicks = matches;

    if (matches.length === 1) {
      await openEditPickForm(matches[0]);
    } else {
      _renderEditPicksList(matches);
      _showEditStep('editPicksList');
    }

  } catch (err) {
    errEl.textContent = 'Error looking up picks. Please try again.';
    errEl.classList.remove('hidden');
  } finally {
    if (findBtn) { findBtn.disabled = false; findBtn.textContent = 'Find My Picks'; }
  }
}

function _renderEditPicksList(picks) {
  const container = document.getElementById('editPicksListItems');
  const count = picks.length;
  container.innerHTML =
    `<p class="picks-instruction">Found ${count} entr${count === 1 ? 'y' : 'ies'} for this tournament. Select one to edit:</p>` +
    picks.map(p => {
      const subDate = p.submittedAt?.toDate ? p.submittedAt.toDate().toLocaleDateString() : '';
      return `<div class="edit-pick-card" onclick="openEditPickFormById('${p.id}')">
        <strong>${escapeHtml(p.entrantName)}</strong>
        ${subDate ? `<span class="muted"> — submitted ${subDate}</span>` : ''}
      </div>`;
    }).join('');
}

export async function openEditPickFormById(pickId) {
  const pick = _editFoundPicks.find(p => p.id === pickId);
  if (pick) await openEditPickForm(pick);
}

async function openEditPickForm(pick) {
  _editingPick = pick;
  const tournament = _editTournament;

  if (!_editTiersData) {
    const db = getDb();
    const tierSnap = await getDoc(doc(db, 'tiers', tournament.id));
    _editTiersData = tierSnap.exists() ? tierSnap.data() : {};
  }

  document.getElementById('editPickName').textContent = `Editing: "${escapeHtml(pick.entrantName)}"`;
  const deadline = tournament.pickDeadline ? new Date(tournament.pickDeadline) : null;
  document.getElementById('editPickDeadline').textContent = deadline
    ? `Picks lock at ${deadline.toLocaleString()}`
    : '';

  const isLocked = tournament.status !== 'open' || isPastDeadline(tournament);
  document.getElementById('editLockedBanner').classList.toggle('hidden', !isLocked);
  document.getElementById('editTierSection').classList.toggle('hidden', isLocked);
  document.getElementById('editSaveRow').classList.toggle('hidden', isLocked);
  document.getElementById('editFormError').classList.add('hidden');

  if (!isLocked) {
    _renderEditTierSelects(_editTiersData, pick);
  } else {
    // Read-only view of current picks when locked
    const container = document.getElementById('editTierPicksContainer');
    container.innerHTML = [1,2,3,4,5,6].map(i =>
      `<div class="tier-row">
        <span class="tier-label">Tier ${i}</span>
        <span class="tier-locked-pick">${escapeHtml(pick[`t${i}`] ?? '—')}</span>
      </div>`
    ).join('');
    document.getElementById('editTierSection').classList.remove('hidden');
  }

  _showEditStep('editPicksForm');
}

function _renderEditTierSelects(tiers, pick) {
  const container = document.getElementById('editTierPicksContainer');
  container.innerHTML = '';
  for (let i = 1; i <= 6; i++) {
    const golfers = (tiers[`tier${i}`] ?? []).slice().sort((a, b) => a.name.localeCompare(b.name));
    const current = pick[`t${i}`] ?? '';
    const row = document.createElement('div');
    row.className = 'tier-row';
    const label = document.createElement('span');
    label.className = 'tier-label';
    label.textContent = `Tier ${i}`;
    const select = document.createElement('select');
    select.id = `editTierPick${i}`;
    select.innerHTML = `<option value="">— Select a golfer —</option>` +
      golfers.map(g => `<option value="${escapeHtml(g.name)}"${g.name === current ? ' selected' : ''}>${escapeHtml(g.name)}</option>`).join('');
    row.appendChild(label);
    row.appendChild(select);
    container.appendChild(row);
  }
}

export function showEditConfirmation() {
  const errEl = document.getElementById('editFormError');
  errEl.classList.add('hidden');

  const newPicks = {};
  for (let i = 1; i <= 6; i++) {
    const val = document.getElementById(`editTierPick${i}`)?.value;
    if (!val) {
      errEl.textContent = `Please select a golfer for Tier ${i}.`;
      errEl.classList.remove('hidden');
      return;
    }
    newPicks[`t${i}`] = val;
  }

  const changes = [];
  for (let i = 1; i <= 6; i++) {
    const oldG = _editingPick[`t${i}`] || '';
    const newG = newPicks[`t${i}`] || '';
    if (oldG !== newG) changes.push({ tier: i, from: oldG, to: newG });
  }

  const diffEl = document.getElementById('editConfirmDiff');
  if (changes.length === 0) {
    diffEl.innerHTML = '<p class="muted" style="margin:.5rem 0">No changes detected.</p>';
  } else {
    diffEl.innerHTML = `
      <table class="success-picks-table" style="margin:.75rem 0">
        <thead><tr><th style="text-align:left">Tier</th><th style="text-align:left">Was</th><th style="text-align:left">Now</th></tr></thead>
        <tbody>${changes.map(c => `
          <tr>
            <td class="success-tier-label">Tier ${c.tier}</td>
            <td class="muted">${escapeHtml(c.from)}</td>
            <td><strong>${escapeHtml(c.to)}</strong></td>
          </tr>`).join('')}
        </tbody>
      </table>`;
  }

  _pendingEditPicks = newPicks;
  show('editConfirmOverlay');
  show('editConfirmModal');
}

export function closeEditConfirm() {
  hide('editConfirmModal');
  hide('editConfirmOverlay');
}

export async function confirmEditSave() {
  if (!_pendingEditPicks) return;

  const saveBtn = document.getElementById('editConfirmSaveBtn');
  if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = 'Saving…'; }

  try {
    const tSnap = await getDoc(doc(getDb(), 'tournaments', _editTournament.id));
    const t = tSnap.exists() ? { id: tSnap.id, ...tSnap.data() } : null;
    if (!t || t.status !== 'open' || isPastDeadline(t)) {
      closeEditConfirm();
      const errEl = document.getElementById('editFormError');
      errEl.textContent = 'Picks are now locked — the tournament has started and no edits can be made.';
      errEl.classList.remove('hidden');
      return;
    }

    await updateDoc(doc(getDb(), 'picks', _editingPick.id), _pendingEditPicks);
    closeEditConfirm();
    _showEditSuccess(_pendingEditPicks);

  } catch (err) {
    closeEditConfirm();
    const errEl = document.getElementById('editFormError');
    errEl.textContent = 'Error saving changes. Please try again.';
    errEl.classList.remove('hidden');
  } finally {
    if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = 'Yes, Save Changes'; }
  }
}

function _showEditSuccess(savedPicks) {
  document.getElementById('editSuccessDetail').textContent =
    `"${_editingPick.entrantName}" has been updated for ${_editTournament.name}.`;
  const summaryEl = document.getElementById('editSuccessSummary');
  if (summaryEl) {
    summaryEl.innerHTML = [1,2,3,4,5,6].map(i =>
      `<tr><td class="success-tier-label">Tier ${i}</td><td>${escapeHtml(savedPicks[`t${i}`] ?? '')}</td></tr>`
    ).join('');
  }
  _showEditStep('editSuccess');
}
