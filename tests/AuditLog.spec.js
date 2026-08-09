// Commissioner audit trail.
//
// Scheduled jobs already leave a record; commissioner actions didn't — and
// several of them quietly rewrite history (a roster correction edits the draft
// record, a season-membership toggle drops a year's scores). These cover that
// the trail is written, scoped to who may see it, and — the important part —
// that a failing audit write can never take the action down with it.

process.env.YEAR = '2026';
process.env.INTERNAL_API_TOKEN = 'test-internal-token';

const express = require('express');
const request = require('supertest');
const { useMongo } = require('./helpers/mongo');
const AuditLog = require('../models/auditLog');
const User = require('../models/user');
const Team = require('../models/team');
const League = require('../models/league');
const audit = require('../modules/audit-log');
const usersRouter = require('../routes/users');
const leaguesRouter = require('../routes/leagues');
const auditRouter = require('../routes/auditLog');

// A session-bearing app, so entries record a real actor.
function appAs(roles, oidcUser) {
    const a = express();
    a.use(express.json());
    if (roles) {
        a.use((req, res, next) => {
            req.oidc = {
                isAuthenticated: () => true,
                user: Object.assign({ name: 'Dana Commish', email: 'dana@example.com', user_metadata: { roles } }, oidcUser || {})
            };
            next();
        });
    }
    a.use('/users', usersRouter);
    a.use('/leagues', leaguesRouter);
    a.use('/audit-log', auditRouter);
    return a;
}
const adminApp = appAs(['Admin']);
const tokenApp = appAs(null);           // no session — server-to-server

useMongo();

const LEAGUE = 'graham-league';
const SEASON = 2026;
const TOKEN = { 'X-Internal-Token': 'test-internal-token' };

function fullTeam(id, school) {
    return {
        id, school, mascot: 'M', abbreviation: school.slice(0, 3).toUpperCase(),
        conference: 'Big Ten', color: '#000', logos: [`${school}.png`],
        location: { venue_id: id, name: 'V', city: 'C', state: 'ST', zip: '1', latitude: 1, longitude: 1, capacity: 100, grass: true, dome: false }
    };
}
const manager = (first, teams) => User.create({
    firstName: first, lastName: 'Test', league: LEAGUE, seasons: [{ season: SEASON, teams }]
});

beforeEach(() => { jest.spyOn(console, 'log').mockImplementation(() => {}); });
afterEach(() => { jest.restoreAllMocks(); });

describe('actorFrom', () => {
    test('reads the session identity', () => {
        const req = { oidc: { isAuthenticated: () => true, user: { name: 'Dana', email: 'd@x.com', user_metadata: { roles: ['League Manager'] } } } };
        expect(audit.actorFrom(req)).toEqual({ actorName: 'Dana', actorEmail: 'd@x.com', actorRole: 'League Manager' });
    });
    test('a server-to-server call records as system', () => {
        expect(audit.actorFrom({}).actorName).toBe('system');
        expect(audit.actorFrom(null).actorRole).toBe('system');
    });
    test('falls back to the email when there is no name', () => {
        const req = { oidc: { isAuthenticated: () => true, user: { email: 'd@x.com', user_metadata: {} } } };
        expect(audit.actorFrom(req).actorName).toBe('d@x.com');
    });
});

describe('record', () => {
    test('writes an entry', async () => {
        await audit.record({}, { action: 'roster.correct', league: LEAGUE, season: '2026', summary: 'A → B' });
        const rows = await AuditLog.find().lean();
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({ action: 'roster.correct', summary: 'A → B', actorName: 'system' });
        expect(rows[0].createdAt).toBeInstanceOf(Date);
    });

    test('ignores an entry with no action or summary', async () => {
        expect(await audit.record({}, { action: 'x' })).toBeNull();
        expect(await audit.record({}, { summary: 'y' })).toBeNull();
        expect(await audit.record({}, null)).toBeNull();
        expect(await AuditLog.countDocuments()).toBe(0);
    });

    // The whole point of best-effort: logging must never break the thing it logs.
    test('a write failure resolves null instead of throwing', async () => {
        jest.spyOn(AuditLog, 'create').mockRejectedValueOnce(new Error('mongo down'));
        await expect(audit.record({}, { action: 'a.b', summary: 's' })).resolves.toBeNull();
    });
});

describe('labelFor', () => {
    test('known actions get a short label', () => {
        expect(audit.labelFor('roster.correct')).toBe('Roster');
        expect(audit.labelFor('scoring.engagement')).toBe('Game modes');
    });
    test('an unknown action still renders as its key rather than vanishing', () => {
        expect(audit.labelFor('something.new')).toBe('something.new');
    });
});

