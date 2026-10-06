// What a team was RANKED when a game was played (#316).
//
// The quadrant bands are rank thresholds, so everything in the basketball
// model rests on this one question — and the answer changes source partway
// through the season:
//
//   preseason, early weeks   Torvik's T-Rank, already in prod for 365 teams
//   once games accumulate    CBBD /ratings/adjusted net-efficiency rank
//   in between               blended, so the standings do not lurch the week
//                            the source changes
//
// NET is never involved. CBBD does not serve it, and it first publishes in
// December — too late to rank a preseason draft pool, which is the first
// thing that needs a ranking.
//
// ---- why blend at all ----
//
// Not tidiness. Scoring banks a result at TIME OF PLAY, so early noise is
// locked in permanently: a team rated #40 in week 2 that is really #150
// hands someone a cheap Q1 that is never revisited. A hard cutover would
// also move every team's rank on one arbitrary week, re-grading nothing but
// changing everything that comes after.
//
// ---- the ramp is PROVISIONAL ----
//
// The weights below are a placeholder shape, not a measured curve, and they
// are deliberately the one thing in this module that is easy to change. The
// measurement is a November job (#318): compare Torvik's preseason rank
// against CBBD adjusted efficiency once teams have ~5 games, and let that
// gap set the rate. Guessing it now and burying the guess in a formula is
// how it would never get measured.

const HoopsRating = require('../models/hoopsRating');
const HoopsTeam = require('../models/hoopsTeam');

// Weeks over which the live number takes over from the preseason one.
// FULLY_PRESEASON and earlier is all Torvik; FULLY_LIVE and later is all
// CBBD; between them it ramps.
const FULLY_PRESEASON = 2;
const FULLY_LIVE = 8;

// How much of the field a stored week must cover before it is believed.
//
// The documented safety net — "a missed refresh falls back to the last week
// that has one" — only catches a refresh that writes NOTHING. A refresh
// that writes two rows and dies was accepted wholesale, which is far worse:
//
//   in the blend window, the two written teams are promoted against the
//   whole Torvik field — a team Torvik has at #300 with a partial live rank
//   of 1 blends to #150, turning a home win over it from Q4 into Q2
//
//   past the ramp, the Torvik baseline is discarded entirely and the map is
//   the two rows, so 363 teams become unranked, EVERY win in the league
//   becomes Q4, and the run logs "ranks cbbd-adjusted" as if healthy
//
// A real refresh rates essentially everybody, so anything under this is a
// broken run rather than a thin one. Below the floor the week is treated as
// absent and the fallback does its job.
const MIN_LIVE_COVERAGE = 0.8;

// How much the PRESEASON rank is worth in week `week`, 1 down to 0.
function blendWeight(week) {
    const w = Number(week);
    if (!Number.isFinite(w) || w <= FULLY_PRESEASON) return 1;
    if (w >= FULLY_LIVE) return 0;
    return (FULLY_LIVE - w) / (FULLY_LIVE - FULLY_PRESEASON);
}

// Combine two rankings into one, then RE-RANK.
//
// Averaging two ranks gives a score, not a ranking: it produces ties and
// fractional values, and the quadrant bands are integer thresholds over a
// dense 1..N field. So the blend ranks the field by the blended score.
//
// A team present in only one input keeps that input's rank as its score,
// rather than being dropped — a team CBBD has not rated yet should slide,
// not vanish into Q4.
// A rank, or null. NOT Number(x): Number(null) is 0 and Number('') is 0,
// both finite — so the obvious version read a missing rank as rank ZERO,
// which sorts FIRST. A team nobody had rated would have come out of the
// blend as the best team in the country, and every win over it a Q1.
function rankOf(value) {
    if (value === null || value === undefined || value === '') return null;
    const n = Number(value);
    return Number.isFinite(n) && n > 0 ? n : null;
}

