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
const { sportForLeague, seasonForLeague, primed } = require('./active-season');

// What identifies a team on the board, in either sport.
const CARD = { _id: 0, id: 1, school: 1, mascot: 1, abbreviation: 1, conference: 1, color: 1, alt_color: 1, logos: 1 };

// The board also ranks what it lists, and the two sports have nothing in
// common there: football sorts on SP+, recruiting, last season's points and
// expected wins; basketball has none of those and sorts on a preseason rating.
//
// So the metrics ride along per sport rather than being normalised into some
// shared vocabulary that would fit neither. public/draftRoom.js picks its
// columns off the `sport` in the response.
//
// Football keeps the `seasons` subtree the board already reads, rather than
// having this module pre-compute the columns: the client's buildPool() derives
// them with prev/current fallbacks and a per-league scoring version, and moving
// that here to change nothing would be a behaviour risk taken for tidiness. The
// projection is still far narrower than the /teams it replaces.
const FOOTBALL_METRICS = {
    alternateNames: 1,       // the recruiting-rankings name match
    'seasons.season': 1, 'seasons.conference': 1,
    'seasons.cumulativeScoreV1': 1, 'seasons.cumulativeScoreV2': 1,
    'seasons.expectedWins': 1, 'seasons.spRating': 1, 'seasons.spRank': 1
};

// Football has no cap: the pool IS the FBS universe, and that has been true of
// every draft the app has run. A cap only exists because 365 D-I basketball
// programs is more than anyone wants to scroll past the first hundred.
async function footballPool() {
    const teams = await Team.find(FBS_ONLY, { ...CARD, ...FOOTBALL_METRICS }).lean();
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
        { ...CARD, preseason: 1 }
    ).sort({ 'preseason.rank': 1, id: 1 });
    if (poolSize) query.limit(poolSize);

    const teams = await query.lean();
    // Flattened off the subdocument: the board should not have to know that
    // these live under `preseason`, and the football rows it renders beside
    // them carry their metrics at the top level too.
    return teams.map(t => {
        const { preseason, ...rest } = t;
        return {
            ...rest,
            rank: preseason.rank,
            barthag: preseason.barthag,
            adjOE: preseason.adjOE,
            adjDE: preseason.adjDE,
            projectedRecord: preseason.projectedRecord
        };
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

// The team a pick is allowed to store, or null.
//
// Returns the DOCUMENT, not a boolean, and that is the point. The cap was
// decoration before this existed — modules/draft-socket.js took the team object
// from the client on make-pick and stored it as sent — and a boolean would have
// closed only half of that. Three failures fall out of one lookup:
//
//   the id is CANONICAL. `Number(teamId)` accepted "1", which validated as team
//   1 and was then written as the string "1". The duplicate guard compares
//   `'picks.team.id': { $ne: team.id }` against stored numbers, and "1" !== 1 in
//   BSON — so two managers ended up holding the same team. Measured.
//
//   the body is OURS. A valid id with a fabricated name and logo URL used to be
//   stored verbatim and reach the roster, the board, grades and Draft Steal.
//
//   the shape is COMPLETE. models/schemas/season.js requires location on a
//   rostered team, and the pool projection does not carry it; storing a
//   projected row would 400 every roster write at the end of the draft.
//
// Full documents, no projection: this is what gets persisted.
async function draftableTeam(league, { teamId, poolSize = null, season } = {}) {
    // An unprimed cache answers 'football' for every league, which would check
    // a basketball pick against the FBS table and find a same-numbered team.
    // Fails OPEN, and silently, so it is refused rather than guessed.
    if (!primed()) return null;

    const sport = sportForLeague(league);
    // Not Number(): that accepts "1", " 1 ", [1] and true. The id written has to
    // be the id checked, so anything that is not already a plain integer is a
    // refusal rather than a coercion.
    const id = typeof teamId === 'number' ? teamId
        : (typeof teamId === 'string' && /^\d+$/.test(teamId) ? Number(teamId) : NaN);
    if (!Number.isInteger(id)) return null;

    if (sport !== 'basketball') {
        return Team.findOne({ id, ...FBS_ONLY }).lean();
    }

    const year = season != null ? Number(season) : seasonForLeague(league);
    if (!Number.isFinite(year)) return null;

    const team = await HoopsTeam.findOne({ season: year, id }).lean();
    const rank = team && team.preseason && team.preseason.rank;
    if (typeof rank !== 'number') return null;       // unranked is not draftable
    if (!poolSize) return team;                      // uncapped: any ranked team

    // Counting what is ahead, rather than `rank <= poolSize`, because that is
    // the question poolFor's sort-and-limit actually asks — and the two must
    // not disagree. Ties broken by id in BOTH, or a tied pair at the cap
    // boundary is on the board in one and draftable in the other.
    const ahead = await HoopsTeam.countDocuments({
        season: year,
        $or: [
            { 'preseason.rank': { $type: 'number', $lt: rank } },
            { 'preseason.rank': rank, id: { $lt: id } }
        ]
    });
    return ahead < poolSize ? team : null;
}

// basketballPool is exported for its own test, not for callers.
//
// The sort trap it guards can only be observed in isolation: through poolFor,
// a season with unranked teams is refused as a half-finished import before the
// ordering is ever reached, so the one test that proves the filter does
// anything cannot go through the front door.
module.exports = { poolFor, draftableTeam, basketballPool, CARD };
