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
        icon: '📊', title: 'Overachiever', tag: 'vs expected wins',
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
        icon: '💎', title: 'Draft Steal', tag: 'season',
        name: `${logoImg(best.meta)}${teamLabel(best.meta, best.meta.school)}`,
        value: `pick #${best.overall}, ${ordinal(best.scoreRank)} in points`, tone: 'good'
    };
}

// Giant killer: drafted team's win over the highest-ranked opponent (where the
// winner was unranked or lower-ranked — a genuine upset).
// games: [{ homeTeam, awayTeam, homePoints, awayPoints, week, completed }]
// rankByWeek: { [week]: { [school]: rank } }; draftedNames: Set of school names
function giantKillerCard(games, rankByWeek, draftedNames, metaByName) {
    let best = null;
    (games || []).forEach(g => {
        if (!g.completed) return;
        const homeWon = g.homePoints > g.awayPoints;
        const awayWon = g.awayPoints > g.homePoints;
        if (!homeWon && !awayWon) return;
        const winner = homeWon ? g.homeTeam : g.awayTeam;
        const loser = homeWon ? g.awayTeam : g.homeTeam;
        if (!draftedNames.has(winner)) return;
        const wk = (rankByWeek && rankByWeek[g.week]) || {};
        const loserRank = wk[loser];
        if (!loserRank) return;                       // opponent must be ranked
        const winnerRank = wk[winner];
        if (winnerRank && winnerRank <= loserRank) return; // winner favored → not an upset
        if (!best || loserRank < best.loserRank) best = { winner, loser, loserRank };
    });
    if (!best) return null;
    const meta = (metaByName && metaByName[best.winner]) || null;
    return {
        icon: '🐉', title: 'Giant Killer', tag: 'season',
        name: `${logoImg(meta)}${teamLabel(meta, best.winner)}`,
        value: `beat #${best.loserRank} ${escapeHtml(best.loser)}`, tone: 'good'
    };
}

function buildAdvancedHighlights({ records, metaById, picks, scoreById, games, rankByWeek, draftedNames, metaByName }) {
    return [
        overachieverCard(records, metaById),
        draftStealCard(picks, scoreById),
        giantKillerCard(games, rankByWeek, draftedNames, metaByName)
    ].filter(Boolean);
}

module.exports = { overachieverCard, draftStealCard, giantKillerCard, buildAdvancedHighlights };