describe('entries are written by the actions themselves', () => {
    test('a roster correction records both sides of the swap', async () => {
        await Team.create([fullTeam(1, 'Iowa'), fullTeam(9, 'Oregon')]);
        const u = await manager('Ann', [fullTeam(1, 'Iowa')]);
        const res = await request(adminApp).patch(`/users/${u._id}/roster-team`)
            .set(TOKEN).send({ fromTeamId: 1, toTeamId: 9 });
        expect(res.status).toBe(200);

        const rows = await AuditLog.find({ action: 'roster.correct' }).lean();
        expect(rows).toHaveLength(1);
        expect(rows[0].summary).toBe('Ann Test: Iowa → Oregon');
        expect(rows[0]).toMatchObject({ league: LEAGUE, season: '2026', actorName: 'Dana Commish', actorRole: 'Admin' });
        expect(rows[0].meta).toMatchObject({ from: 1, to: 9 });
    });

    test('adding and removing a season member both record', async () => {
        const u = await manager('Ann', []);
        await request(adminApp).post(`/users/${u._id}/season-membership`).set(TOKEN).send({ included: false });
        await request(adminApp).post(`/users/${u._id}/season-membership`).set(TOKEN).send({ included: true });
        const rows = await AuditLog.find({ action: 'season.membership' }).sort({ createdAt: 1 }).lean();
        expect(rows.map(r => r.summary)).toEqual(['Removed Ann Test', 'Added Ann Test']);
    });

    // A no-op toggle shouldn't clutter the trail.
    test('a membership call that changes nothing records nothing', async () => {
        const u = await manager('Ann', []);
        await request(adminApp).post(`/users/${u._id}/season-membership`).set(TOKEN).send({ included: true });
        expect(await AuditLog.countDocuments({ action: 'season.membership' })).toBe(0);
    });

    test('creating a manager records', async () => {
        await request(adminApp).post('/users').set(TOKEN)
            .send({ firstName: 'Bo', lastName: 'Nix', league: LEAGUE });
        const rows = await AuditLog.find({ action: 'user.create' }).lean();
        expect(rows[0].summary).toBe('Added Bo Nix');
    });

    test('renaming the league records the new name', async () => {
        await League.create({ code: LEAGUE, name: 'Old' });
        await request(adminApp).patch(`/leagues/${LEAGUE}`).set(TOKEN).send({ name: 'CFB Sickos' });
        const rows = await AuditLog.find({ action: 'league.rename' }).lean();
        expect(rows[0].summary).toBe('League renamed to "CFB Sickos"');
    });

    // Best-effort in practice: the action must still succeed and still persist.
    test('the action succeeds even when the audit write fails', async () => {
        await Team.create([fullTeam(1, 'Iowa'), fullTeam(9, 'Oregon')]);
        const u = await manager('Ann', [fullTeam(1, 'Iowa')]);
        jest.spyOn(AuditLog, 'create').mockRejectedValueOnce(new Error('mongo down'));

        const res = await request(adminApp).patch(`/users/${u._id}/roster-team`)
            .set(TOKEN).send({ fromTeamId: 1, toTeamId: 9 });
        expect(res.status).toBe(200);
        expect((await User.findById(u._id).lean()).seasons[0].teams[0].school).toBe('Oregon');
        expect(await AuditLog.countDocuments()).toBe(0);
    });
});

describe('GET /audit-log', () => {
    const seed = () => AuditLog.create([
        { action: 'roster.correct', league: 'graham-league', summary: 'G one', createdAt: new Date('2026-08-01') },
        { action: 'scoring.config', league: 'claunts-league', summary: 'C one', createdAt: new Date('2026-08-02') },
        { action: 'draft.reset', league: 'graham-league', summary: 'G two', createdAt: new Date('2026-08-03') }
    ]);

    test('newest first, with a display label per row', async () => {
        await seed();
        const res = await request(adminApp).get('/audit-log').set(TOKEN);
        expect(res.status).toBe(200);
        expect(res.body.entries.map(e => e.summary)).toEqual(['G two', 'C one', 'G one']);
        expect(res.body.entries[0].label).toBe('Draft');
        expect(res.body.entries[0].at).toBeTruthy();
    });

    test('an Admin sees every league', async () => {
        await seed();
        const res = await request(adminApp).get('/audit-log').set(TOKEN);
        expect(res.body.scope).toHaveLength(2);
        expect(res.body.entries).toHaveLength(3);
    });

    test('a League Manager sees only their own league', async () => {
        await seed();
        const lmApp = appAs(['League Manager'], { user_metadata: { roles: ['League Manager'], metadata: { league: 'gg' } } });
        const res = await request(lmApp).get('/audit-log');
        expect(res.body.scope).toEqual(['graham-league']);
        expect(res.body.entries.map(e => e.summary)).toEqual(['G two', 'G one']);
    });

    test('someone who manages nothing sees nothing', async () => {
        await seed();
        const res = await request(appAs([])).get('/audit-log');
        expect(res.body).toEqual({ entries: [], scope: [] });
    });

    test('limit is honored and capped', async () => {
        await seed();
        expect((await request(adminApp).get('/audit-log?limit=2').set(TOKEN)).body.entries).toHaveLength(2);
        expect((await request(adminApp).get('/audit-log?limit=9999').set(TOKEN)).body.entries).toHaveLength(3);
    });

    test('an empty trail is an empty list, not an error', async () => {
        const res = await request(adminApp).get('/audit-log').set(TOKEN);
        expect(res.status).toBe(200);
        expect(res.body.entries).toEqual([]);
    });
});
