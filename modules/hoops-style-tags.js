// Plain style tags for a basketball team (#542): "3-point heavy", "Slow pace",
// "Elite defense". Most managers will not know how 100+ basketball teams play,
// and two words beside a name in the draft pool say more than an adjusted
// efficiency figure does.
//
// Pure: CBBD leaderboard rows in, tags out. No I/O, so the thresholds can be
// tuned against a real leaderboard in a test.
//
// ---- every tag is relative ----
//
// A tag is a team's PLACE in the field, not a fixed number: "3-point heavy"
// means a top-15% three-point rate among every team on the leaderboard, so
// the tags move as the season does and need no retuning when the sport's
// averages drift (three-point rates have climbed for twenty years).
//
// Measured on the 2025-26 leaderboard (365 teams, 14 Oct 2026), the metrics
// are smooth and unclumped, so a percentile cut lands where it says:
//
//                 min    15%    median   85%    max
//   pace          60.4   64.0   66.9     69.6   75.5   possessions a game
//   three rate    24.6   33.3   39.5     45.7   54.4   % of shots
//   rim rate      24.6   33.8   39.2     44.0   50.1   % of shots
//   midrange      7.6    15.3   21.5     27.7   37.9   % of shots
//   off. reb %    19.2   27.2   30.6     33.8   38.7
//   forced TO     0.121  0.151  0.170    0.194  0.259  opponent turnovers a possession
//   three %       27.4   31.6   34.0     36.2   40.5
//   FT rate       21.1   29.8   35.0     39.9   46.4   free throws per 100 shots
//
// ---- at most two, the most extreme first ----
//
// Every tag that qualifies is scored by its `share` — the fraction of the
// field at or ahead of the team, so #1 of 365 is 0.3% and the cut-off team
// is 15% — and the two smallest are kept. Elite offense and elite defense
// share ONE slot: a team top-25 at both is "Elite both ends", which is
// what the issue's example (Duke: #1 defense, #4 offense) wanted said, and
// otherwise the best twenty teams would all read the same two tags and say
// nothing about how they play.

const MAX_TAGS = 2;

// Top 25 of ~365 for the efficiency tags, as the issue specifies: a rank is
// how basketball talks about efficiency ("a top-25 defense"), and 25 is ~7%
// of the field, so an elite tag is rarer than a style tag on purpose.
const ELITE_RANK = 25;

// The share of the field a style tag covers. 15% is ~55 teams per tag on a
// 365-team leaderboard: rare enough to be worth saying, common enough that
// most of a 120-team draft pool says something.
const STYLE_SHARE = 0.15;

// A number, or null. NOT Number(x): Number(null) is 0, which is a real pace.
function num(v) {
    if (v === null || v === undefined || v === '') return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
}

const dig = (o, path) => path.split('.').reduce((v, k) => (v == null ? undefined : v[k]), o);

// One leaderboard row -> the slim record that is stored. Only what a tag
// reads, plus the record and games so a reader can say how much basketball
// the tags are built on. The ~2 KB row is otherwise discarded.
function slimRow(r) {
    const teamId = num(r && r.teamId);
    if (teamId === null) return null;
    return {
        teamId,
        school: (r && typeof r.team === 'string') ? r.team : null,
        games: num(dig(r, 'record.games')),
        wins: num(dig(r, 'record.wins')),
        losses: num(dig(r, 'record.losses')),
        pace: num(dig(r, 'summary.pace')),
        // distribution.threeRate and threePointJumper.rate are the same
        // number on every 2025-26 row; the distribution is the documented one.
        threeRate: num(dig(r, 'shotProfile.distribution.threeRate')) ?? num(dig(r, 'shotProfile.threePointJumper.rate')),
        rimRate: num(dig(r, 'shotProfile.atRim.rate')),
        midRate: num(dig(r, 'shotProfile.distribution.midrangeRate')),
        threePct: num(dig(r, 'shotProfile.threePointJumper.pct')),
        orbPct: num(dig(r, 'teamStats.offensiveReboundPct')),
        ftRate: num(dig(r, 'teamStats.freeThrowRate')),
        forcedTo: forcedTurnovers(r),
        offRank: num(dig(r, 'adjustedEfficiency.rankings.offense')),
        defRank: num(dig(r, 'adjustedEfficiency.rankings.defense'))
    };
}

// Opponent turnovers a possession, from the counts. NOT turnoverRatio, which
// CBBD rounds to two places: on 2025-26 that put 95 teams in a "top 15%"
// because a third of the field ties at 0.17-0.19. The ratio is the fallback
// for a row without the counts.
function forcedTurnovers(r) {
    const tov = num(dig(r, 'opponentStats.turnovers.total'));
    const poss = num(dig(r, 'opponentStats.possessions'));
    if (tov !== null && poss) return tov / poss;
    return num(dig(r, 'opponentStats.turnoverRatio'));
}

const one = (n) => n.toFixed(1);

