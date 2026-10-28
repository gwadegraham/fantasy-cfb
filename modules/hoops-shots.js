// Basketball shot charts, from CBBD's post-game play-by-play.
//
// Fetched with the box scores — the live poller's completion pass a few
// minutes after a cluster of finals, and the 05:00 hoops-stats safety net —
// and only ever READ by the game page, as box scores are (#503).
//
// ---- what it costs ----
//
// /plays/game/{id} is BILLABLE, one call per game: there is no batch that
// fits. /plays/date answers a whole day in one call, but a busy Saturday
// (87 games, 7 Mar 2026) was 53 MB — too much to hold on a 512 MB dyno. So
// only games with a DRAFTED team are fetched (~550-700 a month, ~2% of the
// shared 30k pool), each at most MAX_FETCHES times, and once complete never
// again. A run is capped at MAX_PER_RUN calls so a backlog cannot spend the
// pool in one go.
//
// ---- the coordinates ----
//
// Measured on Oklahoma @ West Virginia (5 Apr 2026, 120 located attempts):
// CBBD's x/y is the FULL court in tenths of a foot, 940 x 500, baskets at
// (52.5, 250) and (887.5, 250). Rim shots sat within ~8 ft of a basket and
// threes started at ~21.6 ft, matching the men's arc. Teams change ends at
// half, so each team's attempts in a period are folded onto one basket —
// the end that period's attempts cluster at, so one heave from the far end
// still lands as a long miss rather than flipping the half. Overtime keeps
// the second half's end (teams do not change ends for OT), and a period
// with too few attempts to vote takes the opposite of the other half's.
//
// ---- complete or not ----
//
// CBBD posts the plays after the final, on its own schedule. An empty answer
// is "not yet": the game is tried again on the next pass. Plays whose
// attempts fall short of the stored box score's are stored but marked
// incomplete and tried again; after MAX_FETCHES the chart is what it is.

const cbbd = require('./cbbd-client');
const HoopsGame = require('../models/hoopsGame');
const HoopsShots = require('../models/hoopsShots');
const HoopsBoxScore = require('../models/hoopsBoxScore');
const { isFinal, rosterIds } = require('./hoops-scoring-pass');
const { entryFor } = require('./roster-teams');
const franchiseRepo = require('./franchise-repo');

const DAY_MS = 24 * 60 * 60 * 1000;
const LOOKBACK_MS = 3 * DAY_MS;
const MAX_FETCHES = 3;
const MAX_PER_RUN = 60;
// Half of the 940-tenths court.
const MIDCOURT = 470;

const round1 = (n) => Math.round(n * 10) / 10;
const median = (a) => {
    const s = a.slice().sort((p, q) => p - q);
    return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};
const located = (p) => p.shotInfo && p.shotInfo.location
    && Number.isFinite(Number(p.shotInfo.location.x)) && Number.isFinite(Number(p.shotInfo.location.y))
    && p.shotInfo.location.x !== null && p.shotInfo.location.y !== null;

// Field-goal attempts out of a game's plays, folded onto one half court.
// Pure: plays in, { attempts, shots } out.
function chartFrom(plays, game) {
    const homeId = Number(game.homeTeamId), awayId = Number(game.awayTeamId);
    const fga = (plays || []).filter(p => p && p.shootingPlay && p.shotInfo
        && p.shotInfo.range !== 'free_throw' && (Number(p.teamId) === homeId || Number(p.teamId) === awayId));

    // Which end each team attacked in each half: where its attempts cluster.
    // Overtime is played toward the second half's end.
    const half = (period) => (Number(period) >= 2 ? 2 : 1);
    const xs = new Map();
    for (const p of fga.filter(located)) {
        const k = `${p.teamId}|${half(p.period)}`;
        if (!xs.has(k)) xs.set(k, []);
        xs.get(k).push(Number(p.shotInfo.location.x));
    }
    // A half needs a few attempts to vote; one rim shot plus one heave has a
    // median at mid-court. Too few, and the other half's end, turned round,
    // decides — teams change ends at the half.
    const VOTE = 3;
    const vote = (team, h) => {
        const a = xs.get(`${team}|${h}`) || [];
        return a.length >= VOTE ? median(a) > MIDCOURT : null;
    };
    const farEnd = (team, period) => {
        const h = half(period);
        const own = vote(team, h), other = vote(team, 3 - h);
        if (own !== null) return own;
        if (other !== null) return !other;
        const a = xs.get(`${team}|${h}`) || [];
        return a.length ? median(a) > MIDCOURT : false;
    };

    const shots = fga.filter(located).map(p => {
        let x = Number(p.shotInfo.location.x), y = Number(p.shotInfo.location.y);
        // A 180-degree turn, not a mirror: the shooter's left stays left.
        if (farEnd(p.teamId, p.period)) { x = 940 - x; y = 500 - y; }
        const s = p.shotInfo;
        return {
            teamId: Number(p.teamId),
            athleteId: s.shooter && s.shooter.id != null ? Number(s.shooter.id) : undefined,
            shooter: (s.shooter && s.shooter.name) || undefined,
            made: !!s.made,
            range: s.range || undefined,
            assisted: !!s.assisted,
            period: Number(p.period) || undefined,
            clock: p.clock || undefined,
            // Across the floor, and out from the baseline; a heave from past
            // half court is pinned to the half line rather than drawn off it.
            x: round1(Math.min(Math.max(y / 10, 0), 50)),
            y: round1(Math.min(Math.max(x / 10, 0), 47))
        };
    });
    const count = (id) => fga.filter(p => Number(p.teamId) === id).length;
    return { attempts: { home: count(homeId), away: count(awayId) }, shots };
}

