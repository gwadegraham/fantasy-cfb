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
async function basketballPool(season, poolSize) {
    const query = HoopsTeam.find(
        { season, 'preseason.rank': { $exists: true, $ne: null } },
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
        return { sport, season: year, poolSize: null, total: teams.length, teams };
    }

    if (!Number.isFinite(year)) {
        throw Object.assign(new Error(`League ${league} has no basketball season set`), { status: 409 });
    }

    const [total, ranked] = await Promise.all([
        HoopsTeam.countDocuments({ season: year }),
        HoopsTeam.countDocuments({ season: year, 'preseason.rank': { $exists: true, $ne: null } })
    ]);
    if (!total) {
        throw Object.assign(new Error(`No basketball teams stored for ${year} — run the teams ingest before drafting`), { status: 409 });
    }
    if (!ranked) {
        throw Object.assign(new Error(
            `None of the ${total} teams for ${year} carry a preseason rank — run scripts/import-torvik-preseason.js before drafting`
        ), { status: 409 });
    }
    // A pool that cannot be filled, and the two reasons are NOT the same fix.
    //
    // Ranks missing from some teams is a half-finished import, and the pool
    // would quietly fill to its cap out of whatever happens to be ranked. A cap
    // bigger than the whole season is just a number typed too large, and
    // telling that commissioner to re-run an import sends them somewhere there
    // is nothing to do.
    if (poolSize && ranked < poolSize) {
        throw Object.assign(new Error(
            ranked < total
                ? `Only ${ranked} of the ${total} teams for ${year} carry a preseason rank, fewer than the pool of ${poolSize} — re-run scripts/import-torvik-preseason.js`
                : `The pool of ${poolSize} is larger than the ${total} teams playing in ${year} — lower the cap`
        ), { status: 409 });
    }

    const teams = await basketballPool(year, poolSize);
    return { sport, season: year, poolSize: poolSize || null, total: teams.length, teams };
}

module.exports = { poolFor, CARD };
