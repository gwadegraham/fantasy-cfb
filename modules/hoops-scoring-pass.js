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
const { resolveConfig, overridesFromDoc, engagementForSeason } = require('./scoring-defaults');
const { evaluate } = require('./scoring');
const { buildHoopsContext } = require('./hoops-detectors');
const { ranksFor } = require('./hoops-ranks');
const { entryFor } = require('./roster-teams');
const { autoCaptainTeamId, captainWeeklyBonus } = require('./captain');
const { isModeGame, seasonModeWeeks } = require('./hoops-modes');

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

// The resolved scoring config, and the raw document it came from — the game
// modes (engagementBySeason) and the H2H roster pin live on the document.
async function configFor(league) {
    const doc = await ScoringConfig.findOne({ league }).lean();
    return { cfg: resolveConfig(league, overridesFromDoc(doc)), doc };
}

// Score one week of one basketball league.
//
// Returns a summary rather than writing a log: the caller is a job that
// already knows how to record one, and a pure-ish return is what makes this
// testable without a scheduler.
// ONE PASS PER LEAGUE AT A TIME, in this process.
//
// The nightly job and the live poller (modules/hoops-live-poll.js) both
// score basketball, inside the same dyno, and can land on the same league
// together. Since the H2H step, a pass writes each manager's WHOLE
// weeklyScore array (modules/h2h-settle.js) from a snapshot it read a moment
// earlier — so an interleaved pass could write a week back to what it was
// before the other pass rescored it. Chaining passes per league closes that;
// a failed pass does not block the next one.
const leagueQueue = new Map();
function scoreHoopsWeek(league, opts) {
    const prev = leagueQueue.get(league) || Promise.resolve();
    // `prev` is always a `tail` below, which never rejects.
    const run = prev.then(() => scoreHoopsWeekNow(league, opts));
    const tail = run.catch(() => {});
    leagueQueue.set(league, tail);
    tail.then(() => { if (leagueQueue.get(league) === tail) leagueQueue.delete(league); });
    return run;
}

async function scoreHoopsWeekNow(league, { season, week, apply = true } = {}) {
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

    const [{ cfg, doc: cfgDoc }, ranked, managers] = await Promise.all([
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

    // The weekly game modes (Captain, H2H) for THIS league's season. Read
    // only when one is on: a league playing the classic game pays no extra
    // query for them.
    const eng = engagementForSeason(cfgDoc && cfgDoc.engagementBySeason, yr);
    const modeWeeks = (eng.captainEnabled || eng.h2hEnabled) ? await seasonModeWeeks(yr) : [];
    const inModeWeek = modeWeeks.includes(wk);

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
                const row = {
                    teamId: id, gameId: game.id, score: pts,
                    quadrant: ctx.isRegular ? ctx.quadrant : null,
                    oppRank: ctx.oppRank
                };
                // A conference-tournament or postseason game: it scores,
                // but Captain does not double it and H2H does not count it
                // (modules/hoops-modes.js). Flagged on the row so every
                // reader — the H2H total, the pages that split a Captain
                // bonus across a team's games — can tell without
                // re-reading the game. Absent rather than false otherwise.
                if (!isModeGame(game)) row.noModes = true;
                scoreByTeam.push(row);
            }
        }

        // Captain (×N on one team) — football's helpers, basketball's games.
        // Only in a mode week, and only on mode games: a captained team's
        // conference tournament game in the same week is paid once.
        // A manager who never picks gets the auto-captain, resolved from
        // the weeks BEFORE this one, as football does.
        let captainTeamId = null, captainBonus = 0;
        if (eng.captainEnabled && inModeWeek) {
            // `|| []` kept: these are LEAN reads, which apply no schema
            // defaults, so an entry written by any other path (a raw insert,
            // a migration) can lack the array — and a throw here would stop
            // scoring for the whole league. Covered by a test that seeds
            // exactly that document.
            const entry = entryFor(m, yr);
            const prior = (entry.weeklyScore || []).filter(e => Number(e.week) < wk);
            // The manager's pick, else the FROZEN default (modules/hoops-captain.js),
            // else a fresh auto-captain — only for a week nothing was frozen for
            // (one scored before freezing existed, or a missed sweep).
            const parts = require('./hoops-captain').pickParts(entry.captains, wk);
            captainTeamId = parts.picked != null ? parts.picked
                : parts.frozenAuto != null ? parts.frozenAuto
                : autoCaptainTeamId(ids.map(id => ({ id })), prior);
            captainBonus = captainWeeklyBonus(scoreByTeam.filter(r => !r.noModes), captainTeamId, eng.captainMultiplier);
            score += captainBonus;
        }
        const result = { accountId: m._id, score, scoreByTeam };
        // Stored exactly as football stores it (modules/scoring.js): only
        // when it moved the score, negative included, so the pages can
        // split it back across the captained team's games.
        if (captainTeamId != null && captainBonus !== 0) {
            result.captainTeamId = captainTeamId;
            result.captainBonus = captainBonus;
        }
        results.push(result);
    }

    let h2h = null;
    if (apply) {
        for (const r of results) await writeWeek(league, r.accountId, yr, wk, r);
        // H2H after every manager's week is written — a matchup reads both
        // sides — and before the totals, which then sum the bonus in. It
        // runs whether or not H2H is on: with it off, the pass strips any
        // bonus a previous setting left behind. writeWeek above replaced
        // this week's row whole, bonus fields and all, so this is also what
        // puts this week's result back.
        //
        // Required here, not at the top: hoops-h2h reads this module's
        // helpers, and a load-time cycle hands one side an empty export.
        //
        // try/finally: writeWeek has already replaced this week's rows, so
        // the totals MUST be re-summed even if H2H fails — otherwise
        // cumulativeScore is left holding a bonus the rows no longer carry
        // (the 14 Sep 2026 drift). The error still reaches the caller.
        try {
            if (results.length) {
                h2h = await require('./hoops-h2h').applyHoopsH2H(league, yr, {
                    cfgDoc, weeks: modeWeeks.length ? modeWeeks : undefined
                });
            }
        } finally {
            for (const r of results) await writeCumulative(league, r.accountId, yr);
        }
    }

    return {
        league, season: yr, week: wk,
        source: ranked.source,
        staleWeek: ranked.staleWeek,
        managers: results.length,
        games: final.length,
        skipped: games.length - final.length,
        h2h,
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
    if (result.captainTeamId != null) {
        entry.captainTeamId = result.captainTeamId;
        entry.captainBonus = result.captainBonus;
    }

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

module.exports = { scoreHoopsWeek, isFinal, rosterIds, writeWeek, writeCumulative, points, configFor };
