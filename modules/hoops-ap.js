// The basketball AP Top 25: the rank shown beside a team's name.
//
// DISPLAY ONLY — see models/hoopsApRank.js. Scoring, quadrants, projections
// and the draft all read modules/hoops-ranks.js; nothing here may feed them.
// Where a page needs the quadrant's rank too (the team page's Q chip), it
// carries both, under different names.
//
// One CBBD call returns every poll of the season so far, so the ingest just
// rewrites them all: a corrected poll is picked up, and a missed day costs
// nothing the next run does not repair.

const cbbd = require('./cbbd-client');
const HoopsApRank = require('../models/hoopsApRank');
const { easternDay } = require('./hoops-calendar');

// CBBD's own label on an AP row (the query parameter is 'ap').
const AP_POLL = 'AP Top 25';

// Pull every AP poll CBBD has for the season and store the ranked rows.
// "Others receiving votes" come back with ranking null and are dropped.
async function ingest(season) {
    const { data, remainingCalls } = await cbbd.cbbdGet('/rankings', { season, pollType: 'ap' });
    const rows = data.filter(r => r && r.pollType === AP_POLL
        && Number.isInteger(Number(r.ranking)) && Number(r.ranking) > 0
        && r.teamId != null && Number.isFinite(Number(r.teamId)) && r.pollDate
        && r.week != null && Number.isFinite(Number(r.week)));

    // An empty answer is normal before the preseason poll. Rows that read as
    // nothing, or nothing once polls are stored, is CBBD changing shape (a
    // renamed label or field): fail loudly, keep what is stored, rather than
    // log a quiet success while the ranks stop moving.
    if (data.length && !rows.length) {
        throw new Error(`CBBD /rankings returned ${data.length} rows but none read as an AP poll — the response shape changed`);
    }
    if (!rows.length) {
        const stored = await HoopsApRank.countDocuments({ season });
        if (stored) throw new Error(`CBBD /rankings returned no AP polls for ${season}, but ${stored} rows are stored`);
    }

    const polls = new Map();
    rows.forEach(r => {
        const key = `${r.seasonType}|${r.week}`;
        if (!polls.has(key)) polls.set(key, []);
        polls.get(key).push(r);
    });

    for (const list of polls.values()) {
        const { seasonType, week } = list[0];
        const at = { season, seasonType, week: Number(week) };
        await HoopsApRank.bulkWrite(list.map(r => ({
            updateOne: {
                filter: Object.assign({ teamId: Number(r.teamId) }, at),
                update: { $set: Object.assign({
                    teamId: Number(r.teamId), school: r.team || null, rank: Number(r.ranking),
                    pollDate: new Date(r.pollDate),
                    points: Number.isFinite(Number(r.points)) ? Number(r.points) : null,
                    firstPlaceVotes: Number.isFinite(Number(r.firstPlaceVotes)) ? Number(r.firstPlaceVotes) : null,
                    fetchedAt: new Date()
                }, at) },
                upsert: true
            }
        })));
        // A team CBBD has since dropped from this poll leaves it here too.
        await HoopsApRank.deleteMany(Object.assign({ teamId: { $nin: list.map(r => Number(r.teamId)) } }, at));
    }
    clearCache();

    const latest = rows.reduce((m, r) => (!m || new Date(r.pollDate) > new Date(m)) ? r.pollDate : m, null);
    return { polls: polls.size, rows: rows.length, latest: latest ? new Date(latest) : null, remainingCalls };
}

// Which poll a game reads is decided on EASTERN CALENDAR DAYS, the hoops
// calendar's zone (modules/hoops-calendar.js). CBBD stamps a poll at
// midnight UTC on its Monday; a poll is in force for games on that Monday
// and after. Instants would get two cases wrong:
//   - a late Sunday tip (Sunday 19:00 Central is already Monday 00:00 UTC)
//     would read the poll that will count its own result;
//   - a TBD game is stamped midnight EASTERN (05:00 UTC in winter), so a
//     week opening on a Monday TBD would read last week's poll.
// A Monday game that tips before the noon release shows the new poll a few
// hours early. Accepted.

// A season's polls, oldest first: [{ at: ms, ranks: { <teamId>: rank } }].
// `at` is the poll's Monday, as UTC midnight of that calendar date.
async function polls(season) {
    const rows = await HoopsApRank.find({ season }, { pollDate: 1, teamId: 1, rank: 1, _id: 0 }).lean();
    const byDate = new Map();
    rows.forEach(r => {
        const d = new Date(r.pollDate);
        const at = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
        if (!Number.isFinite(at)) return;
        if (!byDate.has(at)) byDate.set(at, {});
        byDate.get(at)[String(r.teamId)] = r.rank;
    });
    return [...byDate.entries()].sort((a, b) => a[0] - b[0]).map(([at, ranks]) => ({ at, ranks }));
}

// Pages read this on every load; the polls change once a week.
const TTL_MS = 10 * 60 * 1000;
const cache = new Map();
async function cachedPolls(season, now = Date.now()) {
    const hit = cache.get(season);
    if (hit && now - hit.at < TTL_MS) return hit.polls;
    const list = await polls(season);
    cache.set(season, { at: now, polls: list });
    return list;
}
function clearCache() { cache.clear(); }

// The poll in force on `when`'s Eastern day: the latest whose Monday is on or
// before it. A game before the season's first poll shows no rank, and so
// does a team outside the poll. Pure, so a page can resolve many games off
// one read.
function ranksAt(pollList, when) {
    if (when === null || when === undefined) return {};
    const day = easternDay(when);
    if (!day) return {};
    const t = day.getTime();
    let found = null;
    for (const p of pollList || []) {
        if (p.at <= t) found = p; else break;
    }
    return found ? found.ranks : {};
}
function rankAt(pollList, teamId, when) {
    const r = ranksAt(pollList, when)[String(teamId)];
    return Number.isInteger(r) ? r : null;
}

module.exports = { ingest, polls, cachedPolls, clearCache, ranksAt, rankAt, AP_POLL, TTL_MS };