// The style tags, in tie-break order. `high` is a top-of-the-field tag and
// `low` a bottom one; `say` is the number the tooltip quotes.
const STYLE_TAGS = [
    { key: 'three-heavy', label: '3-point heavy', metric: 'threeRate', side: 'high', what: 'three-point rate', say: v => `${one(v)}% of shots are threes` },
    { key: 'rim', label: 'Rim attackers', metric: 'rimRate', side: 'high', what: 'shots at the rim', say: v => `${one(v)}% of shots at the rim` },
    { key: 'fast', label: 'Fast pace', metric: 'pace', side: 'high', what: 'pace', say: v => `${one(v)} possessions a game` },
    { key: 'slow', label: 'Slow pace', metric: 'pace', side: 'low', what: 'pace', say: v => `${one(v)} possessions a game` },
    { key: 'glass', label: 'Crash the glass', metric: 'orbPct', side: 'high', what: 'offensive rebounding', say: v => `grab ${one(v)}% of their misses` },
    { key: 'turnovers', label: 'Forces turnovers', metric: 'forcedTo', side: 'high', what: 'turnovers forced', say: v => `${one(v * 100)} turnovers per 100 opponent possessions` },
    { key: 'shooters', label: 'Sharpshooters', metric: 'threePct', side: 'high', what: 'three-point shooting', say: v => `${one(v)}% from three` },
    { key: 'midrange', label: 'Mid-range heavy', metric: 'midRate', side: 'high', what: 'mid-range rate', say: v => `${one(v)}% of shots from mid-range` },
    { key: 'line', label: 'Gets to the line', metric: 'ftRate', side: 'high', what: 'free-throw rate', say: v => `${one(v)} free throws per 100 shots` }
];

// "Top 4%", never "Top 0%".
const pctText = (share) => `${Math.max(1, Math.round(share * 100))}%`;

// For each team, the fraction of the field at or ahead of it on one metric,
// placing a tie at its MIDDLE: (teams strictly ahead + (tied + 1) / 2) / field.
// Tied teams always get the same share, so the same tag. The mid-rank rather
// than the best place, because the best place tags EVERY team in a block of
// ties — a field where CBBD rounded one metric would come back all "top 1%".
// Teams with no value are not in the field and get no share.
function sharesFor(rows, metric, side) {
    const values = rows.map(r => r[metric]).filter(v => v !== null && v !== undefined);
    const field = values.length;
    const out = new Map();
    if (!field) return out;
    for (const r of rows) {
        const v = r[metric];
        if (v === null || v === undefined) continue;
        const ahead = values.filter(x => (side === 'high' ? x > v : x < v)).length;
        const tied = values.filter(x => x === v).length;
        out.set(r.teamId, (ahead + (tied + 1) / 2) / field);
    }
    return out;
}

// The efficiency candidate for one team, or null. A rank's share is
// rank / the number of ranked teams, so #25 of 365 is 6.8%.
function eliteTag(r, ranked) {
    const off = r.offRank, def = r.defRank;
    const offOk = off !== null && off !== undefined && off <= ELITE_RANK && ranked.off;
    const defOk = def !== null && def !== undefined && def <= ELITE_RANK && ranked.def;
    if (offOk && defOk) {
        return { key: 'elite-both', label: 'Elite both ends', share: Math.min(off / ranked.off, def / ranked.def),
            detail: `#${off} adjusted offense, #${def} adjusted defense` };
    }
    if (defOk) return { key: 'elite-defense', label: 'Elite defense', share: def / ranked.def, detail: `#${def} adjusted defense` };
    if (offOk) return { key: 'elite-offense', label: 'Elite offense', share: off / ranked.off, detail: `#${off} adjusted offense` };
    return null;
}

// Slim rows for the WHOLE field -> Map(teamId -> [{ key, label, detail, share }]).
//
// The whole field, not the draft pool: a percentile among the 120 best teams
// would call an average-paced good team "Slow pace".
function tagTeams(rows, { maxTags = MAX_TAGS, styleShare = STYLE_SHARE } = {}) {
    const list = (rows || []).filter(r => r && r.teamId !== null && r.teamId !== undefined);
    const shares = STYLE_TAGS.map(t => sharesFor(list, t.metric, t.side));
    const ranked = {
        off: list.filter(r => r.offRank !== null && r.offRank !== undefined).length,
        def: list.filter(r => r.defRank !== null && r.defRank !== undefined).length
    };

    const out = new Map();
    for (const r of list) {
        const candidates = [];
        const elite = eliteTag(r, ranked);
        if (elite) candidates.push(Object.assign(elite, { order: -1 }));
        STYLE_TAGS.forEach((t, i) => {
            const share = shares[i].get(r.teamId);
            if (share === undefined || share > styleShare) return;
            const where = t.side === 'high' ? `Top ${pctText(share)}` : `Bottom ${pctText(share)}`;
            candidates.push({ key: t.key, label: t.label, share, order: i,
                detail: `${where} in ${t.what}: ${t.say(r[t.metric])}` });
        });
        candidates.sort((a, b) => (a.share - b.share) || (a.order - b.order));
        out.set(r.teamId, candidates.slice(0, maxTags).map(({ order, ...tag }) => tag));
    }
    return out;
}

module.exports = { tagTeams, slimRow, sharesFor, STYLE_TAGS, MAX_TAGS, ELITE_RANK, STYLE_SHARE };
