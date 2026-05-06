import { getDb } from './firebase-config.js';
import {
  collection, addDoc, getDocs, getDoc, doc, query, where, serverTimestamp
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
  ['pickForm', 'lockedMsg', 'noTournament', 'loadingMsg', 'successMsg'].forEach(id => hide(id));
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

    if (!realName)     throw new Error('Please enter your name.');
    if (!entrantName)  throw new Error('Please enter a Picks Name.');
    if (!entrantEmail) throw new Error('Please enter your email.');
    if (!entrantPhone) throw new Error('Please enter your cell phone number.');

    const dupSnap = await getDocs(
      query(collection(db, 'picks'),
        where('tournamentId', '==', tournament.id),
        where('entrantName', '==', entrantName)
      )
    );
    if (!dupSnap.empty) throw new Error(`Picks Name "${entrantName}" is already taken for this tournament. Choose a different Picks Name.`);

    const picks = { tournamentId: tournament.id, realName, entrantName, email: entrantEmail, phone: entrantPhone, submittedAt: serverTimestamp() };
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
    showSuccessSummary(entrantName, tournament.name, entrantEmail, tierSelections);
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
function showSuccessSummary(picksName, tournamentName, email, tierSelections) {
  document.getElementById('successDetail').textContent =
    `${picksName}'s picks for ${tournamentName} have been saved. Good luck!`;

  // Render picks summary table
  const summaryEl = document.getElementById('successPicksSummary');
  if (summaryEl) {
    summaryEl.innerHTML = tierSelections.map(({ tier, golfer }) =>
      `<tr><td class="success-tier-label">Tier ${tier}</td><td>${escapeHtml(golfer)}</td></tr>`
    ).join('');
  }

  // Build mailto link so they can email themselves a copy
  const mailtoEl = document.getElementById('successMailtoBtn');
  if (mailtoEl && email) {
    const subject = encodeURIComponent(`Your ${tournamentName} Picks — ${picksName}`);
    const body = encodeURIComponent(
      `Here are your picks for ${tournamentName}:\n\n` +
      tierSelections.map(({ tier, golfer }) => `Tier ${tier}: ${golfer}`).join('\n') +
      `\n\nPicks Name: ${picksName}\n\nGood luck!`
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
