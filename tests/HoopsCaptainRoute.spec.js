// GET/PATCH /users/me/captain on a basketball league.
//
// The manager here plays BOTH sports — one account, a football franchise and
// a basketball franchise — because that is the case an unscoped read gets
// wrong: Franchise.findOne({ accountId }) hands back whichever Mongo finds
// first. The league comes from the viewer's selection (the cc_league cookie),
// as GET /users/:id reads it.
//
// The football franchise rosters team 1 too, and a football game exists for
// team 1 in week 1 of "2027": 130 basketball ids are also football ids, so a
// lock read from `games` would be real and wrong rather than empty.

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
const Game = require('../models/game');
const AuditLog = require('../models/auditLog');
const seasons = require('../modules/active-season');
const usersRouter = require('../routes/users');

useMongo();

const HOOPS = 'hoops-league';
const FOOTBALL = 'graham-league';
const SEASON = 2027;

// Week 1 is far in the future, so it never locks under the test's clock.
// Team 1's Tuesday game is TBD; team 2's Thursday game is firm.
const TUE_TBD = '2099-11-03T05:00:00.000Z';
const THU_FIRM = '2099-11-06T00:30:00.000Z';
// Week 2 is in the past: locked.
const PAST = '2020-01-07T00:00:00.000Z';

let gid = 500;
const hg = (week, homeId, startDate, o = {}) => Object.assign({
    id: ++gid, season: SEASON, week, seasonType: 'regular', status: 'scheduled',
    startDate, startTimeTbd: false, homeTeamId: homeId, awayTeamId: 90, homeTeam: `Team ${homeId}`, awayTeam: 'Opp'
}, o);

function footballTeam(id, school) {
    return { id, school, mascot: 'M', abbreviation: 'GRD', conference: 'SEC', color: '#000', logos: ['x.png'],
        location: { venue_id: id, name: 'S', city: 'C', state: 'ST', zip: '0', latitude: 1, longitude: 1, capacity: 1, grass: true, dome: false } };
}

let account, app;
const cookie = (league) => `cc_league=${league}`;

beforeEach(async () => {
    await League.create([
        { code: HOOPS, name: 'Hardwood Heroes', sport: 'basketball' },
        { code: FOOTBALL, name: 'Graham League', sport: 'football' }
    ]);
    await SportSeason.create([
        { sport: 'football', season: 2026, status: 'in-season' },
        { sport: 'basketball', season: SEASON, status: 'in-season' }
    ]);
    await seasons.prime();

    account = await Account.create({ firstName: 'Ann', lastName: 'Two', email: 'ann@example.invalid' });
    await Franchise.create([
        { accountId: account._id, league: HOOPS, seasons: [{ season: SEASON, teamRefs: [{ id: 1, sport: 'basketball' }, { id: 2, sport: 'basketball' }] }] },
        { accountId: account._id, league: FOOTBALL, seasons: [{ season: SEASON, teams: [] }, { season: 2026, teams: [footballTeam(7, 'Gridiron')] }] }
    ]);
    await HoopsTeam.create([
        { id: 1, season: SEASON, school: 'Hoops One' },
        { id: 2, season: SEASON, school: 'Hoops Two' },
        { id: 90, season: SEASON, school: 'Opponent', abbreviation: 'OPP', preseason: { rank: 10 } }
    ]);
    await HoopsGame.create([
        hg(1, 1, TUE_TBD, { startTimeTbd: true }),
        hg(1, 2, THU_FIRM),
        hg(2, 1, PAST),
        // A conference tournament game in week 1 — not a mode game, so it
        // neither sets the lock nor appears on the slate.
        hg(1, 2, '2099-11-02T05:00:00.000Z', { conferenceGame: true, gameNotes: 'Big East Tournament - 1st Round' })
    ]);
    // The football franchise's own 2026 week 3, far in the future.
    await Game.create({ id: 2, season: 2026, week: 3, seasonType: 'regular', startDate: '2099-09-19T19:30:00Z',
        startTimeTbd: false, neutralSite: false, conferenceGame: false,
        homeId: 7, homeTeam: 'Gridiron', awayId: 8, awayTeam: 'Other', completed: false });
    await Game.create({ id: 1, season: SEASON, week: 1, seasonType: 'regular', startDate: '2020-01-01T00:00:00Z',
        startTimeTbd: false, neutralSite: false, conferenceGame: false,
        homeId: 1, homeTeam: 'Football One', awayId: 3, awayTeam: 'Football Three', completed: true });

    app = express();
    app.use(express.json());
    app.use((req, res, next) => {
        req.oidc = { isAuthenticated: () => true, user: { user_metadata: { roles: [], metadata: { league: 'gg', userId: String(account._id) } } } };
        next();
    });
    app.use('/users', usersRouter);
    jest.spyOn(console, 'log').mockImplementation(() => {});
});
afterEach(() => { seasons._reset(); jest.restoreAllMocks(); });

