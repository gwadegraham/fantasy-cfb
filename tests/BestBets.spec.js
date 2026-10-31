// Pure tests for modules/best-bets.js — pricing legs against the other books,
// rating agreement, trap removal, grading, and the list's own season record.

const bb = require('../modules/best-bets');

function game(over = {}) {
    return {
        id: 1, week: 5, homeTeam: 'Utah', awayTeam: 'BYU', neutralSite: false,
        startDate: '2026-10-03T23:00:00.000Z', startTimeTbd: false,
        homePregameElo: 1600, awayPregameElo: 1600, pregameWinProb: null,
        completed: false, homePoints: null, awayPoints: null,
        ...over
    };
}

function lines(dk, ...others) {
    return { id: 1, lines: [{ provider: 'DraftKings', ...dk }, ...others] };
}

// Most fixtures here are coin-flip spreads, which the likely-to-win floor
// filters out; ANY lifts it for the tests that are about ordering or grading.
const ANY = { minWinProb: 0 };

const pick = (cands, betType, side) => cands.find(c => c.betType === betType && (c.teamSide === side || c.selection.startsWith(side)));

describe('consensus', () => {
    test('prices from the OTHER books when any carry the field', () => {
        const m = bb.consensus([{ spread: -3 }, { spread: -4 }], { spread: -7 });
        expect(m.spread).toBe(-3.5);
        expect(m.spreadShopped).toBe(true);
    });

    test('falls back to DK and says so, rather than claim a price edge against itself', () => {
        const m = bb.consensus([], { spread: -7, overUnder: 50, homeMoneyline: -250, awayMoneyline: 200 });
        expect(m.spread).toBe(-7);
        expect(m.spreadShopped).toBe(false);
        expect(m.totalShopped).toBe(false);
        expect(m.homeWinProb).toBeGreaterThan(0.6);
    });

    test('no DK moneyline leaves the win prob unknown', () => {
        expect(bb.consensus([], { spread: -7 }).homeWinProb).toBeNull();
    });

    // The production trap: Bovada's spread had moved to 1.5 but its moneyline
    // still priced the 3.5 opener. Reading it made the DK dog look +12% EV.
    test('ignores the other books\' moneylines, which go stale while spreads move', () => {
        const dk = { spread: 1.5, homeMoneyline: -102, awayMoneyline: -118 };
        const stale = { provider: 'Bovada', spread: 1.5, homeMoneyline: 145, awayMoneyline: -170 };
        const h = bb.impliedProb(-102), a = bb.impliedProb(-118);
        expect(bb.consensus([stale], dk).homeWinProb).toBeCloseTo(h / (h + a), 6);
    });

    test('moves DK\'s moneyline by the gap between its spread and the field\'s', () => {
        const dk = { spread: -7, homeMoneyline: -280, awayMoneyline: 230 };
        const base = bb.consensus([{ spread: -7 }], dk).homeWinProb;
        // The field has the home side 2 points stronger than DK does.
        expect(bb.consensus([{ spread: -9 }], dk).homeWinProb).toBeGreaterThan(base);
        expect(bb.consensus([{ spread: -5 }], dk).homeWinProb).toBeLessThan(base);
    });
});

