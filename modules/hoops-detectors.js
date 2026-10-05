// The basketball condition vocabulary (#316).
//
// The engine itself ports intact — resolveConfig, combineMode, the additive
// walk and the disabled/enabled lists are untouched. What is new is this: a
// context built from a basketball game, and the conditions that read it.
//
// ---- WHAT THE DATA ACTUALLY CARRIES ----
//
// MEASURED, not assumed. The 2027 ingest has no postseason yet, so the shape
// below comes from pulling March 2026 out of CBBD directly. The first
// version of this file was written against the issue's description and was
// wrong about nearly all of it.
//
// NCAA tournament        seasonType 'postseason', tournament 'NCAA'
//                        gameNotes "NCAA Men's Basketball Championship -
//                        <Region> - 1st Round", and seeds on EVERY game
//
// NIT, College Basketball Crown
//                        ALSO seasonType 'postseason', tournament 'NIT' or
//                        blank, with round names that look identical:
//                        "NIT - 1st Round", "NIT - Championship"
//
// Conference tournaments seasonType 'REGULAR', conferenceGame true, named
//                        only in gameNotes: "OVC Championship - Final",
//                        "MVC Tournament - Final", "Sun Belt Championship -
//                        2nd Round". 31 finals, one per conference.
//
// gameType               'TRNMNT' on all of the above AND on 107 November
//                        exhibitions. It distinguishes nothing.
//
// Three traps follow, and the first two would each have mis-scored a real
// game by a wide margin:
//
// 1. THE ROUND NAMES ARE NOT THE OBVIOUS ONES. CBBD says "1st Round",
//    "2nd Round", "Sweet 16", "Elite 8". Written against "First Round" and
//    "Sweet Sixteen", every single NCAA game fell through to the regular
//    path and scored as a quadrant win.
//
// 2. THE NIT USES THE SAME ROUND NAMES. So the round label can never be the
//    thing that identifies the NCAA tournament; `tournament === 'NCAA'` is.
//    An NIT first-round game would otherwise bank 7 permanent points.
//
// 3. A CONFERENCE TOURNAMENT IS NOT A POSTSEASON GAME to CBBD. Reading
//    seasonType alone, every conference tournament game — including the 31
//    finals — is a regular-season game.
//
// FIRST FOUR is a real round and was missing from the model entirely. It is
// its own rung, worth 0 by default: a First Four winner goes on to play a
// 1st Round game and would otherwise be paid twice for entering.

const { quadrantFor, venueFor } = require('./hoops-quadrants');

// NCAA tournament rounds, in order. The VALUES are configured per league;
// this is only the vocabulary.
const NCAA_ROUNDS = ['ff', 'r64', 'r32', 's16', 'e8', 'f4', 'title'];

// The last " - " segment of gameNotes, which is where CBBD puts the round.
function roundLabel(game) {
    const parts = String((game && game.gameNotes) || '').split(' - ');
    return parts.length > 1 ? parts[parts.length - 1].trim() : '';
}

// Spellings accepted per round. The left column is what CBBD actually sent
// in March 2026; the alternatives are cheap insurance against a feed that
// has already been seen to shout and abbreviate inconsistently elsewhere.
const ROUND_PATTERNS = [
    ['title', /^(national\s+championship|championship\s+game|title\s+game)$/i],
    ['f4', /^(final\s*four|f4)$/i],
    ['e8', /^(elite\s*(8|eight))$/i],
    ['s16', /^(sweet\s*(16|sixteen))$/i],
    ['ff', /^(first\s*four)$/i],
    ['r32', /^(2nd\s+round|second\s+round|round\s+of\s+32|r32)$/i],
    ['r64', /^(1st\s+round|first\s+round|round\s+of\s+64|r64)$/i]
];

// Which round of the NCAA tournament a game is, or null.
//
// `tournament === 'NCAA'` is the ONLY thing that makes a game an NCAA game.
// The NIT and the College Basketball Crown are also postseason, also carry
// gameType 'TRNMNT', and also call their rounds "1st Round" and
// "Championship" — so a round label can identify the round but never the
// tournament.
function ncaaRoundFor(game) {
    if (!game) return null;
    if (String(game.tournament || '').trim().toUpperCase() !== 'NCAA') return null;
    const label = roundLabel(game);
    for (const [round, re] of ROUND_PATTERNS) {
        if (re.test(label)) return round;
    }
    // An NCAA game whose round we cannot name scores as a regular game
    // rather than being guessed at.
    return null;
}

// A conference tournament FINAL — the title game, not every game in it.
//
// These are seasonType 'regular' to CBBD, so the discriminator is the notes
// plus conferenceGame. Postseason is excluded explicitly, or "NIT -
// Championship" would read as somebody's conference title.
function isConfTournamentFinal(game) {
    if (!game) return false;
    // A NAMED tournament is somebody else's: 'NCAA', 'NIT'. Conference
    // tournaments carry no tournament code at all — every one of the 31
    // finals pulled from March 2026 had the field empty, with the name only
    // in gameNotes. This replaced a `seasonType !== 'postseason'` guard,
    // which was both redundant (an NIT game is not a conferenceGame) and a
    // liability: it would MISS a conference final the day CBBD decides to
    // file one as postseason.
    if (String(game.tournament || '').trim()) return false;
    if (!game.conferenceGame) return false;
    const notes = String(game.gameNotes || '');
    if (!/\b(championship|tournament)\b/i.test(notes)) return false;
    return /^(final|championship)$/i.test(roundLabel(game));
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
    // The play-in. Worth 0 by default: its winner goes on to play a 1st
    // Round game and would otherwise be paid twice for entering.
    ncaaFirstFour: (ctx) => ctx.played && ctx.round === 'ff',
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
