// The Captain pick leaves a trail.
//
// Why this exists: `seasons[].captains` stores only the LATEST pick for a week —
// the PATCH drops the week's entry and pushes a fresh one — so a manager who
// says "I picked X and it changed back to Y" cannot be answered from the data.
// It says what the pick is and when it was last written, and nothing else.
//
// The rejected write is the half that actually answers it. An attempt to switch
// after kickoff 409s, and the picker repaints into its locked state showing the
// stored pick — which looks exactly like the pick reverting on its own. These
// tests pin BOTH outcomes, and that a captain row stays out of the commissioner
// feed (a game week writes one per manager and would bury everything else).

process.env.YEAR = '2026';

const express = require('express');
const request = require('supertest');
const { useMongo } = require('./helpers/mongo');
const AuditLog = require('../models/auditLog');
const User = require('../models/user');
const Game = require('../models/game');
const audit = require('../modules/audit-log');
const usersRouter = require('../routes/users');
const auditRouter = require('../routes/auditLog');

useMongo();

const SEASON = 2026;
const LEAGUE = 'graham-league';
const PITT = 221, BAMA = 333, USC = 30;

function fullTeam(id, school) {
    return {
        id, school, mascot: 'M', abbreviation: school.slice(0, 3).toUpperCase(),
        conference: 'SEC', color: '#000', logos: [`${school}.png`],
        location: { venue_id: id, name: 'V', city: 'C', state: 'ST', zip: '1', latitude: 1, longitude: 1, capacity: 100, grass: true, dome: false }
    };
}

// Week 3, the shape of the real incident: Pitt plays Thursday (the manager's
// earliest kickoff, so the week locks on it) and Alabama plays Saturday.
const FUTURE_THU = '2099-09-17T23:30:00.000Z';
const FUTURE_SAT = '2099-09-19T19:30:00.000Z';
const PAST_THU = '2020-09-17T23:30:00.000Z';
const PAST_SAT = '2020-09-19T19:30:00.000Z';

function weekGames(thu, sat) {
    return [
        { id: 1, season: SEASON, week: 3, seasonType: 'regular', startDate: thu, startTimeTbd: false,
          neutralSite: false, conferenceGame: false, homeId: PITT, homeTeam: 'Pittsburgh', awayId: 900, awayTeam: 'Syracuse', completed: false },
        { id: 2, season: SEASON, week: 3, seasonType: 'regular', startDate: sat, startTimeTbd: false,
          neutralSite: false, conferenceGame: false, homeId: BAMA, homeTeam: 'Alabama', awayId: 901, awayTeam: 'Florida State', completed: false }
    ];
}

let user;
async function seed({ locked = false, captains = [] } = {}) {
    user = await User.create({
        firstName: 'Brock', lastName: 'McCord', league: LEAGUE,
        seasons: [{
            season: SEASON, captains,
            teams: [fullTeam(PITT, 'Pittsburgh'), fullTeam(BAMA, 'Alabama'), fullTeam(USC, 'USC')],
            weeklyScore: [], cumulativeScore: 0
        }]
    });
    await Game.create(locked ? weekGames(PAST_THU, PAST_SAT) : weekGames(FUTURE_THU, FUTURE_SAT));
    return user;
}

// The manager's own session.
function selfApp(roles) {
    const a = express();
    a.use(express.json());
    a.use((req, res, next) => {
        req.oidc = {
            isAuthenticated: () => true,
            user: { name: 'Brock McCord', email: 'brock@example.com',
                    user_metadata: { roles: roles || [], metadata: { userId: String(user._id) } } }
        };
        next();
    });
    a.use('/users', usersRouter);
    a.use('/audit-log', auditRouter);
    return a;
}

// A commissioner acting on someone else.
function adminApp() {
    const a = express();
    a.use(express.json());
    a.use((req, res, next) => {
        req.oidc = {
            isAuthenticated: () => true,
            user: { name: 'Dana Commish', email: 'dana@example.com', user_metadata: { roles: ['Admin'] } }
        };
        next();
    });
    a.use('/users', usersRouter);
    a.use('/audit-log', auditRouter);
    return a;
}

const rows = (action) => AuditLog.find(action ? { action } : {}, null, { sort: { createdAt: 1 } }).lean();
const capsOf = async () => (await User.findById(user._id).lean()).seasons[0].captains;

