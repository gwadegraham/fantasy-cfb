// The commissioner Captain Override (PATCH /users/:id/captain) on a
// basketball league (#569), and the week list its card offers.
//
// One ACCOUNT holding two franchises with separate ids: football (2026),
// created FIRST, and basketball (2027). Football first is what makes an
// unscoped load wrong here — Franchise.findOne({ accountId }) hands back the
// football document, and a basketball override would land on it.
//
// The Admin views their own football league, as an Admin usually does; the
// card names the basketball league in the body.

jest.mock('web-push', () => ({ setVapidDetails: jest.fn(), sendNotification: jest.fn() }));

const express = require('express');
const request = require('supertest');
const { useMongo } = require('./helpers/mongo');
const Account = require('../models/account');
const Franchise = require('../models/franchise');
const League = require('../models/league');
const SportSeason = require('../models/sportSeason');
const HoopsGame = require('../models/hoopsGame');
const HoopsTeam = require('../models/hoopsTeam');
const AuditLog = require('../models/auditLog');
const seasons = require('../modules/active-season');
const usersRouter = require('../routes/users');

useMongo();

const HOOPS = 'hoops-league';
const FOOTBALL = 'graham-league';
const HOOPS_SEASON = 2027;
const FOOTBALL_SEASON = 2026;

// Week 1 has tipped off: the self-serve lock is closed. Week 2 has not.
const PAST = '2020-01-07T00:00:00.000Z';
const FUTURE = '2099-11-06T00:30:00.000Z';

let gid = 700;
const hg = (week, homeId, startDate) => ({
    id: ++gid, season: HOOPS_SEASON, week, seasonType: 'regular', status: 'scheduled',
    startDate, startTimeTbd: false, homeTeamId: homeId, awayTeamId: 90, homeTeam: `Team ${homeId}`, awayTeam: 'Opp'
});

function footballTeam(id, school) {
    return { id, school, mascot: 'M', abbreviation: 'GRD', conference: 'SEC', color: '#000', logos: ['x.png'],
        location: { venue_id: id, name: 'S', city: 'C', state: 'ST', zip: '0', latitude: 1, longitude: 1, capacity: 1, grass: true, dome: false } };
}

let account, football, hoops;

function appAs(roles, league = 'gg') {
    const app = express();
    app.use(express.json());
    app.use((req, res, next) => {
        req.oidc = { isAuthenticated: () => true, user: { user_metadata: { roles, metadata: { league } } } };
        next();
    });
    app.use('/users', usersRouter);
    return app;
}
const admin = () => appAs(['Admin']);
const override = (body, viewing = FOOTBALL) => request(admin())
    .patch(`/users/${account._id}/captain`).set('Cookie', `cc_league=${viewing}`).send(body);
const hoopsDoc = () => Franchise.findById(hoops._id).lean();
const footballDoc = () => Franchise.findById(football._id).lean();

beforeEach(async () => {
    await League.create([
        { code: FOOTBALL, name: 'Graham League', sport: 'football' },
        { code: HOOPS, name: 'Hardwood Heroes', sport: 'basketball' }
    ]);
    await SportSeason.create([
        { sport: 'football', season: FOOTBALL_SEASON, status: 'in-season' },
        { sport: 'basketball', season: HOOPS_SEASON, status: 'in-season' }
    ]);
    await seasons.prime();

    account = await Account.create({ firstName: 'Ann', lastName: 'Two', email: 'ann@example.invalid' });
    // Football FIRST — see the header. Team 1 is a football id too.
    football = await Franchise.create({ accountId: account._id, league: FOOTBALL,
        seasons: [{ season: FOOTBALL_SEASON, teams: [footballTeam(1, 'Football One'), footballTeam(7, 'Gridiron')] }] });
    hoops = await Franchise.create({ accountId: account._id, league: HOOPS,
        seasons: [{ season: HOOPS_SEASON, teamRefs: [{ id: 1, sport: 'basketball' }, { id: 2, sport: 'basketball' }] }] });

    await HoopsTeam.create([
        { id: 1, season: HOOPS_SEASON, school: 'Hoops One' },
        { id: 2, season: HOOPS_SEASON, school: 'Hoops Two' },
        { id: 90, season: HOOPS_SEASON, school: 'Opponent' }
    ]);
    await HoopsGame.create([hg(1, 1, PAST), hg(1, 2, PAST), hg(2, 1, FUTURE), hg(2, 2, FUTURE)]);
    jest.spyOn(console, 'log').mockImplementation(() => {});
});
afterEach(() => { seasons._reset(); jest.restoreAllMocks(); });