// Every team on a basketball roster this season, across every league.
async function rosteredTeamIds(season) {
    // Required here: hoops-scores-job pulls in the routes tree.
    const { basketballLeagues } = require('./hoops-scores-job');
    const leagues = (await basketballLeagues()).filter(l => Number(l.season) === Number(season));
    const ids = new Set();
    for (const { league } of leagues) {
        const managers = await franchiseRepo.byLeagueAndSeason(league, season, { fields: ['seasons'] });
        managers.forEach(m => rosterIds(entryFor(m, season)).forEach(id => ids.add(id)));
    }
    return ids;
}

// The box score's field-goal attempts, to tell whole plays from partial ones.
function boxAttempts(box) {
    if (!box || !box.home || !box.away) return null;
    const h = Number(box.home.fgAtt), a = Number(box.away.fgAtt);
    return Number.isFinite(h) && Number.isFinite(a) ? { home: h, away: a } : null;
}

// Fetch and store one game. Returns 'stored' | 'partial' | 'empty'.
//
// The fetch is COUNTED before the billable call, atomically: a CBBD error
// still uses one of the game's MAX_FETCHES, and the poller and the 05:00 job
// landing on the same game cannot both count it as their first.
async function fetchGame(game, now) {
    const id = Number(game.id);
    await HoopsShots.updateOne({ gameId: id },
        { $inc: { fetches: 1 }, $set: { season: game.season, fetchedAt: new Date(now) }, $setOnInsert: { complete: false } },
        { upsert: true });
    const { data } = await cbbd.cbbdGet(`/plays/game/${id}`);
    if (!data.length) return 'empty';
    const chart = chartFrom(data, game);
    // Complete only when the box score agrees. No box yet is NOT proof:
    // plays posted part-way would otherwise be frozen as whole. The 05:00 job
    // runs the box batch first, so the next pass has one to check against.
    const box = boxAttempts(await HoopsBoxScore.findOne({ gameId: id }, { home: 1, away: 1, _id: 0 }).lean());
    const complete = !!box && chart.attempts.home >= box.home && chart.attempts.away >= box.away;
    await HoopsShots.updateOne({ gameId: id }, { $set: Object.assign({ complete }, chart) });
    return complete ? 'stored' : 'partial';
}

// Every final game in the lookback (or just `gameIds`) with a drafted team
// and no complete chart yet. One billable call per game fetched.
async function ingestShots(season, { now = Date.now(), gameIds = null, teamIds = null } = {}) {
    const yr = Number(season);
    const query = { season: yr, status: 'final', startDate: { $gte: new Date(now - LOOKBACK_MS), $lte: new Date(now) } };
    if (Array.isArray(gameIds)) query.id = { $in: gameIds.map(Number) };
    const finals = (await HoopsGame.find(query, { id: 1, season: 1, status: 1, homeTeamId: 1, awayTeamId: 1,
        homePoints: 1, awayPoints: 1, startDate: 1, _id: 0 }).sort({ startDate: 1, id: 1 }).lean()).filter(isFinal);
    if (!finals.length) return { season: yr, games: 0, stored: 0, skippedReason: 'nothing final' };

    const drafted = teamIds ? new Set([...teamIds].map(Number)) : await rosteredTeamIds(yr);
    const ours = finals.filter(g => drafted.has(Number(g.homeTeamId)) || drafted.has(Number(g.awayTeamId)));
    if (!ours.length) return { season: yr, games: 0, stored: 0, skippedReason: 'no drafted team played' };

    const done = await HoopsShots.find({ gameId: { $in: ours.map(g => Number(g.id)) } },
        { gameId: 1, complete: 1, fetches: 1, _id: 0 }).lean();
    const byId = new Map(done.map(d => [Number(d.gameId), d]));
    const due = ours.filter(g => {
        const d = byId.get(Number(g.id));
        return !d || (!d.complete && (d.fetches || 0) < MAX_FETCHES);
    });
    if (!due.length) return { season: yr, games: ours.length, stored: 0, skippedReason: 'all charted' };

    const out = { season: yr, games: due.length, stored: 0, partial: 0, empty: 0, deferred: 0, failed: 0, calls: 0 };
    let lastError = null;
    for (const g of due) {
        if (out.calls >= MAX_PER_RUN) { out.deferred++; continue; }
        out.calls++;
        try {
            out[await fetchGame(g, now)]++;
        } catch (err) {
            // CBBD down: every other game would fail the same way.
            if (err && err.unreachable) throw err;
            // One game CBBD answers badly for does not cost the rest.
            out.failed++;
            lastError = err.message;
        }
    }
    if (lastError) out.error = lastError;
    return out;
}

// The page's view of a game's chart, or null. Never calls CBBD.
async function forGame(game) {
    const doc = await HoopsShots.findOne({ gameId: Number(game.id) }, { _id: 0, __v: 0 }).lean();
    if (!doc || !Array.isArray(doc.shots) || !doc.shots.length) return null;
    const side = (teamId) => doc.shots.filter(s => Number(s.teamId) === Number(teamId))
        .map(({ teamId, ...s }) => s);
    return {
        home: side(game.homeTeamId),
        away: side(game.awayTeamId),
        attempts: doc.attempts || null,
        complete: !!doc.complete
    };
}

module.exports = { ingestShots, forGame, chartFrom, rosteredTeamIds, fetchGame, MAX_FETCHES, MAX_PER_RUN, LOOKBACK_MS };