function blendRanks(preseason, live, weight) {
    const w = Math.min(1, Math.max(0, Number(weight)));
    const ids = new Set([...Object.keys(preseason || {}), ...Object.keys(live || {})]);
    const scored = [];
    for (const id of ids) {
        const pre = rankOf((preseason || {})[id]);
        const now = rankOf((live || {})[id]);
        if (pre === null && now === null) continue;
        const score = (pre !== null && now !== null) ? (w * pre) + ((1 - w) * now)
            : (pre !== null ? pre : now);
        scored.push([id, score]);
    }
    // Tie-broken by team id: two teams on the same blended score must not
    // swap places between runs and carry a quadrant boundary with them.
    //
    // NOT redundant, which an earlier comment here claimed. The id set is
    // the preseason keys followed by the live-only keys APPENDED, so a team
    // only the live source knows arrives out of numeric order and a stable
    // sort keeps it there. The comparator is what makes the order a
    // property of the inputs rather than of the insertion order.
    scored.sort((a, b) => (a[1] - b[1]) || (Number(a[0]) - Number(b[0])));
    const out = {};
    scored.forEach(([id], i) => { out[id] = i + 1; });
    return out;
}

// Torvik's preseason ranks for a season, as {teamId: rank}.
async function preseasonRanks(season) {
    const rows = await HoopsTeam.find(
        { season: Number(season), 'preseason.rank': { $type: 'number' } },
        { id: 1, 'preseason.rank': 1, _id: 0 }
    ).lean();
    const out = {};
    for (const r of rows) out[String(r.id)] = r.preseason.rank;
    return out;
}

// The stored live ranks for a week, falling back to the most recent EARLIER
// week in the same season.
//
// The fallback matters: the refresh runs weekly and a missed run must not
// silently drop every team to Q4 for a whole week of games. Last week's
// ranking is wrong by a little; no ranking is wrong by everything.
async function liveRanks(season, week) {
    const yr = Number(season);
    const wk = Number(week);
    const exact = await HoopsRating.find({ season: yr, week: wk }, { teamId: 1, rank: 1, _id: 0 }).lean();
    if (exact.length) return { ranks: byTeam(exact), week: wk, stale: false };

    const prior = await HoopsRating.find(
        { season: yr, week: { $lt: wk } }, { teamId: 1, rank: 1, week: 1, _id: 0 }
    ).sort({ week: -1 }).lean();
    if (!prior.length) return { ranks: {}, week: null, stale: false };

    const latest = prior[0].week;
    return { ranks: byTeam(prior.filter(r => r.week === latest)), week: latest, stale: true };
}

function byTeam(rows) {
    const out = {};
    for (const r of rows) out[String(r.teamId)] = r.rank;
    return out;
}

// The ranking to quadrant a week's games against.
//
// Returns the map the engine wants plus the provenance, because "why did
// this team's rank move on a week it did not play" is otherwise unanswerable
// — and with scores banked at time of play it is a question that gets asked
// months later.
async function ranksFor(season, week) {
    const [pre, live] = await Promise.all([
        preseasonRanks(season),
        liveRanks(season, week)
    ]);

    const preCount = Object.keys(pre).length;
    const liveCount = Object.keys(live.ranks).length;

    // A partially-written week is a FAILED refresh, not a thin one.
    const thin = preCount > 0 && liveCount > 0 && liveCount < preCount * MIN_LIVE_COVERAGE;
    if (thin) {
        console.error(`hoops-ranks: ignoring week ${live.week} — only ${liveCount} of ${preCount} teams rated`);
    }

    const havePre = preCount > 0;
    const haveLive = liveCount > 0 && !thin;
    if (!haveLive) return { ranks: pre, source: 'torvik', blendWeight: 1, staleWeek: null, partialWeek: thin ? live.week : null };
    if (!havePre) return { ranks: live.ranks, source: 'cbbd-adjusted', blendWeight: 0, staleWeek: live.stale ? live.week : null };

    const w = blendWeight(week);
    if (w >= 1) return { ranks: pre, source: 'torvik', blendWeight: 1, staleWeek: null };
    if (w <= 0) return { ranks: live.ranks, source: 'cbbd-adjusted', blendWeight: 0, staleWeek: live.stale ? live.week : null };
    return {
        ranks: blendRanks(pre, live.ranks, w),
        source: 'blended',
        blendWeight: w,
        staleWeek: live.stale ? live.week : null
    };
}

module.exports = {
    ranksFor, blendRanks, blendWeight, preseasonRanks, liveRanks, rankOf, MIN_LIVE_COVERAGE,
    FULLY_PRESEASON, FULLY_LIVE
};
