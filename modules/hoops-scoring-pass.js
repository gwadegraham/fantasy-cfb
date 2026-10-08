// Scoring a week of basketball onto rosters (#316).
//
// A separate pass from football's, deliberately. The football job fetches a
// manager list over HTTP, then a batched games route, then PATCHes each
// manager back — a shape it grew for good reasons (a 30s Heroku ceiling and
// a route that already existed). None of those apply here: the basketball
// games, rosters and ratings are all local, so this is three queries and one
// write per manager, and football is not touched by any of it.
//
// What IS shared is the engine. evaluate('hoops', ...) is the same walk the
// two football leagues run, with the basketball context and vocabulary.

const HoopsGame = require('../models/hoopsGame');
const Franchise = require('../models/franchise');
const ScoringConfig = require('../models/scoringConfig');
const franchiseRepo = require('./franchise-repo');
const { resolveConfig, overridesFromDoc } = require('./scoring-defaults');
const { evaluate } = require('./scoring');
const { buildHoopsContext } = require('./hoops-detectors');
const { ranksFor } = require('./hoops-ranks');
const { entryFor } = require('./roster-teams');

// ONLY FINAL GAMES SCORE.
//
// CBBD says status 'final' on a played game and 'scheduled' on everything
// else; every one of the 105 March 2026 games carried points, a status of
// 'final' and a boolean winner. Points alone are not the test — a live game
// has points too, and basketball scores are banked at TIME OF PLAY, so a
// half-time score banked as a result is never revisited.
// `Number(null)` is 0 and 0 is finite, so the obvious check read a final
// with no points on file as a completed 0-0 game and banked a loss for
// both teams. That trap has now been hit three times in this model — on a
// display rank, on a blended rank, and here. A points value that is
// absent is absent.
function points(value) {
    if (value === null || value === undefined || value === '') return null;
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
}

function isFinal(game) {
    if (!game) return false;
    if (String(game.status || '').toLowerCase() !== 'final') return false;
    const home = points(game.homePoints);
    const away = points(game.awayPoints);
    if (home === null || away === null) return false;
    // A TIE is not a result. Basketball does not have them, so one means
    // the row is wrong — and scoring it would pay BOTH teams a Q4 "win"
    // and shield both from the bad-loss penalty, permanently.
    return home !== away;
}

// Every team id on a roster, in roster order. Reads refs first because that
// is how basketball stores them, and falls back to embedded teams so a
// hand-corrected roster still scores.
function rosterIds(entry) {
    if (!entry) return [];
    const refs = (entry.teamRefs || []).filter(r => r && r.sport === 'basketball');
    if (refs.length) return refs.map(r => Number(r.id));
    return (entry.teams || []).map(t => Number(t.id)).filter(Number.isFinite);
}

async function configFor(league) {
    const doc = await ScoringConfig.findOne({ league }).lean();
    return resolveConfig(league, overridesFromDoc(doc));
}

