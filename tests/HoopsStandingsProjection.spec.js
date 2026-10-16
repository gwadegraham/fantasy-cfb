// Projected finish + title odds on a BASKETBALL league (#310 PR 5).
//
// Pins the traps two reviews named in standings-projection's football code:
//   - the postseason is proj.postseason, never cfp + confChamp + bowl
//   - the remaining schedule is filtered on `status` (HoopsGame has no
//     `completed`) through projectRemaining, not football's signature
//   - Monte Carlo + Captain read pointsIfLoss (the opt-in bad-loss penalty)
//   - H2H and Captain run basketball's 18 mode weeks, not football's 16
//   - what is DECIDED comes from the team's own rows, so banked titles are
//     not expected again
//   - March is sampled per team, not held at its expected value
// and that GET /standings/projections answers a basketball league from
// hoopsteams / hoopsgames only.

const express = require('express');
const request = require('supertest');
const { useMongo } = require('./helpers/mongo');
const { buildHoopsProjections, hasForecast } = require('../modules/hoops-standings-projection');
const { projectRemaining, buildHoopsPoolContext } = require('../modules/hoops-projection');
const { attachMarch } = require('../modules/hoops-march');
const SP = require('../modules/standings-projection');
const postseasonState = require('../modules/hoops-postseason-state');
const { resolveConfig } = require('../modules/scoring-defaults');

useMongo();

const cfg = resolveConfig('x', { model: 'hoops' });
const SEASON = 2027;

const ratings = [
    { id: 1, school: 'Top', conference: 'BE', preseason: { rank: 1, barthag: 0.97, projectedRecord: '28-3', adjOE: 125, adjDE: 90 } },
    { id: 2, school: 'Mid', conference: 'BE', preseason: { rank: 60, barthag: 0.75, projectedRecord: '19-12', adjOE: 112, adjDE: 100 } },
    { id: 3, school: 'Opp', conference: 'BE', preseason: { rank: 20, barthag: 0.88, projectedRecord: '22-9', adjOE: 118, adjDE: 96 } },
    { id: 4, school: 'Low', conference: 'A10', preseason: { rank: 200, barthag: 0.35, projectedRecord: '11-19', adjOE: 100, adjDE: 108 } }
];
const ranks = { 1: 1, 2: 60, 3: 20, 4: 200 };
let gid = 0;
function g(week, home, away, o = {}) {
    gid += 1;
    const status = o.status || 'scheduled';
    const homeWon = o.homeWon !== false;
    return Object.assign({
        id: gid, season: SEASON, week, seasonType: 'regular', status,
        startDate: new Date(Date.UTC(2099, 10, 3 + week * 7 + (gid % 5))),   // far future: never "overdue"
        homeTeamId: home, awayTeamId: away, neutralSite: false, conferenceGame: false,
        homePoints: status === 'final' ? (homeWon ? 80 : 70) : null,
        awayPoints: status === 'final' ? (homeWon ? 70 : 80) : null
    }, o);
}
const mgr = (id, ids, cum = 0) => ({ _id: id, firstName: id, lastName: 'X', seasons: [{ season: SEASON, cumulativeScore: cum, rosterIds: ids }] });
const silent = { warn: () => {}, error: () => {} };

function schedule() {
    gid = 0;
    const rows = [];
    for (let w = 1; w <= 18; w++) {
        rows.push(g(w, 1, w % 2 ? 3 : 4, { status: w <= 2 ? 'final' : 'scheduled' }));
        rows.push(g(w, 2, w % 2 ? 4 : 3, { status: w <= 2 ? 'final' : 'scheduled', homeWon: w !== 1 }));
    }
    return rows;
}

