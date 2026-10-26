// What a team was RANKED when a game was played (#316).
//
// The quadrant bands are rank thresholds, so everything in the basketball
// model rests on this one question — and the answer changes source partway
// through the season:
//
//   preseason, early weeks   Torvik's T-Rank: his CURRENT rank going into
//                            the week (modules/hoops-torvik-job.js), else
//                            the preseason import
//   once games accumulate    CBBD /ratings/adjusted net-efficiency rank
//   in between               blended, so the standings do not lurch the week
//                            the source changes
//   once the NET publishes   the official NCAA NET, outright (#533)
//
// ---- the NET takes over ----
//
// The NET is what managers know, and Graham decided (12 Oct 2026) that it
// drives scoring once it exists. It first publishes in early-to-mid December,
// too late to rank a preseason draft pool, so everything above still covers
// the first month. From the first week that has NET rows (modules/
// hoops-net-job.js files a snapshot taken in week N under week N + 1, as the
// CBBD job does), that week and every later one is graded on the NET as
// published — no blend, because the point is that the number on the page is
// the number on ncaa.com. A later week the NET job missed uses the latest
// earlier NET week rather than dropping back to CBBD: one source switch a
// season, not one per missed fetch.
//
// ---- which Torvik ----
//
// Torvik's rank moves through the season — it starts from his preseason
// projection and gives way to results as they come in — so the Torvik side
// of everything below is his rank as it stood going into the week:
// HoopsTorvikRank, frozen at the week's first tip. The preseason import on
// hoopsTeam is the fallback for a week no snapshot reaches (the job had not
// run yet, or barttorvik walled it), and it is still what the draft and the
// coverage floors are measured on. Graham decided (26 Oct 2026) that Torvik
// stays current for as long as it is in the blend.
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
const HoopsNetRank = require('../models/hoopsNetRank');
const HoopsTorvikRank = require('../models/hoopsTorvikRank');
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

// The NET ranks to grade a week on: that week's, else the latest EARLIER
// week's, as { ranks, week, stale } — or null when no week at or before it
// has a whole NET ranking on file.
//
// "Whole" is the same coverage floor as the CBBD weeks, measured against the
// same preseason field, and checked per week BEFORE one is chosen: a thin
// NET week is skipped in favour of the whole week before it, rather than
// discarded and replaced by a different source. With no preseason field to
// measure against, any rows count, as they do for CBBD.
//
// `weeks` is netWeeks()'s answer when the caller already has it in flight —
// ranksFor fetches it alongside the preseason field, since only the floor
// needs that count.
async function netRanks(season, week, preCount, weeks) {
    const yr = Number(season);
    const wk = Number(week);
    if (!Number.isFinite(yr) || !Number.isFinite(wk)) return null;
    const whole = wholeNetWeek(yr, await (weeks || netWeeks(yr, wk)), preCount);
    if (!whole) return null;
    const rows = await HoopsNetRank.find({ season: yr, week: whole._id }, { teamId: 1, rank: 1, _id: 0 }).lean();
    return { ranks: byTeam(rows), week: whole._id, stale: whole._id !== wk };
}
const thinLogged = new Set();

// The newest of `weeks` (netWeeks()'s answer) that clears the coverage
// floor, or undefined. Shared by scoring and the pages' display, so a page
// never shows a NET week scoring has passed over.
function wholeNetWeek(yr, weeks, preCount) {
    const floor = preCount > 0 ? preCount * MIN_LIVE_COVERAGE : 1;
    const whole = weeks.find(w => w.n >= floor);
    for (const w of weeks) {
        if (w === whole) break;
        // Once per process per week: ranksFor runs on every page view past
        // the rank cache, and the job's own JobRun is the alarm.
        const key = `${yr}:${w._id}`;
        if (thinLogged.has(key)) continue;
        thinLogged.add(key);
        console.error(`hoops-ranks: ignoring NET week ${w._id} — only ${w.n} of ${preCount} teams ranked`);
    }
    return whole;
}

// The newest whole NET week of a season, or null — what the pages show as
// "the NET": the latest snapshot scoring would accept, not merely the
// highest week on file.
async function latestNetWeek(season) {
    const yr = Number(season);
    if (!Number.isFinite(yr)) return null;
    const [preCount, weeks] = await Promise.all([
        HoopsTeam.countDocuments({ season: yr, 'preseason.rank': { $type: 'number' } }),
        netWeeks(yr, Number.MAX_SAFE_INTEGER)
    ]);
    const whole = wholeNetWeek(yr, weeks, preCount);
    return whole ? whole._id : null;
}

