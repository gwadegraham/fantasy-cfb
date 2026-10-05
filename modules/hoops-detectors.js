// The basketball condition vocabulary (#316).
//
// The engine itself ports intact — resolveConfig, combineMode, the additive
// walk and the disabled/enabled lists are untouched. What is new is this: a
// context built from a basketball game, and the conditions that read it.
//
// ---- WHAT THE DATA ACTUALLY CARRIES ----
//
// Measured against the 5,286 ingested 2027 games before any of this was
// written, because the issue's postseason design assumed otherwise:
//
//   seasonType   'regular' on EVERY game
//   gameType     'STD' and 'TRNMNT' only
//   tournament   empty on every game
//   homeSeed     absent on every game
//   schedule     2026-11-02 .. 2027-03-07
//
// So there is no postseason in the data yet, and there will not be until
// March. Two consequences the code has to respect:
//
// 1. `gameType: 'TRNMNT'` IS NOT THE NCAA TOURNAMENT. It marks early-season
//    multi-team events — the Hall of Fame Tip-Off, the Veterans Classic,
//    Showdown in St. Pete — all 107 of them played in November and December.
//    Treating TRNMNT as "tournament" would score a November exhibition as an
//    NCAA appearance, which is worth 7 points and is banked permanently.
//
// 2. Round detection REFUSES TO GUESS. It recognises explicit markers only
//    and otherwise answers null, so an unrecognised shape scores as a
//    regular-season game rather than silently inventing a tournament run.
//    When March data lands, the markers get confirmed against it — the
//    alternative is writing detectors against a shape nobody has seen.

const { quadrantFor, venueFor } = require('./hoops-quadrants');

// NCAA tournament rounds, in order, with the ladder's own names. The VALUES
// are configured per league; this is only the vocabulary.
const NCAA_ROUNDS = ['r64', 'r32', 's16', 'e8', 'f4', 'title'];

// Explicit markers only. Matched case-insensitively against `tournament`,
// because a feed that spells things four ways has already been met once.
const NCAA_MARKERS = /\b(ncaa|march\s*madness)\b/i;
const CONF_TOURNEY_MARKERS = /\bconference\s+tournament\b|\bconf\s*tourn/i;

// Which round of the NCAA tournament a game is, or null.
//
// Null is the common answer and the safe one: it routes the game down the
// regular-season path, where it scores on its quadrant like any other.
function ncaaRoundFor(game) {
    if (!game) return null;
    const label = `${game.tournament || ''} ${game.gameNotes || ''}`;
    // The marker is required. gameType alone is not enough — see the note on
    // TRNMNT above.
    if (!NCAA_MARKERS.test(label)) return null;

    if (/\bnational\s+championship\b|\btitle\s+game\b/i.test(label)) return 'title';
    if (/\bfinal\s*four\b|\bf4\b/i.test(label)) return 'f4';
    if (/\belite\s*(8|eight)\b|\be8\b/i.test(label)) return 'e8';
    if (/\bsweet\s*(16|sixteen)\b|\bs16\b/i.test(label)) return 's16';
    if (/\bsecond\s+round\b|\br32\b/i.test(label)) return 'r32';
    if (/\bfirst\s+round\b|\br64\b/i.test(label)) return 'r64';
    return null;
}

// A conference tournament FINAL — the title game, not every game in it.
function isConfTournamentFinal(game) {
    if (!game) return false;
    const label = `${game.tournament || ''} ${game.gameNotes || ''}`;
    if (!CONF_TOURNEY_MARKERS.test(label)) return false;
    return /\bchampionship\b|\bfinal\b|\btitle\b/i.test(label);
}

// How many seeds better the winner was than the loser, or 0.
//
// The issue notes CBBD carries homeSeed/awaySeed natively, which is why this
// needs no bracket ingest and no notes-string parsing — unlike the CFP. None
// of the 5,286 ingested games has a seed yet, because seeds are assigned in
// March; absent seeds give 0, which is the same answer as "no upset".
function seedUpsetFor(teamId, game, won) {
    if (!game || !won) return 0;
    const isHome = Number(game.homeTeamId) === Number(teamId);
    const mine = Number(isHome ? game.homeSeed : game.awaySeed);
    const theirs = Number(isHome ? game.awaySeed : game.homeSeed);
    if (!Number.isFinite(mine) || !Number.isFinite(theirs)) return 0;
    // Winner's seed minus loser's, when positive: a 12 beating a 5 is +7.
    const diff = mine - theirs;
    return diff > 0 ? diff : 0;
}