describe('buildHoopsProjections (pure)', () => {
    test('banked + remaining regular season + proj.postseason, per manager', () => {
        const games = schedule();
        const [a] = buildHoopsProjections({ users: [mgr('a', [1], 40)], ratings, games, field: null, ranks, cfg, season: SEASON, log: silent });
        const ctx = attachMarch(buildHoopsPoolContext(ratings, { ranks, cfg }), ratings);
        const p = projectRemaining(ratings[0], games.filter(x => x.homeTeamId === 1), ctx, { perGame: true });
        expect(a.banked).toBe(40);
        expect(a.remainingCount).toBe(16);                     // the 2 finals are filtered on status
        expect(a.postRemaining).toBeCloseTo(p.postseason, 9);
        // The whole March estimate, not the conference title alone (football's
        // cfp + confChamp + bowl would read just that here).
        expect(p.postseason).toBeGreaterThan(p.confChamp + 20);
        expect(a.projectedFinal).toBe(Math.round(40 + p.regular + p.postseason));
        expect(a.byWeek[3][0].games[0]).toHaveProperty('pointsIfLoss');
    });

    test('a conference title already won is not expected again', () => {
        const games = schedule();
        const [before] = buildHoopsProjections({ users: [mgr('a', [1])], ratings, games, field: null, ranks, cfg, season: SEASON, log: silent });
        const won = g(19, 1, 3, { status: 'final', conferenceGame: true, gameNotes: 'Big East Tournament - Final' });
        const [after] = buildHoopsProjections({ users: [mgr('a', [1])], ratings, games: games.concat([won]), field: null, ranks, cfg, season: SEASON, log: silent });
        // confChamp (title odds × 10) and the confTourney wins both drop out.
        expect(before.postRemaining - after.postRemaining).toBeGreaterThan(5);
        expect(after.postRemaining).toBeGreaterThan(0);        // the NCAA is still to come
    });

    test('out of the NCAA (the bracket is out without it): no postseason left', () => {
        const field = postseasonState.ncaaField(Array.from({ length: 32 }, (_, i) => ({ tournament: 'NCAA', homeTeamId: 100 + 2 * i, awayTeamId: 101 + 2 * i })));
        const [a] = buildHoopsProjections({ users: [mgr('a', [1])], ratings, games: schedule(), field, ranks, cfg, season: SEASON, log: silent });
        expect(a.postRemaining).toBe(0);
        expect(a.postSample()).toBe(0);
    });

    test('a refused decided state costs that team its postseason, not the page', () => {
        const spy = jest.spyOn(postseasonState, 'decidedFor').mockReturnValue({ decided: { ncaa: 'in' }, anomalies: [{ teamId: 1, kind: 'x' }] });
        const log = { warn: jest.fn(), error: jest.fn() };
        const [a] = buildHoopsProjections({ users: [mgr('a', [1])], ratings, games: schedule(), field: null, ranks, cfg, season: SEASON, log });
        spy.mockRestore();
        expect(a.postRemaining).toBe(0);
        expect(a.remainingCount).toBe(16);                     // the regular season is still projected
        expect(log.error).toHaveBeenCalled();
        expect(log.warn).toHaveBeenCalled();
    });

    test('postSample averages to postRemaining', () => {
        const [a] = buildHoopsProjections({ users: [mgr('a', [1, 2])], ratings, games: schedule(), field: null, ranks, cfg, season: SEASON, log: silent });
        let s = 0;
        const N = 100000;
        for (let i = 0; i < N; i++) s += a.postSample();
        expect(s / N).toBeGreaterThan(a.postRemaining * 0.97);
        expect(s / N).toBeLessThan(a.postRemaining * 1.03);
    });

    test('a duplicate listing is projected once', () => {
        const games = schedule();
        const twin = Object.assign({}, games.find(x => x.week === 5 && x.homeTeamId === 1), { id: 999 });
        twin.startDate = new Date(twin.startDate.getTime() + 864e5);
        const [a] = buildHoopsProjections({ users: [mgr('a', [1])], ratings, games: games.concat([twin]), field: null, ranks, cfg, season: SEASON, log: silent });
        expect(a.remainingCount).toBe(16);
    });

    test('an unplayed listing a week past its tip is not projected (the card and the scorer drop it too)', () => {
        const games = schedule();
        const wk3 = games.find(x => x.week === 3 && x.homeTeamId === 1);
        const now = wk3.startDate.getTime() + 8 * 864e5;           // 8 days after week 3's tip
        const [a] = buildHoopsProjections({ users: [mgr('a', [1])], ratings, games, field: null, ranks, cfg, season: SEASON, log: silent, nowMs: now });
        expect(a.remainingCount).toBe(15);
        expect(a.byWeek[3]).toBeUndefined();
    });

    test('the regular season over, March still to come: still a forecast', () => {
        expect(hasForecast([{ remainingCount: 0, postRemaining: 30 }])).toBe(true);
        expect(hasForecast([{ remainingCount: 0, postRemaining: 0 }])).toBe(false);
    });

    test('managers without a roster, and roster ids without a rating row, are skipped', () => {
        const out = buildHoopsProjections({ users: [mgr('a', []), mgr('b', [99])], ratings, games: [], field: null, ranks, cfg, season: SEASON, log: silent });
        expect(out.map(m => m.userId)).toEqual(['b']);
        expect(out[0].projectedFinal).toBe(0);
        expect(hasForecast(out)).toBe(false);
    });
});

