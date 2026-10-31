// Best Bets: ranks the week's DraftKings lines into a short list of legs.
//
// Pure and I/O-free — routes/betting.js gathers the games, lines and SP+
// snapshots and hands them in.
//
// WHAT THIS DOES NOT CLAIM. Before this was built, every signal we hold was
// backtested against DK lines and final scores (dev copy of prod, Oct 2026):
//
//   Elo pregame margin, 2024–26      n=1899   48–52% ATS in every edge band
//   SP+ weekly snapshot, 2026        n=393    41–53%
//   CFBD pregame win prob, 2026      n=501    52–55%, but r=0.993 with the spread
//   DK ≥1.5 pts off the other books  n=142    53.5%
//   ML at +500 or longer             n=492    −46% ROI
//
// (Pricing DK moneylines against the other books' moneylines looked like an
// edge too, until it turned out those were stale — see consensus().)
//
// Break-even at −110 is 52.4%. No rating we store beats the market by itself,
// so the list does not pretend to. What it is FOR (the group's brief, Oct 2026):
// parlay legs that are likely to hit, at the best value DK offers for them.
//
//   1. LIKELY. Only legs the market gives at least LIKELY_MIN to win. A six-leg
//      slip needs every leg; coin-flip spreads and longshot dogs sink it.
//   2. VALUE. Among those, the leg that pays most for its chance first — EV at
//      DK's price against the fair probability. Where DK hangs a better number
//      than the field, that is where it shows up (line shopping, the one
//      measurable inefficiency available to someone who bets at DK).
//   3. AGREEMENT. Elo, SP+ and CFBD's win prob each vote on the side; it breaks
//      ties. It does not beat the line, but it is a second opinion.
//
// Longshot moneylines are dropped outright (TRAP_ML) rather than ranked low.
//
// The list's own track record is graded by seasonRecord() from the same
// function, so the page can show whether any of this is working.

const { normCdf, DEFAULT_SIGMA } = require('./win-probability');

// ML at or beyond this is a trap: −46% ROI over 492 backtested bets.
const TRAP_ML = 500;
// A price this short carries no information worth ranking (−1000 pays $10 on
// $100) and the backtest excluded it for the same reason.
const MAX_FAVORITE_ML = -1000;
// What a spread or total costs at DK when the line carries no price. CFBD's
// /lines gives the number but not the juice; the bet board assumes the same.
const STANDARD_ODDS = -110;
// The floor for "likely to hit": the market's fair chance, not ours (~ a −235
// favorite). Chosen on the brief — whole six-leg slips that hit — measured over
// 2024–26, top 6 a week:
//
//   floor   legs won   6-leg slips hit   return per leg
//   none      42%         0 / 37           −3.8%
//   0.65      71%         6 / 35           −7.4%
//   0.70      77%         8 / 35           −5.0%
//   0.75      79%         6 / 35           −6.0%
//
// Return is the house cut at every floor, so it is not what picked this.
const LIKELY_MIN = 0.7;
// One pick per member on the group's slip.
const RECORD_PICKS_PER_WEEK = 6;
// HFA in SP+ space; matches modules/win-probability.js.
const SP_HFA = 2.5;
// HFA in Elo points (CFBD's own Elo uses ~55).
const ELO_HFA = 55;

// Also how routes/betting.js picks the bet board's DK line, and both take the
// FIRST match: if the two disagreed on spelling ("Draft Kings" in 2025) or on
// which of two DK rows to use, a pick would name a line the board doesn't show.
const isDK = l => /draft\s*kings/i.test((l && l.provider) || '');

function decimalOdds(american) {
    return american > 0 ? 1 + american / 100 : 1 + 100 / -american;
}

function impliedProb(american) {
    return 1 / decimalOdds(american);
}