describe('candidatesForGame', () => {
    test('no DraftKings line, no candidates', () => {
        expect(bb.candidatesForGame(game(), { lines: [{ provider: 'Bovada', spread: -3 }] }, null)).toEqual([]);
        expect(bb.candidatesForGame(game(), null, null)).toEqual([]);
    });

    test('finds DK under the "Draft Kings" spelling CFBD used in 2025', () => {
        const c = bb.candidatesForGame(game(), { lines: [{ provider: 'Draft Kings', spread: -3 }] }, null);
        expect(c.length).toBe(2);
    });

    test('a DK spread better than the field is worth more than the other side', () => {
        // DK gives the home dog +3.5 where Bovada gives +2.5.
        const c = bb.candidatesForGame(game(), lines({ spread: 3.5 }, { provider: 'Bovada', spread: 2.5 }), null);
        const home = pick(c, 'spread', 'home'), away = pick(c, 'spread', 'away');
        expect(home.priceEdge).toBe(1);
        expect(away.priceEdge).toBe(-1);
        expect(home.winProb).toBeGreaterThan(0.5);
        expect(home.ev).toBeGreaterThan(away.ev);
        expect(home.shopped).toBe(true);
    });

    test('a DK-only spread is a coin flip at -110 on both sides', () => {
        const c = bb.candidatesForGame(game(), lines({ spread: -7 }), null);
        expect(pick(c, 'spread', 'home').winProb).toBeCloseTo(0.5, 6);
        expect(pick(c, 'spread', 'away').winProb).toBeCloseTo(0.5, 6);
        expect(pick(c, 'spread', 'home').ev).toBeCloseTo(0.5 * (1 + 100 / 110) - 1, 6);
    });

    test('selection strings match the bet board buttons, pick \'em included', () => {
        const c = bb.candidatesForGame(game(), lines({ spread: 0, overUnder: 51.5, homeMoneyline: -110, awayMoneyline: -110 }), null);
        expect(c.map(x => x.selection).sort()).toEqual(
            ['BYU +0', 'BYU ML', 'Over 51.5', 'Under 51.5', 'Utah +0', 'Utah ML'].sort()
        );
        expect(pick(c, 'spread', 'away').line).toBe(-0);
    });

    test('flags a moneyline at +500 or longer as a trap', () => {
        const c = bb.candidatesForGame(game(), lines({ homeMoneyline: -800, awayMoneyline: 500 }), null);
        expect(pick(c, 'moneyline', 'away').trap).toBe(true);
        expect(pick(c, 'moneyline', 'home').trap).toBe(false);
    });

    test('totals price off the field total', () => {
        // DK hangs 48.5, the field 50.5: the over is two points cheap at DK.
        const c = bb.candidatesForGame(game(), lines({ overUnder: 48.5 }, { provider: 'Bovada', overUnder: 50.5 }), null);
        const over = pick(c, 'over_under', 'Over'), under = pick(c, 'over_under', 'Under');
        expect(over.priceEdge).toBe(2);
        expect(over.winProb).toBeGreaterThan(0.5);
        expect(under.winProb).toBeLessThan(0.5);
        // No rating projects a total, so no votes.
        expect(over.voters).toEqual([]);
    });

    test('each rating votes, and a missing one is absent rather than a "no"', () => {
        const strongHome = game({ homePregameElo: 1900, awayPregameElo: 1400, pregameWinProb: 0.2 });
        const c = bb.candidatesForGame(strongHome, lines({ spread: -3 }), { home: 20, away: 0 });
        const home = pick(c, 'spread', 'home');
        expect(home.voters.sort()).toEqual(['cfbd', 'elo', 'sp']);
        // Elo and SP+ see more than a field goal; CFBD's 20% does not.
        expect(home.agree.sort()).toEqual(['elo', 'sp']);
        expect(pick(c, 'spread', 'away').agree).toEqual(['cfbd']);

        const noRatings = game({ homePregameElo: null, awayPregameElo: null });
        expect(pick(bb.candidatesForGame(noRatings, lines({ spread: -3 }), null), 'spread', 'home').voters).toEqual([]);
    });
});

describe('modelMargins', () => {
    test('equal Elo at a neutral site is a pick \'em', () => {
        expect(bb.modelMargins(game({ neutralSite: true }), null).elo).toBeCloseTo(0, 3);
    });

    test('home field moves both Elo and SP+ toward the home side', () => {
        const m = bb.modelMargins(game(), { home: 10, away: 10 });
        expect(m.elo).toBeGreaterThan(0);
        expect(m.sp).toBe(2.5);
    });

    test('CFBD win prob maps back to a margin', () => {
        expect(bb.modelMargins(game({ pregameWinProb: 0.5 }), null).cfbd).toBeCloseTo(0, 3);
        expect(bb.modelMargins(game({ pregameWinProb: 0.8 }), null).cfbd).toBeGreaterThan(10);
    });
});

describe('rankBestBets', () => {
    const g1 = game({ id: 1 });
    const g2 = game({ id: 2, homeTeam: 'Ohio State', awayTeam: 'Purdue' });

    test('one leg per game, best-priced game first', () => {
        const byId = new Map([
            [1, lines({ spread: -7 })],
            [2, { id: 2, lines: [{ provider: 'DraftKings', spread: 3.5 }, { provider: 'Bovada', spread: 1.5 }] }]
        ]);
        const picks = bb.rankBestBets([g1, g2], byId, () => null, ANY);
        expect(picks.map(p => p.gameId)).toEqual([2, 1]);
        expect(picks[0].selection).toBe('Ohio State +3.5');
    });

    test('drops traps and no-information favorites even when they price best', () => {
        const byId = new Map([[1, {
            id: 1, lines: [
                { provider: 'DraftKings', homeMoneyline: -1200, awayMoneyline: 700 },
                // Every other book has the dog shorter, so DK's +700 is the
                // best-priced leg on the board. It is still a trap.
                { provider: 'Bovada', homeMoneyline: -1500, awayMoneyline: 500 }
            ]
        }]]);
        expect(bb.rankBestBets([g1], byId, () => null)).toEqual([]);
    });

    test('ties on price go to the side more ratings agree with', () => {
        const strongAway = game({ homePregameElo: 1400, awayPregameElo: 1800 });
        const picks = bb.rankBestBets([strongAway], new Map([[1, lines({ spread: 3 })]]), () => ({ home: 0, away: 15 }), ANY);
        expect(picks[0].teamSide).toBe('away');
        expect(picks[0].agree.sort()).toEqual(['elo', 'sp']);
    });

    test('respects the limit', () => {
        const byId = new Map([[1, lines({ spread: -7 })], [2, { id: 2, lines: [{ provider: 'DraftKings', spread: -1 }] }]]);
        expect(bb.rankBestBets([g1, g2], byId, () => null, { ...ANY, limit: 1 })).toHaveLength(1);
    });
});