describe('standings-projection, basketball inputs (pure)', () => {
    test('the Captain term counts a penalised loss', () => {
        const week = [{ teamId: 1, games: [{ winProb: 0.5, pointsIfWin: 4, pointsIfLoss: -2 }] }];
        expect(SP.expectedCaptainWeek(week, 2)).toBeCloseTo(1, 12);   // 0.5×4 + 0.5×(−2)
        // Football's entries (no pointsIfLoss) are unchanged.
        expect(SP.expectedCaptainWeek([{ teamId: 1, games: [{ winProb: 0.5, pointsIfWin: 4 }] }], 2)).toBe(2);
    });

    test('captainMaxWeek stops the Captain at the last mode week', () => {
        const byWeek = { 17: [{ teamId: 1, games: [{ winProb: 1, pointsIfWin: 5 }] }], 19: [{ teamId: 1, games: [{ winProb: 1, pointsIfWin: 5 }] }] };
        expect(SP.expectedCaptain(byWeek, 2)).toBe(10);
        expect(SP.expectedCaptain(byWeek, 2, 18)).toBe(5);
    });

    test('H2H counts weeks 17 and 18 when maxWeek is 18 (no 16-week cap)', () => {
        const wk = (w) => ({ [w]: [{ teamId: 1, games: [{ winProb: 1, pointsIfWin: 5 }] }] });
        const a = { userId: 'a', projectedFinal: 0, byWeek: Object.assign({}, wk(17), wk(18)) };
        const b = { userId: 'b', projectedFinal: 0, byWeek: {} };
        const eng = { h2hEnabled: true, h2hWinBonus: 3 };
        SP.applyEngagement([a, b], eng, { maxWeek: 18 });
        expect(a.expH2H).toBe(6);
        const a2 = { userId: 'a', projectedFinal: 0, byWeek: a.byWeek }, b2 = { userId: 'b', projectedFinal: 0, byWeek: {} };
        SP.applyEngagement([a2, b2], eng, {});
        expect(a2.expH2H).toBe(0);                             // football's default cap
    });

    test('a week whose every option expects a loss still has a Captain (the least-bad)', () => {
        const week = [{ teamId: 1, games: [{ winProb: 0, pointsIfWin: 0, pointsIfLoss: -2 }] },
            { teamId: 2, games: [{ winProb: 0, pointsIfWin: 0, pointsIfLoss: -4 }] }];
        expect(SP.expectedCaptainWeek(week, 2)).toBe(-2);
        expect(SP.expectedCaptainWeek([], 2)).toBe(0);
    });

    describe('h2hExact: the week under way, and the tie bonus', () => {
        const eng = { h2hEnabled: true, h2hWinBonus: 3, h2hTieBonus: 1 };
        test('a tie pays the configured tie bonus, not half a win', () => {
            const ms = ['a', 'b'].map(id => ({ userId: id, projectedFinal: 0, byWeek: { 1: [{ teamId: 1, games: [{ winProb: 0, pointsIfWin: 5 }] }] } }));
            SP.applyEngagement(ms, eng, { h2hExact: true });
            expect(ms.map(m => m.expH2H)).toEqual([1, 1]);           // a certain 0-0 tie
            const old = ['a', 'b'].map(id => ({ userId: id, projectedFinal: 0, byWeek: ms[0].byWeek }));
            SP.applyEngagement(old, eng, {});
            expect(old.map(m => m.expH2H)).toEqual([1.5, 1.5]);       // the estimate football still uses
        });

        test('banked points in the week under way decide the expectation', () => {
            // A banked 10 and has nothing left; B can only reach 5.
            const a = { userId: 'a', projectedFinal: 0, byWeek: { 1: [] }, bankedWeek: { 1: 10 } };
            const b = { userId: 'b', projectedFinal: 0, byWeek: { 1: [{ teamId: 2, games: [{ winProb: 1, pointsIfWin: 5 }] }] } };
            SP.applyEngagement([a, b], eng, { h2hExact: true });
            expect(a.expH2H).toBe(3);
            expect(b.expH2H).toBe(0);
        });

        test('the simulation counts them too, in the matchup but not the season total', () => {
            // A: 4 banked in the season, 10 of it this week, nothing left.
            // B: 0 banked, a certain 5 to come. Banked-aware, A wins the week
            // (+3, total 7 > 5); blind to it, B does (+3, 8 > 4).
            const mk = () => [
                { userId: 'a', postExpected: 4, byWeek: { 1: [] }, bankedWeek: { 1: 10 } },
                { userId: 'b', postExpected: 0, byWeek: { 1: [{ teamId: 2, games: [{ winProb: 1, pointsIfWin: 5 }] }] } }
            ];
            const o = { engagement: eng, postseasonSd: 0 };
            expect(SP.simulateTitleOdds(mk(), 100, Object.assign({ h2hExact: true }, o)).a).toBe(1);
            expect(SP.simulateTitleOdds(mk(), 100, o).b).toBe(1);
        });

        test('the chosen captain of the week under way is the one doubled', () => {
            const capEng = Object.assign({ captainEnabled: true, captainMultiplier: 2 }, eng);
            // A's best remaining team is 1, but A captained team 2 (worth 1).
            const a = { userId: 'a', projectedFinal: 0, captainWeek: { 1: 2 }, bankedWeek: { 1: 3 },
                byWeek: { 1: [{ teamId: 1, games: [{ winProb: 1, pointsIfWin: 4 }] }, { teamId: 2, games: [{ winProb: 1, pointsIfWin: 1 }] }] } };
            const b = { userId: 'b', projectedFinal: 0, byWeek: { 1: [{ teamId: 3, games: [{ winProb: 1, pointsIfWin: 9 }] }] }, captainWeek: { 1: 99 } };
            SP.applyEngagement([a, b], capEng, { h2hExact: true });
            // A: 3 banked + 4 + 1×2 = 9; B: 9, its captain (99) has no game
            // left. A tie: 1 each. Doubling A's best (4) instead would win.
            expect(a.expH2H).toBe(1);
            expect(a.expCaptain).toBe(1);
        });

        test('the simulation doubles the chosen captain of the week under way', () => {
            const capEng = Object.assign({ captainEnabled: true, captainMultiplier: 2 }, eng);
            // A's chosen captain is team 2 (1 point): 4 + 1×2 = 6 < B's 7.
            // Doubling the best team (4) would give A 9 and the title.
            const mk = () => [
                { userId: 'a', postExpected: 0, captainWeek: { 1: 2 },
                    byWeek: { 1: [{ teamId: 1, games: [{ winProb: 1, pointsIfWin: 4 }] }, { teamId: 2, games: [{ winProb: 1, pointsIfWin: 1 }] }] } },
                { userId: 'b', postExpected: 7, byWeek: {} }
            ];
            expect(SP.simulateTitleOdds(mk(), 50, { engagement: capEng, h2hExact: true, pinnedIds: ['a'], postseasonSd: 0 }).b).toBe(1);
        });

        test('attachBankedWeeks: only the current week, through weekBase and captainOf', () => {
            const ms = [{ userId: 'u1', byWeek: { 6: [], 7: [] } }, { userId: 'u2', byWeek: { 7: [] } }];
            const users = [{ _id: 'u1', seasons: [{ season: SEASON, captains: [], weeklyScore: [
                { week: 6, score: 13, h2hBonus: 3 }, { week: 7, score: 5 }, { week: 6, season: 'postseason', score: 50 }] }] },
            { _id: 'u2', seasons: [{ season: SEASON, weeklyScore: [] }] }];
            SP.attachBankedWeeks(ms, users, SEASON, { weekBase: (e) => e.score - (e.h2hBonus || 0), captainOf: () => 4 });
            expect(ms[0].bankedWeek).toEqual({ 6: 10 });
            expect(ms[0].captainWeek).toEqual({ 6: 4 });
            expect(ms[1].bankedWeek).toBeUndefined();
            SP.attachBankedWeeks([{ userId: 'x', byWeek: {} }], users, SEASON, {});   // nothing to do
        });
    });

    test('the simulation pays the tie bonus', () => {
        // A and B tie 0-0 every sim; C (not in the H2H) has 0.5. With the tie
        // bonus A and B finish on 1 and share the title; without it C wins.
        const eng = { h2hEnabled: true, h2hWinBonus: 3, h2hTieBonus: 1 };
        const wk = { 1: [{ teamId: 1, games: [{ winProb: 0, pointsIfWin: 5 }] }] };
        const ms = [{ userId: 'a', postExpected: 0, byWeek: wk }, { userId: 'b', postExpected: 0, byWeek: wk },
            { userId: 'c', postExpected: 0.5, byWeek: {} }];
        const odds = SP.simulateTitleOdds(ms, 100, { engagement: eng, pinnedIds: ['a', 'b'], postseasonSd: 0 });
        expect(odds.a).toBeCloseTo(0.5, 9);
        expect(odds.c).toBe(0);
    });

    describe('H2H pairings are numbered over the whole season (scheduleWeeks)', () => {
        const { scheduleForWeeks } = require('../modules/h2h');
        const ids = ['a', 'b', 'c', 'd'];
        const full = [1, 2, 3, 4, 5, 6];
        // Week 5 is the only one left (round 2 of 3 — week 4 would be round 1 again). A scores 10, B 1, C 2, D 3, certain.
        const pts = { a: 10, b: 1, c: 2, d: 3 };
        const make = () => ids.map(id => ({ userId: id, projectedFinal: 0, postExpected: id === 'a' ? -100 : 0, postRemaining: 0,
            byWeek: { 5: [{ teamId: 1, games: [{ winProb: 1, pointsIfWin: pts[id] }] }] } }));
        const eng = { h2hEnabled: true, h2hWinBonus: 3, h2hTieBonus: 0 };
        const real = scheduleForWeeks(ids, full)[5];
        const wrong = scheduleForWeeks(ids, [5])[5];
        const winnersOf = (pairs) => pairs.map(([x, y]) => (pts[x] > pts[y] ? x : y));

        test('the fixture distinguishes the two pairings', () => {
            expect(winnersOf(real).sort()).not.toEqual(winnersOf(wrong).sort());
        });

        test('expectedH2H pays the real week-5 winners', () => {
            const ms = make();
            SP.applyEngagement(ms, eng, { pinnedIds: ids, maxWeek: 6, scheduleWeeks: full });
            const paid = ms.filter(m => m.expH2H > 0).map(m => m.userId).sort();
            expect(paid).toEqual(winnersOf(real).sort());
        });

        test('the simulation plays the real week-5 matchups', () => {
            // A is out of the title race (-100); among B, C, D the one who
            // wins a matchup gets +3 — which depends on who plays A.
            const total = (id) => pts[id] + (winnersOf(real).includes(id) ? 3 : 0);
            const champ = ['b', 'c', 'd'].sort((x, y) => total(y) - total(x))[0];
            const odds = SP.simulateTitleOdds(make(), 50, { engagement: eng, pinnedIds: ids, maxWeek: 6, scheduleWeeks: full, postseasonSd: 0 });
            expect(odds[champ]).toBe(1);
        });
    });

    test('the simulation draws pointsIfLoss', () => {
        // A is certain to lose 2 on a penalised loss; B is certain to score 0.
        const a = { userId: 'a', postExpected: 0, perGame: [{ winProb: 0, pointsIfWin: 0, pointsIfLoss: -2 }] };
        const b = { userId: 'b', postExpected: 0, perGame: [] };
        expect(SP.simulateTitleOdds([a, b], 500, { postseasonSd: 0 }).b).toBe(1);
    });

    test('the weekly simulation draws pointsIfLoss and stops the Captain at captainMaxWeek', () => {
        const eng = { captainEnabled: true, captainMultiplier: 2 };
        // Week 19 (past the mode weeks): A's penalised loss must not be doubled.
        const a = { userId: 'a', postExpected: 0, byWeek: { 19: [{ teamId: 1, games: [{ winProb: 0, pointsIfWin: 0, pointsIfLoss: -2 }] }] } };
        const b = { userId: 'b', postExpected: -3, byWeek: { 19: [] } };
        // Undoubled A is -2 > B's -3; doubled A would be -4.
        expect(SP.simulateTitleOdds([a, b], 200, { engagement: eng, captainMaxWeek: 18, postseasonSd: 0 }).a).toBe(1);
        expect(SP.simulateTitleOdds([a, b], 200, { engagement: eng, postseasonSd: 0 }).a).toBe(0);
    });

    test('postSample replaces the normal draw', () => {
        // Equal forecasts; A's postseason is a lottery ticket, B's is fixed.
        const a = { userId: 'a', postExpected: 50, postRemaining: 50, perGame: [], postSample: () => (Math.random() < 0.25 ? 200 : 0) };
        const b = { userId: 'b', postExpected: 60, postRemaining: 50, perGame: [] };
        const odds = SP.simulateTitleOdds([a, b], 4000, { postseasonSd: 0 });
        expect(odds.a).toBeGreaterThan(0.2);
        expect(odds.a).toBeLessThan(0.3);
    });
});