// Inverse normal CDF by bisection — precision far beyond what a win prob needs.
function probit(p) {
    const q = Math.min(0.999, Math.max(0.001, p));
    let lo = -6, hi = 6;
    for (let i = 0; i < 60; i++) {
        const mid = (lo + hi) / 2;
        if (normCdf(mid) < q) lo = mid; else hi = mid;
    }
    return (lo + hi) / 2;
}

const mean = xs => xs.reduce((s, x) => s + x, 0) / xs.length;

// `>=`, not `>`: the bet board writes a pick 'em as "Army +0", and the page
// finds the button to select by this exact string.
function fmtSigned(n) {
    return (n >= 0 ? '+' : '') + n;
}

// Home-perspective predicted margins from each rating we hold. Any of them may
// be null; the caller decides what to do with a missing vote.
function modelMargins(game, sp) {
    const hfa = game.neutralSite ? 0 : 1;
    const out = { elo: null, sp: null, cfbd: null };
    if (game.homePregameElo != null && game.awayPregameElo != null) {
        const diff = game.homePregameElo - game.awayPregameElo + ELO_HFA * hfa;
        out.elo = DEFAULT_SIGMA * probit(1 / (1 + Math.pow(10, -diff / 400)));
    }
    if (sp && sp.home != null && sp.away != null) {
        out.sp = sp.home - sp.away + SP_HFA * hfa;
    }
    if (game.pregameWinProb != null) {
        out.cfbd = DEFAULT_SIGMA * probit(game.pregameWinProb);
    }
    return out;
}

// The market's view, from every book EXCEPT DraftKings when any carry the
// field, else DK's own line. `shopped` says which, so the page never claims a
// price edge it measured against itself.
//
// Moneylines are deliberately NOT read from the other books. In the CFBD feed
// their moneylines go stale while their spreads move: Bovada's K-State @ ASU
// row (week 8, 2026) carried a 1.5 spread beside a +145/-170 moneyline — the
// price of its 3.5 OPENING spread. Averaging those made every DK underdog look
// +10–20% EV, and the first live week of the list went 0–8 on exactly those.
// The home win prob here is DK's own no-vig moneyline, moved only by how far
// the field's (current) spread sits from DK's.
function consensus(others, dk) {
    const spreads = others.filter(l => l.spread != null).map(l => l.spread);
    const totals = others.filter(l => l.overUnder != null).map(l => l.overUnder);
    const spread = spreads.length ? mean(spreads) : dk.spread;
    let homeWinProb = null;
    if (dk.homeMoneyline != null && dk.awayMoneyline != null) {
        const h = impliedProb(dk.homeMoneyline), a = impliedProb(dk.awayMoneyline);
        // Points the field gives the home side beyond DK's spread.
        const shift = dk.spread != null && spread != null ? dk.spread - spread : 0;
        homeWinProb = normCdf(probit(h / (h + a)) + shift / DEFAULT_SIGMA);
    }
    return {
        spread,
        spreadShopped: spreads.length > 0,
        total: totals.length ? mean(totals) : dk.overUnder,
        totalShopped: totals.length > 0,
        homeWinProb
    };
}

