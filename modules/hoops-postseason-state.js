// What a basketball team's postseason has ALREADY settled, from its HoopsGame
// rows (#310, PR 5 of the projection plan) — the `decided` input of the March
// estimate (modules/hoops-march.js expectedPostseason).
//
// Banked points live on the franchise, scored at time of play. A projection
// that still expected them would pay a conference champion its title twice,
// or a Final Four team its first four rungs again. So the projection asks,
// per team:
//
//   confTourney   undefined          the conference tournament has not started
//                                    for this team
//                 { wins, alive }    under way: tournament games won so far,
//                                    and whether it is still in it
//                 'over'             won the final (the title is banked)
//   ncaa          undefined          Selection Sunday has not happened
//                 'out'              not in the field, or eliminated
//                 'done'             won the title game — nothing is left
//                 { next: round }    in the field and certain to play `round`
//                                    ('ff' … 'title'), every earlier rung banked
//
// ---- the detectors are the SCORING ones ----
//
// A conference-tournament game is hoops-detectors isConfTournament, a
// conference final isConfTournamentFinal, an NCAA round ncaaRoundFor — the
// very tests the scoring pass banks points with. If the projection and the
// scorer disagreed about which game was a conference-tournament game, one of
// them would count it twice or not at all. (hoops-projection's
// isConfTournamentGame, the second definition that existed, now delegates to
// the same function.)
//
// ---- where validation lives ----
//
// The March model THROWS on a state it does not know (an unknown value
// silently falling back to the whole ladder would pay a champion the
// tournament again). Rows from CBBD can be odd — an NCAA game whose round
// label we cannot read, a team listed as winning a round after losing one —
// so this module never hands it one: every state built here is one of the
// shapes above, by construction, and every oddity is resolved CONSERVATIVELY
// (towards expecting less, never more) and reported in `anomalies` for the
// caller to log. The projection route additionally catches a throw per team
// (modules/hoops-standings-projection.js), so no row can 500 the page.
//
// Pure: no database.

const { ncaaRoundFor, isConfTournament, isConfTournamentFinal } = require('./hoops-detectors');
const { isFinal } = require('./hoops-scoring-pass');

const ROUND_ORDER = ['ff', 'r64', 'r32', 's16', 'e8', 'f4', 'title'];
const NEXT_ROUND = { ff: 'r64', r64: 'r32', r32: 's16', s16: 'e8', e8: 'f4', f4: 'title' };

const isNcaa = (g) => String((g && g.tournament) || '').trim().toUpperCase() === 'NCAA';

function wonBy(teamId, g) {
    const home = Number(g.homeTeamId) === Number(teamId);
    return home ? Number(g.homePoints) > Number(g.awayPoints) : Number(g.awayPoints) > Number(g.homePoints);
}
const plays = (teamId, g) => Number(g.homeTeamId) === Number(teamId) || Number(g.awayTeamId) === Number(teamId);

// The NCAA field: every team in an NCAA tournament game of the season, or
// null until the WHOLE field is on file. `ncaaGames` may be the whole
// season's NCAA rows — 67 at most.
//
// Whole, not merely started: postseason rows reach hoopsgames through the
// nightly results window (the last 3 days, hoops-scores-job LOOKBACK_MS),
// so on First Four night only those 4-8 teams are stored. Reading that as
// the field would mark every Thursday/Friday round-of-64 team 'out' — its
// whole March gone from the projection for two or three days. A team
// missing from a PARTIAL field is unknown, not out; teams IN it still get
// their own state from their own rows.
const FIELD_SIZE = 64;   // the round of 64; 68 with the First Four
function ncaaField(ncaaGames) {
    const rows = (ncaaGames || []).filter(isNcaa);
    if (!rows.length) return null;
    const ids = new Set();
    rows.forEach(g => {
        if (g.homeTeamId != null) ids.add(Number(g.homeTeamId));
        if (g.awayTeamId != null) ids.add(Number(g.awayTeamId));
    });
    return ids.size >= FIELD_SIZE ? ids : null;
}

function ncaaState(teamId, games, field, anomalies) {
    const mine = (games || []).filter(g => isNcaa(g) && plays(teamId, g));
    if (!mine.length) {
        // The bracket is out and this team is not in it.
        if (field && !field.has(Number(teamId))) return 'out';
        return undefined;
    }
    const finals = mine.filter(isFinal);
    // Any NCAA loss ends it, whatever else the rows say.
    if (finals.some(g => !wonBy(teamId, g))) return 'out';
    let best = -1, unknown = false;
    finals.forEach(g => {
        const r = ncaaRoundFor(g);
        if (r === null) { unknown = true; return; }
        best = Math.max(best, ROUND_ORDER.indexOf(r));
    });
    if (unknown) {
        // A win we cannot place: expecting nothing more errs low; guessing a
        // round could pay a rung twice.
        anomalies.push({ teamId: Number(teamId), kind: 'ncaa-round-unreadable' });
        return 'done';
    }
    if (best === ROUND_ORDER.indexOf('title')) return 'done';
    if (best >= 0) return { next: NEXT_ROUND[ROUND_ORDER[best]] };
    // In the field, nothing played yet: the earliest round it is listed in.
    const listed = mine.map(ncaaRoundFor).filter(r => r !== null)
        .sort((a, b) => ROUND_ORDER.indexOf(a) - ROUND_ORDER.indexOf(b));
    if (!listed.length) {
        anomalies.push({ teamId: Number(teamId), kind: 'ncaa-round-unreadable' });
        return 'done';
    }
    return { next: listed[0] };
}

function confState(teamId, games) {
    const mine = (games || []).filter(g => isConfTournament(g) && plays(teamId, g) && isFinal(g));
    if (!mine.length) return undefined;
    if (mine.some(g => isConfTournamentFinal(g) && wonBy(teamId, g))) return 'over';
    const lost = mine.some(g => !wonBy(teamId, g));
    const wins = mine.filter(g => wonBy(teamId, g)).length;
    return { wins, alive: !lost };
}

// The decided state for one team. `games` are the team's HoopsGame rows of
// the season, every seasonType (the conference tournament is filed as
// 'regular', the NCAA as 'postseason'); `field` is ncaaField()'s answer.
// Returns { decided, anomalies }; `decided` holds only the keys that apply.
function decidedFor(teamId, games, field) {
    const anomalies = [];
    const decided = {};
    const n = ncaaState(teamId, games, field || null, anomalies);
    if (n !== undefined) decided.ncaa = n;
    const c = confState(teamId, games);
    if (c !== undefined) decided.confTourney = c;
    return { decided, anomalies };
}

module.exports = { decidedFor, ncaaField, ROUND_ORDER, NEXT_ROUND, FIELD_SIZE };
