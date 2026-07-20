// Pure compute + HTML builders for the Standings view. No DOM, no fetch — so it
// can be exercised with mock data in a harness. standings.js imports these and
// injects the returned HTML / feeds the chart.

function escapeHtml(value) {
    return String(value == null ? '' : value)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

const season = (u) => (u && u.seasons && u.seasons[0]) || {};
const weekly = (u) => season(u).weeklyScore || [];
const cum = (u) => season(u).cumulativeScore || 0;
const initialName = (u) => `${u.firstName} ${u.lastName ? u.lastName[0] : ''}.`;
const franchiseName = (u) => season(u).franchiseName || null;
// Cumulative points through the first `n` weekly entries (matches how the
// season total is summed).
const cumThrough = (u, n) => weekly(u).slice(0, n).reduce((s, w) => s + (w.score || 0), 0);

const num = (v) => { const n = parseFloat(v); return isNaN(n) ? 0 : n; };
const round = (v) => Math.round(v * 10) / 10;

// Label for a weekly entry ("Week 5", or "Postseason").
function weekLabel(entry) {
    if (!entry) return '';
    if (entry.season === 'postseason') return 'Postseason';
    return 'Week ' + entry.week;
}

// --- ranked table rows -------------------------------------------------------

// Ranked rows with movement (rank change vs last week) and gap to the leader.
export function rankedRows(users) {
    const sorted = users.slice().sort((a, b) => cum(b) - cum(a));
    const weeks = sorted.length ? weekly(sorted[0]).length : 0;

    let prevRankById = null;
    if (weeks > 1) {
        prevRankById = {};
        users.slice().sort((a, b) => cumThrough(b, weeks - 1) - cumThrough(a, weeks - 1))
            .forEach((u, i) => { prevRankById[u._id] = i; });
    }

    const leader = sorted.length ? cum(sorted[0]) : 0;
    return sorted.map((u, i) => ({
        rank: i + 1,
        id: u._id,
        name: initialName(u),
        franchise: franchiseName(u),
        teams: season(u).teams || [],
        score: cum(u),
        gap: i === 0 ? 0 : leader - cum(u),
        delta: (prevRankById && prevRankById[u._id] != null) ? (prevRankById[u._id] - i) : null
    }));
}

function movementHtml(delta) {
    if (delta == null) return '';
    if (delta > 0) return `<span class="move up" title="Up ${delta}">▲${delta}</span>`;
    if (delta < 0) return `<span class="move down" title="Down ${-delta}">▼${-delta}</span>`;
    return `<span class="move flat" title="No change">–</span>`;
}

export function buildStandingsRowsHtml(rows) {
    return rows.map(r => {
        const medal = r.rank <= 3 ? ` medal-${r.rank}` : '';
        const crown = r.rank === 1 ? '<span class="crown" aria-label="Leader">👑</span> ' : '';
        const logos = r.teams.map(t =>
            `<a href="/team?team=${t.id}"><img src="${t.logos.at(-1)}" alt="${escapeHtml(t.mascot)}"></a>`
        ).join('');
        const gap = r.rank === 1
            ? '<span class="gap leader">Leader</span>'
            : (r.gap === 0 ? '<span class="gap">Tied</span>' : `<span class="gap">-${r.gap} back</span>`);
        return `<tr class="standings-row${medal}">
            <th class="sticky-header rank-cell"><span class="rank-num">${r.rank}</span>${movementHtml(r.delta)}</th>
            <th class="sticky-header name-cell"><a href="/userHome?user=${r.id}">${crown}${escapeHtml(r.franchise || r.name)}${r.franchise ? `<span class="std-manager">${escapeHtml(r.name)}</span>` : ''}</a></th>
            <td class="team-item"><div class="team-logos">${logos}</div></td>
            <th class="sticky-header-score"><span class="score-num" data-count="${r.score}">${r.score}</span><br>${gap}</th>
        </tr>`;
    }).join('');
}

// --- league highlights -------------------------------------------------------

// Each drafted team's total season points, summed from scoreByTeam across all
// users (a team can be on multiple rosters; each roster spot counts separately).
function teamTotals(users) {
    const totals = [];
    users.forEach(u => {
        (season(u).teams || []).forEach(team => {
            let total = 0;
            weekly(u).forEach(wk => {
                (wk.scoreByTeam || []).forEach(st => {
                    if (st.team === team.school) total += (st.score || 0);
                });
            });
            totals.push({ team: team.mascot, school: team.school, owner: initialName(u), logo: team.logos.at(-1), score: total });
        });
    });
    return totals.sort((a, b) => b.score - a.score);
}

// Standard deviation of a user's weekly scores (consistency).
function stdev(vals) {
    if (vals.length < 2) return Infinity;
    const mean = vals.reduce((s, v) => s + v, 0) / vals.length;
    const variance = vals.reduce((s, v) => s + (v - mean) ** 2, 0) / vals.length;
    return Math.sqrt(variance);
}

// Returns the ordered list of highlight cards to render. Only includes a card
// when the underlying data exists, so early-season / empty state stays clean.
export function buildHighlights(users) {
    const cards = [];
    const withWeeks = users.filter(u => weekly(u).length > 0);
    if (!withWeeks.length) return cards;

    const weeks = weekly(users[0]).length;
    const lastIdx = weeks - 1;
    const latest = (u) => weekly(u)[lastIdx];
    const latestScore = (u) => num(latest(u) && latest(u).score);
    const thisWeekLabel = weekLabel(weekly(withWeeks[0])[lastIdx]);

    // Big winner / loser (this week)
    const byLatest = withWeeks.slice().sort((a, b) => latestScore(b) - latestScore(a));
    if (byLatest.length) {
        const w = byLatest[0], l = byLatest[byLatest.length - 1];
        cards.push({ icon: '🏆', title: 'Big Winner', tag: thisWeekLabel, name: initialName(w), value: `+${latestScore(w)}`, tone: 'good' });
        cards.push({ icon: '😢', title: 'Big Loser', tag: thisWeekLabel, name: initialName(l), value: `+${latestScore(l)}`, tone: 'bad' });
    }

    // Hot / cold streak (last 2 weeks)
    const twoWk = (u) => weekly(u).slice(Math.max(0, weeks - 2)).reduce((s, w) => s + (w.score || 0), 0);
    const byStreak = withWeeks.slice().sort((a, b) => twoWk(b) - twoWk(a));
    if (byStreak.length) {
        cards.push({ icon: '🔥', title: 'Hot Streak', tag: 'last 2 weeks', name: initialName(byStreak[0]), value: `+${twoWk(byStreak[0])}`, tone: 'good' });
        cards.push({ icon: '🧊', title: 'Cold Streak', tag: 'last 2 weeks', name: initialName(byStreak[byStreak.length - 1]), value: `+${twoWk(byStreak[byStreak.length - 1])}`, tone: 'bad' });
    }

    // Biggest riser (rank climb vs last week)
    if (weeks > 1) {
        const rows = rankedRows(users).filter(r => r.delta != null);
        const riser = rows.slice().sort((a, b) => b.delta - a.delta)[0];
        if (riser && riser.delta > 0) {
            cards.push({ icon: '📈', title: 'Biggest Riser', tag: thisWeekLabel, name: riser.name, value: `▲ ${riser.delta} spot${riser.delta > 1 ? 's' : ''}`, tone: 'good' });
        }
    }

    // Closest race (gap between 1st and 2nd)
    const ranked = rankedRows(users);
    if (ranked.length > 1) {
        const g = ranked[1].gap;
        cards.push({ icon: '🏁', title: 'Closest Race', tag: 'season', name: `${ranked[0].name} over ${ranked[1].name}`, value: g === 0 ? 'Tied!' : `${g} pt${g === 1 ? '' : 's'}`, tone: 'neutral' });
    }

    // Season-high single week (anyone)
    let high = null;
    withWeeks.forEach(u => weekly(u).forEach(wk => {
        if (!high || (wk.score || 0) > high.score) high = { name: initialName(u), score: wk.score || 0, when: weekLabel(wk) };
    }));
    if (high) cards.push({ icon: '💥', title: 'Season High', tag: high.when, name: high.name, value: `+${high.score}`, tone: 'good' });

    // Best team (season) + best single team-game
    const totals = teamTotals(users);
    if (totals.length && totals[0].score > 0) {
        cards.push({ icon: '🥇', title: 'Best Team', tag: 'season', name: `<img src="${totals[0].logo}" class="hl-logo">${escapeHtml(totals[0].team)}`, value: `+${totals[0].score}`, tone: 'good' });
    }
    // Top single game: the highest one-game team score. Since the postseason
    // bonuses make the max a frequent multi-way tie, show all tied teams.
    let topScore = 0;
    let topGames = [];
    withWeeks.forEach(u => weekly(u).forEach(wk => (wk.scoreByTeam || []).forEach(st => {
        const sc = st.score || 0;
        if (sc > topScore) { topScore = sc; topGames = [{ team: st.team, owner: initialName(u) }]; }
        else if (sc === topScore && sc > 0) { topGames.push({ team: st.team, owner: initialName(u) }); }
    })));
    if (topScore > 0 && topGames.length) {
        const teamNames = [...new Set(topGames.map(g => g.team))];
        if (teamNames.length > 1) {
            const shown = teamNames.slice(0, 4).map(escapeHtml).join(', ');
            let name = shown;
            if (teamNames.length > 4) {
                // "+N" is a button that reveals the full list in a popover
                // (standings.js wires the toggle); the popover carries every
                // tied team so nothing is hidden for good.
                const extra = teamNames.length - 4;
                const full = teamNames.map(escapeHtml).join(', ');
                name += ` <button type="button" class="hl-more" aria-expanded="false">+${extra}</button>`
                    + `<span class="hl-popover" role="tooltip" hidden>`
                    + `<span class="hl-popover-title">All ${teamNames.length} tied teams</span>${full}</span>`;
            }
            cards.push({ icon: '⚡', title: 'Top Single Game', tag: `${teamNames.length}-way tie`, name, value: `+${topScore}`, tone: 'good' });
        } else {
            cards.push({ icon: '⚡', title: 'Top Single Game', tag: 'one game', name: `${escapeHtml(topGames[0].team)} <span class="hl-sub">(${escapeHtml(topGames[0].owner)})</span>`, value: `+${topScore}`, tone: 'good' });
        }
    }

    // Mr. Reliable (lowest weekly variance)
    const eligible = withWeeks.filter(u => weekly(u).length >= 2);
    if (eligible.length) {
        const steady = eligible.slice().sort((a, b) => stdev(weekly(a).map(w => w.score || 0)) - stdev(weekly(b).map(w => w.score || 0)))[0];
        const scores = weekly(steady).map(w => w.score || 0);
        const sd = stdev(scores);
        const avg = scores.reduce((s, v) => s + v, 0) / scores.length;
        cards.push({ icon: '🎯', title: 'Mr. Reliable', tag: 'season', name: initialName(steady), value: `±${round(sd)} pts/wk`, sub: `avg ${round(avg)}/wk — smallest swing`, tone: 'neutral' });
    }

    return cards;
}

export function buildHighlightsHtml(cards) {
    return cards.map(c => `
        <div class="sub-highlight-container">
            <div class="highlight-title"><span class="hl-icon">${c.icon}</span> ${escapeHtml(c.title)}<span class="hl-tag">${escapeHtml(c.tag)}</span></div>
            <div class="highlight-info">
                <span class="hl-name">${c.name}</span>
                <span class="hl-value ${c.tone}">${c.value}</span>
                ${c.sub ? `<span class="hl-detail">${c.sub}</span>` : ''}
            </div>
        </div>`).join('');
}

// --- chart data (points + rank / bump) --------------------------------------

// Builds labels + datasets for both the cumulative-points line and the
// rank-over-time (bump) chart, from the same weekly data.
export function buildChartData(users) {
    const sorted = users.slice().sort((a, b) => cum(b) - cum(a));
    const maxWeeks = sorted.reduce((m, u) => Math.max(m, weekly(u).length), 0);

    const labels = ['Start'];
    for (let i = 1; i <= maxWeeks; i++) labels.push('Wk ' + i);

    // Per-user cumulative series (index 0 = Start = 0).
    const cumSeries = {};
    sorted.forEach(u => {
        const series = [0];
        let running = 0;
        weekly(u).forEach(w => { running += (w.score || 0); series.push(running); });
        while (series.length <= maxWeeks) series.push(running);
        cumSeries[u._id] = series;
    });

    const pointsDatasets = sorted.map(u => ({
        label: initialName(u), data: cumSeries[u._id],
        fill: false, backgroundColor: u.color, borderColor: u.color, tension: 0.15
    }));

    // Rank per week: at each week index, rank users by cumulative-so-far (1 = best).
    const rankDatasets = sorted.map(u => ({
        label: initialName(u), data: [], fill: false,
        backgroundColor: u.color, borderColor: u.color, tension: 0.15,
        stepped: false
    }));
    for (let wi = 0; wi <= maxWeeks; wi++) {
        const standingsAtWeek = sorted.slice().sort((a, b) => cumSeries[b._id][wi] - cumSeries[a._id][wi]);
        standingsAtWeek.forEach((u, pos) => {
            const idx = sorted.findIndex(s => s._id === u._id);
            rankDatasets[idx].data.push(pos + 1);
        });
    }

    return { labels, pointsDatasets, rankDatasets, playerCount: sorted.length };
}