describe('GET /standings/projections on a basketball league', () => {
    const HoopsGame = require('../models/hoopsGame');
    const HoopsTeam = require('../models/hoopsTeam');
    const Game = require('../models/game');
    const Team = require('../models/team');
    const Franchise = require('../models/franchise');
    const Account = require('../models/account');
    const League = require('../models/league');
    const SportSeason = require('../models/sportSeason');
    const ScoringConfig = require('../models/scoringConfig');
    const { scoreHoopsWeek } = require('../modules/hoops-scoring-pass');
    const seasons = require('../modules/active-season');
    const LEAGUE = 'hoops-league';
    const app = express();
    app.use('/standings', require('../routes/standings'));

    async function manager(name, ids, cum) {
        const a = await Account.create({ firstName: name, lastName: 'M', email: `${name}@example.invalid` });
        await Franchise.create({ accountId: a._id, league: LEAGUE, seasons: [{ season: SEASON, franchiseName: name, cumulativeScore: cum,
            teamRefs: ids.map(id => ({ id, sport: 'basketball' })) }] });
        return a;
    }

    beforeEach(async () => {
        await League.create({ code: LEAGUE, name: 'Hardwood Heroes', sport: 'basketball' });
        await SportSeason.create([{ sport: 'football', season: 2026, status: 'in-season' }, { sport: 'basketball', season: SEASON, status: 'in-season' }]);
        await seasons.prime();
        await HoopsTeam.create(ratings.map(t => Object.assign({ season: SEASON, abbreviation: t.school }, t)));
        await HoopsGame.create(schedule());
        // Football rows on the SAME ids, in the same season: if anything read
        // football, team 1 would carry a 12-game football schedule.
        await Team.create({ id: 1, school: 'Football One', mascot: 'M', abbreviation: 'F1', conference: 'SEC', color: '#000', logos: ['x'],
            location: { venue_id: 1, name: 'S', city: 'C', state: 'ST', zip: '0', latitude: 1, longitude: 1, capacity: 1, grass: true, dome: false } });
        await Game.create([1, 2, 3].map(w => ({ id: 900 + w, season: SEASON, week: w, seasonType: 'regular', startDate: '2099-01-01T00:00:00Z', startTimeTbd: false,
            neutralSite: false, conferenceGame: false, homeId: 1, homeTeam: 'Football One', awayId: 2, awayTeam: 'Football Two', completed: false })));
    });
    afterEach(() => { seasons._reset(); jest.restoreAllMocks(); });

    test('answers projected finish and title odds, with Captain and H2H on 18 weeks', async () => {
        await ScoringConfig.updateOne({ league: LEAGUE }, { $set: { league: LEAGUE,
            // A tie bonus of half the win bonus keeps every week worth exactly
            // 3 in total, whoever wins or ties.
            [`engagementBySeason.${SEASON}`]: { captainEnabled: true, captainMultiplier: 2, h2hEnabled: true, h2hWinBonus: 3, h2hTieBonus: 1.5 } } }, { upsert: true });
        const top = await manager('Top', [1], 30);
        await manager('Mid', [2], 120);
        const res = await request(app).get(`/standings/projections/${LEAGUE}/${SEASON}`);
        expect(res.status).toBe(200);
        expect(res.body.managers).toHaveLength(2);
        const t = res.body.managers.find(m => m.userId === String(top._id));
        expect(t.projectedRank).toBe(1);
        expect(t.banked).toBe(30);
        expect(t.titleOdds).toBeGreaterThan(60);
        expect(t.titleOdds).toBeLessThan(90);                   // March keeps it open (78 when written)
        expect(t.expCaptain).toBeGreaterThan(0);
        // 16 remaining H2H weeks (3..18), 3 points each: weeks 17-18 are in
        // range.
        const sum = res.body.managers.reduce((s, m) => s + m.expH2H, 0);
        expect(sum).toBeCloseTo(16 * 3, 0);
        // Only basketball's schedule: its own projection of team 1.
        const ctx = attachMarch(buildHoopsPoolContext(ratings, { ranks, cfg: resolveConfig(LEAGUE) }), ratings);
        const p = projectRemaining(ratings[0], schedule().filter(x => x.homeTeamId === 1), ctx);
        // (Rounded in three steps, and the engagement terms to 0.1.)
        expect(Math.abs(t.projectedFinal - (30 + p.regular + p.postseason + t.expCaptain + t.expH2H))).toBeLessThan(1.6);
    });

    test('H2H is projected on the real round robin: whole-season numbering, pinned order', async () => {
        const accts = [await manager('Top', [1], 0), await manager('Mid', [2], 0), await manager('Low', [4], 0)];
        // Pinned in an order that is NOT sorted, as a real pin can be.
        const pin = accts.map(a => String(a._id)).reverse();
        await ScoringConfig.updateOne({ league: LEAGUE }, { $set: { league: LEAGUE,
            [`engagementBySeason.${SEASON}`]: { captainEnabled: false, h2hEnabled: true, h2hWinBonus: 3, h2hTieBonus: 0 },
            [`h2hScheduleBySeason.${SEASON}`]: { ids: pin } } }, { upsert: true });
        const res = await request(app).get(`/standings/projections/${LEAGUE}/${SEASON}`);
        // The same managers, built here, under the real schedule and under
        // the remaining-weeks-only numbering the football path uses.
        const users = accts.map((a, i) => mgr(String(a._id), [[1], [2], [4]][i]));
        const build = (opts) => {
            const ms = buildHoopsProjections({ users, ratings, games: schedule(), field: null, ranks, cfg: resolveConfig(LEAGUE), season: SEASON, log: silent });
            SP.applyEngagement(ms, { h2hEnabled: true, h2hWinBonus: 3, h2hTieBonus: 0 }, Object.assign({ pinnedIds: pin, maxWeek: 18, h2hExact: true }, opts));
            const by = {};
            ms.forEach(m => { by[m.userId] = Math.round(m.expH2H * 10) / 10; });
            return by;
        };
        const real = build({ scheduleWeeks: Array.from({ length: 18 }, (_, i) => i + 1) });
        const shifted = build({});
        expect(real).not.toEqual(shifted);                     // the fixture can tell them apart
        res.body.managers.forEach(m => expect(m.expH2H).toBe(real[m.userId]));
    });

    test('the week under way: the projection agrees with the matchup card', async () => {
        // Dev's week 6 shape, cut to one week: Ann has banked a captained Q1
        // win (5, doubled to 10); Bo has one game left, captained. With the
        // tie bonus at half the win bonus, expH2H / 3 is exactly the card's
        // win probability (which splits ties evenly).
        await HoopsGame.deleteMany({});
        await HoopsGame.create([
            g(1, 1, 3, { status: 'final', startDate: new Date('2026-11-03T00:00:00Z') }),
            // A conference-tournament win the same week: scored, but not part
            // of the matchup (modeWeekBase) — on the card or in the projection.
            g(1, 1, 3, { status: 'final', conferenceGame: true, gameNotes: 'Big East Tournament - Quarterfinal', startDate: new Date('2026-11-04T00:00:00Z') }),
            g(1, 2, 3, { startDate: new Date('2099-01-01T00:00:00Z') }),
            g(1, 4, 3, { startDate: new Date('2099-01-01T00:00:00Z') })
        ]);
        await ScoringConfig.updateOne({ league: LEAGUE }, { $set: { league: LEAGUE,
            [`engagementBySeason.${SEASON}`]: { captainEnabled: true, captainMultiplier: 2, h2hEnabled: true, h2hWinBonus: 3, h2hTieBonus: 1.5 } } }, { upsert: true });
        const ann = await manager('Ann', [1], 0);
        // Bo captains team 4, his WORSE remaining team — so only the chosen
        // captain, not the best-expected one, reproduces the card.
        const bo = await manager('Bo', [2, 4], 0);
        await Franchise.updateOne({ accountId: ann._id }, { $set: { 'seasons.0.captains': [{ week: 1, teamId: 1 }] } });
        await Franchise.updateOne({ accountId: bo._id }, { $set: { 'seasons.0.captains': [{ week: 1, teamId: 4 }] } });
        await scoreHoopsWeek(LEAGUE, { season: SEASON, week: 1 });

        const card = (await request(app).get(`/standings/h2h/${LEAGUE}/${SEASON}`)).body.schedule.find(w => w.week === 1).games[0];
        const cardAnn = card.aId === String(ann._id) ? card.winP.a : card.winP.b;
        const proj = (await request(app).get(`/standings/projections/${LEAGUE}/${SEASON}`)).body.managers;
        const projAnn = proj.find(m => m.userId === String(ann._id)).expH2H / 3 * 100;
        expect(cardAnn).toBeGreaterThan(55);                       // Ann leads: not a coin flip
        expect(cardAnn).toBeLessThan(100);
        expect(Math.abs(projAnn - cardAnn)).toBeLessThan(2);       // rounding only
    });

    test('no pin yet: the round robin runs on the SORTED ids, as the real pass derives them', async () => {
        // Accounts first (ascending ids), franchises in REVERSE, so the
        // managers come back in an order that is not the sorted one.
        const accts = [];
        for (const n of ['A1', 'A2', 'A3']) accts.push(await Account.create({ firstName: n, lastName: 'M', email: `${n}@example.invalid` }));
        const rosters = { A1: [1], A2: [2], A3: [4] };
        for (const a of accts.slice().reverse()) {
            await Franchise.create({ accountId: a._id, league: LEAGUE, seasons: [{ season: SEASON, franchiseName: a.firstName, cumulativeScore: 0,
                teamRefs: rosters[a.firstName].map(id => ({ id, sport: 'basketball' })) }] });
        }
        await ScoringConfig.updateOne({ league: LEAGUE }, { $set: { league: LEAGUE,
            [`engagementBySeason.${SEASON}`]: { captainEnabled: false, h2hEnabled: true, h2hWinBonus: 3, h2hTieBonus: 0 } } }, { upsert: true });
        const res = await request(app).get(`/standings/projections/${LEAGUE}/${SEASON}`);
        const users = accts.map(a => mgr(String(a._id), rosters[a.firstName]));
        const build = (order) => {
            const ms = buildHoopsProjections({ users, ratings, games: schedule(), field: null, ranks, cfg: resolveConfig(LEAGUE), season: SEASON, log: silent });
            SP.applyEngagement(ms, { h2hEnabled: true, h2hWinBonus: 3, h2hTieBonus: 0 },
                { pinnedIds: order, maxWeek: 18, h2hExact: true, scheduleWeeks: Array.from({ length: 18 }, (_, i) => i + 1) });
            const by = {};
            ms.forEach(m => { by[m.userId] = Math.round(m.expH2H * 10) / 10; });
            return by;
        };
        const ids = accts.map(a => String(a._id));
        const sorted = build(ids.slice().sort());
        expect(build(ids.slice().reverse())).not.toEqual(sorted);   // the fixture can tell them apart
        res.body.managers.forEach(m => expect(m.expH2H).toBe(sorted[m.userId]));
    });

    test('the projection is cached for 60 s per league + season', async () => {
        const router = require('../routes/standings');
        router.projectionCache.enabled = true;
        router.projectionCache.entries.clear();
        try {
            await manager('Top', [1], 30);
            const first = (await request(app).get(`/standings/projections/${LEAGUE}/${SEASON}`)).body.managers[0].banked;
            await Franchise.updateMany({}, { $set: { 'seasons.0.cumulativeScore': 99 } });
            expect((await request(app).get(`/standings/projections/${LEAGUE}/${SEASON}`)).body.managers[0].banked).toBe(first);
            // 61 s later it is recomputed.
            const now = Date.now();
            jest.spyOn(Date, 'now').mockReturnValue(now + 61 * 1000);
            expect((await request(app).get(`/standings/projections/${LEAGUE}/${SEASON}`)).body.managers[0].banked).toBe(99);
        } finally {
            router.projectionCache.enabled = false;
            router.projectionCache.entries.clear();
        }
    });

    test('a league with nothing left to play answers no managers', async () => {
        await HoopsGame.updateMany({}, { $set: { status: 'final', homePoints: 80, awayPoints: 70 } });
        // A whole NCAA field without team 1 (a 32-game round of 64), so it is out.
        await HoopsGame.create(Array.from({ length: 32 }, (_, i) => ({ id: 5000 + i, season: SEASON, week: 20, seasonType: 'postseason',
            tournament: 'NCAA', status: 'final', startDate: new Date('2027-03-20'), gameNotes: "NCAA Men's Basketball Championship - East - 1st Round",
            homeTeamId: 100 + 2 * i, awayTeamId: 101 + 2 * i, homePoints: 70, awayPoints: 60 })));
        await manager('Top', [1], 30);
        const res = await request(app).get(`/standings/projections/${LEAGUE}/${SEASON}`);
        expect(res.body.managers).toEqual([]);
    });
});
