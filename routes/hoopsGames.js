// Basketball schedule and score ingest (#314, Hardwood B1).
//
// A parallel tree to routes/games.js rather than a sport parameter on it. The
// reasoning is the same one that gave basketball its own collections (#312):
// every shared handler is a place a forgotten sport branch serves football data
// to a basketball surface, and this app already has that failure mode on record
// — modules/league-access.js warns that a league-code mismatch "silently
// resolves the member into the other league rather than failing". Two trees
// make an omission return zero rows instead of the wrong rows.

const express = require('express');
const router = express.Router();
const HoopsGame = require('../models/hoopsGame');
// Imported as a MODULE, not destructured. Destructuring captures the function
// reference at import time, which makes the network call unstubbable — the
// first version of the tests spied on the client and the route went to the real
// API anyway, failing with a 400 that looked like a routing bug.
const cbbd = require('../modules/cbbd-client');
// PAGE_CAP only; seasonRange is reached through `cbbd` so it stays stubbable —
// destructuring it here would re-arm the very trap the note above describes.
const { PAGE_CAP } = cbbd;

// One bulkWrite, with the partial-failure handling routes/games.js:897 works
// out the hard way.
//
// With { ordered: false } a partial failure still THROWS, but the successful
// ops did write and err.result carries their counts. Reporting 0/0 and a 500
// would tell the cron a run failed when it wrote 5,014 of 5,015 games.
//
// And a duplicate-key loss (11000) to a concurrent run is not a failure at all:
// the other run wrote that game. Two overlapping runs are realistic here —
// the full ingest measured 14.5s against Heroku's 30s ceiling, and an H12
// leaves the handler running while the caller retries.
async function writeGames(ops, label) {
    if (!ops.length) return { created: 0, updated: 0, failure: null };
    try {
        const write = await HoopsGame.bulkWrite(ops, { ordered: false });
        return { created: write.upsertedCount || 0, updated: write.matchedCount || 0, failure: null };
    } catch (err) {
        const partial = (err && err.result) || null;
        const created = partial ? (partial.upsertedCount || 0) : 0;
        const updated = partial ? (partial.matchedCount || 0) : 0;

        const writeErrors = (err && err.writeErrors) || [];
        const code = (e) => (e.err ? e.err.code : e.code);
        const duplicates = writeErrors.filter(e => code(e) === 11000);
        const unexpected = writeErrors.filter(e => code(e) !== 11000);
        if (duplicates.length) {
            console.log(`${label}: lost ${duplicates.length} of ${ops.length} upserts to a concurrent run`);
        }
        // No writeErrors at all means the whole batch failed for some other
        // reason, which is a genuine loss and must surface as a non-2xx — the
        // caller distinguishes healthy from not only by the status.
        const failure = (!writeErrors.length || unexpected.length) ? err.message : null;
        if (failure) console.log(`${label}: bulk write error: ${failure}`);
        return { created, updated, failure };
    }
}

// One upsert op per game, keyed on CBBD's id so re-running is safe.
//
// $set of the mapped fields rather than the raw row: CBBD sends 40 fields and
// the schema names 34 of them, so a blind $set would store whatever the API
// adds next under a name nothing reads. Mapping explicitly means a NEW field
// arrives as a schema change, deliberately, rather than as silent drift.
function buildUpsertOp(g) {
    if (!g || g.id == null) return null;

    const played = g.status === 'final';

    const doc = {
        id: g.id,
        sourceId: g.sourceId == null ? undefined : String(g.sourceId),
        season: g.season,
        seasonLabel: g.seasonLabel,
        seasonType: g.seasonType,
        startDate: g.startDate,
        startTimeTbd: !!g.startTimeTbd,
        status: g.status,
        neutralSite: !!g.neutralSite,
        conferenceGame: !!g.conferenceGame,
        gameType: g.gameType,
        tournament: g.tournament,
        gameNotes: g.gameNotes,
        attendance: g.attendance,
        excitement: g.excitement,
        homeTeamId: g.homeTeamId, homeTeam: g.homeTeam,
        homeConferenceId: g.homeConferenceId, homeConference: g.homeConference,
        homeSeed: g.homeSeed,
        homePeriodPoints: g.homePeriodPoints, homeWinner: g.homeWinner,
        homeTeamEloStart: g.homeTeamEloStart, homeTeamEloEnd: g.homeTeamEloEnd,
        awayTeamId: g.awayTeamId, awayTeam: g.awayTeam,
        awayConferenceId: g.awayConferenceId, awayConference: g.awayConference,
        awaySeed: g.awaySeed,
        awayPeriodPoints: g.awayPeriodPoints, awayWinner: g.awayWinner,
        awayTeamEloStart: g.awayTeamEloStart, awayTeamEloEnd: g.awayTeamEloEnd,
        venueId: g.venueId, venue: g.venue, city: g.city, state: g.state
    };

    // ⚠️ POINTS ARE ONLY STORED ONCE THE GAME IS FINAL.
    //
    // CBBD sends homePoints: 0 / awayPoints: 0 on a SCHEDULED game, where CFBD
    // leaves them absent. Storing those zeros would make every unplayed game a
    // 0-0 result in the database, and anything reading falsy-points as "not
    // played yet" would agree with it right up until someone looked at a
    // scoreboard. Verified live: scheduled is {status:'scheduled', homePoints:0,
    // awayPoints:0, homeWinner:null}; final is {status:'final', homePoints:117,
    // awayPoints:55, homeWinner:true}.
    //
    // This is routes/games.js's stripAbsentScores problem arriving from the
    // other direction — there the API sends nulls over a live score, here it
    // sends zeros over nothing.
    if (played) {
        doc.homePoints = g.homePoints;
        doc.awayPoints = g.awayPoints;
    }

    // undefined AND null. A null period array would be stored as null, past the
    // [Number] default, and a reader doing .homePeriodPoints.length on the
    // schema's word throws on every scheduled game.
    Object.keys(doc).forEach(k => { if (doc[k] === undefined || doc[k] === null) delete doc[k]; });
    return { updateOne: { filter: { id: g.id }, update: { $set: doc }, upsert: true } };
}

