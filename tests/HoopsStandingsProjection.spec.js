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
        startDate: new Date(Date.UTC(2026, 10, 3 + week * 7 + (gid % 5))),
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
        const field = postseasonState.ncaaField([{ tournament: 'NCAA', homeTeamId: 3, awayTeamId: 4 }]);
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
            [`engagementBySeason.${SEASON}`]: { captainEnabled: true, captainMultiplier: 2, h2hEnabled: true, h2hWinBonus: 3, h2hTieBonus: 0 } } }, { upsert: true });
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
        // 16 remaining H2H weeks (3..18) at +3: Top is favoured in most, and
        // weeks 17-18 are in range. Zero-sum across the two.
        const sum = res.body.managers.reduce((s, m) => s + m.expH2H, 0);
        expect(sum).toBeCloseTo(16 * 3, 0);
        // Only basketball's schedule: its own projection of team 1.
        const ctx = attachMarch(buildHoopsPoolContext(ratings, { ranks, cfg: resolveConfig(LEAGUE) }), ratings);
        const p = projectRemaining(ratings[0], schedule().filter(x => x.homeTeamId === 1), ctx);
        // (Rounded in three steps, and the engagement terms to 0.1.)
        expect(Math.abs(t.projectedFinal - (30 + p.regular + p.postseason + t.expCaptain + t.expH2H))).toBeLessThan(1.6);
    });

    test('a league with nothing left to play answers no managers', async () => {
        await HoopsGame.updateMany({}, { $set: { status: 'final', homePoints: 80, awayPoints: 70 } });
        await HoopsGame.create({ id: 5000, season: SEASON, week: 20, seasonType: 'postseason', tournament: 'NCAA', status: 'final', startDate: new Date('2027-04-05'),
            gameNotes: "NCAA Men's Basketball Championship - National Championship", homeTeamId: 3, awayTeamId: 4, homePoints: 70, awayPoints: 60 });
        await manager('Top', [1], 30);
        const res = await request(app).get(`/standings/projections/${LEAGUE}/${SEASON}`);
        expect(res.body.managers).toEqual([]);
    });
});
