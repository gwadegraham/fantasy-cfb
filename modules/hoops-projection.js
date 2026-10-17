// Expected fantasy points for a basketball team's regular season (#310, PR 1
// of the projection engine). The basketball counterpart of
// modules/draft-projection.js projectTeamPoints, with the same field names
// where the meaning is the same:
//
//   { regular, confChamp, ncaa, upset, postseason, cfp: 0, bowl: 0, total,
//     projWins, makeProb, perGame: [{ week, gameId, winProb, pointsIfWin,
//     pointsIfLoss }] }
//
// ---- what the consumers must change to read it ----
//
// NOT drop-in. Only h2h.matchupWinProb takes perGame as it is. The rest
// were written against football's call signature and fields:
//
//   draft grades (modules/draft-grades.js, PR 3) — its postseason column sums
//     cfp + confChamp + bowl, which for basketball is confChamp alone: read
//     proj.postseason instead. It also calls projectTeamPoints(team, games,
//     poolCtx, rankings, cfg, season); basketball is
//     projectHoopsTeam(team, games, ctx) with buildHoopsPoolContext +
//     (PR 2) attachMarch. And its groupGamesByTeam keys games on g.homeId /
//     g.awayId, which a HoopsGame does not have (homeTeamId / awayTeamId):
//     fed basketball games as they are, it drops every one and every
//     regular season projects to 0.
//   standings projection (modules/standings-projection.js buildProjections,
//     PR 5) — it filters the remaining schedule on g.completed and
//     g.homeId, neither of which a HoopsGame has, and sums cfp + confChamp
//     + bowl. Basketball calls projectRemaining(team, games, ctx), which
//     filters on status (isFinal) itself, and reads proj.postseason.
//     Nothing derives the March estimate's `decided` state (conference
//     tournament progress, NCAA round) from HoopsGame rows yet; PR 5 has to
//     build that. Its Monte Carlo and Captain term (simulateTitleOdds,
//     expectedCaptainWeek) read only pointsIfWin, so with the bad-loss
//     penalty on, projectedFinal (which includes it) and the simulated
//     odds (which do not) disagree until PR 5 reads pointsIfLoss too.
//
// Pure: no database, no network. The caller supplies teams, games, a rank map
// and the league's resolved scoring config.
//
// ---- the three steps ----
//
// 1. A per-game win probability from Torvik's barthag through log5 (the
//    formula modules/hoops-win-prob.js already uses for the game preview), with
//    home court as an odds multiplier. Neutral sites get none.
// 2. Each team's probabilities shifted, in LOGIT space, so they add up to its
//    Torvik projected win rate over the games being projected. Football does
//    the same thing in margin space (calibrateToExpectedWins).
// 3. Points-if-win from the REAL scoring engine (modules/scoring evaluate,
//    'hoops' model) on a synthesized win, so the quadrant bands, the league's
//    point values and any commissioner overrides all come from where scoring
//    reads them. Nothing here knows that Q1 is worth 5.
//
// Every constant below was picked against the 2025-26 season, scored with
// the preseason Torvik ratings that were published before it tipped off —
// see scripts/hoops-projection-backtest.js and the PR that added this file.
//
// ---- what it gets wrong, measured ----
//
// Over the 120-team draft pool, the preseason projection of regular-season
// points runs about 3 points (9%) HIGH against what 2025-26 would have
// banked, with wins unbiased (-0.2). The gap is in points per win, and it is
// structural rather than a bug: an opponent that ends up ranked high enough
// to be a Q1 is, more often than not, one that out-played its preseason
// rating — so Q1 games are harder than the preseason ratings say (projected
// win rate 0.41, actual 0.33, grading every game on end-of-season ranks).
// It is NOT uniform across the pool: +4.2 for preseason ranks 1-40, +5.3
// for 41-80 and -0.3 for 81-120, so mid-tier teams read a few points rich
// against late picks. Within a tier the ordering is weak too (r = 0.25 for
// ranks 41-80) — a season of basketball is noisy, and no preseason rating
// knows which mid-major is about to out-play its number.
//
// Conference tournament games are left out (see isConfTournamentGame); in
// 2025-26 they were worth about 4 banked points a pool team, which the March
// estimate is the place to add.

