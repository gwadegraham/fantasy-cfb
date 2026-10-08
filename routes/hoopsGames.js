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
const calendar = require('../modules/hoops-calendar');
// Namespaces, not destructures, so a test can stand in for them.
const leagueSelection = require('../modules/league-selection');
const seasons = require('../modules/active-season');
const visibility = require('../modules/hoops-visibility');
const gamePage = require('../modules/hoops-game-page');
const roster = require('../modules/hoops-roster');
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
// A game already stored as FINAL keeps its result. CBBD's /games can lag its
// /scoreboard: a late tip the live poller has finalled can still read
// in_progress at the 23:30 refresh, and writing that back would drop the game
// from the week the same job then scores. The rest of the row (time, venue,
// notes) still updates.
const RESULT_FIELDS = ['status', 'homePoints', 'awayPoints', 'homeWinner', 'awayWinner',
    'homePeriodPoints', 'awayPeriodPoints', 'period', 'clock'];
async function keepStoredFinals(ops) {
    const ids = ops.map(op => op.updateOne && op.updateOne.filter && op.updateOne.filter.id).filter(id => id != null);
    if (!ids.length) return ops;
    const finals = new Set(await HoopsGame.distinct('id', { id: { $in: ids }, status: 'final' }));
    if (!finals.size) return ops;
    return ops.map(op => {
        const u = op.updateOne;
        if (!finals.has(u.filter.id) || !u.update.$set || u.update.$set.status === 'final') return op;
        const set = Object.assign({}, u.update.$set);
        const unset = Object.assign({}, u.update.$unset || {});
        RESULT_FIELDS.forEach(f => { delete set[f]; delete unset[f]; });
        const update = { $set: set };
        if (Object.keys(unset).length) update.$unset = unset;
        return { updateOne: Object.assign({}, u, { update }) };
    });
}