describe('rankBestBets — likely to win', () => {
    test('keeps only legs at or above the floor, on the market\'s numbers', () => {
        // DK has Ohio State -400 / +310: about 78% to win. The spread is a coin flip.
        const byId = new Map([[1, lines({ spread: -10.5, homeMoneyline: -400, awayMoneyline: 310 })]]);
        const picks = bb.rankBestBets([game()], byId, () => null);
        expect(picks).toHaveLength(1);
        expect(picks[0]).toMatchObject({ betType: 'moneyline', teamSide: 'home' });
        expect(picks[0].winProb).toBeGreaterThanOrEqual(bb.LIKELY_MIN);
    });

    test('a game with nothing likely enough is left off entirely', () => {
        const byId = new Map([[1, lines({ spread: -3, homeMoneyline: -150, awayMoneyline: 130 })]]);
        expect(bb.rankBestBets([game()], byId, () => null)).toEqual([]);
    });

    test('between two likely legs, the better value comes first', () => {
        // Same favourite price, but the field has game 2's home side 3 points
        // stronger than DK does, so DK's -400 there is the better buy.
        const g2 = game({ id: 2, homeTeam: 'Iowa', awayTeam: 'Rice' });
        const byId = new Map([
            [1, lines({ spread: -10.5, homeMoneyline: -400, awayMoneyline: 310 })],
            [2, { id: 2, lines: [{ provider: 'DraftKings', spread: -10.5, homeMoneyline: -400, awayMoneyline: 310 }, { provider: 'Bovada', spread: -13.5 }] }]
        ]);
        expect(bb.rankBestBets([game(), g2], byId, () => null).map(p => p.gameId)).toEqual([2, 1]);
    });

    test('the season record counts whole slips that would have cashed', () => {
        const fav = id => ({ id, lines: [{ provider: 'DraftKings', homeMoneyline: -400, awayMoneyline: 310 }] });
        const mk = (wk, n, homeWinsAll) => Array.from({ length: n }, (_, i) => game({
            id: wk * 100 + i, week: wk, completed: true,
            homePoints: homeWinsAll || i ? 30 : 10, awayPoints: 20
        }));
        const games = [...mk(1, 6, true), ...mk(2, 6, false)];
        const byId = new Map(games.map(g => [g.id, fav(g.id)]));
        expect(bb.seasonRecord(games, byId, () => null)).toMatchObject({ slips: 2, slipsHit: 1, wins: 11, losses: 1 });
    });
});

describe('compareCandidates', () => {
    test('falls through to the likelier leg when price and votes tie', () => {
        const a = { ev: -0.04, agree: [], winProb: 0.8 };
        const b = { ev: -0.04, agree: [], winProb: 0.6 };
        expect([b, a].sort(bb.compareCandidates)[0]).toBe(a);
    });

    test('float noise in EV does not decide the order', () => {
        const a = { ev: -0.0454545454, agree: ['elo'], winProb: 0.5 };
        const b = { ev: -0.0454545451, agree: [], winProb: 0.5 };
        expect([b, a].sort(bb.compareCandidates)[0]).toBe(a);
    });
});

describe('gradePick', () => {
    const final = game({ completed: true, homePoints: 24, awayPoints: 17 });

    test('spreads grade off the line from the picked side', () => {
        expect(bb.gradePick({ betType: 'spread', teamSide: 'home', line: -6.5 }, final)).toBe('win');
        expect(bb.gradePick({ betType: 'spread', teamSide: 'home', line: -7 }, final)).toBe('push');
        expect(bb.gradePick({ betType: 'spread', teamSide: 'away', line: 6.5 }, final)).toBe('loss');
        expect(bb.gradePick({ betType: 'spread', teamSide: 'away', line: 7.5 }, final)).toBe('win');
    });

    test('moneylines grade on the winner', () => {
        expect(bb.gradePick({ betType: 'moneyline', teamSide: 'home' }, final)).toBe('win');
        expect(bb.gradePick({ betType: 'moneyline', teamSide: 'away' }, final)).toBe('loss');
    });

    test('totals grade on the combined score', () => {
        expect(bb.gradePick({ betType: 'over_under', selection: 'Over 40.5', line: 40.5 }, final)).toBe('win');
        expect(bb.gradePick({ betType: 'over_under', selection: 'Under 40.5', line: 40.5 }, final)).toBe('loss');
        expect(bb.gradePick({ betType: 'over_under', selection: 'Under 41', line: 41 }, final)).toBe('push');
    });

    test('an unfinished game is not graded', () => {
        expect(bb.gradePick({ betType: 'moneyline', teamSide: 'home' }, game())).toBeNull();
        expect(bb.gradePick({ betType: 'moneyline', teamSide: 'home' }, null)).toBeNull();
    });
});