const { evaluate } = require('./scoring');
const { log5, HOME_ODDS } = require('./hoops-win-prob');
const { venueFor } = require('./hoops-quadrants');
const { isFinal } = require('./hoops-scoring-pass');
const { isConfTournament } = require('./hoops-detectors');

// Home court, as a multiplier on the home side's odds (neutral sites get 1):
// HOME_ODDS from modules/hoops-win-prob.js, shared with the game preview so
// the two can never disagree. 1.55, fitted on 2025-26 — the measurement is
// documented there.

// How many games of real results it takes to earn half the say in a team's
// remaining-wins forecast against its preseason rate. Football settled on 10;
// basketball's preseason ratings hold up much better than that. Predicting
// every team's remaining D-I wins from every week of 2025-26:
//
//   K = 0 (record only)  MAE 3.42 wins     K = 20   2.12
//   K = 10 (football's)  2.23              K = 30   2.09
//   preseason only       2.08
//
// Flat from 20 up. 30 rather than "never": it is within 0.004 wins of
// ignoring results entirely, and it leaves a team whose rating was simply
// wrong a way to be found out.
const BLEND_GAMES = 30;

// How often a D-I team beats a non-D-I opponent: 542 of 548 in 2025-26.
// Torvik's projected record counts those games and we do not (the opponent
// has no rating), so they come out of the target at this rate.
const NON_D1_WIN_RATE = 0.989;

// barthag lives in (0, 1), but log5 divides by a + b - 2ab, which is 0 when
// both sides sit at the same extreme. Ratings are clamped just inside.
const EPS = 1e-4;
const clampP = (p) => Math.min(1 - EPS, Math.max(EPS, p));

const logit = (p) => Math.log(p / (1 - p));
const sigmoid = (x) => 1 / (1 + Math.exp(-x));

// A rating, or null. NOT Number(x): Number(null) is 0, and a 0 barthag is a
// real-looking "worst team in the country" rather than "no rating".
function barthagOf(value) {
    if (value === null || value === undefined || value === '') return null;
    const n = Number(value);
    return Number.isFinite(n) && n > 0 && n < 1 ? n : null;
}

// Where a stored game was played, from `teamId`'s side.
//
// HoopsGame stores homeTeamId / awayTeamId, but venueFor reads homeId. Passing
// the raw game makes every comparison undefined === id, so EVERY game grades
// as 'away' — which inflated the first draft simulation by ~20%. This is the
// one place that translates.
function venueOfGame(teamId, game) {
    return venueFor(teamId, { homeId: game.homeTeamId, awayId: game.awayTeamId, neutralSite: game.neutralSite });
}

// P(team beats opponent) from both barthags and the venue, from the team's
// side. null when either rating is missing.
function teamWinProb(myBarthag, oppBarthag, venue, homeOdds = HOME_ODDS) {
    const a = barthagOf(myBarthag), b = barthagOf(oppBarthag);
    if (a === null || b === null) return null;
    const base = clampP(log5(clampP(a), clampP(b)));
    if (venue === 'neutral') return base;
    const odds = (base / (1 - base)) * (venue === 'home' ? homeOdds : 1 / homeOdds);
    return odds / (1 + odds);
}

// Shift every probability by the same amount in LOGIT space so they sum to
// `expectedWins`. Returns { probs, delta }; a null target is a no-op.
//
// Logit, not probability space, and the backtest says why: an additive
// probability shift moves a 97% game as far as a 50% one, which pushes heavy
// favourites through 1 and has to be clamped, and the clamped mass then has
// to be found elsewhere. A logit shift is the same move as "this team is a
// little better than its rating says" — a constant change in log-odds against
// every opponent — which is what a disagreement between a rating and a
// projected record actually is. Football does exactly this in margin space.
//
// Measured on 2025-26 with the D-I rate as the target, team's side, 10,694
// team-games: logit shift Brier 0.1920 / log loss 0.5589, probability shift
// 0.1920 / 0.5592, uncalibrated 0.1919 / 0.5587. So calibration buys nothing
// MEASURABLE on a season where the record and the rating come from the same
// Torvik model, and costs nothing either. It stays because the two inputs
// will not always agree — a hand-pasted record from a different day than the
// rating, and mid-season, where the target is the blended remaining pace.
function calibrateProbs(probs, expectedWins) {
    const raw = probs.map(clampP);
    // A target that is not a number is no target. Number('abc') is NaN, and
    // a NaN target sends the bisection to its floor and every game to ~0%.
    if (expectedWins === null || expectedWins === undefined || expectedWins === ''
        || !Number.isFinite(Number(expectedWins)) || !raw.length) return { probs: raw, delta: 0 };
    const target = Math.min(raw.length - 1e-6, Math.max(1e-6, Number(expectedWins)));
    const x = raw.map(logit);
    const sumAt = (d) => x.reduce((s, xi) => s + sigmoid(xi + d), 0);
    let lo = -20, hi = 20;
    for (let i = 0; i < 60; i++) {
        const mid = (lo + hi) / 2;
        if (sumAt(mid) < target) lo = mid; else hi = mid;
    }
    const delta = (lo + hi) / 2;
    return { probs: x.map(xi => sigmoid(xi + delta)), delta };
}

