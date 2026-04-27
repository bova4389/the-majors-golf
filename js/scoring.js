// Pure scoring logic — no Firebase, no DOM. Import anywhere.

/**
 * Format a raw score number as a display string.
 * Returns "-12", "E", "+3", or "MC" / "WD" for penalty values.
 */
export function formatScore(score, status) {
  if (status === 'cut' || status === 'wd') return status === 'wd' ? 'WD' : 'MC';
  if (typeof score !== 'number') return '-';
  if (score === 0) return 'E';
  return score > 0 ? `+${score}` : `${score}`;
}

/**
 * Returns the CSS class for a score cell.
 */
export function scoreClass(score, status) {
  if (status === 'cut' || status === 'wd') return 'score-mc';
  if (typeof score !== 'number') return '';
  if (score < 0) return 'score-under';
  if (score > 0) return 'score-over';
  return 'score-even';
}

/**
 * Get the effective score for a golfer.
 * If cut or WD, returns the mcPenalty value.
 */
export function effectiveScore(golferName, scoresMap, mcPenalty) {
  const g = scoresMap[golferName];
  if (!g) return mcPenalty; // not found = treat as MC
  if (g.status === 'cut' || g.status === 'wd') return mcPenalty;
  return typeof g.score === 'number' ? g.score : mcPenalty;
}

/**
 * Calculate standings for all picks against current scores.
 *
 * @param {Array}  picks     - Array of pick objects from Firestore
 * @param {Object} scoresMap - { golferName: { score, position, status } }
 * @param {number} mcPenalty - Strokes to assign for MC/WD
 * @returns {Array} Sorted array of { pick, tierScores, total, rank }
 */
export function calculateStandings(picks, scoresMap, mcPenalty) {
  const results = picks.map(pick => {
    const tierScores = {};
    let total = 0;
    for (let i = 1; i <= 6; i++) {
      const golfer = pick[`t${i}`];
      const score = effectiveScore(golfer, scoresMap, mcPenalty);
      tierScores[`t${i}`] = { golfer, score, status: scoresMap[golfer]?.status || 'active' };
      total += score;
    }
    return { pick, tierScores, total };
  });

  // Sort ascending (lower score = better)
  results.sort((a, b) => a.total - b.total);

  // Assign ranks (ties get the same rank)
  let rank = 1;
  for (let i = 0; i < results.length; i++) {
    if (i > 0 && results[i].total !== results[i - 1].total) rank = i + 1;
    results[i].rank = rank;
  }

  return results;
}

/**
 * Calculate prize payouts for a final tournament.
 *
 * @param {Array}  standings    - Result of calculateStandings()
 * @param {number} totalPool    - Total prize money
 * @param {Array}  payoutConfig - [{ place, pct }, ...] e.g. [{place:1,pct:40},{place:2,pct:25}]
 * @returns {Array} [{ entrantName, rank, prize }, ...]
 */
export function calculatePrizes(standings, totalPool, payoutConfig) {
  const payouts = [];

  // Group standings by rank
  const byRank = {};
  for (const s of standings) {
    if (!byRank[s.rank]) byRank[s.rank] = [];
    byRank[s.rank].push(s);
  }

  let place = 1;
  for (const group of Object.values(byRank)) {
    // Find all prize places this group occupies
    const places = Array.from({ length: group.length }, (_, i) => place + i);
    const totalPct = places.reduce((sum, p) => {
      const config = payoutConfig.find(c => c.place === p);
      return sum + (config ? config.pct : 0);
    }, 0);
    const sharedPrize = (totalPool * totalPct) / 100 / group.length;

    for (const s of group) {
      payouts.push({
        entrantName: s.pick.entrantName,
        rank: s.rank,
        total: s.total,
        prize: sharedPrize > 0 ? sharedPrize : 0
      });
    }
    place += group.length;
  }

  return payouts;
}
