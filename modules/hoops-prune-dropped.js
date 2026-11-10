// Games CBBD no longer lists, removed after a pull that proves it.
//
// Every basketball import upserts by CBBD's game id and, until this, never
// deleted. So a game CBBD drops, or re-issues under a new id, stayed in
// `hoopsgames` for ever as an unplayed "scheduled" row. On 10 Nov 2026 eight
// Tulsa WOMEN's games CBBD had once filed under the men's Tulsa team blocked
// basketball H2H week 1 from settling until they were deleted by hand; the
// same comparison found five more stale rows (games moved or re-issued).
//
// The rule: after a pull of [start, end] for one season + seasonType that
// SUCCEEDED in full, a stored row of that season + seasonType dated inside
// [start, end] whose id CBBD did not return is gone from CBBD — delete it,
// provided it was never played and nothing points at it.
//
// What must never happen is a delete off a bad pull, so the CALLER only gets
// here when the fetch threw nothing, hit no cap, wrote cleanly, and was not
// the "CBBD returned nothing although games were due" case. This module adds
// its own refusals on top:
//   - a returned game without an id: the id set is not trustworthy;
//   - more than MAX_PRUNE candidates in one pass (see below).
//
// What it leaves alone, deliberately:
//   - finals, anything with points, anything in progress — a played game is
//     history even if CBBD later drops it;
//   - rows CBBD STILL lists, however odd (a double listing, a tournament
//     placeholder): presence in the pull is all that matters here. #512's
//     duplicate hide (modules/hoops-stale-duplicates.js) keeps handling those;
//   - rows something references: scored weekly rows (Franchise and the legacy
//     User copy), a stored box score or shot chart, or a push alert already
//     sent for it. Those are reported, not deleted.
//
// A refusal is reported in the job summary, never silent; so is every row
// deleted (id, matchup, date).

const HoopsGame = require('../models/hoopsGame');
const HoopsBoxScore = require('../models/hoopsBoxScore');
const HoopsShots = require('../models/hoopsShots');
const Franchise = require('../models/franchise');
const User = require('../models/user');
const calendar = require('./hoops-calendar');

// The most rows one pass may delete. The largest real event so far was 8 (the
// Tulsa women's games), and a whole-season comparison found 5 more — 13 in a
// season. A pass over the look-ahead's 28 days sees ~1,500 games; 25 is
// roughly twice the season's real total, yet a partial CBBD answer that still
// looks successful (a conference's slate missing, say) runs to dozens or
// hundreds and is refused whole rather than half-applied.
const MAX_PRUNE = 25;

const day = (d) => new Date(d).toISOString().slice(0, 10);
const describe = (g) => ({ id: g.id, matchup: `${g.awayTeam || g.awayTeamId} @ ${g.homeTeam || g.homeTeamId}`, date: day(g.startDate) });

// Which of `ids` something points at, as id -> [what].
async function referencesTo(ids) {
    const refs = new Map(ids.map(id => [id, []]));
    // Each source below yields an id at most once, and only ids asked for.
    const add = (id, what) => refs.get(id).push(what);

    // Football's weeklyScore rows carry CFBD ids in the same field, so a
    // collision with a CBBD id only makes this skip a row — the safe way to
    // be wrong.
    const scored = { 'seasons.weeklyScore.teams.gameId': { $in: ids } };
    for (const [Model, what] of [[Franchise, 'weekly score'], [User, 'weekly score (user)']]) {
        const rows = await Model.aggregate([
            { $match: scored },
            { $unwind: '$seasons' }, { $unwind: '$seasons.weeklyScore' }, { $unwind: '$seasons.weeklyScore.teams' },
            { $match: { 'seasons.weeklyScore.teams.gameId': { $in: ids } } },
            { $group: { _id: '$seasons.weeklyScore.teams.gameId' } }
        ]);
        rows.forEach(r => add(r._id, what));
    }
    (await HoopsBoxScore.distinct('gameId', { gameId: { $in: ids } })).forEach(id => add(id, 'box score'));
    (await HoopsShots.distinct('gameId', { gameId: { $in: ids } })).forEach(id => add(id, 'shot chart'));
    (await HoopsGame.find({ id: { $in: ids }, 'pushAlerts.0': { $exists: true } }, { id: 1, _id: 0 }).lean())
        .forEach(g => add(g.id, 'push alert sent'));
    return refs;
}