beforeEach(() => { jest.spyOn(console, 'log').mockImplementation(() => {}); });
afterEach(() => { jest.restoreAllMocks(); });

// The audit row is about a PERSON — their name, and an id that resolves to
// them. Under #313 the name lives on the account and the roster on the franchise,
// so a handler that reads identity off the franchise writes "undefined undefined"
// and a franchise id that points at nothing.
//
// Everything below runs with FRANCHISE_READS unset, where the two are one
// document and that mistake is invisible. This block is why it is not.
describe('the row names the person, from either source (#313 phase 3)', () => {
    const migration = require('../modules/account-migration');
    const ORIGINAL = process.env.FRANCHISE_READS;
    afterEach(() => {
        if (ORIGINAL === undefined) delete process.env.FRANCHISE_READS;
        else process.env.FRANCHISE_READS = ORIGINAL;
    });

    test.each([['false'], ['true']])('a self-serve pick, with the flag %s', async (flag) => {
        await seed();
        await migration.migrate({ apply: true });
        process.env.FRANCHISE_READS = flag;

        const res = await request(selfApp()).patch('/users/me/captain').send({ week: 3, teamId: PITT });
        expect(res.status).toBe(200);

        const [row] = await rows('captain.set');
        expect(row.summary).toBe('Brock McCord set Week 3 captain: Pittsburgh');
        expect(row.league).toBe(LEAGUE);
        // The ACCOUNT id. A franchise id here is a pointer to nothing, and the
        // trail exists precisely to be looked up later.
        expect(row.meta.userId).toBe(String(user._id));
    });

    test.each([['false'], ['true']])('an admin override, with the flag %s', async (flag) => {
        await seed();
        await migration.migrate({ apply: true });
        process.env.FRANCHISE_READS = flag;

        await request(adminApp()).patch(`/users/${user._id}/captain`).send({ week: 3, teamId: PITT });

        const [row] = await rows('captain.set');
        expect(row.summary).toMatch(/^Brock McCord set Week 3 captain: Pittsburgh/);
        expect(row.summary).toMatch(/admin override$/);
        expect(row.meta.userId).toBe(String(user._id));
    });
});

describe('a pick the manager makes', () => {
    test('records the team by name, with the league and season', async () => {
        await seed();
        const res = await request(selfApp()).patch('/users/me/captain').send({ week: 3, teamId: PITT });
        expect(res.status).toBe(200);

        const [row] = await rows('captain.set');
        expect(row.summary).toBe('Brock McCord set Week 3 captain: Pittsburgh');
        expect(row.league).toBe(LEAGUE);
        expect(row.season).toBe('2026');
        expect(row.actorName).toBe('Brock McCord');
        expect(row.meta).toMatchObject({ userId: String(user._id), week: 3, teamId: PITT, prevTeamId: null, via: 'self' });
    });

    // The whole point: the row names what it replaced, which the stored subdoc
    // cannot, because the previous entry is deleted by the same request.
    test('names the pick it replaced', async () => {
        await seed({ captains: [{ week: 3, teamId: BAMA }] });
        await request(selfApp()).patch('/users/me/captain').send({ week: 3, teamId: PITT });

        const [row] = await rows('captain.set');
        expect(row.summary).toBe('Brock McCord set Week 3 captain: Pittsburgh (was Alabama)');
        expect(row.meta.prevTeamId).toBe(BAMA);
    });

    test('records a clear as a clear', async () => {
        await seed({ captains: [{ week: 3, teamId: BAMA }] });
        await request(selfApp()).patch('/users/me/captain').send({ week: 3, teamId: null });

        const [row] = await rows('captain.set');
        expect(row.summary).toBe('Brock McCord cleared Week 3 captain (was Alabama)');
        expect(row.meta.teamId).toBeNull();
    });

    // Ordering matters: a row for a write that never landed is worse than none.
    test('writes nothing when the pick is rejected as off-roster', async () => {
        await seed();
        const res = await request(selfApp()).patch('/users/me/captain').send({ week: 3, teamId: 12345 });
        expect(res.status).toBe(400);
        expect(await rows()).toHaveLength(0);
    });
});