// Row counts of every NET week at or before `week`, newest first.
function netWeeks(season, week) {
    return HoopsNetRank.aggregate([
        { $match: { season: Number(season), week: { $lte: Number(week) } } },
        { $group: { _id: '$week', n: { $sum: 1 } } },
        { $sort: { _id: -1 } }
    ]);
}

// Torvik's ranking going into a week: the newest WHOLE snapshot at or
// before it, as { ranks, week }, or null to fall back to the preseason
// import. A thin week (a run that matched part of the field) is passed over
// for the whole one before it, as a thin NET week is.
//
// `weeks` is torvikWeeks()'s answer when the caller already has it in flight.
async function torvikRanks(season, week, preCount, weeks) {
    const yr = Number(season);
    const wk = Number(week);
    if (!Number.isFinite(yr) || !Number.isFinite(wk)) return null;
    const floor = preCount > 0 ? preCount * MIN_LIVE_COVERAGE : 1;
    const whole = (await (weeks || torvikWeeks(yr, wk))).find(w => w.n >= floor);
    if (!whole) return null;
    const rows = await HoopsTorvikRank.find({ season: yr, week: whole._id }, { teamId: 1, rank: 1, _id: 0 }).lean();
    return { ranks: byTeam(rows), week: whole._id };
}

// Row counts of every Torvik week at or before `week`, newest first.
function torvikWeeks(season, week) {
    return HoopsTorvikRank.aggregate([
        { $match: { season: Number(season), week: { $lte: Number(week) } } },
        { $group: { _id: '$week', n: { $sum: 1 } } },
        { $sort: { _id: -1 } }
    ]);
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
    // One round of reads, in parallel: the free tier's cost is round trips,
    // and this runs on every rank-cache miss and every scoring pass. The
    // CBBD week is fetched even when the NET wins — a wasted read is
    // cheaper than a second round.
    const [preseason, weeks, live, tWeeks] = await Promise.all([
        preseasonRanks(season),
        netWeeks(season, week),
        liveRanks(season, week),
        torvikWeeks(season, week)
    ]);
    const preCount = Object.keys(preseason).length;

    const [net, current] = await Promise.all([
        netRanks(season, week, preCount, weeks),
        torvikRanks(season, week, preCount, tWeeks)
    ]);
    // The Torvik side of everything below: his rank going into this week,
    // else the preseason import.
    const pre = current ? current.ranks : preseason;
    const torvikWeek = current ? current.week : null;

    // The NET, once it has published, outranks everything below.
    if (net) {
        // A team the NET does not rank — a school reclassifying into D-I, or
        // one NCAA leaves off — keeps the rank the sources below give it:
        // CBBD's for the week, else Torvik's. Left out, it would be
        // unranked, and every win over it a silent Q4.
        const ranks = Object.assign({}, pre, live.ranks, net.ranks);
        return {
            ranks, source: 'ncaa-net', blendWeight: 0, staleWeek: net.stale ? net.week : null, torvikWeek,
            notOnNet: Object.keys(ranks).length - Object.keys(net.ranks).length
        };
    }

    const liveCount = Object.keys(live.ranks).length;

    // A partially-written week is a FAILED refresh, not a thin one.
    const thin = preCount > 0 && liveCount > 0 && liveCount < preCount * MIN_LIVE_COVERAGE;
    if (thin) {
        console.error(`hoops-ranks: ignoring week ${live.week} — only ${liveCount} of ${preCount} teams rated`);
    }

    const havePre = Object.keys(pre).length > 0;
    const haveLive = liveCount > 0 && !thin;
    if (!haveLive) return { ranks: pre, source: 'torvik', blendWeight: 1, staleWeek: null, torvikWeek, partialWeek: thin ? live.week : null };
    if (!havePre) return { ranks: live.ranks, source: 'cbbd-adjusted', blendWeight: 0, staleWeek: live.stale ? live.week : null, torvikWeek };

    const w = blendWeight(week);
    if (w >= 1) return { ranks: pre, source: 'torvik', blendWeight: 1, staleWeek: null, torvikWeek };
    if (w <= 0) return { ranks: live.ranks, source: 'cbbd-adjusted', blendWeight: 0, staleWeek: live.stale ? live.week : null, torvikWeek };
    return {
        ranks: blendRanks(pre, live.ranks, w),
        source: 'blended',
        blendWeight: w,
        staleWeek: live.stale ? live.week : null,
        torvikWeek
    };
}

module.exports = {
    ranksFor, blendRanks, blendWeight, preseasonRanks, liveRanks, netRanks, netWeeks, latestNetWeek, rankOf,
    torvikRanks, torvikWeeks,
    _resetThinLog: () => thinLogged.clear(), MIN_LIVE_COVERAGE,
    FULLY_PRESEASON, FULLY_LIVE
};