// Everything the basketball conditions read, from one game.
function buildHoopsContext(teamId, game, ranks) {
    const id = Number(teamId);
    const isHome = Number(game.homeTeamId) === id;
    const isAway = Number(game.awayTeamId) === id;
    const won = isHome ? game.homePoints > game.awayPoints
        : isAway ? game.awayPoints > game.homePoints : false;
    const oppId = isHome ? game.awayTeamId : (isAway ? game.homeTeamId : null);

    // The opponent's rank AS OF THIS GAME. The caller supplies it; see the
    // note on banking at time of play in modules/hoops-quadrants.js.
    const oppRank = ranks ? ranks[String(oppId)] : null;
    const venue = venueFor(id, { homeId: game.homeTeamId, awayId: game.awayTeamId, neutralSite: game.neutralSite });

    const round = ncaaRoundFor(game);
    return {
        game,
        team: id,
        won,
        played: isHome || isAway,
        venue,
        quadrant: quadrantFor(oppRank, venue),
        // null, not 0, when there is no rank. Number(null) is 0 and
        // Number.isInteger(0) is true, so the obvious version reported an
        // unranked opponent as "#0" — harmless to the score, since
        // quadrantFor rejects anything below 1, but this field exists to be
        // SHOWN next to the quadrant.
        oppRank: (oppRank === null || oppRank === undefined || oppRank === '' || !Number.isInteger(Number(oppRank)))
            ? null : Number(oppRank),
        isConference: !!game.conferenceGame,
        // A tournament game is NOT a regular-season game, so the quadrant
        // rules must not also fire on it.
        round,
        isConfTournamentFinal: isConfTournamentFinal(game),
        isRegular: !round && !isConfTournamentFinal(game),
        seedUpset: seedUpsetFor(id, game, won)
    };
}

// A quadrant win fires only on a REGULAR-season game the team actually
// played and won. Tournament games score on the ladder instead.
const qWin = (q) => (ctx) => ctx.played && ctx.won && ctx.isRegular && ctx.quadrant === q;

const HOOPS_CONDITIONS = {
    q1Win: qWin(1),
    q2Win: qWin(2),
    q3Win: qWin(3),
    q4Win: qWin(4),

    // Losing at home to a Q4 opponent. Off by default: it is the one rule
    // that can take points away, and a league should opt into that.
    badLoss: (ctx) => ctx.played && !ctx.won && ctx.isRegular && ctx.quadrant === 4,

    // Conference tournament title.
    confTournamentTitle: (ctx) => ctx.played && ctx.won && ctx.isConfTournamentFinal,

    // The NCAA ladder. Each is an APPEARANCE — reaching the round, win or
    // lose — and they stack, so a champion banks every rung beneath them.
    ncaaR64: (ctx) => ctx.played && ctx.round === 'r64',
    ncaaR32: (ctx) => ctx.played && ctx.round === 'r32',
    ncaaS16: (ctx) => ctx.played && ctx.round === 's16',
    ncaaE8: (ctx) => ctx.played && ctx.round === 'e8',
    ncaaF4: (ctx) => ctx.played && ctx.round === 'f4',
    ncaaTitleGame: (ctx) => ctx.played && ctx.round === 'title',
    // The only ladder rung that requires winning.
    ncaaChampion: (ctx) => ctx.played && ctx.won && ctx.round === 'title',

    // Beating a better seed, in any tournament game.
    seedUpsetBonus: (ctx) => ctx.played && ctx.won && ctx.seedUpset > 0
};

module.exports = {
    buildHoopsContext, HOOPS_CONDITIONS,
    ncaaRoundFor, isConfTournamentFinal, seedUpsetFor,
    NCAA_ROUNDS
};