describe('GET /users/me/captain on a basketball league', () => {
    test("the week's lock is the first tip-off, a TBD one included", async () => {
        const res = await request(app).get('/users/me/captain').set('Cookie', cookie(HOOPS));
        expect(res.status).toBe(200);
        expect(res.body).toMatchObject({ sport: 'basketball', season: SEASON, week: 1, locked: false, teamId: null });
        // Football's rule would skip the TBD Tuesday for the firm Thursday.
        expect(res.body.lockAt).toBe(TUE_TBD);
        expect(res.body.lockTeamIds).toEqual([1]);
        const one = res.body.slate.find(s => s.teamId === 1);
        expect(one.games).toHaveLength(1);
        expect(one.games[0]).toMatchObject({ opp: 'OPP', ha: 'vs', kickoff: null, day: TUE_TBD, oppRank: 10 });
        // The conference tournament game is not on team 2's slate.
        expect(res.body.slate.find(s => s.teamId === 2).games).toHaveLength(1);
    });

    test('a football selection still gets the football picker', async () => {
        const res = await request(app).get('/users/me/captain?season=2026').set('Cookie', cookie(FOOTBALL));
        expect(res.status).toBe(200);
        expect(res.body.sport).toBeUndefined();
        // The FOOTBALL franchise's week — the basketball one has no 2026.
        expect(res.body.week).toBe(3);
        expect(res.body.slate.map(s => s.teamId)).toEqual([7]);
    });

    test('a football pick lands on the football franchise', async () => {
        const res = await request(app).patch('/users/me/captain').set('Cookie', cookie(FOOTBALL))
            .send({ season: 2026, week: 3, teamId: 7 });
        expect(res.status).toBe(200);
        const football = await Franchise.findOne({ accountId: account._id, league: FOOTBALL }).lean();
        expect(football.seasons.find(s => s.season === 2026).captains.map(c => c.teamId)).toEqual([7]);
        const hoops = await Franchise.findOne({ accountId: account._id, league: HOOPS }).lean();
        expect(hoops.seasons[0].captains).toBeUndefined();
    });
});