// Every leg the bet board offers for one game, priced and voted on.
// `sp` is { home, away } SP+ ratings as of before kickoff, or null.
function candidatesForGame(game, bettingLine, sp) {
    const lines = (bettingLine && bettingLine.lines) || [];
    const dk = lines.find(isDK);
    if (!dk) return [];
    const others = lines.filter(l => !isDK(l));
    const market = consensus(others, dk);
    const models = modelMargins(game, sp);
    const votes = Object.entries(models).filter(([, m]) => m != null);
    // Which ratings this game had at all, so the page can show a missing one
    // as missing rather than as a disagreement.
    const voters = votes.map(([k]) => k);
    const base = {
        gameId: game.id, week: game.week,
        homeTeam: game.homeTeam, awayTeam: game.awayTeam,
        startDate: game.startDate, startTimeTbd: !!game.startTimeTbd
    };
    const out = [];

    if (dk.spread != null) {
        const marketMargin = -market.spread;
        for (const side of ['home', 'away']) {
            const sign = side === 'home' ? 1 : -1;
            const line = sign * dk.spread;
            const team = side === 'home' ? game.homeTeam : game.awayTeam;
            // Points DK gives this side beyond what the field gives.
            const priceEdge = side === 'home' ? dk.spread - market.spread : market.spread - dk.spread;
            const winProb = normCdf(sign * (marketMargin + dk.spread) / DEFAULT_SIGMA);
            out.push({
                ...base,
                betType: 'spread', teamSide: side, line, odds: STANDARD_ODDS,
                // Same string the bet board's buttons carry (public/betting.js
                // renderBetBoard), so the page can select the matching button.
                selection: team + ' ' + fmtSigned(line),
                winProb, priceEdge, shopped: market.spreadShopped,
                agree: votes.filter(([, m]) => sign * (m + dk.spread) > 0).map(([k]) => k),
                voters
            });
        }
    }

    if (dk.homeMoneyline != null && dk.awayMoneyline != null && market.homeWinProb != null) {
        for (const side of ['home', 'away']) {
            const odds = side === 'home' ? dk.homeMoneyline : dk.awayMoneyline;
            const sign = side === 'home' ? 1 : -1;
            const team = side === 'home' ? game.homeTeam : game.awayTeam;
            const winProb = side === 'home' ? market.homeWinProb : 1 - market.homeWinProb;
            out.push({
                ...base,
                betType: 'moneyline', teamSide: side, line: null, odds,
                selection: team + ' ML',
                // A moneyline's edge comes from the spread comparison above,
                // so it is "shopped" exactly when the spread was.
                winProb, priceEdge: null, shopped: market.spreadShopped && dk.spread != null,
                trap: odds >= TRAP_ML,
                agree: votes.filter(([, m]) => sign * m > 0).map(([k]) => k),
                voters
            });
        }
    }

    if (dk.overUnder != null) {
        for (const dir of ['Over', 'Under']) {
            const sign = dir === 'Over' ? 1 : -1;
            out.push({
                ...base,
                betType: 'over_under', teamSide: null, line: dk.overUnder, odds: STANDARD_ODDS,
                selection: dir + ' ' + dk.overUnder,
                winProb: normCdf(sign * (market.total - dk.overUnder) / DEFAULT_SIGMA),
                priceEdge: sign * (market.total - dk.overUnder),
                shopped: market.totalShopped,
                // None of our ratings project a total, so a total never earns
                // an agreement vote — it can only rank on price.
                agree: [], voters: []
            });
        }
    }

    for (const c of out) {
        c.ev = c.winProb * decimalOdds(c.odds) - 1;
        c.trap = !!c.trap;
    }
    return out;
}

// Price first (EV, rounded to a tenth of a percent so float noise can't decide
// an order), then how many ratings agree, then the likelier leg — which is what
// a parlay wants when two legs are priced the same.
function compareCandidates(a, b) {
    const ev = Math.round(b.ev * 1000) - Math.round(a.ev * 1000);
    if (ev) return ev;
    const agree = b.agree.length - a.agree.length;
    if (agree) return agree;
    return b.winProb - a.winProb;
}

// The ranked list for a set of games: one leg per game (its best), traps,
// no-information favorites and anything under `minWinProb` removed.
// `spFor(game)` returns { home, away } or null.
function rankBestBets(games, linesById, spFor, { limit = 10, minWinProb = LIKELY_MIN } = {}) {
    const picks = [];
    for (const game of games) {
        const legs = candidatesForGame(game, linesById.get(game.id), spFor(game))
            .filter(c => !c.trap && !(c.betType === 'moneyline' && c.odds <= MAX_FAVORITE_ML))
            .filter(c => c.winProb >= minWinProb)
            .sort(compareCandidates);
        if (legs.length) picks.push(legs[0]);
    }
    return picks.sort(compareCandidates).slice(0, limit);
}

