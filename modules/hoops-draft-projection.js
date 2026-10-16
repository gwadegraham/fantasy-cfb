// The basketball projection, wired for draft time (#310, PR 3): the live draft
// board and the post-draft grades.
//
// The engine is modules/hoops-projection.js (regular season) plus
// modules/hoops-march.js (postseason). This module is the glue football keeps
// inline in routes/draft.js and modules/draft-grades.js — which teams are in
// the pool, which games belong to which team, what rank map the quadrants are
// graded on — and the frozen-snapshot shape that keeps a grade from drifting.
//
// Pure: no database. The routes own the reads; the field lists they read with
// live here so the snapshot and the live path can never project different
// fields.
//
// ---- three things that differ from football, and each one bit someone ----
//
// 1. GAMES ARE KEYED ON homeTeamId / awayTeamId. A HoopsGame has no homeId,
//    so football's grouping (draft-grades groupGamesByTeam) drops every game
//    and every regular season projects to 0. groupHoopsGamesByTeam is the
//    basketball one.
// 2. THE OPPONENT TABLE IS THE WHOLE COUNTRY, THE PROJECTED SET IS THE POOL.
//    A pool team's win probabilities need every opponent's barthag, so the
//    context is built from all ~365 teams; only the draft pool (top N by
//    preseason rank, modules/draft-pool.js) is projected and banded.
// 3. IDS COLLIDE WITH FOOTBALL'S (130 of 365). Everything here is fed from
//    hoopsteams / hoopsgames only; nothing reads Team or Game.
//
// ---- the ranks the quadrants are graded on ----
//
// The PRESEASON Torvik rank. That is what live scoring grades the first
// weeks on too (hoops-ranks blendWeight is 1 through week 2), and it is the
// only rank that exists at the draft. It is frozen with the snapshot.

const { buildHoopsPoolContext, projectHoopsTeam, isDead, isConfTournamentGame } = require('./hoops-projection');
const { isFinal } = require('./hoops-scoring-pass');
const { attachMarch } = require('./hoops-march');

const RANK_SOURCE = 'preseason Torvik T-Rank';

// What the projection reads from a HoopsTeam row. logos are left out: the
// board fetches them for the pool only, and 365 teams' logo arrays are most
// of the bytes otherwise.
const TEAM_FIELDS = {
    _id: 0, id: 1, school: 1, conference: 1,
    'preseason.rank': 1, 'preseason.barthag': 1, 'preseason.adjOE': 1,
    'preseason.adjDE': 1, 'preseason.projectedRecord': 1
};

// What the projection and the scoring engine read from a HoopsGame row.
// status: dead (cancelled/postponed) rows are skipped. tournament/gameNotes/
// conferenceGame: a conference tournament game is left out of the regular
// projection. startDate: duplicate listings are told apart by date (see
// dedupeListings). Points and seeds are not read — a preseason projection
// synthesizes the result.
const GAME_FIELDS = {
    _id: 0, id: 1, season: 1, seasonType: 1, week: 1, status: 1, startDate: 1,
    neutralSite: 1, conferenceGame: 1, tournament: 1, gameNotes: 1,
    homeTeamId: 1, homeConference: 1, awayTeamId: 1, awayConference: 1
};

function rankOf(team) {
    const r = team && team.preseason && team.preseason.rank;
    return typeof r === 'number' && Number.isFinite(r) ? r : null;
}

// The draft pool: ranked teams, best preseason rank first, ties by id, capped
// at poolSize (null/0 = every ranked team). The same order and cap as
// draft-pool.js basketballPool, which does it in Mongo; tested against it.
function poolOf(teams, poolSize) {
    const ranked = (teams || []).filter(t => rankOf(t) !== null)
        .sort((a, b) => rankOf(a) - rankOf(b) || Number(a.id) - Number(b.id));
    return poolSize ? ranked.slice(0, poolSize) : ranked;
}

// { teamId: preseason rank } — the map the quadrants are graded on.
function preseasonRanks(teams) {
    const ranks = {};
    (teams || []).forEach(t => { const r = rankOf(t); if (r !== null) ranks[String(t.id)] = r; });
    return ranks;
}

// Games by the BASKETBALL team ids in them. `ids` is the set worth keeping
// (a Set of strings); a game between two kept teams lands under both.
function groupHoopsGamesByTeam(games, ids) {
    const by = {};
    for (const g of games || []) {
        const h = String(g.homeTeamId), a = String(g.awayTeamId);
        if (ids.has(h)) (by[h] = by[h] || []).push(g);
        if (ids.has(a)) (by[a] = by[a] || []).push(g);
    }
    return by;
}