describe('PATCH /users/me/captain on a basketball league', () => {
    const patch = (body) => request(app).patch('/users/me/captain').set('Cookie', cookie(HOOPS)).send(body);

    test('saves the pick on the BASKETBALL franchise', async () => {
        const res = await patch({ week: 1, teamId: 2 });
        expect(res.status).toBe(200);
        const hoops = await Franchise.findOne({ accountId: account._id, league: HOOPS }).lean();
        expect(hoops.seasons[0].captains).toEqual([{ week: 1, teamId: 2, _id: expect.anything() }]);
        const football = await Franchise.findOne({ accountId: account._id, league: FOOTBALL }).lean();
        expect(football.seasons[0].captains).toBeUndefined();
        const row = await AuditLog.findOne({ action: 'captain.set' }).lean();
        expect(row.summary).toContain('Hoops Two');

        const after = await request(app).get('/users/me/captain').set('Cookie', cookie(HOOPS));
        expect(after.body.teamId).toBe(2);
    });

    test('refuses once the first tip-off has passed, and records the attempt', async () => {
        const res = await patch({ week: 2, teamId: 1 });
        expect(res.status).toBe(409);
        expect(await AuditLog.countDocuments({ action: 'captain.locked' })).toBe(1);
    });

    test('a team that is not on the basketball roster is refused', async () => {
        expect((await patch({ week: 1, teamId: 90 })).status).toBe(400);
    });

    test('a week outside the regular season is refused', async () => {
        const res = await patch({ week: 9, teamId: 1 });
        expect(res.status).toBe(400);
        expect(res.body.message).toMatch(/weeks 1–2/);
    });

    test('a frozen default shows as a default, and a pick before the lock replaces it', async () => {
        await Franchise.updateOne({ accountId: account._id, league: HOOPS },
            { $set: { 'seasons.0.captains': [{ week: 1, teamId: 1, auto: true }] } });
        const shown = await request(app).get('/users/me/captain').set('Cookie', cookie(HOOPS));
        expect(shown.body).toMatchObject({ week: 1, teamId: null, autoTeamId: 1 });

        expect((await patch({ week: 1, teamId: 2 })).status).toBe(200);
        const hoops = await Franchise.findOne({ accountId: account._id, league: HOOPS }).lean();
        expect(hoops.seasons[0].captains.map(c => [c.week, c.teamId, !!c.auto])).toEqual([[1, 2, false]]);
        // The audit names no previous pick: a default was not their choice.
        const row = await AuditLog.findOne({ action: 'captain.set' }).lean();
        expect(row.summary).not.toContain('(was');
    });

    test('clearing a pick', async () => {
        await patch({ week: 1, teamId: 2 });
        expect((await patch({ week: 1, teamId: null })).status).toBe(200);
        const hoops = await Franchise.findOne({ accountId: account._id, league: HOOPS }).lean();
        expect(hoops.seasons[0].captains).toEqual([]);
    });
});

describe('the week being played, once the picker has moved on', () => {
    const { captainState } = require('../modules/hoops-captain');

    test('reports what is riding on it, pick or default', async () => {
        // Weeks run back to back, so the picker offers the next week as soon
        // as this one locks — and says what this one is carrying.
        await HoopsGame.deleteMany({});
        await HoopsGame.create([
            hg(1, 1, '2026-11-03T05:00:00.000Z', { startTimeTbd: true }),
            hg(1, 2, '2026-11-06T00:30:00.000Z'),
            hg(2, 1, '2026-11-10T00:30:00.000Z')
        ]);
        const now = Date.parse('2026-11-04T12:00:00Z');
        const out = await captainState({ userId: account._id, league: HOOPS, season: SEASON, nowMs: now });
        expect(out.body).toMatchObject({ week: 2, locked: false });
        expect(out.body.current).toEqual({ week: 1, teamId: null, autoTeamId: 1 });

        await Franchise.updateOne({ accountId: account._id, league: HOOPS },
            { $set: { 'seasons.0.captains': [{ week: 1, teamId: 2 }] } });
        const picked = await captainState({ userId: account._id, league: HOOPS, season: SEASON, nowMs: now });
        expect(picked.body.current).toEqual({ week: 1, teamId: 2, autoTeamId: null });
    });

    test('after the last week locks, that week is shown locked', async () => {
        await HoopsGame.deleteMany({});
        await HoopsGame.create([hg(1, 1, '2026-11-03T05:00:00.000Z', { startTimeTbd: true })]);
        const out = await captainState({ userId: account._id, league: HOOPS, season: SEASON, nowMs: Date.parse('2026-11-03T12:00:00Z') });
        expect(out.body).toMatchObject({ week: 1, locked: true });
        expect(out.body.current).toBeUndefined();
    });

    test('season over, or no roster: nothing to show', async () => {
        const over = await captainState({ userId: account._id, league: HOOPS, season: SEASON, nowMs: Date.parse('2100-01-01') });
        expect(over.body.week).toBeNull();
        const none = await captainState({ userId: account._id, league: HOOPS, season: 2030 });
        expect(none.body.week).toBeNull();
        const nobody = await captainState({ userId: '64f539d45cf0433f3b6a6a1e', league: HOOPS, season: SEASON });
        expect(nobody.status).toBe(404);
    });
});