// 'win' | 'loss' | 'push' for a candidate on a final game; null if not final.
function gradePick(pick, game) {
    if (!game || !game.completed || game.homePoints == null || game.awayPoints == null) return null;
    const margin = game.homePoints - game.awayPoints;
    let result;
    if (pick.betType === 'spread') {
        result = (pick.teamSide === 'home' ? margin : -margin) + pick.line;
    } else if (pick.betType === 'moneyline') {
        result = pick.teamSide === 'home' ? margin : -margin;
    } else {
        const total = game.homePoints + game.awayPoints;
        result = pick.selection.startsWith('Over') ? total - pick.line : pick.line - total;
    }
    return result > 0 ? 'win' : result < 0 ? 'loss' : 'push';
}

// How the list would have done: the top RECORD_PICKS_PER_WEEK of each week,
// graded at the stored DK price, one unit each. Each week is ranked over ALL its
// games, as the page ranked it, and only the picks whose games are final are
// graded. Ranking just the finished games would, on a Saturday afternoon, grade
// a "top 6" made of whichever three games ended first — a list nobody saw.
// Lines stored for a past week are the last ones fetched, i.e. near the close,
// which is a little kinder than the number a member saw on Wednesday — say so
// wherever this is shown.
function seasonRecord(games, linesById, spFor, { beforeWeek = Infinity, minWinProb = LIKELY_MIN } = {}) {
    const byWeek = new Map();
    for (const g of games) {
        if (g.week >= beforeWeek) continue;
        if (!byWeek.has(g.week)) byWeek.set(g.week, []);
        byWeek.get(g.week).push(g);
    }
    const gameById = new Map(games.map(g => [g.id, g]));
    // slips/slipsHit: weeks whose full six were all graded, and how many of
    // those had no loss — i.e. "would a slip built from this list have cashed".
    // That is the question the group actually asks of it.
    const rec = { wins: 0, losses: 0, pushes: 0, units: 0, weeks: 0, slips: 0, slipsHit: 0 };
    for (const weekGames of byWeek.values()) {
        const picks = rankBestBets(weekGames, linesById, spFor, { limit: RECORD_PICKS_PER_WEEK, minWinProb });
        const graded = picks.map(p => gradePick(p, gameById.get(p.gameId)));
        if (!graded.some(r => r)) continue;
        rec.weeks++;
        if (picks.length === RECORD_PICKS_PER_WEEK && graded.every(r => r)) {
            rec.slips++;
            if (!graded.includes('loss')) rec.slipsHit++;
        }
        picks.forEach((p, i) => {
            const r = graded[i];
            if (r === 'win') { rec.wins++; rec.units += decimalOdds(p.odds) - 1; }
            else if (r === 'loss') { rec.losses++; rec.units -= 1; }
            else if (r === 'push') rec.pushes++;
        });
    }
    rec.units = Math.round(rec.units * 100) / 100;
    const decided = rec.wins + rec.losses;
    rec.hitPct = decided ? Math.round(1000 * rec.wins / decided) / 10 : null;
    return rec;
}

// SP+ as of before `week`: the latest weekly snapshot older than it. Falls back
// to the season rating only for a game not yet played, where "current" is
// before kickoff by definition — on a finished game it would leak the result.
function spBefore(teamSeason, week, completed) {
    if (!teamSeason) return null;
    const prior = (teamSeason.spHistory || [])
        .filter(h => h.week < week && h.rating != null)
        .sort((a, b) => b.week - a.week)[0];
    if (prior) return prior.rating;
    return !completed && teamSeason.spRating != null ? teamSeason.spRating : null;
}

module.exports = {
    isDK,
    TRAP_ML,
    MAX_FAVORITE_ML,
    STANDARD_ODDS,
    LIKELY_MIN,
    RECORD_PICKS_PER_WEEK,
    decimalOdds,
    impliedProb,
    probit,
    modelMargins,
    consensus,
    candidatesForGame,
    compareCandidates,
    rankBestBets,
    gradePick,
    seasonRecord,
    spBefore
};