describe('seasonRecord', () => {
    // Week 1: home dog +3.5 at DK, +1.5 elsewhere, covers by losing 20-21.
    // Week 2: same shape, home loses by 10 — a loss.
    // Week 3: not played, so not graded.
    const games = [
        game({ id: 1, week: 1, completed: true, homePoints: 20, awayPoints: 21 }),
        game({ id: 2, week: 2, completed: true, homePoints: 10, awayPoints: 20 }),
        game({ id: 3, week: 3 })
    ];
    const shopped = id => ({ id, lines: [{ provider: 'DraftKings', spread: 3.5 }, { provider: 'Bovada', spread: 1.5 }] });
    const byId = new Map([[1, shopped(1)], [2, shopped(2)], [3, shopped(3)]]);

    test('grades each finished week at the DK price, one unit a pick', () => {
        const rec = bb.seasonRecord(games, byId, () => null, ANY);
        expect(rec).toMatchObject({ wins: 1, losses: 1, pushes: 0, weeks: 2, hitPct: 50 });
        expect(rec.units).toBeCloseTo(100 / 110 - 1, 2);
    });

    test('stops before the week asked for', () => {
        expect(bb.seasonRecord(games, byId, () => null, { ...ANY, beforeWeek: 2 })).toMatchObject({ wins: 1, losses: 0, weeks: 1 });
    });

    test('an empty season has no hit rate rather than 0%', () => {
        expect(bb.seasonRecord([], new Map(), () => null)).toMatchObject({ wins: 0, losses: 0, hitPct: null, units: 0 });
    });

    test('grades the list as the page ranked it, not a list of whatever finished first', () => {
        // Saturday afternoon: game 1 is final but ranks last of seven, behind
        // six unplayed games priced better at DK. The page's top 6 never had
        // game 1 on it, so nothing is graded yet.
        const unplayed = Array.from({ length: 6 }, (_, i) => game({ id: 10 + i, week: 9 }));
        const early = game({ id: 1, week: 9, completed: true, homePoints: 30, awayPoints: 0 });
        const byIdSat = new Map([[1, { id: 1, lines: [{ provider: 'DraftKings', spread: -7 }] }]]);
        unplayed.forEach(g => byIdSat.set(g.id, shopped(g.id)));
        expect(bb.seasonRecord([early, ...unplayed], byIdSat, () => null, ANY)).toMatchObject({ wins: 0, losses: 0, weeks: 0 });
    });

    test('counts a push without a unit either way', () => {
        const push = [game({ id: 1, week: 1, completed: true, homePoints: 10, awayPoints: 13 })];
        const flat = new Map([[1, { id: 1, lines: [{ provider: 'DraftKings', spread: 3 }, { provider: 'Bovada', spread: 1 }] }]]);
        expect(bb.seasonRecord(push, flat, () => null, ANY)).toMatchObject({ pushes: 1, units: 0, hitPct: null });
    });
});

describe('spBefore', () => {
    const ts = { spRating: 25, spHistory: [{ week: 1, rating: 10 }, { week: 3, rating: 14 }, { week: 5, rating: 20 }] };

    test('uses the latest snapshot from before the week', () => {
        expect(bb.spBefore(ts, 5, true)).toBe(14);
        expect(bb.spBefore(ts, 9, true)).toBe(20);
    });

    test('never leaks the current rating into a finished game', () => {
        expect(bb.spBefore(ts, 1, true)).toBeNull();
    });

    test('an unplayed game may use the current rating', () => {
        expect(bb.spBefore(ts, 1, false)).toBe(25);
        expect(bb.spBefore({ spHistory: [] }, 1, false)).toBeNull();
        expect(bb.spBefore(null, 4, false)).toBeNull();
    });
});

describe('odds helpers', () => {
    test('decimal and implied agree', () => {
        expect(bb.decimalOdds(150)).toBe(2.5);
        expect(bb.decimalOdds(-200)).toBe(1.5);
        expect(bb.impliedProb(-200)).toBeCloseTo(2 / 3, 6);
    });

    test('probit inverts the normal CDF', () => {
        expect(bb.probit(0.5)).toBeCloseTo(0, 6);
        expect(bb.probit(0.8413)).toBeCloseTo(1, 3);
    });
});