async function writeGames(ops, label) {
    if (!ops.length) return { created: 0, updated: 0, failure: null };
    try {
        // Inside the try: a failed check must fail the write (a 500 the caller
        // sees), never escape the handler — and never write without the check.
        ops = await keepStoredFinals(ops);
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
// `seasonStart` is the Monday of the week containing the season's first game.
// Passed in rather than derived per game, because deriving it from the row
// being written would make every game its own week 1.
function buildUpsertOp(g, seasonStart) {
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
        // Derived here so the whole app can query by week without repeating
        // the derivation (#315). null before week 1 rather than 0.
        week: seasonStart ? calendar.weekOf(g.startDate, seasonStart) : undefined,
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

    // undefined AND null get stripped from $set — EXCEPT `week`.
    //
    // A null period array would otherwise be stored as null, past the [Number]
    // default, and a reader doing .homePeriodPoints.length would throw on every
    // scheduled game.
    //
    // `week` is $unset rather than skipped when it has no value, so a stale
    // number cannot outlive the date that produced it.
    //
    // Unreachable through a normal ingest — the origin is the earliest game we
    // know of, so moving a game earlier re-anchors the season rather than
    // putting the game before week 1 (there is a test for exactly that). This
    // covers the case where seasonStart could not be derived at all, where
    // skipping the key would leave whatever was there before.
    const unsetWeek = doc.week === null || doc.week === undefined;
    Object.keys(doc).forEach(k => { if (doc[k] === undefined || doc[k] === null) delete doc[k]; });
    const update = { $set: doc };
    if (unsetWeek) update.$unset = { week: '' };
    return { updateOne: { filter: { id: g.id }, update, upsert: true } };
}

// Week 1's Monday for a season, from the earliest game we know about — stored
// or incoming, whichever is earlier.
//
// Reading the database matters for /refresh: its window is a day or two, so the
// earliest game IN THE BATCH is not the season's first game, and deriving from
// the batch would restart the numbering every night. Reading the incoming batch
// matters for the first /schedule ingest, when the database is still empty.
// A single bad date must not renumber a season.
//
// The anchor is a min(), so ONE row with a typo'd year moves week 1 back a year
// and every game jumps ~52 weeks. Not hypothetical: CFBD shipped a year typo in
// its 2025 calendar (see the project notes on the calendar week-loop risk), and
// this runs unattended.
//
// A season is ~26 weeks, so a backwards jump implying a longer one is a bad row
// rather than a long season. The outlier is ignored and the anchor left where
// it was; the row is still stored, it just does not get to define week 1.
//
// Used by BOTH the pre-write and post-write anchors. The first version guarded
// only the pre-write one, and the post-write re-derivation — added to catch a
// forward move — read the bad row straight back out of the database and
// reinstated it.
const MAX_SEASON_WEEKS = 30;
function plausibleAnchor(candidate, previous, season) {
    if (!previous || !candidate || candidate.getTime() >= previous.getTime()) return candidate;
    const jumpWeeks = (previous.getTime() - candidate.getTime()) / (7 * 86400000);
    if (jumpWeeks <= MAX_SEASON_WEEKS) return candidate;
    console.log(`Hoops ${season}: ignoring an anchor jump of ${Math.round(jumpWeeks)} weeks `
        + `(${candidate.toISOString().slice(0, 10)}) — keeping ${previous.toISOString().slice(0, 10)}. `
        + 'A single mis-dated game must not renumber a season.');
    return previous;
}

async function resolveSeasonStart(season, incoming) {
    // `startDate: { $ne: null }` is load-bearing. Mongo sorts a missing field
    // FIRST, so one dateless row for the season becomes the "earliest game",
    // line below sees it falsy, and the whole read-the-database mechanism is
    // skipped — the anchor then falls back to the earliest game in the BATCH,
    // which on /refresh is a two-day window. Measured: one dateless row made an
    // ordinary nightly refresh re-anchor the season on 21 December, unset the
    // week on every earlier game, and answer 200.
    //
    // A dateless row is reachable: bulkWrite does not run `required`
    // validators, so a CBBD row with a null startDate upserts anyway.
    const stored = await HoopsGame.findOne({ season, startDate: { $ne: null } }, { startDate: 1, _id: 0 })
        .sort({ startDate: 1 }).lean();
    const dates = [];
    if (stored && stored.startDate) dates.push(new Date(stored.startDate));
    incoming.forEach(g => { if (g && g.startDate) dates.push(new Date(g.startDate)); });
    const valid = dates.filter(d => !Number.isNaN(d.getTime()));
    if (!valid.length) return { seasonStart: null, moved: false };

    const earliest = new Date(Math.min(...valid.map(d => d.getTime())));
    const previous = stored && stored.startDate ? calendar.seasonStartFrom(stored.startDate) : null;

    // A single bad date must not renumber a season.
    //
    // The anchor is a min(), so ONE row with a typo'd year moves week 1 back a
    // year and every game jumps ~52 weeks. That is not hypothetical here: CFBD
    // shipped a year typo in its 2025 calendar (see the project notes on the
    // calendar week-loop risk), and this runs unattended.
    //
    // A season is ~26 weeks, so anything implying a longer one is a bad row
    // rather than a long season. The outlier is ignored and the anchor left
    // where it was; the row is still stored, just not trusted to define week 1.
    const seasonStart = plausibleAnchor(calendar.seasonStartFrom(earliest), previous, season);
    // Did the origin move BACKWARDS? Only then do the already-stored rows carry
    // the wrong numbering.
    const moved = !!(previous && seasonStart && previous.getTime() !== seasonStart.getTime());

    // Also re-stamp when anything is UNNUMBERED. Games ingested before #315
    // existed have no week at all, and `moved` is false for them — so a
    // /refresh would leave the rest of the season blank forever while
    // numbering only the handful of rows in its own window. A countDocuments
    // is cheap; a season half-numbered is not.
    const unnumbered = await HoopsGame.countDocuments({ season, week: { $in: [null, undefined] } });
    return { seasonStart, moved: moved || unnumbered > 0, previous };
}

// The anchor AFTER the write, which is not always the one computed before it.
//
// `moved` is derived from pre-write state, so it cannot see a FORWARD move —
// the season opener being postponed. Measured: postponing game 1 from 2 Nov to
// 30 Nov left week 1 empty and every other game a week off, with restamped=0,
// and a rebuild of the same data would have numbered them differently. The
// numbering has to be a function of the data, not of ingest history.
async function anchorAfterWrite(season, trusted) {
    const first = await HoopsGame.findOne({ season, startDate: { $ne: null } }, { startDate: 1, _id: 0 })
        .sort({ startDate: 1 }).lean();
    const derived = first && first.startDate ? calendar.seasonStartFrom(first.startDate) : null;
    // Through the same clamp: the bad row is in the database by now, so an
    // unguarded re-derivation would simply read it back.
    return plausibleAnchor(derived, trusted, season);
}

// Re-stamp every stored game for a season against a (possibly new) origin.
//
// The origin is min(earliest stored, earliest incoming), so a game earlier than
// anything we hold — an exhibition, a foreign-tournament opener, a rescheduled
// game, or simply ingesting the POSTSEASON before the regular season — shifts
// week 1 backwards. Only the batch being written gets the new numbering, so
// without this the collection ends up holding two numbering schemes at once
// with nothing to detect it: opening night and the Sweet Sixteen both labelled
// week 1, and standings, H2H and Captain mixing two slates under one number.
async function restampSeason(season, seasonStart) {
    const games = await HoopsGame.find({ season }, { startDate: 1, week: 1 }).lean();
    const ops = games.map(g => {
        const week = calendar.weekOf(g.startDate, seasonStart);
        if (week === g.week) return null;
        return week == null
            ? { updateOne: { filter: { _id: g._id }, update: { $unset: { week: '' } } } }
            : { updateOne: { filter: { _id: g._id }, update: { $set: { week } } } };
    }).filter(Boolean);
    if (!ops.length) return 0;
    const res = await HoopsGame.bulkWrite(ops, { ordered: false });
    return res.modifiedCount || 0;
}

// The basketball game page's data (#503). No CBBD calls: box scores come
// from the nightly batch (modules/hoops-box-score.js, run by hoops-stats-job).
//
// Basketball stays hidden from anyone not in a basketball league (404, as if
// it did not exist), and ownership is league-private, so the league comes
// from the server's validated selection — never a query string.
router.get('/:id/page', async (req, res) => {
    try {
        if (!(await visibility.seesBasketball(req))) return res.status(404).json({ message: 'Not found' });
        const id = Number(req.params.id);
        if (!Number.isInteger(id)) return res.status(400).json({ message: 'game id must be a number' });
        let league = '';
        try {
            league = await leagueSelection.selectedLeague(req);
        } catch (e) {
            console.error(`hoops game page: league selection failed: ${e.message}`);
        }
        const basketball = !!league && seasons.sportForLeague(league) === 'basketball';
        // Who is looking, so the page can open on their own team. The app's
        // account id lives in the Auth0 profile's nested metadata.
        const meta = (req.effUser && req.effUser.user_metadata) || {};
        const viewerId = (meta.metadata && meta.metadata.userId) || null;
        const page = await gamePage.build(id, { league: basketball ? league : null, viewerId });
        if (!page) return res.status(404).json({ message: 'No such basketball game' });
        return res.json(page);
    } catch (err) {
        console.error(`hoops game page ${req.params.id}: ${err && err.message}`);
        return res.status(500).json({ message: 'Could not load this game' });
    }
});

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

    // Guarded, like every other await in this file. Express 4 does not route an
    // async handler's rejection and there is no process-level
    // unhandledRejection handler, so a transient Mongo error here sends NO
    // response and takes the dyno down — for every user, not just the ingest.
    // The comment 30 lines above says exactly this; these four awaits were
    // added without it.
    let seasonStart, moved;
    try {
        ({ seasonStart, moved } = await resolveSeasonStart(season, result.games));
    } catch (err) {
        console.log(`Hoops schedule · ${season}: could not resolve the season anchor: ${err.message}`);
        return res.status(500).json({ message: `Could not resolve the season anchor: ${err.message}` });
    }
    const ops = result.games.map(g => buildUpsertOp(g, seasonStart)).filter(Boolean);
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

    // After the write, so the rows just inserted are numbered too. A failure
    // here is NOT fatal to the ingest — the games landed, only the numbering
    // is behind — so it is reported rather than thrown.
    let restamped = 0, restampError = null;
    try {
        const after = await anchorAfterWrite(season, seasonStart);
        const shifted = after && seasonStart && after.getTime() !== seasonStart.getTime();
        if (moved || shifted) restamped = await restampSeason(season, after || seasonStart);
    } catch (err) { restampError = err.message; console.log(`Hoops schedule · ${season}: re-stamp failed: ${err.message}`); }
    if (restamped) console.log(`Hoops schedule · ${season}: anchor moved — re-stamped ${restamped} game(s)`);

    // Jersey numbers ride along with the schedule, ONCE a season: the first
    // ingest that finds no roster on file imports it (one billable call), and
    // every later ingest is a free read that skips it. Numbers do not change
    // once the season starts; a late addition is the admin's
    // POST /hoops/teams/:season/roster. Not fatal — the games landed, and a
    // page without numbers just shows names.
    let rosterResult = null, rosterError = null;
    try {
        rosterResult = (await roster.hasSeason(season)) ? { skippedReason: 'already imported' } : await roster.importSeason(season);
    } catch (err) { rosterError = err.message; console.log(`Hoops schedule · ${season}: roster import failed: ${err.message}`); }

    console.log(`Hoops schedule · ${season} ${seasonType}: ${created} created, ${updated} updated `
        + `(${result.games.length} games, ${result.windows} window(s))`);
    return res.status(200).json({
        season, seasonType, created, updated, restamped,
        ...(restampError ? { restampError } : {}),
        roster: rosterResult, ...(rosterError ? { rosterError } : {}),
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
// Pull results for a date range from CBBD and write them (#314; called by
// POST /refresh and, since #505, by the nightly hoops-scores job as the safety
// net under the live poller). Returns { code, body } — the HTTP answer the
// route sends — so the job can read exactly what an operator would see.
const reply = (code, body) => ({ code, body });
async function refreshResults({ season, seasonType, start, end }) {
    let result;
    try {
        result = await cbbd.fetchGamesInRange(season, seasonType, start, end);
    } catch (err) {
        const code = err.unreachable ? 502 : 400;
        console.log(`Hoops refresh failed: ${err.message}`);
        return reply(code, { message: err.message });
    }
    if (result.capHits.length) {
        return reply(500, { message: `CBBD hit the ${PAGE_CAP}-record cap for ${result.capHits.join(', ')}.` });
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
        // This season type only: in March the window can hold only
        // postseason games, and counting them against an empty REGULAR fetch
        // reported "CBBD returned nothing" every night of the tournament.
        const due = await HoopsGame.countDocuments({ season, seasonType, startDate: { $gte: start, $lte: end } });
        if (due > 0) {
            return reply(422, {
                message: `CBBD returned no ${seasonType} games for season ${season} between `
                    + `${start.toISOString().slice(0, 10)} and ${end.toISOString().slice(0, 10)}, `
                    + `but ${due} are on the stored schedule. CBBD numbers a split season by its `
                    + 'ENDING year — the 2026-27 season is season 2027.',
                season, expected: due, returned: 0
            });
        }
    }
    let seasonStart, moved;
    try {
        ({ seasonStart, moved } = await resolveSeasonStart(season, result.games));
    } catch (err) {
        console.log(`Hoops refresh · ${season}: could not resolve the season anchor: ${err.message}`);
        return reply(500, { message: `Could not resolve the season anchor: ${err.message}` });
    }
    const ops = result.games.map(g => buildUpsertOp(g, seasonStart)).filter(Boolean);
    const { created, updated, failure } = await writeGames(ops, `Hoops refresh · ${season}`);
    if (failure) {
        return reply(500, { season, seasonType, created, updated, message: `Refresh write failed: ${failure}` });
    }

    // `games` and `finals` count what was WRITABLE, not what was fetched. Off
    // the fetch they were the one pair of numbers here that could report a
    // healthy run while nothing landed — if CBBD renamed `id`, every op would
    // be null and the response still said "1463 games, 1463 final".
    let restamped = 0, restampError = null;
    try {
        const after = await anchorAfterWrite(season, seasonStart);
        const shifted = after && seasonStart && after.getTime() !== seasonStart.getTime();
        if (moved || shifted) restamped = await restampSeason(season, after || seasonStart);
    } catch (err) { restampError = err.message; console.log(`Hoops refresh · ${season}: re-stamp failed: ${err.message}`); }
    if (restamped) console.log(`Hoops refresh · ${season}: anchor moved — re-stamped ${restamped} game(s)`);

    const finals = result.games.filter(g => g.status === 'final' && g.id != null).length;
    console.log(`Hoops refresh · ${season} ${seasonType} `
        + `${start.toISOString().slice(0, 10)}..${end.toISOString().slice(0, 10)}: `
        + `${ops.length} writable of ${result.games.length} fetched, ${finals} final, `
        + `${created} created, ${updated} updated`);
    return reply(200, {
        season, seasonType, created, updated, restamped,
        ...(restampError ? { restampError } : {}),
        games: ops.length, fetched: result.games.length, finals,
        remainingCalls: result.remainingCalls
    });
}

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
    const out = await refreshResults({ season, seasonType, start, end });
    return res.status(out.code).json(out.body);
});

module.exports = router;
module.exports.buildUpsertOp = buildUpsertOp;
module.exports.resolveSeasonStart = resolveSeasonStart;
module.exports.restampSeason = restampSeason;
module.exports.refreshResults = refreshResults;
module.exports.keepStoredFinals = keepStoredFinals;