// ---- duplicate listings ----
//
// CBBD keeps a game's OLD listing when it is rescheduled, under its own id
// (#498). hoops-stale-duplicates drops the old one once its twin has gone
// final — which never happens before the season, so at the draft every copy
// is projected. On the 2027 schedule as stored in mid-October (the dev copy's
// dates run 9 weeks early, which moves no gap between two listings) Boston
// College held 56 regular-season rows against a median of ~31 — 35 of them
// ACC games, for a 20-game ACC schedule.
//
// Three rules, each from 2025-26 as CBBD served it (6,213 rows, PR #554's
// pulls). A real home-and-home swaps the host, so none of them can merge one.
//
//   CONFERENCE REGULAR SEASON, conference of 10+ members: the same host and
//     the same visitor is ONE game, however far apart the listings are. A
//     conference plays a team at home at most once unless it runs a triple
//     round robin, and only small conferences do: every same-host conference
//     repeat in 2025-26 (21 pairs, all 21 played) was in the 7-member UAC;
//     no conference of 10 or more had one. Membership is counted from the
//     season's teams, not a list. (On 2027, all 20 such repeats — ACC 15,
//     SWAC 4, Sun Belt 1 — have at most one final.)
//   OTHER SAME HOST (not neutral): under 12 days apart is one game. The
//     closest pair of same-host games both actually played was 13 days
//     apart; the stale listings never played sat 0.8, 1, 7, 11.1 and 11.1
//     days from their twins. Nine more sat 16-48 days out, which no window
//     can separate from a real rematch — left to the THICK flag below.
//   NEUTRAL: the same pair on a neutral floor within 3 days. 2025-26 had no
//     neutral repeats at all; 2027 has one (Kansas State and Gonzaga, the
//     Players Era Festival, listed on consecutive days).
// Listings chain: a third copy within the window of the second joins the
// same game. Conference tournament games and dead rows are left alone.
//
// Within one game, every FINAL listing is kept — two finals are two played
// games, whatever the dates say — and the unplayed copies dropped. With no
// final, the highest id (the newer listing) is kept.
//
// Measured on that 2027 copy: 25 of 5,286 rows collapse, touching 34 teams
// (19 in the pool). Boston College's ACC games come to exactly 20; it keeps
// 41 rows (40 projectable) because it also lists 21 non-conference games
// against 19 opponents — a padded non-conference slate no evidence-backed
// rule separates, so it stays flagged THICK (40 > 1.3 × the median of 30).
const SAME_HOST_DAYS = 12;
const NEUTRAL_DAYS = 3;
const CONF_MIN_MEMBERS = 10;
const DAY_MS = 24 * 60 * 60 * 1000;

function conferenceSizes(teams) {
    const n = {};
    (teams || []).forEach(t => { if (t && t.conference) n[t.conference] = (n[t.conference] || 0) + 1; });
    return n;
}

function listingKey(g, sizes) {
    if (g.neutralSite) return 'n:' + [Number(g.homeTeamId), Number(g.awayTeamId)].sort((a, b) => a - b).join('-');
    const pair = Number(g.homeTeamId) + '-' + Number(g.awayTeamId);
    const conf = g.homeConference;
    if (g.conferenceGame && conf && conf === g.awayConference && (sizes[conf] || 0) >= CONF_MIN_MEMBERS) return 'c:' + pair;
    return 'h:' + pair;
}

const WINDOW_MS = { n: NEUTRAL_DAYS * DAY_MS, h: SAME_HOST_DAYS * DAY_MS, c: Infinity };

// One listing per real game. `teams` (the season's HoopsTeam rows) sizes the
// conferences; without it the conference rule never applies. Returns
// { games, dropped } — dropped being the ids collapsed away.
function dedupeListings(games, teams) {
    const sizes = conferenceSizes(teams);
    const groups = {};
    const keep = [];
    (games || []).forEach(g => {
        if (isDead(g) || isConfTournamentGame(g)) { keep.push(g); return; }
        const k = listingKey(g, sizes);
        (groups[k] = groups[k] || []).push(g);
    });
    const dropped = [];
    Object.keys(groups).forEach(k => {
        const window = WINDOW_MS[k[0]];
        const rows = groups[k].slice().sort((a, b) => new Date(a.startDate) - new Date(b.startDate) || a.id - b.id);
        let cluster = [];
        const flush = () => {
            const finals = cluster.filter(isFinal);
            const kept = finals.length ? finals : [cluster.slice().sort((a, b) => b.id - a.id)[0]];
            cluster.forEach(g => { if (kept.includes(g)) keep.push(g); else dropped.push(g.id); });
            cluster = [];
        };
        rows.forEach(g => {
            const prev = cluster[cluster.length - 1];
            const gap = prev ? new Date(g.startDate) - new Date(prev.startDate) : NaN;
            if (prev && !(gap < window)) flush();
            cluster.push(g);
        });
        flush();
    });
    return { games: keep, dropped };
}

// Project `projectIds` (strings) against the whole country.
//
// teams: every HoopsTeam row of the season (TEAM_FIELDS shape).
// games: the season's regular-season rows touching at least the projected
//   teams (GAME_FIELDS shape).
// Returns { [teamId]: projectHoopsTeam result, with perGame }.
function projectHoopsTeams(teams, games, { cfg, projectIds }) {
    const ctx = attachMarch(buildHoopsPoolContext(teams, { ranks: preseasonRanks(teams), cfg }), teams);
    const ids = new Set((projectIds || []).map(String));
    const byTeam = groupHoopsGamesByTeam(dedupeListings(games, teams).games, ids);
    const byId = {};
    (teams || []).forEach(t => { byId[String(t.id)] = t; });
    const out = {};
    ids.forEach(id => {
        if (!byId[id]) return;
        out[id] = projectHoopsTeam(byId[id], byTeam[id] || [], ctx, { perGame: true });
    });
    return out;
}