// Torvik's projected record ("26-6") as a win RATE, or null.
//
// A rate, not a count: Torvik's record covers the games HE projects, and the
// schedule we hold can be longer or shorter (non-D-I opponents are dropped,
// conference tournaments are not on a preseason schedule). Scaling the rate
// to our own game count calibrates like for like.
function winRateOf(projectedRecord) {
    const m = /^\s*(\d+)\s*-\s*(\d+)\s*$/.exec(String(projectedRecord || ''));
    if (!m) return null;
    const w = Number(m[1]), l = Number(m[2]);
    return w + l > 0 ? w / (w + l) : null;
}

// A conference-tournament game. CBBD files a conference tournament as
// seasonType 'regular', and the March estimate prices it (confTourney +
// confChamp), so the regular projection leaves those games out rather than
// counting them twice.
//
// It is hoops-detectors isConfTournament — the SCORING definition, the one
// the Captain/H2H modes (hoops-modes isModeGame) and the team page read —
// so the projection and the scorer agree on which games those are. Until
// #310 PR 5 this file had its own test, which disagreed on one shape: a
// conference game carrying a tournament code. The scorer reads a named
// tournament as somebody else's (the NCAA, the NIT) and scores it as a mode
// game; this file left it out. None exists on the 2026-27 schedule, and
// CBBD's 31 conference finals of March 2026 all had the field empty.
function isConfTournamentGame(game) {
    return isConfTournament(game);
}

// A row that will never be played as listed. 18 of the 6,213 2025-26
// regular-season rows were cancelled or postponed, most with a rescheduled
// twin on file; projecting both would count the game twice.
const DEAD_STATUSES = ['cancelled', 'canceled', 'postponed'];
function isDead(game) {
    return DEAD_STATUSES.includes(String(game.status || '').toLowerCase());
}

// The game as a result for `teamId`, for the scoring engine. Notes and the
// tournament code are dropped so a synthesized result can only ever match a
// quadrant rule.
function synthResult(game, teamId, won) {
    const isHome = Number(game.homeTeamId) === Number(teamId);
    const teamPts = won ? 1 : 0, oppPts = won ? 0 : 1;
    return Object.assign({}, game, {
        seasonType: 'regular', tournament: null, gameNotes: null, status: 'final',
        homePoints: isHome ? teamPts : oppPts, awayPoints: isHome ? oppPts : teamPts,
        homeSeed: null, awaySeed: null
    });
}

// What a win in this game is worth under this league's config, graded on the
// opponent's rank in `ranks` ({ teamId: rank }) — the caller's CURRENT ranks.
function pointsIfWin(teamId, game, ranks, cfg) {
    return evaluate('hoops', Number(teamId), synthResult(game, teamId, true), ranks || {}, cfg);
}

// What a LOSS in this game is worth: 0 unless the league has opted into the
// bad-loss penalty, and then negative on a Q4 loss.
function pointsIfLoss(teamId, game, ranks, cfg) {
    return evaluate('hoops', Number(teamId), synthResult(game, teamId, false), ranks || {}, cfg);
}

