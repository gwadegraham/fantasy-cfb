// The basketball admin page (#518): routes/hoopsAdmin.js, its gate, and the
// link to it on football's admin page.
//
// The gate IS the feature here. Basketball stays invisible to everyone who is
// not in on it, and football's /admin lets League Managers in — so a page that
// copied that gate would put basketball in front of a football commissioner.
// Rendered through the real ejs views, so a refactor that drops the page's
// markup or the link's isAdmin check cannot pass on a string match.

const express = require('express');
const path = require('path');
const fs = require('fs');
const ejs = require('ejs');
const request = require('supertest');
const { useMongo } = require('./helpers/mongo');
const hoopsAdmin = require('../routes/hoopsAdmin');
const HoopsTeam = require('../models/hoopsTeam');
const HoopsGame = require('../models/hoopsGame');
const HoopsRoster = require('../models/hoopsRoster');
const JobRun = require('../models/jobRun');
const SportSeason = require('../models/sportSeason');
const activeSeason = require('../modules/active-season');
const cbbd = require('../modules/cbbd-client');

useMongo();
const SEASON = 2027;

// roles: null = signed out; [] = a member; ['League Manager']; ['Admin'].
function appAs(roles) {
    const a = express();
    a.set('views', path.join(__dirname, '..', 'views'));
    a.set('view engine', 'ejs');
    a.use((req, res, next) => {
        req.oidc = {
            isAuthenticated: () => roles !== null,
            user: roles === null ? null : { user_metadata: { roles } }
        };
        next();
    });
    a.use('/hoops/admin', hoopsAdmin.build({
        pageLocals: () => ({ user: { userId: 'u1', firstName: 'Garrett', role: (roles || [])[0] || '' }, userState: '{}' })
    }));
    // What server.js does with a request no route answered.
    a.use((req, res) => res.status(404).send('Not found'));
    return a;
}

beforeEach(async () => {
    activeSeason._reset();
    await SportSeason.create([{ sport: 'football', season: 2026, status: 'in-season' },
                              { sport: 'basketball', season: SEASON, status: 'preseason' }]);
    await activeSeason.prime();
});
afterEach(() => jest.restoreAllMocks());

describe('the page', () => {
    test('an Admin gets it', async () => {
        const res = await request(appAs(['Admin'])).get('/hoops/admin');
        expect(res.status).toBe(200);
        expect(res.text).toContain('id="hoops-admin"');
        expect(res.text).toContain('/hoopsAdmin.js');
    });

    test('signed out goes to login, like /admin', async () => {
        const res = await request(appAs(null)).get('/hoops/admin');
        expect(res.status).toBe(302);
        expect(res.headers.location).toBe('/login');
    });

    // 404, not 403 and not a redirect home: either of those says the page exists.
    test.each([['a League Manager', ['League Manager']], ['a member', []]])('%s gets a plain 404', async (_, roles) => {
        const res = await request(appAs(roles)).get('/hoops/admin');
        expect(res.status).toBe(404);
        expect(res.text).not.toContain('hoops-admin');
    });
});

