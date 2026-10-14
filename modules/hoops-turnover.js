// Basketball roster turnover (#541): the transfer portal and recruiting
// class going INTO a season, per team. Pure summarising plus the page reader;
// the job that fetches is modules/hoops-turnover-job.js.
//
// ---- which CBBD year ----
//
// CBBD files the portal and recruiting classes by the calendar year of the
// spring they happened in, NOT by its season label. Measured 14 Oct 2026:
// of the year=2026 portal players found on CBBD's 2025–26 rosters, 1,424 were
// at their ORIGIN school and none at their destination; Duke's year=2026
// recruits are on its 2026–27 roster and not its 2025–26 one. So the turnover
// leading into season S (CBBD's label, ending year) is year S - 1 — the same
// number CBBD uses for the season BEFORE. Getting this backwards shows last
// year's moves as this year's, and nothing errors.

const HoopsTeamTurnover = require('../models/hoopsTeamTurnover');

const portalYear = (season) => Number(season) - 1;

// Names kept per side. The busiest team in 2026 had 13 arrivals; a longer
// list is a scroll on a phone, and the counts carry the full number anyway.
const MAX_LISTED = 15;

// What a portal row says happened to the player:
//   'moved' — a new school other than the one they left
//   'left'  — gone, no new school listed (yet, or ever: pro, overseas)
//   null    — stayed: withdrew with no new school, or "transferred" to the
//             school they left (CBBD lists both; 37 such rows in 2026)
function outcome(r) {
    const from = r.origin && r.origin.id != null ? Number(r.origin.id) : null;
    const to = r.destination && r.destination.id != null ? Number(r.destination.id) : null;
    if (from == null) return null;
    if (to != null) return to === from ? null : 'moved';
    return r.eligibility === 'Withdrawn' ? null : 'left';
}

const num = (x) => (x == null || x === '' || !Number.isFinite(Number(x)) ? null : Number(x));

function nameOf(r) {
    return [r.firstName, r.lastName].filter(Boolean).join(' ').trim();
}

// `teamId` only when the other school is one of ours, so a page can link
// it; a Division II school keeps its name and no id.
function move(r, other, known) {
    const otherId = other && other.id != null ? Number(other.id) : null;
    return {
        name: nameOf(r),
        position: r.position || null,
        stars: num(r.stars),
        rating: num(r.rating),
        teamId: otherId != null && known.has(otherId) ? otherId : null,
        school: (other && other.name) || null
    };
}

// Best first: rating, then stars, then name, so an unrated walk-on never
// pushes a four-star off a short list.
function byQuality(a, b) {
    return (b.rating || 0) - (a.rating || 0) || (b.stars || 0) - (a.stars || 0) || a.name.localeCompare(b.name);
}

function side(moves) {
    const rated = moves.filter(m => m.rating != null);
    return {
        count: moves.length,
        topStars: moves.filter(m => (m.stars || 0) >= 4).length,
        avgRating: rated.length ? Math.round(rated.reduce((s, m) => s + m.rating, 0) / rated.length * 1000) / 1000 : null
    };
}

// Map teamId -> slim record, for the teams in `teams` ([{ id, school }]) —
// every one of them, so "no transfers" reads as +0 / −0 rather than missing.
// Also returns the match counts the job reports, since an id scheme change
// would otherwise land as a board of zeros.
function summarize(portalRows, classRows, teams) {
    const known = new Map(teams.map(t => [Number(t.id), t.school]));
    const arrivals = new Map();
    const departures = new Map();
    const push = (map, id, m) => { if (!map.has(id)) map.set(id, []); map.get(id).push(m); };
    // A player CBBD lists twice for the same school pair counts once.
    const seen = new Set();
    let rows = 0, matched = 0;

    for (const r of portalRows || []) {
        const what = r ? outcome(r) : null;
        // A nameless row has nothing to list, and the stored name is required.
        if (!what || !nameOf(r)) continue;
        const from = Number(r.origin.id);
        const to = what === 'moved' ? Number(r.destination.id) : null;
        const key = `${nameOf(r)}|${from}|${to}`;
        if (seen.has(key)) continue;
        seen.add(key);
        rows++;
        if (known.has(from) || (to != null && known.has(to))) matched++;
        if (known.has(from)) push(departures, from, move(r, what === 'moved' ? r.destination : null, known));
        if (to != null && known.has(to)) push(arrivals, to, move(r, r.origin, known));
    }

    const classes = new Map();
    for (const c of classRows || []) {
        const id = c && c.teamId != null ? Number(c.teamId) : null;
        if (id == null || !known.has(id)) continue;
        classes.set(id, { rank: num(c.ranking), rating: num(c.rating) });
    }

    const out = new Map();
    for (const [id, school] of known) {
        const a = (arrivals.get(id) || []).sort(byQuality);
        const d = (departures.get(id) || []).sort(byQuality);
        const cls = classes.get(id) || {};
        out.set(id, {
            teamId: id,
            school: school || null,
            in: side(a),
            out: side(d),
            arrivals: a.slice(0, MAX_LISTED),
            departures: d.slice(0, MAX_LISTED),
            classRank: cls.rank != null ? cls.rank : null,
            classRating: cls.rating != null ? cls.rating : null
        });
    }
    return { byTeam: out, rows, matched, classes: classes.size };
}

// Where the turnover came from, for the caption: "spring 2026".
function sourceOf(season, fromYear, fetchedAt) {
    if (fromYear == null) return null;
    return { fromYear: Number(fromYear), season: Number(season), fetchedAt: fetchedAt || null };
}

// The draft pool's per-team slice: just the line, not the names.
const POOL_FIELDS = { teamId: 1, fromYear: 1, fetchedAt: 1, 'in.count': 1, 'in.topStars': 1, 'out.count': 1, 'out.topStars': 1, classRank: 1, _id: 0 };

// { source, byTeam } for a season, optionally only some teams. `full` adds
// the name lists, for the team page; the pool only needs the counts.
async function turnoverFor(season, teamIds = null, { full = false } = {}) {
    const filter = { season: Number(season) };
    if (teamIds) filter.teamId = { $in: teamIds.map(Number) };
    const rows = await HoopsTeamTurnover.find(filter, full ? { _id: 0, __v: 0, season: 0 } : POOL_FIELDS).lean();
    const byTeam = {};
    let source = null;
    for (const r of rows) {
        // One season's rows always come from one fetch: the job replaces
        // them wholesale.
        if (!source) source = sourceOf(season, r.fromYear, r.fetchedAt);
        const rec = { in: r.in.count, out: r.out.count, inTop: r.in.topStars, outTop: r.out.topStars, classRank: r.classRank == null ? null : r.classRank };
        if (full) {
            Object.assign(rec, {
                inAvgRating: r.in.avgRating == null ? null : r.in.avgRating,
                outAvgRating: r.out.avgRating == null ? null : r.out.avgRating,
                classRating: r.classRating == null ? null : r.classRating,
                arrivals: r.arrivals || [],
                departures: r.departures || []
            });
        }
        byTeam[String(r.teamId)] = rec;
    }
    return { source, byTeam };
}

module.exports = { portalYear, outcome, summarize, turnoverFor, sourceOf, MAX_LISTED };