// Everything a projection reads that is the same for every team, built once.
//
// teams: [{ id, preseason: { barthag, projectedRecord } }] — the season's
//   HoopsTeam rows. A team with no barthag is not D-I, or not rated yet; its
//   games are left out of every projection rather than guessed at.
// ranks: { teamId: rank } the quadrants are graded against.
// cfg: the league's resolved scoring config (resolveConfig).
function buildHoopsPoolContext(teams, { ranks, cfg, homeOdds = HOME_ODDS } = {}) {
    const barthagById = {}, winRateById = {}, teamsById = {};
    (teams || []).forEach(t => {
        const id = String(t.id);
        teamsById[id] = t;
        const pre = t.preseason || {};
        const b = barthagOf(pre.barthag);
        if (b !== null) barthagById[id] = b;
        const r = winRateOf(pre.projectedRecord);
        if (r !== null) winRateById[id] = r;
    });
    return { barthagById, winRateById, teamsById, ranks: ranks || {}, cfg, homeOdds };
}

// A regular-season game that a projection could cover, rated or not.
function scheduledRegular(teamId, games) {
    const id = Number(teamId);
    return (games || []).filter(g => String(g.seasonType || '').toLowerCase() === 'regular'
        && !isDead(g)
        && !isConfTournamentGame(g)
        && (Number(g.homeTeamId) === id || Number(g.awayTeamId) === id));
}

// The team's Torvik win rate restated over D-I games only, or null.
//
// Torvik's record includes the ~1.5 games a season a D-I team plays against a
// non-D-I opponent, and wins 98.9% of. Calibrating our D-I-only schedule to
// the raw rate asked every team to win those games again against real
// opponents: across 2025-26 the mean target rate was 0.524 where D-I against
// D-I is 0.500 by construction, and the calibrated probabilities came out
// biased high (logistic intercept -0.13, Brier 0.1929). Taking the non-D-I
// wins out first removes the bias (intercept +0.001, Brier 0.1920).
function d1WinRate(teamId, games, ctx) {
    const rate = ctx.winRateById[String(teamId)];
    if (rate === undefined) return null;
    const all = scheduledRegular(teamId, games);
    const id = Number(teamId);
    const isRated = (g) => ctx.barthagById[String(Number(g.homeTeamId) === id ? g.awayTeamId : g.homeTeamId)] !== undefined;
    const nD1 = all.filter(isRated).length;
    const nNon = all.length - nD1;
    if (!nD1) return null;
    const wins = rate * all.length - NON_D1_WIN_RATE * nNon;
    return Math.min(1, Math.max(0, wins / nD1));
}

// The regular-season games a projection covers: the team played in it, it is
// not a conference tournament or postseason game, and both sides are rated.
function projectableGames(teamId, games, ctx) {
    const id = Number(teamId);
    return scheduledRegular(teamId, games).filter(g => {
        const opp = Number(g.homeTeamId) === id ? g.awayTeamId : g.homeTeamId;
        return ctx.barthagById[String(opp)] !== undefined;
    });
}

