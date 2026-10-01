// What a league can actually draft (#320).
//
// Football drafts the whole FBS universe; basketball drafts the top N of 365 by
// preseason rating. Those are two collections with two shapes, and the draft
// room has one board — so the sport is resolved here, from the league's own
// `sport` field (#312), and both come back in one shape.
//
// Issue #320 says the draft room is sport-agnostic and needs no changes. That
// is true of the snake maths, the socket protocol and the FX, and false of the
// pool: routes/draft.js reads models/team.js with FBS_ONLY in three places and
// public/draftRoom.js fetches /teams. This module is what those call instead.

const Team = require('../models/team');
const HoopsTeam = require('../models/hoopsTeam');
const { FBS_ONLY } = require('./team-scope');
const { sportForLeague, seasonForLeague } = require('./active-season');

// The fields a draft board renders, and nothing else. A rostered team document
// is heavy — see the note in models/hoopsTeam.js about logos — and the pool is
// every team at once, which is the one read where that multiplies.
const CARD = { _id: 0, id: 1, school: 1, mascot: 1, abbreviation: 1, conference: 1, color: 1, alt_color: 1, logos: 1 };

// Football has no cap: the pool IS the FBS universe, and that has been true of
// every draft the app has run. A cap only exists because 365 D-I basketball
// programs is more than anyone wants to scroll past the first hundred.
async function footballPool() {
    const teams = await Team.find(FBS_ONLY, CARD).lean();
    return teams.sort((a, b) => String(a.school).localeCompare(String(b.school)));
}

// ⚠️ THE FILTER IS NOT AN OPTIMISATION — IT IS THE WHOLE CORRECTNESS ARGUMENT.
//
// A missing field sorts BEFORE every number in a Mongo ascending sort. So with
// `sort({ 'preseason.rank': 1 })` alone, a season where the Torvik import has
// not run — or has only half run — puts the UNRANKED teams at the top and the
// cap then takes them in natural order. The pool would be 120 arbitrary
// programs, correctly sized, in a plausible-looking list, with Duke nowhere in
// it. Requiring the field is what makes the sort mean what it reads as.
//
// `$type: 'number'` rather than `$exists: true, $ne: null`, which was the first
// version and covered only two of the three ways this goes wrong. Numbers sort
// BEFORE strings in BSON, so a rank stored as "1" lands at the END of the sort
// while still counting as ranked — the best team in the season, absent from a
// pool that is the right size and in a plausible order. Nothing writes a string
// rank today (the importer rejects non-finite values), so this is a hand-edit
// away rather than live; the point is that one clause makes the argument
// structural instead of depending on every future writer being careful.
const RANKED = { $type: 'number' };

async function basketballPool(season, poolSize) {
    const query = HoopsTeam.find(
        { season, 'preseason.rank': RANKED },
        { ...CARD, 'preseason.rank': 1 }
    ).sort({ 'preseason.rank': 1 });
    if (poolSize) query.limit(poolSize);

    const teams = await query.lean();
    return teams.map(t => {
        const { preseason, ...rest } = t;
        return { ...rest, rank: preseason.rank };
    });
}

// The draftable teams for a league, in board order.
//
// Football comes back alphabetically, which is how the board has always shown
// it. Basketball comes back in rating order, because that ordering IS the
// pool — the cap is "the top N", so a board that re-sorted it would hide which
// teams are in and which fell outside.
//
// Throws rather than returning a short list. A pool missing its best teams
// still renders, still drafts, and is only discovered when someone asks why
// Duke was never available — so the failure has to happen at the read.
async function poolFor(league, { poolSize = null, season } = {}) {
    const sport = sportForLeague(league);
    const year = season != null ? Number(season) : seasonForLeague(league);

    if (sport !== 'basketball') {
        const teams = await footballPool();
        if (!teams.length) throw Object.assign(new Error('No FBS teams to draft — the team ingest has not run'), { status: 503 });
        return { sport, season: year, poolSize: null, count: teams.length, seasonTotal: teams.length, teams };
    }

    if (!Number.isFinite(year)) {
        throw Object.assign(new Error(`League ${league} has no basketball season set`), { status: 409 });
    }

    const [inSeason, ranked] = await Promise.all([
        HoopsTeam.countDocuments({ season: year }),
        HoopsTeam.countDocuments({ season: year, 'preseason.rank': RANKED })
    ]);
    if (!inSeason) {
        throw Object.assign(new Error(`No basketball teams stored for ${year} — run the teams ingest before drafting`), { status: 409 });
    }
    if (!ranked) {
        throw Object.assign(new Error(
            `None of the ${inSeason} teams for ${year} carry a preseason rank — run scripts/import-torvik-preseason.js before drafting`
        ), { status: 409 });
    }

    // A HALF-FINISHED IMPORT IS REFUSED WHETHER OR NOT THERE IS A CAP.
    //
    // This check used to sit inside `if (poolSize && ...)`, which made it
    // unreachable in the only state a real league can currently be in — nothing
    // writes poolSize yet, so every pool is uncapped. A module whose stated job
    // is refusing a quietly-wrong pool had its main refusal switched off in
    // practice. The partial state is reachable: the importer's bulkWrite lands
    // before its own completeness assertion throws.
    if (ranked < inSeason) {
        throw Object.assign(new Error(
            `Only ${ranked} of the ${inSeason} teams for ${year} carry a preseason rank — re-run scripts/import-torvik-preseason.js`
        ), { status: 409 });
    }

    // A separate cause with a separate fix. Telling this commissioner to re-run
    // an import points them at a script with nothing to do: every team IS
    // ranked, the number was just typed too large.
    if (poolSize && poolSize > inSeason) {
        throw Object.assign(new Error(
            `The pool of ${poolSize} is larger than the ${inSeason} teams playing in ${year} — lower the cap`
        ), { status: 409 });
    }

    const teams = await basketballPool(year, poolSize);
    // `count` is the pool; `seasonTotal` is everything it was drawn from. One
    // field named `total` meant both, so an admin preview rendering "N of
    // total" read "120 of 120".
    return { sport, season: year, poolSize: poolSize || null, count: teams.length, seasonTotal: inSeason, teams };
}

// basketballPool is exported for its own test, not for callers.
//
// The sort trap it guards can only be observed in isolation: through poolFor,
// a season with unranked teams is refused as a half-finished import before the
// ordering is ever reached, so the one test that proves the filter does
// anything cannot go through the front door.
module.exports = { poolFor, basketballPool, CARD };