// Regular-season points per WEEK the team plays — the Captain's unit. A
// basketball team plays ~2 games a week and the Captain doubles a week, not
// a game, so football's regular / games would halve it.
function perWeekOf(proj) {
    const weeks = new Set((proj.perGame || []).map(g => g.week).filter(w => w != null));
    return weeks.size ? proj.regular / weeks.size : 0;
}

const r1 = (x) => Math.round(x * 10) / 10;

// One draft-board row, the same fields football's projectPool emits where the
// meaning is the same. `post` is the whole basketball postseason (NCAA ladder,
// upsets, conference tournament and title), never football's cfp + confChamp
// + bowl.
function boardRow(team, proj, logo) {
    const pre = team.preseason || {};
    return {
        id: team.id, school: team.school, conference: team.conference || null,
        logo: logo || null,
        total: r1(proj.total),
        regular: r1(proj.regular),
        post: r1(proj.postseason),
        perWeek: Math.round(perWeekOf(proj) * 100) / 100,
        wins: r1(proj.projWins),
        makeProb: proj.makeProb == null ? null : Math.round(proj.makeProb * 100) / 100,
        rank: rankOf(team),
        projectedRecord: pre.projectedRecord || null,
        games: (proj.perGame || []).length
    };
}

// Teams whose stored schedule cannot be projected honestly, measured on the
// games actually projected (after dedupeListings) against the projected
// set's median:
//   thin   under THIN_SHARE of it. On the 2027 schedule as stored in
//          mid-October, the A-10, American and Pac-12 conference slates were
//          not published: 21 of the 120 pool teams held 7-24 games against a
//          median of ~31 and projected a third to a half of a full season.
//   thick  over THICK_SHARE of it — duplicate listings the date window could
//          not separate from a real rematch (Boston College: 40 projectable
//          games after deduplication on the mid-October 2027 schedule).
// A projection cannot tell a short schedule from a weak team, or a padded
// one from a strong team, so the board names them and the freeze refuses.
const THIN_SHARE = 0.75;
const THICK_SHARE = 1.3;
function scheduleFlags(projByTeam, teams) {
    const ids = Object.keys(projByTeam || {});
    const count = (id) => (projByTeam[id].perGame || []).length;
    const counts = ids.map(count).sort((a, b) => a - b);
    if (!counts.length) return [];
    const median = counts[Math.floor(counts.length / 2)];
    const school = {};
    (teams || []).forEach(t => { school[String(t.id)] = t.school; });
    return ids.map(id => {
        const n = count(id);
        const kind = n < THIN_SHARE * median ? 'thin' : (n > THICK_SHARE * median ? 'thick' : null);
        return kind && { id: Number(id), school: school[id] || null, games: n, kind };
    }).filter(Boolean).sort((a, b) => a.games - b.games || a.id - b.id);
}

// ---- the frozen grade input ----
//
// Everything a basketball grade reads that can change after the draft: every
// team's preseason rating and rank (a re-import of the Torvik paste rewrites
// them in place), and the schedule (CBBD reschedules, adds and cancels games
// all season). The scoring config is read live, as football's is, and so is
// the March calibration file, which only a commit changes.

function snapshotTeams(teams) {
    return (teams || []).filter(t => t && t.id != null).map(t => {
        const pre = t.preseason || {};
        return {
            id: t.id, school: t.school, conference: t.conference || null,
            rank: pre.rank, barthag: pre.barthag, adjOE: pre.adjOE, adjDE: pre.adjDE,
            projectedRecord: pre.projectedRecord
        };
    });
}

function snapshotGames(games) {
    return (games || []).map(g => {
        const row = {};
        Object.keys(GAME_FIELDS).forEach(k => { if (k !== '_id' && g[k] !== undefined) row[k] = g[k]; });
        return row;
    });
}

// A snapshot back into the shapes projectHoopsTeams reads, so a frozen grade
// runs exactly the code a live one does.
function fromSnapshot(snap) {
    const teams = ((snap && snap.teams) || []).map(t => ({
        id: t.id, school: t.school, conference: t.conference,
        preseason: { rank: t.rank, barthag: t.barthag, adjOE: t.adjOE, adjDE: t.adjDE, projectedRecord: t.projectedRecord }
    }));
    return { teams, games: ((snap && snap.games) || []).slice() };
}

module.exports = {
    RANK_SOURCE, TEAM_FIELDS, GAME_FIELDS,
    rankOf, poolOf, preseasonRanks, groupHoopsGamesByTeam, projectHoopsTeams,
    perWeekOf, boardRow, scheduleFlags, THIN_SHARE, THICK_SHARE,
    dedupeListings, SAME_HOST_DAYS, NEUTRAL_DAYS, CONF_MIN_MEMBERS, snapshotTeams, snapshotGames, fromSnapshot
};