// Per-team projection, shaped like draft-projection's projectTeamPoints.
//
// opts.expectedWins: the calibration target for the games passed. Default:
//   the team's Torvik win rate (restated over D-I games, d1WinRate) times the
//   number of projectable games — a full-season projection. Remaining-
//   schedule callers pass their own (see projectRemaining). null disables
//   calibration.
// opts.decided: this team's postseason state (see hoops-march
//   expectedPostseason) — a conference tournament that is over, or an NCAA
//   run that is out or under way — so a term already banked is not expected
//   again.
// opts.perGame: also return perGame [{ week, gameId, winProb, pointsIfWin,
//   pointsIfLoss }]. The first four are football's entry; pointsIfLoss is
//   only non-zero in a league that has opted into the bad-loss penalty, and
//   h2h's matchupWinProb (which floors at 0) does not read it — nor do the
//   standings projection's Monte Carlo and Captain term (see the consumer
//   notes at the top).
//
// `cfp` and `bowl` are always 0: they are football's postseason terms, kept so
// a consumer that sums proj.cfp + proj.confChamp + proj.bowl (the standings
// projection does) gets a number instead of NaN. The basketball postseason
// is `postseason` (= confChamp + confTourney + ncaa + upset), filled by the
// March estimate when ctx carries one (modules/hoops-march.js attachMarch)
// and 0 otherwise. Note for a consumer that sums football's three terms:
// confChamp alone is not the basketball postseason — read `postseason`.
function projectHoopsTeam(team, teamGames, ctx, opts = {}) {
    const teamId = Number(team.id);
    const key = String(teamId);
    const games = projectableGames(teamId, teamGames, ctx);
    const mine = ctx.barthagById[key];

    const raw = games.map(g => {
        const opp = Number(g.homeTeamId) === teamId ? g.awayTeamId : g.homeTeamId;
        const p = teamWinProb(mine, ctx.barthagById[String(opp)], venueOfGame(teamId, g), ctx.homeOdds);
        // An unrated team of our own is a coin flip until calibration (or
        // nothing at all) says otherwise.
        return p === null ? 0.5 : p;
    });

    let target;
    if (Object.prototype.hasOwnProperty.call(opts, 'expectedWins')) target = opts.expectedWins;
    else {
        const rate = d1WinRate(teamId, teamGames, ctx);
        target = rate === null ? null : rate * games.length;
    }
    const { probs } = calibrateProbs(raw, target);

    let regular = 0, projWins = 0;
    const perGame = [];
    games.forEach((g, i) => {
        const pts = pointsIfWin(teamId, g, ctx.ranks, ctx.cfg);
        const lossPts = pointsIfLoss(teamId, g, ctx.ranks, ctx.cfg);
        regular += probs[i] * pts + (1 - probs[i]) * lossPts;
        projWins += probs[i];
        if (opts.perGame) perGame.push({ week: g.week, gameId: g.id, winProb: probs[i], pointsIfWin: pts, pointsIfLoss: lossPts });
    });

    // The March estimate, when the context carries one (hoops-march
    // attachMarch). Without it the postseason is 0, as it was in PR 1.
    let post = { confChamp: 0, confTourney: 0, ncaa: 0, upset: 0, makeProb: null };
    const march = ctx.march;
    if (march && march.rankById[key] !== undefined) {
        post = march.model.expectedPostseason({ id: teamId, rank: march.rankById[key] }, march.confCtx, ctx.cfg, march.basis,
            opts.decided);
    }
    const { confChamp, confTourney, ncaa, upset } = post;
    const postseason = confChamp + confTourney + ncaa + upset;
    return {
        regular, confChamp, confTourney, ncaa, upset, postseason, cfp: 0, bowl: 0,
        total: regular + postseason,
        projWins, makeProb: post.makeProb, perGame
    };
}

// Did `teamId` win this final game?
function wonGame(teamId, game) {
    const isHome = Number(game.homeTeamId) === Number(teamId);
    return isHome ? Number(game.homePoints) > Number(game.awayPoints)
        : Number(game.awayPoints) > Number(game.homePoints);
}

// Expected wins over a team's REMAINING games, blending the preseason rate
// with the rate actually being played: reality's weight is gp / (gp + K).
// Football's remainingWinsTarget, on basketball's game shape. null when there
// is no preseason rate to anchor on.
function remainingWinsTarget(rate, played, wins, remainingCount, blendGames = BLEND_GAMES) {
    if (rate === null || rate === undefined) return null;
    if (!remainingCount) return 0;
    if (!played) return rate * remainingCount;
    const weight = played / (played + blendGames);
    const pace = (1 - weight) * rate + weight * (wins / played);
    return Math.min(Math.max(pace, 0), 1) * remainingCount;
}

// Mid-season: project only the games not yet final, calibrated to the
// blended remaining-wins target. Banked points are the caller's (they live on
// the franchise, scored at time of play) and are not recomputed here.
function projectRemaining(team, teamGames, ctx, opts = {}) {
    const teamId = Number(team.id);
    const games = projectableGames(teamId, teamGames, ctx);
    const done = games.filter(isFinal);
    const remaining = games.filter(g => !isFinal(g));
    const wins = done.filter(g => wonGame(teamId, g)).length;
    const rate = d1WinRate(teamId, teamGames, ctx);
    const target = remainingWinsTarget(rate, done.length, wins, remaining.length,
        opts.blendGames === undefined ? BLEND_GAMES : opts.blendGames);
    const proj = projectHoopsTeam(team, remaining, ctx, Object.assign({}, opts, { expectedWins: target }));
    return Object.assign(proj, { played: done.length, wins, remaining: remaining.length });
}

module.exports = {
    HOME_ODDS, BLEND_GAMES, NON_D1_WIN_RATE, d1WinRate, scheduledRegular,
    teamWinProb, calibrateProbs, winRateOf, venueOfGame, barthagOf,
    pointsIfWin, pointsIfLoss, isConfTournamentGame, isDead, projectableGames, wonGame,
    buildHoopsPoolContext, projectHoopsTeam, remainingWinsTarget, projectRemaining,
    logit, sigmoid
};