describe('PATCH /users/:id/captain on a basketball league', () => {
    test("lands on the BASKETBALL franchise, in the league's own season, past the tip-off lock", async () => {
        // No season sent: football's would be 2026, which this franchise
        // does not have. Week 1 has tipped off, which the override skips.
        const res = await override({ league: HOOPS, week: 1, teamId: 2 });
        expect(res.status).toBe(200);
        expect(res.body).toMatchObject({ userId: String(account._id), season: HOOPS_SEASON, week: 1, teamId: 2 });

        expect((await hoopsDoc()).seasons[0].captains.map(c => [c.week, c.teamId])).toEqual([[1, 2]]);
        expect((await footballDoc()).seasons[0].captains).toBeUndefined();
    });

    test('is audited as captain.set, naming the basketball team, as an admin override', async () => {
        await override({ league: HOOPS, week: 2, teamId: 1 });
        await override({ league: HOOPS, week: 2, teamId: 2 });
        const rows = await AuditLog.find({ action: 'captain.set' }).sort({ _id: 1 }).lean();
        expect(rows).toHaveLength(2);
        expect(rows[1]).toMatchObject({ league: HOOPS, season: String(HOOPS_SEASON) });
        // Basketball's names, not football's team 1.
        expect(rows[1].summary).toBe('Ann Two set Week 2 captain: Hoops Two (was Hoops One) · admin override');
        expect(rows[1].meta).toMatchObject({ via: 'admin', week: 2, teamId: 2, prevTeamId: 1 });
    });

    test("weeks are basketball's mode weeks, not football's 1–16", async () => {
        const res = await override({ league: HOOPS, week: 3, teamId: 1 });
        expect(res.status).toBe(400);
        expect(res.body.message).toMatch(/weeks 1–2/);
        expect((await hoopsDoc()).seasons[0].captains).toBeUndefined();
    });

    test('a team off the basketball roster is refused, even one on the football roster', async () => {
        const res = await override({ league: HOOPS, week: 2, teamId: 7 });
        expect(res.status).toBe(400);
        expect(res.body.message).toBe('That team is not on their roster.');
    });

    test("replaces this week's frozen default, and keeps another week's", async () => {
        await Franchise.updateOne({ _id: hoops._id }, { $set: { 'seasons.0.captains': [
            { week: 1, teamId: 1, auto: true }, { week: 2, teamId: 1, auto: true }
        ] } });
        expect((await override({ league: HOOPS, week: 1, teamId: 2 })).status).toBe(200);
        const caps = (await hoopsDoc()).seasons[0].captains.map(c => [c.week, c.teamId, !!c.auto]).sort();
        expect(caps).toEqual([[1, 2, false], [2, 1, true]]);
        // A default was not the manager's pick.
        const row = await AuditLog.findOne({ action: 'captain.set' }).lean();
        expect(row.meta.prevTeamId).toBeNull();
    });

    test('clears a pick', async () => {
        await override({ league: HOOPS, week: 2, teamId: 1 });
        expect((await override({ league: HOOPS, week: 2, teamId: null })).status).toBe(200);
        expect((await hoopsDoc()).seasons[0].captains).toEqual([]);
    });

    test('with no league sent, the viewed basketball league decides', async () => {
        const res = await override({ week: 2, teamId: 1 }, HOOPS);
        expect(res.status).toBe(200);
        expect((await hoopsDoc()).seasons[0].captains.map(c => c.teamId)).toEqual([1]);
        expect((await footballDoc()).seasons[0].captains).toBeUndefined();
    });

    test('football, named in the body, still takes the football path', async () => {
        const res = await override({ league: FOOTBALL, week: 16, teamId: 7 }, HOOPS);
        expect(res.status).toBe(200);
        expect(res.body.season).toBe(FOOTBALL_SEASON);
        expect((await footballDoc()).seasons[0].captains.map(c => [c.week, c.teamId])).toEqual([[16, 7]]);
        expect((await hoopsDoc()).seasons[0].captains).toBeUndefined();
    });

    test("a league named in the body that the manager isn't in is refused, not swapped for another", async () => {
        await Franchise.deleteOne({ _id: hoops._id });
        const res = await override({ league: HOOPS, week: 2, teamId: 7 });
        expect(res.status).toBe(404);
        expect((await footballDoc()).seasons[0].captains).toBeUndefined();
    });

    test('Admin only — a League Manager is refused', async () => {
        const res = await request(appAs(['League Manager'])).patch(`/users/${account._id}/captain`)
            .send({ league: HOOPS, week: 2, teamId: 1 });
        expect(res.status).toBe(403);
    });
});

describe('GET /users/league/:league/captain-weeks', () => {
    test('basketball: the mode weeks of its own season', async () => {
        const res = await request(admin()).get(`/users/league/${HOOPS}/captain-weeks`);
        expect(res.status).toBe(200);
        expect(res.body).toEqual({ league: HOOPS, sport: 'basketball', season: HOOPS_SEASON, weeks: [1, 2] });
    });

    test('football: 1–16', async () => {
        const res = await request(admin()).get(`/users/league/${FOOTBALL}/captain-weeks`);
        expect(res.body.sport).toBe('football');
        expect(res.body.weeks).toEqual(Array.from({ length: 16 }, (_, i) => i + 1));
    });

    test("viewing a league is not authority over it: a football League Manager can't read basketball's", async () => {
        const res = await request(appAs(['League Manager'], 'gg')).get(`/users/league/${HOOPS}/captain-weeks`)
            .set('Cookie', `cc_league=${HOOPS}`);
        expect(res.status).toBe(403);
    });
});