describe('a pick the lock refuses', () => {
    test('records the attempt, names what it would have replaced, and changes nothing', async () => {
        await seed({ locked: true, captains: [{ week: 3, teamId: BAMA }] });
        const res = await request(selfApp()).patch('/users/me/captain').send({ week: 3, teamId: PITT });
        expect(res.status).toBe(409);

        const [row] = await rows('captain.locked');
        expect(row.summary).toBe('Brock McCord tried to set Week 3 captain to Pittsburgh after lock — stays Alabama');
        expect(row.meta).toMatchObject({ week: 3, teamId: PITT, prevTeamId: BAMA, via: 'self' });
        expect(row.meta.note).toContain('locked at');

        // The stored pick is untouched — the rejection is the only trace.
        expect(await capsOf()).toMatchObject([{ week: 3, teamId: BAMA }]);
        expect(await rows('captain.set')).toHaveLength(0);
    });

    test('records the backstop rejection too (no kickoff time, week already played)', async () => {
        user = await User.create({
            firstName: 'Brock', lastName: 'McCord', league: LEAGUE,
            seasons: [{ season: SEASON, captains: [{ week: 3, teamId: BAMA }], teams: [fullTeam(PITT, 'Pittsburgh'), fullTeam(BAMA, 'Alabama')], weeklyScore: [], cumulativeScore: 0 }]
        });
        // No parseable kickoff at all, but the week has a completed game — the
        // backstop that stops a played week being retro-edited.
        await Game.create([{
            id: 3, season: SEASON, week: 3, seasonType: 'regular', startDate: 'TBD', startTimeTbd: true,
            neutralSite: false, conferenceGame: false, homeId: PITT, homeTeam: 'Pittsburgh', awayId: 900, awayTeam: 'Syracuse', completed: true
        }]);

        const res = await request(selfApp()).patch('/users/me/captain').send({ week: 3, teamId: PITT });
        expect(res.status).toBe(409);
        const [row] = await rows('captain.locked');
        expect(row.meta.note).toContain('completed game');
    });
});

describe('a commissioner override', () => {
    test('is marked as one, and records the admin as the actor', async () => {
        await seed({ locked: true, captains: [{ week: 3, teamId: BAMA }] });
        const res = await request(adminApp()).patch(`/users/${user._id}/captain`).send({ week: 3, teamId: PITT });
        expect(res.status).toBe(200);

        const [row] = await rows('captain.set');
        expect(row.summary).toBe('Brock McCord set Week 3 captain: Pittsburgh (was Alabama) · admin override');
        expect(row.actorName).toBe('Dana Commish');
        expect(row.meta.via).toBe('admin');
    });
});

describe('the audit write never takes the pick down with it', () => {
    test('the pick still saves when the audit write throws', async () => {
        await seed();
        jest.spyOn(AuditLog, 'create').mockRejectedValue(new Error('mongo is down'));

        const res = await request(selfApp()).patch('/users/me/captain').send({ week: 3, teamId: PITT });
        expect(res.status).toBe(200);
        expect(await capsOf()).toMatchObject([{ week: 3, teamId: PITT }]);
    });
});

describe('GET /audit-log separates the two feeds', () => {
    beforeEach(async () => {
        await seed();
        await request(selfApp()).patch('/users/me/captain').send({ week: 3, teamId: PITT });
        await audit.record(
            { oidc: { isAuthenticated: () => true, user: { name: 'Dana Commish', user_metadata: { roles: ['Admin'] } } } },
            { action: 'scoring.config', league: LEAGUE, season: '2026', summary: 'Scoring saved' });
    });

    test('the commissioner feed leaves captain rows out', async () => {
        const res = await request(adminApp()).get('/audit-log');
        expect(res.status).toBe(200);
        expect(res.body.kind).toBe('commissioner');
        expect(res.body.entries.map(e => e.action)).toEqual(['scoring.config']);
    });

    test('kind=captain returns only the captain rows, labelled', async () => {
        const res = await request(adminApp()).get('/audit-log?kind=captain');
        expect(res.body.entries.map(e => e.action)).toEqual(['captain.set']);
        expect(res.body.entries[0].label).toBe('Captain');
    });

    test('kind=all returns both', async () => {
        const res = await request(adminApp()).get('/audit-log?kind=all');
        expect(res.body.entries.map(e => e.action).sort()).toEqual(['captain.set', 'scoring.config']);
    });
});
