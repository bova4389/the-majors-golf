// Pure scoring logic — no Firebase, no DOM. Import anywhere.

/**
 * Format a raw score number as a display string.
 */
export function formatScore(score, status) {
  if (status === 'cut' || status === 'wd') return status === 'wd' ? 'WD' : 'MC';
  if (typeof score !== 'number') return '-';
  if (score === 0) return 'E';
  return score > 0 ? `+${score}` : `${score}`;
}

/**
 * Returns the CSS class for a score value.
 */
export function scoreClass(score, status) {
  if (status === 'cut' || status === 'wd') return 'score-mc';
  if (typeof score !== 'number') return '';
  if (score < 0) return 'score-under';
  if (score > 0) return 'score-over';
  return 'score-even';
}

/**
 * Get the effective score for a golfer (MC/WD = mcPenalty).
 */
export function effectiveScore(golferName, scoresMap, mcPenalty) {
  const g = scoresMap[golferName];
  if (!g) return mcPenalty;
  if (g.status === 'cut' || g.status === 'wd') return mcPenalty;
  return typeof g.score === 'number' ? g.score : mcPenalty;
}

/**
 * Calculate standings for all picks against current scores.
 * Total = best 4 of 6 golfers' scores. isTop4 flag marks which golfers count.
 */
export function calculateStandings(picks, scoresMap, mcPenalty) {
  const results = picks.map(pick => {
    const tierScores = {};
    const scoreEntries = [];

    for (let i = 1; i <= 6; i++) {
      const golfer = pick[`t${i}`];
      const score = effectiveScore(golfer, scoresMap, mcPenalty);
      const status = scoresMap[golfer]?.status || 'active';
      tierScores[`t${i}`] = { golfer, score, status };
      scoreEntries.push({ tier: `t${i}`, score });
    }

    // Best 4 of 6: sort ascending, sum the 4 lowest scores
    const sorted = [...scoreEntries].sort((a, b) => a.score - b.score);
    const topFourTiers = new Set(sorted.slice(0, 4).map(e => e.tier));
    const total = sorted.slice(0, 4).reduce((sum, e) => sum + e.score, 0);
    const fifth = sorted[4].score;
    const sixth = sorted[5].score;

    for (const tier of Object.keys(tierScores)) {
      tierScores[tier].isTop4 = topFourTiers.has(tier);
    }

    return { pick, tierScores, total, fifth, sixth };
  });

  // Sort by best-4 total, then 5th-best score, then 6th-best score
  results.sort((a, b) =>
    a.total !== b.total ? a.total - b.total :
    a.fifth !== b.fifth ? a.fifth - b.fifth :
    a.sixth - b.sixth
  );

  let rank = 1;
  for (let i = 0; i < results.length; i++) {
    if (i > 0 && (
      results[i].total !== results[i - 1].total ||
      results[i].fifth !== results[i - 1].fifth ||
      results[i].sixth !== results[i - 1].sixth
    )) rank = i + 1;
    results[i].rank = rank;
  }

  return results;
}

/**
 * Calculate prize payouts for a final tournament.
 */
export function calculatePrizes(standings, totalPool, payoutConfig) {
  const payouts = [];

  const byRank = {};
  for (const s of standings) {
    if (!byRank[s.rank]) byRank[s.rank] = [];
    byRank[s.rank].push(s);
  }

  let place = 1;
  for (const group of Object.values(byRank)) {
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
