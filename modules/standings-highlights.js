// Pure computation of the "advanced" league highlights that need data the
// Standings page doesn't itself load (records/xWins, games+rankings, draft
// order). routes/standings.js gathers the data from Mongo and hands it here.
// DB-free so it's unit-testable. Each builder returns a highlight card in the
// same shape the client renderer (buildHighlightsHtml) expects, or null.

function escapeHtml(v) {
    return String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
const round = (v) => Math.round(v * 10) / 10;
function ordinal(n) {
    const s = ['th', 'st', 'nd', 'rd'], v = n % 100;
    return n + (s[(v - 20) % 10] || s[v] || s[0]);
}
function logoImg(meta) {
    return (meta && meta.logos && meta.logos.length) ? `<img src="${meta.logos[meta.logos.length - 1]}" class="hl-logo">` : '';
}
function teamLabel(meta, fallback) {
    return escapeHtml((meta && meta.mascot) || fallback || '');
}

// Overachiever: drafted team whose actual wins most exceed its expected wins.
// records: [{ teamId, team, expectedWins, total: { wins } }] (drafted teams only)
function overachieverCard(records, metaById) {
    let best = null;
    (records || []).forEach(r => {
        const wins = r.total && typeof r.total.wins === 'number' ? r.total.wins : null;
        const xw = typeof r.expectedWins === 'number' ? r.expectedWins : null;
        if (wins == null || xw == null) return;
        const diff = wins - xw;
        if (!best || diff > best.diff) best = { teamId: r.teamId, team: r.team, diff };
    });
    if (!best || best.diff < 0.5) return null;   // only when meaningfully over
    const meta = (metaById && metaById[best.teamId]) || null;
    return {
        icon: 'chart', title: 'Overachiever', tag: 'vs expected wins',
        name: `${logoImg(meta)}${teamLabel(meta, best.team)}`,
        value: `+${round(best.diff)} wins`, tone: 'good'
    };
}

// Draft steal: the pick that scored far better than where it was drafted —
// biggest positive gap between pick order and points rank.
// picks: [{ overall, team: { id, mascot, school, logos } }]; scoreById: { id: pts }
function draftStealCard(picks, scoreById) {
    const rows = (picks || [])
        .filter(p => p && p.team && p.team.id != null)
        .map(p => ({ id: p.team.id, overall: p.overall, meta: p.team, score: (scoreById && scoreById[p.team.id]) || 0 }));
    if (rows.length < 3) return null;

    rows.slice().sort((a, b) => a.overall - b.overall).forEach((r, i) => { r.pickRank = i + 1; });
    rows.slice().sort((a, b) => b.score - a.score).forEach((r, i) => { r.scoreRank = i + 1; });

    let best = null;
    rows.forEach(r => {
        const edge = r.pickRank - r.scoreRank;   // + = scored better than drafted
        if (r.score > 0 && (!best || edge > best.edge)) best = { ...r, edge };
    });
    if (!best || best.edge <= 0) return null;
    return {
        icon: 'gem', title: 'Draft Steal', tag: 'season',
        name: `${logoImg(best.meta)}${teamLabel(best.meta, best.meta.school)}`,
        value: `pick #${best.overall}, ${ordinal(best.scoreRank)} in points`, tone: 'good'
    };
}

// Biggest upset: the drafted team that won as the largest betting underdog.
// games: [{ id, week, homeTeam, awayTeam, homePoints, awayPoints, completed }]
// spreadByGameId: { [gameId]: homeSpread } where a POSITIVE home spread means
//   the home team was the underdog by that many points (CFBD convention), so a
//   negative spread means the home team was favored.
// fantasyByGameId: { [gameId]: { [teamName]: fantasyPoints } } — the points the
//   drafting owner banked from that team in that game (used for the card detail).
function biggestUpsetCard(games, spreadByGameId, draftedNames, metaByName, fantasyByGameId) {
    let best = null;
    (games || []).forEach(g => {
        if (!g.completed) return;
        const homeWon = g.homePoints > g.awayPoints;
        const awayWon = g.awayPoints > g.homePoints;
        if (!homeWon && !awayWon) return;
        const winner = homeWon ? g.homeTeam : g.awayTeam;
        const loser = homeWon ? g.awayTeam : g.homeTeam;
        if (!draftedNames.has(winner)) return;
        const spread = spreadByGameId ? spreadByGameId[g.id] : undefined;
        if (spread == null) return;
        // Underdog margin for the winner: home won while a home underdog
        // (spread > 0), or away won while the home team was favored (spread < 0).
        const margin = homeWon ? (spread > 0 ? spread : null) : (spread < 0 ? -spread : null);
        if (margin == null || margin <= 0) return;
        if (!best || margin > best.margin) best = { game: g, winner, loser, margin, homeWon };
    });
    if (!best) return null;
    const g = best.game;
    const meta = (metaByName && metaByName[best.winner]) || null;
    const winScore = best.homeWon ? g.homePoints : g.awayPoints;
    const loseScore = best.homeWon ? g.awayPoints : g.homePoints;
    const fantasy = fantasyByGameId && fantasyByGameId[g.id] ? fantasyByGameId[g.id][best.winner] : undefined;

    // Fantasy points the owner banked lead the card (that's the payoff); the
    // matchup, final score and underdog margin sit in the detail line.
    const value = typeof fantasy === 'number'
        ? `+${round(fantasy)} pts`
        : `${round(best.margin)}-pt dog`;
    const detail = `beat ${escapeHtml(best.loser)} ${winScore}–${loseScore} · ${round(best.margin)}-pt underdog`;
    return {
        icon: 'upset', title: 'Biggest Upset',
        tag: g.week != null ? `week ${g.week}` : 'season',
        name: `${logoImg(meta)}${teamLabel(meta, best.winner)}`,
        value, sub: detail, tone: 'good'
    };
}

function buildAdvancedHighlights({ records, metaById, picks, scoreById, games, spreadByGameId, draftedNames, metaByName, fantasyByGameId }) {
    return [
        overachieverCard(records, metaById),
        draftStealCard(picks, scoreById),
        biggestUpsetCard(games, spreadByGameId, draftedNames, metaByName, fantasyByGameId)
    ].filter(Boolean);
}

module.exports = { overachieverCard, draftStealCard, biggestUpsetCard, buildAdvancedHighlights };