// Score one week of one basketball league.
//
// Returns a summary rather than writing a log: the caller is a job that
// already knows how to record one, and a pure-ish return is what makes this
// testable without a scheduler.
async function scoreHoopsWeek(league, { season, week, apply = true } = {}) {
    const yr = Number(season);
    const wk = Number(week);

    // A week the caller could not resolve is a SKIP, not a crash. Number
    // (undefined) is NaN, which Mongoose rejects with a cast error — thrown
    // from inside a scheduled job, where the useful outcome is "nothing to
    // do tonight" rather than a stack trace and no JobRun.
    if (!Number.isFinite(yr) || !Number.isFinite(wk)) {
        return {
            league, season: yr, week: wk,
            skippedReason: 'no season or week to score',
            source: null, staleWeek: null, managers: 0, games: 0, skipped: 0, results: []
        };
    }

    const [cfg, ranked, managers] = await Promise.all([
        configFor(league),
        ranksFor(yr, wk),
        franchiseRepo.byLeagueAndSeason(league, yr, {
            fields: ['firstName', 'lastName', 'league', 'seasons']
        })
    ]);

    // Every rostered team across the league, deduplicated: managers draft
    // from one pool and a game between two rostered teams must be fetched
    // once, not twice.
    const idsByManager = new Map();
    const allIds = new Set();
    for (const m of managers) {
        const ids = rosterIds(entryFor(m, yr));
        idsByManager.set(String(m._id), ids);
        ids.forEach(id => allIds.add(id));
    }

    const games = allIds.size ? await HoopsGame.find({
        season: yr, week: wk,
        $or: [{ homeTeamId: { $in: [...allIds] } }, { awayTeamId: { $in: [...allIds] } }]
    }).lean() : [];

    const final = games.filter(isFinal);
    const byTeam = new Map();
    for (const g of final) {
        for (const id of [g.homeTeamId, g.awayTeamId]) {
            if (!allIds.has(Number(id))) continue;
            const key = String(id);
            if (!byTeam.has(key)) byTeam.set(key, []);
            byTeam.get(key).push(g);
        }
    }

    const results = [];
    for (const m of managers) {
        // No `|| []`: the map was built from this same list a few lines
        // up, so every manager has an entry. A fallback here would be an
        // unreachable branch pretending to be a safeguard.
        const ids = idsByManager.get(String(m._id));
        let score = 0;
        const scoreByTeam = [];
        for (const id of ids) {
            for (const game of byTeam.get(String(id)) || []) {
                const pts = evaluate('hoops', id, game, ranked.ranks, cfg);
                score += pts;
                // The quadrant it was banked at, kept with the points (#502):
                // ranks can move after a week is scored (a late weekly row,
                // a re-imported preseason), and the pages must show what
                // was PAID, not what the ranks say today.
                const ctx = buildHoopsContext(id, game, ranked.ranks);
                scoreByTeam.push({
                    teamId: id, gameId: game.id, score: pts,
                    quadrant: ctx.isRegular ? ctx.quadrant : null,
                    oppRank: ctx.oppRank
                });
            }
        }
        results.push({ accountId: m._id, score, scoreByTeam });
    }

    if (apply) {
        for (const r of results) {
            await writeWeek(league, r.accountId, yr, wk, r);
            await writeCumulative(league, r.accountId, yr);
        }
    }

    return {
        league, season: yr, week: wk,
        source: ranked.source,
        staleWeek: ranked.staleWeek,
        managers: results.length,
        games: final.length,
        skipped: games.length - final.length,
        results
    };
}

// Upsert ONE week's entry, leaving every other week alone.
//
// Re-running a week must overwrite it rather than append — a second pass
// over the same week is normal (a late final, a corrected roster) and
// appending would double every score in the season total.
async function writeWeek(league, accountId, season, week, result) {
    const entry = { week, score: result.score, scoreByTeam: result.scoreByTeam };

    const replaced = await Franchise.updateOne(
        { accountId, league, seasons: { $elemMatch: { season, 'weeklyScore.week': week } } },
        { $set: { 'seasons.$[s].weeklyScore.$[w]': entry } },
        { arrayFilters: [{ 's.season': season }, { 'w.week': week }] }
    );
    if (replaced.modifiedCount || replaced.matchedCount) return;

    await Franchise.updateOne(
        { accountId, league, 'seasons.season': season },
        { $push: { 'seasons.$.weeklyScore': entry } }
    );
}

// The season total, recomputed from the weeks that are actually on file.
//
// NOT accumulated as we go. Re-scoring a week is normal — a late final, a
// corrected roster — and adding a delta would drift every time; summing
// what is stored is correct however many times the pass runs.
//
// Standings reads THIS, not the weekly entries. Without it a league with
// six weeks of real scores renders every manager on 0, tied — which is
// exactly how it looked in dev, while League Highlights (which does read
// the weekly entries) showed the right numbers two inches below.
async function writeCumulative(league, accountId, season) {
    const doc = await Franchise.findOne(
        { accountId, league, 'seasons.season': season },
        { seasons: { $elemMatch: { season } } }
    ).lean();
    // No `|| []` on seasons: the filter above requires a matching season,
    // so a document that comes back always carries it. A fallback there
    // would be an unreachable branch pretending to be a safeguard.
    const entry = doc && doc.seasons[0];
    if (!entry) return;
    // `|| []` here IS kept, and is deliberately not covered: mongoose
    // materialises the array on anything it created, so this only fires
    // for a document written by some other path. Cheap insurance on a
    // value that feeds the standings.
    const total = (entry.weeklyScore || []).reduce((sum, w) => sum + (Number(w.score) || 0), 0);
    await Franchise.updateOne(
        { accountId, league, 'seasons.season': season },
        { $set: { 'seasons.$.cumulativeScore': total } }
    );
}

module.exports = { scoreHoopsWeek, isFinal, rosterIds, writeWeek, writeCumulative, points };
