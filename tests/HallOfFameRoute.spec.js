// GET /history/:league is sport-aware (#562).
//
// The route used to judge every league's seasons against football's active
// season. Basketball names a season by its ENDING year and plays it while
// football's is live, so its first season (2027, i.e. 2026–27) would have stayed
// "in progress" until football rolled to 2028 — a year after it wrapped.
//
// No finished basketball season exists in any database yet, so these seed one.

const express = require('express');
const request = require('supertest');
const { useMongo } = require('./helpers/mongo');
const Account = require('../models/account');
const Franchise = require('../models/franchise');
const League = require('../models/league');
const SportSeason = require('../models/sportSeason');
const HoopsTeam = require('../models/hoopsTeam');
const Draft = require('../models/draft');
const seasons = require('../modules/active-season');

useMongo();

const HOOPS = 'hoops-league';
const FOOTBALL = 'graham-league';

function app() {
    const a = express();
    a.use('/history', require('../routes/history'));
    return a;
}

const hoopsTeam = (id, school) => ({ id, season: 2027, school, mascot: 'M', abbreviation: school.slice(0, 3).toUpperCase(),
    conference: 'ACC', color: '#000', logos: [] });
const ref = (id) => ({ id, sport: 'basketball' });
const row = (teamId, score, extra) => Object.assign({ teamId, gameId: teamId * 100 + score, score }, extra || {});

async function hoopsManager(first, total, weeks) {
    const a = await Account.create({ firstName: first, lastName: 'Test', email: `${first}@example.invalid` });
    await Franchise.create({ accountId: a._id, league: HOOPS,
        seasons: [{ season: 2027, teamRefs: [ref(150), ref(2)], cumulativeScore: total, weeklyScore: weeks }] });
    return a;
}

async function seed({ hoopsStatus = 'in-season', hoopsSeason = 2027, withHoopsRow = true } = {}) {
    await League.create({ code: HOOPS, name: 'Hardwood', sport: 'basketball' });
    await League.create({ code: FOOTBALL, name: 'Graham League', sport: 'football' });
    // Football is on 2026 — the October 2026 state, and the one the old
    // code compared basketball's 2027 against.
    await SportSeason.create({ sport: 'football', season: 2026, status: 'in-season' });
    if (withHoopsRow) await SportSeason.create({ sport: 'basketball', season: hoopsSeason, status: hoopsStatus });
    await HoopsTeam.create([hoopsTeam(150, 'Duke'), hoopsTeam(2, 'Auburn')]);
    // Week 18 is late February — regular season. Football's rules would file
    // it in the postseason bucket (week > 16), so it is what tells the two
    // rule sets apart.
    const ann = await hoopsManager('Ann', 39, [
        { week: 3, score: 12, scoreByTeam: [row(150, 7), row(2, 5)] },
        { week: 18, score: 9, scoreByTeam: [row(150, 9)] },
        { week: 21, score: 18, scoreByTeam: [row(150, 18, { noModes: true })] }
    ]);
    const bob = await hoopsManager('Bob', 20, [{ week: 3, score: 20, scoreByTeam: [row(2, 20)] }]);
    await Draft.create({ league: HOOPS, season: 2027, picks: [
        { round: 1, overall: 1, userId: bob._id, team: { id: 2, school: 'Auburn' } },
        { round: 1, overall: 2, userId: ann._id, team: { id: 150, school: 'Duke' } }
    ] });
    await seasons.prime();
}

beforeEach(() => { jest.spyOn(console, 'error').mockImplementation(() => {}); });
afterEach(() => { jest.restoreAllMocks(); seasons._reset(); });

describe('GET /history/:league for a basketball league', () => {
    test('the season being played is not crowned, and the response says which it is', async () => {
        await seed({ hoopsStatus: 'in-season' });
        const res = await request(app()).get('/history/' + HOOPS);
        expect(res.status).toBe(200);
        expect(res.body.sport).toBe('basketball');
        expect(res.body.activeSeason).toBe(2027);
        expect(res.body.seasons).toEqual([]);
        expect(res.body.managers).toEqual([]);
        expect(res.body.records).toEqual([]);
        expect(res.body.draftHistory).toEqual([]);
    });

    // Football is still on 2026 here: judged against it, 2027 is "the future".
    test('a completed basketball season is crowned while football is mid-season', async () => {
        await seed({ hoopsStatus: 'complete' });
        const res = await request(app()).get('/history/' + HOOPS);
        expect(res.body.seasons.map(s => s.season)).toEqual([2027]);
        expect(res.body.seasons[0].champion.name).toBe('Ann Test');
        expect(res.body.managers.map(m => m.name)).toEqual(['Ann Test', 'Bob Test']);
    });

    test('a past basketball season is finished once the sport rolls over', async () => {
        await seed({ hoopsSeason: 2028, hoopsStatus: 'preseason' });
        const res = await request(app()).get('/history/' + HOOPS);
        expect(res.body.seasons.map(s => s.season)).toEqual([2027]);
    });

    test('records and the draft retrospective read schools off the teamRefs roster', async () => {
        await seed({ hoopsStatus: 'complete' });
        const res = await request(app()).get('/history/' + HOOPS);
        const rec = (k) => res.body.records.find(r => r.key === k);
        expect(rec('bestTeamSeason').detail).toBe('Duke');
        expect(rec('bestTeamGame').detail).toBe('Auburn · Week 3');
        expect(rec('bestPostseason').value).toBe(18);
        expect(rec('bestPostseason').detail).toBe('1 game');
        expect(rec('bestSeason').breakdown.rows.map(r => r.label)).toEqual(['Duke', 'Auburn']);
        expect(res.body.draftHistory[0].season).toBe(2027);
        expect(res.body.draftHistory[0].firstOverall.team).toBe('Auburn');
        expect(res.body.draftHistory[0].firstOverall.points).toBe(20);
    });

    test('a basketball league whose sport has no season yet is an empty page, not an error', async () => {
        await seed({ withHoopsRow: false });
        const res = await request(app()).get('/history/' + HOOPS);
        expect(res.status).toBe(200);
        expect(res.body.activeSeason).toBeNull();
        expect(res.body.seasons).toEqual([]);
    });
});

describe('GET /history/:league for a football league', () => {
    test('still judged against football, and labelled as football', async () => {
        await seed({ hoopsStatus: 'complete' });
        const a = await Account.create({ firstName: 'Cal', lastName: 'Test', email: 'cal@example.invalid' });
        await Franchise.create({ accountId: a._id, league: FOOTBALL, seasons: [
            { season: 2025, cumulativeScore: 90, weeklyScore: [{ week: 1, score: 90, scoreByTeam: [] }] },
            { season: 2026, cumulativeScore: 40, weeklyScore: [{ week: 1, score: 40, scoreByTeam: [] }] }
        ] });
        const res = await request(app()).get('/history/' + FOOTBALL);
        expect(res.body.sport).toBe('football');
        expect(res.body.activeSeason).toBe(2026);
        expect(res.body.seasons.map(s => s.season)).toEqual([2025]);
    });
});