// Ingest a whole season's schedule. Safe to re-run — upserts by game id.
//
// Paged by date window, because /games caps at 3,000 records with no error and
// no indication: a single call for 2025-26 returns exactly 3000 rows ending
// 6 Jan, and the paged fetch returns 6,079 ending 15 Mar. More than half the
// season, lost silently, on a call that looks entirely successful.
router.post('/:season/schedule', async (req, res) => {
    if (!/^\d{4}$/.test(req.params.season)) {
        return res.status(400).json({ message: 'Invalid season' });
    }
    const season = Number(req.params.season);
    const seasonType = req.body && req.body.seasonType === 'postseason' ? 'postseason' : 'regular';
    const { start, end } = cbbd.seasonRange(season);

    let result;
    try {
        result = await cbbd.fetchGamesInRange(season, seasonType, start, end);
    } catch (err) {
        // Guarded for the reason routes/games.js documents: fetch REJECTS on a
        // network-layer failure, Express 4 does not route an async handler's
        // rejection, and there is no process-level unhandledRejection handler —
        // so an unguarded throw here takes the dyno down. This will be on a
        // cron, so it will eventually meet a flaky CBBD.
        const code = err.unreachable ? 502 : 400;
        console.log(`Hoops schedule ingest failed: ${err.message}`);
        return res.status(code).json({ message: err.message });
    }

    // A window at the cap is an UNDER-INGEST, not a big week. Refusing is the
    // whole point of paging — reporting success here would restore exactly the
    // silent truncation this route exists to avoid.
    if (result.capHits.length) {
        return res.status(500).json({
            message: `CBBD returned the ${PAGE_CAP}-record cap for window(s) ${result.capHits.join(', ')} — `
                + 'the ingest would be incomplete. Narrow WINDOW_DAYS in modules/cbbd-client.js.'
        });
    }

    // ⚠️ AN EMPTY SEASON IS A FAILURE, NOT AN EMPTY SCHEDULE.
    //
    // CBBD labels a split season by its ENDING year: the 2026-27 season is
    // season 2027. Asking for 2026 in November 2026 returns HTTP 200 and an
    // empty array — verified live, 0 games for the tip-off week against 73 for
    // 2027. Without this guard the wrong season number is a green ingest that
    // wrote nothing, discovered whenever someone next opens a schedule.
    if (!result.games.length) {
        return res.status(422).json({
            message: `CBBD returned no ${seasonType} games for season ${season} `
                + `(${start.toISOString().slice(0, 10)} to ${end.toISOString().slice(0, 10)}). `
                + 'CBBD numbers a split season by its ENDING year — the 2026-27 season is season 2027.'
        });
    }

    const ops = result.games.map(buildUpsertOp).filter(Boolean);
    // Games came back but none could be mapped — CBBD renamed `id`, or the rows
    // are a shape buildUpsertOp does not recognise. Without this the bulkWrite
    // threw "Invalid BulkOperation, Batch cannot be empty", a cryptic 500 for
    // what is actually a field rename.
    if (!ops.length) {
        return res.status(500).json({
            message: `CBBD returned ${result.games.length} game(s) for season ${season}, `
                + 'none of which carried an id — the response shape changed.'
        });
    }

    // Counts come off the WRITE RESULT, never off the ops assembled — a
    // bulkWrite that wrote nothing would otherwise still answer "6079 updated"
    // to the cron that reads these numbers to decide whether the run was
    // healthy. matchedCount rather than modifiedCount, because a game whose
    // CBBD row is byte-identical to the stored one modifies nothing and would
    // read as a partial failure on every quiet day.
    const { created, updated, failure } = await writeGames(ops, `Hoops schedule · ${season}`);
    if (failure) {
        // The counts still go out: a partial write is not a no-op, and the cron
        // needs to know what landed before it retries.
        return res.status(500).json({ season, seasonType, created, updated, message: `Schedule write failed: ${failure}` });
    }

    console.log(`Hoops schedule · ${season} ${seasonType}: ${created} created, ${updated} updated `
        + `(${result.games.length} games, ${result.windows} window(s))`);
    return res.status(200).json({
        season, seasonType, created, updated,
        games: result.games.length, windows: result.windows,
        remainingCalls: result.remainingCalls
    });
});