// A tip time ESPN filled in (startTimeSource) is OURS: CBBD still lists the
// game at its midnight-Eastern placeholder on the same Eastern day. A late
// tip stored at, say, 01:00Z on D+1 has CBBD's copy at 05:00Z on D — and a
// pull starting on D+1 asks CBBD from D+1 00:00Z, so the copy is not in the
// answer while our row is in the window. Such a row is only judged by a pull
// that reaches back to its placeholder.
function placeholderBeforeWindow(g, start) {
    if (!g.startTimeSource) return false;
    const placeholder = calendar.easternMidnight(calendar.easternDay(g.startDate));
    const asked = new Date(`${day(start)}T00:00:00Z`);   // fetchGamesInRange's startDateRange
    return placeholder < asked;
}

// Returns { pruned: [{id, matchup, date}], kept: [{..., refs}], refused: string|null }.
async function pruneDroppedGames({ season, seasonType, start, end, returned }) {
    const none = { pruned: [], kept: [], refused: null };
    if (returned.some(g => !g || g.id == null)) {
        return Object.assign(none, { refused: 'a returned game had no id, so the pull cannot prove what is missing' });
    }
    const seen = returned.map(g => g.id);

    const candidates = (await HoopsGame.find({
        season, seasonType,
        startDate: { $gte: start, $lte: end },
        id: { $nin: seen },
        status: { $nin: ['final', 'in_progress'] },
        homePoints: null, awayPoints: null
    }, { id: 1, startDate: 1, startTimeSource: 1, homeTeam: 1, awayTeam: 1, homeTeamId: 1, awayTeamId: 1, _id: 0 })
        .sort({ startDate: 1, id: 1 }).lean()).filter(g => !placeholderBeforeWindow(g, start));
    if (!candidates.length) return none;
    if (candidates.length > MAX_PRUNE) {
        return Object.assign(none, {
            refused: `${candidates.length} stored game(s) missing from CBBD's answer, over the ${MAX_PRUNE}-row cap — `
                + 'deleted nothing; check CBBD before trusting this pull'
        });
    }

    const refs = await referencesTo(candidates.map(g => g.id));
    const kept = candidates.filter(g => refs.get(g.id).length).map(g => Object.assign(describe(g), { refs: refs.get(g.id) }));
    const doomed = candidates.filter(g => !refs.get(g.id).length);
    if (!doomed.length) return Object.assign(none, { kept });

    // The same guards again on the delete itself, so a row that went live or
    // final between the read and here survives.
    await HoopsGame.deleteMany({
        id: { $in: doomed.map(g => g.id) }, season, seasonType,
        status: { $nin: ['final', 'in_progress'] }, homePoints: null, awayPoints: null
    });
    return { pruned: doomed.map(describe), kept, refused: null };
}

// One line for a job summary, or '' when there is nothing to say.
function pruneNote(prune) {
    if (!prune) return '';
    const fmt = (g) => `${g.id} ${g.matchup} ${g.date}`;
    const parts = [];
    if (prune.pruned.length) parts.push(`pruned ${prune.pruned.length} dropped by CBBD: ${prune.pruned.map(fmt).join('; ')}`);
    if (prune.kept.length) parts.push(`kept ${prune.kept.length} dropped but referenced: ${prune.kept.map(g => `${fmt(g)} (${g.refs.join(', ')})`).join('; ')}`);
    if (prune.refused) parts.push(`prune refused: ${prune.refused}`);
    return parts.join('; ');
}

module.exports = { pruneDroppedGames, pruneNote, referencesTo, MAX_PRUNE };
