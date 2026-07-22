// One-time reconstruction of past drafts from user.seasons[].
//
// We never stored draft picks, but each manager's `teams` array is saved in the
// order they were drafted. Combined with a known slot order per league-season
// and the snake pattern, that's enough to rebuild the exact overall pick number
// for every team — i.e. the whole draft board.
//
// The slot orders below can't be derived from data: 2023 has no prior standings
// to reverse from, and later years added managers who have no prior finish. So
// they're recorded here as the source of truth (confirmed from memory / records)
// and resolved to users at runtime. This table is also the scope lock — the
// backfill only ever touches these exact league-seasons, never a live draft.
//
// Manager keys are "FirstName" or "FirstName Initial" (the initial disambiguates
// the two Jeffs); they're matched against users within the given league.

const DRAFT_HISTORY = [
    { league: 'graham-league',  season: 2023, orderMethod: 'manual',    order: ['Treyce', 'Trevor', 'Brock', 'Garrett', 'Michael'] },
    { league: 'graham-league',  season: 2024, orderMethod: 'standings', order: ['Treyce', 'Garrett', 'Brock', 'Trevor', 'Michael'] },
    { league: 'graham-league',  season: 2025, orderMethod: 'standings', order: ['Trevor', 'Treyce', 'Garrett', 'Michael', 'Brock', 'Cole'] },
    { league: 'claunts-league', season: 2023, orderMethod: 'manual',    order: ['Scott', 'Jeff C', 'Jeff D', 'David'] },
    { league: 'claunts-league', season: 2024, orderMethod: 'standings', order: ['Jeff D', 'Jeff C', 'David', 'Scott'] },
    { league: 'claunts-league', season: 2025, orderMethod: 'standings', order: ['Scott', 'Joe', 'Jeff D', 'Jeff C', 'Lynn', 'David'] },
];

function displayName(u) {
    return `${u.firstName} ${u.lastName ? u.lastName[0] + '.' : ''}`.trim();
}

function seasonOf(u, season) {
    return (u.seasons || []).find(s => Number(s.season) === Number(season));
}

// A key is "First" or "First Initial". Match exact first name (scoped to the
// league) plus, when given, the last-name initial.
function matchUsers(users, league, key) {
    const parts = key.split(' ');
    const first = parts[0];
    const initial = parts[1];
    return users.filter(u =>
        u.league === league &&
        u.firstName === first &&
        (initial == null || (u.lastName || '')[0] === initial));
}

// Snake overall pick number for a manager at 1-based slot `s`, in 1-based round
// `r`, with `N` managers.
function overallPick(r, s, N) {
    return (r % 2 === 1) ? (r - 1) * N + s : r * N - s + 1;
}

function reconstructOne(users, cfg) {
    const res = {
        league: cfg.league, season: cfg.season, orderMethod: cfg.orderMethod,
        ok: false, errors: [], order: [], draftOrder: [], picks: [], board: [], integrity: null
    };

    // Resolve each configured manager key to exactly one user with that season.
    const resolved = [];
    for (const key of cfg.order) {
        const hits = matchUsers(users, cfg.league, key);
        if (hits.length === 0) { res.errors.push(`No user matched "${key}"`); continue; }
        if (hits.length > 1) { res.errors.push(`Key "${key}" matched ${hits.length} users`); continue; }
        if (!seasonOf(hits[0], cfg.season)) { res.errors.push(`"${key}" has no ${cfg.season} season`); continue; }
        resolved.push(hits[0]);
    }
    if (res.errors.length) return res;

    const N = resolved.length;
    const lengths = resolved.map(u => (seasonOf(u, cfg.season).teams || []).length);
    const rounds = Math.max(...lengths);
    if (new Set(lengths).size > 1) {
        res.errors.push(`Uneven rosters: [${lengths.join(', ')}]`);
    }

    const board = {};
    resolved.forEach((u, i) => {
        const slot = i + 1;
        res.order.push({ userId: u._id, name: displayName(u), slot });
        res.draftOrder.push(u._id);
        const teams = seasonOf(u, cfg.season).teams || [];
        teams.forEach((team, k) => {
            const round = k + 1;
            const overall = overallPick(round, slot, N);
            if (board[overall]) {
                res.errors.push(`Collision at overall ${overall}`);
                return;
            }
            board[overall] = { overall, round, name: displayName(u), school: team.school };
            res.picks.push({ round, overall, userId: u._id, team });
        });
    });

    const expected = lengths.reduce((a, b) => a + b, 0);
    const placed = Object.keys(board).length;
    res.integrity = { N, rounds, expected, placed, ok: placed === expected && res.errors.length === 0 };
    res.board = Object.values(board).sort((a, b) => a.overall - b.overall);
    res.ok = res.integrity.ok;
    return res;
}

function reconstructAll(users) {
    return DRAFT_HISTORY.map(cfg => reconstructOne(users, cfg));
}

module.exports = { DRAFT_HISTORY, reconstructAll, reconstructOne, overallPick };