describe('GET /hoops/admin/status', () => {
    test.each([['signed out', null], ['a League Manager', ['League Manager']], ['a member', []]])('%s gets 404', async (_, roles) => {
        const res = await request(appAs(roles)).get('/hoops/admin/status');
        expect(res.status).toBe(404);
        expect(res.body.season).toBeUndefined();
    });

    test('reports what is on file for the active basketball season, and nothing from another', async () => {
        await HoopsTeam.create([
            { id: 1, season: SEASON, school: 'Duke', logos: ['a.png'] },
            { id: 2, season: SEASON, school: 'Army' },
            { id: 3, season: 2026, school: 'Old', logos: ['x.png'] }
        ]);
        const game = (id, o) => Object.assign({ id, season: SEASON, seasonType: 'regular', startDate: new Date('2026-11-10T00:00:00Z'), status: 'scheduled' }, o);
        await HoopsGame.create([
            game(10, { status: 'final', startDate: new Date('2026-11-12T00:00:00Z') }),
            game(11, { status: 'final', startDate: new Date('2026-11-14T00:00:00Z') }),
            game(12),
            game(13, { season: 2026, status: 'final', startDate: new Date('2026-03-01T00:00:00Z') })
        ]);
        await HoopsRoster.create([
            { season: SEASON, athleteId: 1, teamId: 1, jersey: '2', fetchedAt: new Date('2026-11-01T00:00:00Z') },
            { season: SEASON, athleteId: 2, teamId: 1, jersey: '00', fetchedAt: new Date('2026-11-03T00:00:00Z') },
            { season: SEASON, athleteId: 3, teamId: 2, jersey: '5', fetchedAt: new Date('2026-11-02T00:00:00Z') },
            { season: 2026, athleteId: 3, teamId: 9, jersey: '1' }
        ]);
        const res = await request(appAs(['Admin'])).get('/hoops/admin/status');
        expect(res.status).toBe(200);
        expect(res.body.season).toBe(SEASON);
        expect(res.body.seasonStatus).toBe('preseason');
        expect(res.body.onFile.teams).toEqual({ teams: 2, withLogos: 1 });
        expect(res.body.onFile.games).toEqual({ games: 3, finals: 2, lastFinal: '2026-11-14T00:00:00.000Z' });
        expect(res.body.onFile.roster).toEqual({ players: 3, teams: 2, fetchedAt: '2026-11-03T00:00:00.000Z' });
    });

    test('quotes the calls each task will spend', async () => {
        const res = await request(appAs(['Admin'])).get('/hoops/admin/status');
        // Oct 1 .. Apr 30 is 212 days: eight 30-day windows, plus the roster
        // the schedule ingest imports when none is on file in full.
        expect(res.body.calls).toEqual({ ingest: 1, schedule: 9, refresh: 1, roster: 1 });
    });

    test('the schedule stops counting the roster call once a full roster is on file', async () => {
        jest.spyOn(require('../modules/hoops-roster'), 'hasSeason').mockResolvedValue(true);
        const res = await request(appAs(['Admin'])).get('/hoops/admin/status');
        expect(res.body.calls.schedule).toBe(8);
    });

    test('the latest run of each basketball job, and no football job', async () => {
        await JobRun.create([
            { jobName: 'hoops-scores', status: 'error', startedAt: new Date('2026-11-10T05:00:00Z'), message: 'old' },
            { jobName: 'hoops-scores', status: 'success', startedAt: new Date('2026-11-11T05:00:00Z'), message: 'new' },
            { jobName: 'daily-scores', status: 'success', startedAt: new Date('2026-11-11T05:00:00Z') }
        ]);
        const res = await request(appAs(['Admin'])).get('/hoops/admin/status');
        expect(res.body.jobs.map(j => j.jobName)).toEqual(hoopsAdmin.HOOPS_JOBS);
        const scores = res.body.jobs.find(j => j.jobName === 'hoops-scores');
        expect(scores).toMatchObject({ status: 'success', message: 'new' });
        expect(res.body.jobs.find(j => j.jobName === 'hoops-live').status).toBeNull();
    });

    test('no basketball season set says so rather than guessing one', async () => {
        await SportSeason.deleteMany({ sport: 'basketball' });
        activeSeason._reset();
        await activeSeason.prime();
        const prev = process.env.YEAR;
        delete process.env.YEAR;
        try {
            const res = await request(appAs(['Admin'])).get('/hoops/admin/status');
            expect(res.status).toBe(200);
            expect(res.body).toEqual({ season: null });
        } finally {
            if (prev !== undefined) process.env.YEAR = prev;
        }
    });

    test('a failed read is a 500 with a message, not a hang', async () => {
        jest.spyOn(console, 'error').mockImplementation(() => {});
        jest.spyOn(HoopsTeam, 'countDocuments').mockRejectedValue(new Error('boom'));
        const res = await request(appAs(['Admin'])).get('/hoops/admin/status');
        expect(res.status).toBe(500);
        expect(res.body.message).toMatch(/basketball status/);
    });
});

describe('windowsFor', () => {
    // The confirm step quotes this number, so it must be the number the
    // ingest actually spends — counted off a real fetchGamesInRange run.
    test('matches the /games calls fetchGamesInRange makes for a season', async () => {
        const { start, end } = cbbd.seasonRange(SEASON);
        const fetchSpy = jest.spyOn(global, 'fetch').mockImplementation(async () => ({
            ok: true, headers: { get: () => null }, json: async () => []
        }));
        const out = await cbbd.fetchGamesInRange(SEASON, 'regular', start, end);
        expect(fetchSpy).toHaveBeenCalledTimes(out.windows);
        expect(hoopsAdmin.windowsFor(start, end)).toBe(out.windows);
    });

    test('a one-day range is one call; a backwards one is none', () => {
        const d = new Date('2026-11-10T00:00:00Z');
        expect(hoopsAdmin.windowsFor(d, d)).toBe(1);
        expect(hoopsAdmin.windowsFor(d, new Date('2026-11-09T00:00:00Z'))).toBe(0);
    });
});

describe("football's admin page links here for Admins only", () => {
    const ADMIN = path.join(__dirname, '..', 'views', 'admin.ejs');
    const template = fs.readFileSync(ADMIN, 'utf8');
    const render = (isAdmin) => ejs.render(template, {
        user: { userId: 'u1', firstName: 'Garrett', role: isAdmin ? 'Admin' : 'League Manager' },
        userState: '{}', year: 2026, isAdmin, draftDefaults: '{}'
    }, { filename: ADMIN });

    test('an Admin sees the link', () => {
        expect(render(true)).toContain('href="/hoops/admin"');
    });
    test('a League Manager does not', () => {
        expect(render(false)).not.toContain('/hoops/admin');
    });
});