// Refresh scores for a date range — basketball plays every night, so the
// nightly job asks for a couple of days rather than a week.
//
// Defaults to yesterday and today in UTC: a game tipping at 21:00 ET lands on
// the following UTC date, so a single-day refresh would miss the late slate
// every night.
router.post('/refresh', async (req, res) => {
    const season = Number(req.body && req.body.season);
    if (!Number.isInteger(season)) {
        return res.status(400).json({ message: 'A numeric season is required.' });
    }
    const seasonType = req.body && req.body.seasonType === 'postseason' ? 'postseason' : 'regular';

    const now = new Date();
    const end = req.body && req.body.end ? new Date(req.body.end) : now;
    const start = req.body && req.body.start
        ? new Date(req.body.start)
        : new Date(end.getTime() - 24 * 3600 * 1000);
    if (isNaN(start) || isNaN(end) || start > end) {
        return res.status(400).json({ message: 'Invalid start/end range.' });
    }

    let result;
    try {
        result = await cbbd.fetchGamesInRange(season, seasonType, start, end);
    } catch (err) {
        const code = err.unreachable ? 502 : 400;
        console.log(`Hoops refresh failed: ${err.message}`);
        return res.status(code).json({ message: err.message });
    }
    if (result.capHits.length) {
        return res.status(500).json({ message: `CBBD hit the ${PAGE_CAP}-record cap for ${result.capHits.join(', ')}.` });
    }

    // An empty window is USUALLY an ordinary quiet night — but this is the route
    // that runs unattended ~150 times a season, so "usually" is where the
    // ending-year trap would hide for months.
    //
    // The discriminator is what we already stored: if the schedule says games
    // were due in this window and CBBD returned none, that is not a quiet night.
    // Wired with the football season number (2026 rather than 2027), every
    // nightly refresh would otherwise answer 200 {games: 0} from November to
    // March and no score would ever be ingested.
    if (!result.games.length) {
        const due = await HoopsGame.countDocuments({ season, startDate: { $gte: start, $lte: end } });
        if (due > 0) {
            return res.status(422).json({
                message: `CBBD returned no ${seasonType} games for season ${season} between `
                    + `${start.toISOString().slice(0, 10)} and ${end.toISOString().slice(0, 10)}, `
                    + `but ${due} are on the stored schedule. CBBD numbers a split season by its `
                    + 'ENDING year — the 2026-27 season is season 2027.',
                season, expected: due, returned: 0
            });
        }
    }
    const ops = result.games.map(buildUpsertOp).filter(Boolean);
    const { created, updated, failure } = await writeGames(ops, `Hoops refresh · ${season}`);
    if (failure) {
        return res.status(500).json({ season, seasonType, created, updated, message: `Refresh write failed: ${failure}` });
    }

    // `games` and `finals` count what was WRITABLE, not what was fetched. Off
    // the fetch they were the one pair of numbers here that could report a
    // healthy run while nothing landed — if CBBD renamed `id`, every op would
    // be null and the response still said "1463 games, 1463 final".
    const finals = result.games.filter(g => g.status === 'final' && g.id != null).length;
    console.log(`Hoops refresh · ${season} ${seasonType} `
        + `${start.toISOString().slice(0, 10)}..${end.toISOString().slice(0, 10)}: `
        + `${ops.length} writable of ${result.games.length} fetched, ${finals} final, `
        + `${created} created, ${updated} updated`);
    return res.status(200).json({
        season, seasonType, created, updated,
        games: ops.length, fetched: result.games.length, finals,
        remainingCalls: result.remainingCalls
    });
});

module.exports = router;
module.exports.buildUpsertOp = buildUpsertOp;
