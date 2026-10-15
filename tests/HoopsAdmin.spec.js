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
function appAs(roles, viewing) {
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
        pageLocals: () => ({ user: { userId: 'u1', firstName: 'Garrett', role: (roles || [])[0] || '' }, userState: '{}',
            viewerLeagueCode: viewing, draftDefaults: '{}' })
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

// League setup on the basketball page: football's commissioner tools,
// pointed at the basketball league and its season.
describe('the page manages a basketball league', () => {
    const League = require('../models/league');
    beforeEach(async () => {
        await League.create([{ code: 'graham-league', name: 'The Polar Depressed', sport: 'football' },
                             { code: 'hoops-league', name: 'Hardwood Heroes', sport: 'basketball' }]);
        activeSeason._reset();
        await activeSeason.prime();
    });
    const page = async (viewing) => (await request(appAs(['Admin'], viewing)).get('/hoops/admin')).text;

    // An Admin arriving from football's page is still VIEWING football.
    test.each([['viewing basketball', 'hoops-league'], ['viewing nothing yet', undefined]])(
        '%s, it manages the basketball league in its own season', async (_, viewing) => {
            const html = await page(viewing);
            expect(html).toContain('window.ADMIN_LEAGUE = "hoops-league"');
            expect(html).toContain('window.APP_YEAR = "2027"');
            expect(html).toContain('Hardwood Heroes');
            expect(html).toContain('src="/admin.js"');
        });

    test("League setup without what basketball doesn't have", async () => {
        const html = await page('hoops-league');
        ['displayLeagueNameContainer', 'displayDraftConfigContainer', 'displayScoringConfigContainer',
         'displayCreateUserContainer', 'displaySeasonRosterContainer', 'displayManagerLoginsContainer',
         'displayAuditLogContainer',
         // Captain and H2H run on basketball too (modules/hoops-modes.js),
         // and the override branches to hoops-captain (#569).
         'displayEngagementContainer', 'displayCaptainOverrideContainer',
         // Its routes read the league's sport: HoopsTeam, never Team (#561).
         'displayRosterCorrectionContainer'].forEach(fn => expect(html).toContain(fn + '()'));
        // Always quadrants.
        expect(html).not.toContain('name="rule-shape"');
        expect(html).toContain('user-table-body');
        // Nothing football-only in the words either. "Captain" is no longer
        // football-only — it is a basketball game mode.
        expect(html.replace(/<script[\s\S]*?<\/script>/g, '').replace(/<[^>]+>/g, ' ')).not.toMatch(/football|kickoff|FBS/i);
    });

    // The badge counts the tools actually shown, on both pages.
    test.each([['basketball', 'hoops'], ['football', 'admin']])('%s: the League setup count matches its tools', async (sport) => {
        const PARTIAL = path.join(__dirname, '..', 'views', 'partials', 'admin-league-setup.ejs');
        const html = ejs.render(fs.readFileSync(PARTIAL, 'utf8'), { sport }, { filename: PARTIAL });
        const shown = (html.match(/class="function-container/g) || []).length;
        expect(html).toContain('<span class="group-count">' + shown + '</span>');
    });

    // Graham: "If I am on the CBB Admin page and click the league switcher, I
    // want the Admin page to switch to the other sport's admin page." The
    // switcher reloads, so viewing football here has to land on /admin.
    test('viewing a football league sends an Admin to football\'s /admin', async () => {
        const res = await request(appAs(['Admin'], 'graham-league')).get('/hoops/admin');
        expect(res.status).toBe(302);
        expect(res.headers.location).toBe('/admin');
    });

    test('no basketball league: the data tasks only, and no league tools', async () => {
        await League.deleteMany({ sport: 'basketball' });
        activeSeason._reset();
        await activeSeason.prime();
        const html = await page(undefined);
        expect(html).toContain('window.ADMIN_LEAGUE = null');
        expect(html).not.toContain('src="/admin.js"');
        expect(html).not.toContain('displayDraftConfigContainer');
    });
});

describe("football's /admin sends an Admin viewing basketball to this page", () => {
    test('an Admin viewing basketball is redirected', () => {
        expect(hoopsAdmin.footballAdminRedirect(['Admin'], 'basketball')).toBe('/hoops/admin');
    });
    test('an Admin viewing football stays', () => {
        expect(hoopsAdmin.footballAdminRedirect(['Admin'], 'football')).toBeNull();
    });
    // A League Manager manages their own football league on /admin, and the
    // basketball page would 404 them anyway.
    test('a League Manager stays, whatever they view', () => {
        expect(hoopsAdmin.footballAdminRedirect(['League Manager'], 'basketball')).toBeNull();
    });
});

describe("football's /admin works in the season of the league it manages", () => {
    const League = require('../models/league');
    const lm = { user_metadata: { metadata: { league: 'gg' } } };
    beforeEach(async () => {
        await League.create([{ code: 'graham-league', name: 'The Polar Depressed', sport: 'football' },
                             { code: 'hoops-league', name: 'Hardwood Heroes', sport: 'basketball' }]);
        activeSeason._reset();
        await activeSeason.prime();
    });
    test('a League Manager viewing basketball still gets football\'s season', () => {
        expect(hoopsAdmin.footballAdminSeason(['League Manager'], 'hoops-league', lm)).toBe(2026);
    });
    // The viewed league and the Admin's own Auth0 league must differ in
    // season, or reading the wrong one passes too.
    test('an Admin gets the season of the league they view, not their own', async () => {
        await League.updateOne({ code: 'graham-league' }, { $set: { season: 2025 } });
        await League.create({ code: 'claunts-league', name: 'Goofballers', sport: 'football' });
        activeSeason._reset();
        await activeSeason.prime();
        const claunts = { user_metadata: { metadata: { league: 'claunts' } } };
        expect(hoopsAdmin.footballAdminSeason(['Admin'], 'graham-league', claunts)).toBe(2025);
    });
});

describe("football's admin page is unchanged by the split", () => {
    const ADMIN = path.join(__dirname, '..', 'views', 'admin.ejs');
    test('it keeps every League setup tool, Fixed/Stacking included', () => {
        const html = ejs.render(fs.readFileSync(ADMIN, 'utf8'), {
            user: { userId: 'u1', firstName: 'Garrett', role: 'League Manager' },
            userState: '{}', year: 2026, isAdmin: false, draftDefaults: '{}'
        }, { filename: ADMIN });
        ['displayEngagementContainer', 'displayCaptainOverrideContainer', 'displayRosterCorrectionContainer',
         'name="rule-shape"', 'displayDraftConfigContainer'].forEach(bit => expect(html).toContain(bit));
        expect(html).toContain('<span class="group-count">10</span>');
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

    test("the refresh quote follows the route's own default window", async () => {
        const games = require('../routes/hoopsGames');
        const prev = games.DEFAULT_REFRESH_MS;
        expect(prev).toBe(24 * 3600 * 1000);
        // A wider default (45 days) must change the quote, not leave it at 1.
        games.DEFAULT_REFRESH_MS = 45 * 24 * 3600 * 1000;
        try {
            const res = await request(appAs(['Admin'])).get('/hoops/admin/status');
            expect(res.body.calls.refresh).toBe(2);
        } finally { games.DEFAULT_REFRESH_MS = prev; }
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

// Graham: viewing football, "I only want to see CFB admin functions and info".
describe("football's admin page says nothing about basketball", () => {
    const ADMIN = path.join(__dirname, '..', 'views', 'admin.ejs');
    const template = fs.readFileSync(ADMIN, 'utf8');
    const render = (isAdmin) => ejs.render(template, {
        user: { userId: 'u1', firstName: 'Garrett', role: isAdmin ? 'Admin' : 'League Manager' },
        userState: '{}', year: 2026, isAdmin, draftDefaults: '{}'
    }, { filename: ADMIN });

    // The navbar is rendered too, and its league switcher legitimately
    // lists every league; the page body is what has to be football-only.
    const body = (html) => html.slice(html.indexOf('<div class="header">'));
    test.each([['an Admin', true], ['a League Manager', false]])('%s: no basketball link or wording', (_, isAdmin) => {
        const html = body(render(isAdmin));
        expect(html).not.toContain('/hoops/admin');
        expect(html).not.toMatch(/basketball/i);
    });
});

// The Preseason ratings card's three routes (#544). Mounted behind the same
// app-wide express.json() server.js puts in front of every router, so the
// 100 KB limit a real paste would hit is the real one.
describe('preseason ratings', () => {
    const League = require('../models/league');
    const Franchise = require('../models/franchise');
    const AuditLog = require('../models/auditLog');
    const mongoose = require('mongoose');
    const torvik = require('../modules/torvik-import');

    const SCHOOLS = ['Duke', 'Virginia', 'Louisville', 'Clemson', 'Kansas', 'Houston', 'Baylor', 'Arizona'];
    const conf = (i) => (i < 4 ? ['ACC', 'ACC'] : ['B12', 'Big 12']);
    // Torvik's JSON file, in its positional shape, padded the way the real
    // ~300 KB one is so it cannot ride under the 100 KB JSON limit.
    const torvikJson = () => JSON.stringify(SCHOOLS.map((s, i) =>
        [i + 1, s, conf(i)[0], '0-0', 120 - i, i + 1, 90 + i, i + 1, 0.95 - i * 0.05, i + 1, 25 - i, 5 + i,
            ...new Array(30).fill(0.123456789012345)])) + ' '.repeat(150 * 1024);

    function app(roles = ['Admin']) {
        const a = express();
        a.use(express.json());
        a.use((req, res, next) => {
            req.oidc = { isAuthenticated: () => roles !== null,
                user: roles === null ? null : { name: 'Garrett', email: 'g@example.com', user_metadata: { roles } } };
            next();
        });
        a.use('/hoops/admin', hoopsAdmin.build());
        a.use((req, res) => res.status(404).send('Not found'));
        return a;
    }
    const preview = (body = torvikJson()) => request(app()).post('/hoops/admin/preseason/preview')
        .set('Content-Type', 'text/plain').send(body);

    beforeEach(async () => {
        await League.create({ code: 'hoops-league', name: 'Hoops', sport: 'basketball' });
        await HoopsTeam.create(SCHOOLS.map((school, i) => ({ id: i + 1, season: SEASON, school, conference: conf(i)[1] })));
    });

    test.each([['a League Manager', ['League Manager']], ['a member', []], ['signed out', null]])(
        '%s gets a 404 from all three', async (_, roles) => {
            const a = app(roles);
            expect((await request(a).get('/hoops/admin/preseason')).status).toBe(404);
            expect((await request(a).post('/hoops/admin/preseason/preview').set('Content-Type', 'text/plain').send(torvikJson())).status).toBe(404);
            expect((await request(a).post('/hoops/admin/preseason/apply').send({ rows: [], origin: 'json' })).status).toBe(404);
            expect(await HoopsTeam.countDocuments({ 'preseason.rank': { $exists: true } })).toBe(0);
        });

    test('what is on file: never imported, unlocked', async () => {
        const res = await request(app()).get('/hoops/admin/preseason');
        expect(res.status).toBe(200);
        expect(res.body).toMatchObject({ season: SEASON, locked: false, url: 'https://barttorvik.com/2027_team_results.json',
            current: { teams: 8, ranked: 0, source: null, importedAt: null, top: [] } });
    });

    test('a pasted JSON file larger than the app-wide JSON limit previews, and writes nothing', async () => {
        expect(Buffer.byteLength(torvikJson())).toBeGreaterThan(100 * 1024);
        const res = await preview();
        expect(res.status).toBe(200);
        expect(res.body).toMatchObject({ ok: true, origin: 'json', locked: false, counts: { ratings: 8, teams: 8, matched: 8 } });
        expect(res.body.compare.newTop.map(t => t.school)).toEqual(SCHOOLS);
        expect(res.body.rows).toHaveLength(8);
        expect(res.body.source).toMatch(/pasted team_results\.json \(2027_team_results\.json\)/);
        expect(await HoopsTeam.countDocuments({ 'preseason.rank': { $exists: true } })).toBe(0);
    });

    test('a browser copy of the table is refused with directions', async () => {
        const res = await preview('1\tDuke\tACC\t120.8\n2\tVirginia\tACC\t119');
        expect(res.status).toBe(422);
        expect(res.body.problems[0]).toMatch(/copied text/);
    });

    test('Fetch reads Torvik\'s JSON server-side', async () => {
        const spy = jest.spyOn(torvik, 'fetchFromTorvik').mockResolvedValue({ rows: torvik.parsePaste(torvikJson()).rows });
        const res = await request(app()).post('/hoops/admin/preseason/preview').send({ fetch: true });
        expect(spy).toHaveBeenCalledWith(SEASON);
        expect(res.body).toMatchObject({ ok: true, origin: 'fetch' });
        expect(res.body.source).toMatch(/fetched from barttorvik\.com/);
    });

    test('a fetch that hits the wall is the admin\'s message, not a 500', async () => {
        jest.spyOn(torvik, 'fetchFromTorvik').mockRejectedValue(new Error('answered with a web page, not data'));
        const res = await request(app()).post('/hoops/admin/preseason/preview').send({ fetch: true });
        expect(res.status).toBe(422);
        expect(res.body.problems).toEqual(['answered with a web page, not data']);
    });

    test('a failing check comes back as problems, with no rows to apply', async () => {
        // Ranks numbered from the bottom: the worst team ranked 1.
        const reversed = JSON.parse(torvikJson());
        reversed.forEach((r, i) => { r[0] = reversed.length - i; });
        const res = await preview(JSON.stringify(reversed));
        expect(res.status).toBe(200);
        expect(res.body.ok).toBe(false);
        expect(res.body.rows).toBeUndefined();
        expect(res.body.problems.join('\n')).toMatch(/sort may be reversed/);
    });

    test('Apply writes every team, records an audit row, and shows on file', async () => {
        const { rows, origin } = (await preview()).body;
        const res = await request(app()).post('/hoops/admin/preseason/apply').send({ rows, origin });
        expect(res.status).toBe(200);
        expect(res.body).toMatchObject({ ok: true, stamped: 8, teams: 8 });
        expect(await HoopsTeam.countDocuments({ season: SEASON, 'preseason.rank': { $exists: true } })).toBe(8);

        const log = await AuditLog.find({ action: 'hoops.preseason' }).lean();
        expect(log).toHaveLength(1);
        expect(log[0]).toMatchObject({ season: '2027', league: null, actorName: 'Garrett', meta: { stamped: 8, teams: 8 } });
        expect(log[0].summary).toMatch(/8 \/ 8 teams ranked/);

        const on = (await request(app()).get('/hoops/admin/preseason')).body.current;
        expect(on).toMatchObject({ ranked: 8, source: res.body.source, importedAt: res.body.importedAt });
        expect(on.top[0]).toMatchObject({ rank: 1, school: 'Duke' });
    });

    test('Apply re-runs the checks: rows tampered with after the preview are refused', async () => {
        const { rows } = (await preview()).body;
        rows.forEach(r => { r.rank = 1; });
        const res = await request(app()).post('/hoops/admin/preseason/apply').send({ rows, origin: 'json' });
        expect(res.status).toBe(422);
        expect(res.body.problems.join('\n')).toMatch(/not unique/);
        expect(await HoopsTeam.countDocuments({ 'preseason.rank': { $exists: true } })).toBe(0);
        expect(await AuditLog.countDocuments()).toBe(0);
    });

    test('last season\'s data file is refused, not imported as this season', async () => {
        const rows = torvik.parsePaste(torvikJson()).rows;
        const res = await preview(JSON.stringify({ season: SEASON - 1, source: 'old', teams: rows }));
        expect(res.status).toBe(422);
        expect(res.body.problems[0]).toMatch(/for season 2026, not 2027/);
        const ok = await preview(JSON.stringify({ season: SEASON, source: 'x', teams: rows }));
        expect(ok.body).toMatchObject({ ok: true, origin: 'file' });
    });

    test('Apply needs rows and a known origin', async () => {
        const res = await request(app()).post('/hoops/admin/preseason/apply').send({ rows: [], origin: 'made-up' });
        expect(res.status).toBe(400);
    });

    test('LOCKED once a basketball league has banked points: 423, nothing written', async () => {
        const { rows, origin } = (await preview()).body;
        await Franchise.create({ accountId: new mongoose.Types.ObjectId(), league: 'hoops-league',
            seasons: [{ season: SEASON, weeklyScore: [{ week: 1, score: 14 }] }] });
        expect((await request(app()).get('/hoops/admin/preseason')).body.locked).toBe(true);
        const res = await request(app()).post('/hoops/admin/preseason/apply').send({ rows, origin });
        expect(res.status).toBe(423);
        expect(res.body.message).toMatch(/Locked/);
        expect(await HoopsTeam.countDocuments({ 'preseason.rank': { $exists: true } })).toBe(0);
    });

    test('a zero-point week (seeded before tip-off) does not lock it', async () => {
        await Franchise.create({ accountId: new mongoose.Types.ObjectId(), league: 'hoops-league',
            seasons: [{ season: SEASON, weeklyScore: [{ week: 1, score: 0 }] }] });
        expect((await request(app()).get('/hoops/admin/preseason')).body.locked).toBe(false);
    });

    test('a failed write is audited and reported, not thrown', async () => {
        const { rows, origin } = (await preview()).body;
        jest.spyOn(torvik, 'apply').mockRejectedValue(Object.assign(new Error('PARTIAL IMPORT: 3 of 8'), { partial: 3 }));
        const res = await request(app()).post('/hoops/admin/preseason/apply').send({ rows, origin });
        expect(res.status).toBe(500);
        expect(res.body.problems).toEqual(['PARTIAL IMPORT: 3 of 8']);
        const log = await AuditLog.findOne({ action: 'hoops.preseason' }).lean();
        expect(log.summary).toMatch(/FAILED/);
        expect(log.meta.partial).toBe(3);
    });

    test('no basketball season: a plain answer, not a 500', async () => {
        await SportSeason.deleteMany({ sport: 'basketball' });
        activeSeason._reset();
        await activeSeason.prime();
        expect((await request(app()).get('/hoops/admin/preseason')).body).toEqual({ season: null });
        expect((await preview()).status).toBe(409);
        expect((await request(app()).post('/hoops/admin/preseason/apply').send({ rows: [], origin: 'json' })).status).toBe(409);
    });

    test('a database failure is a clean JSON 500 on every route', async () => {
        jest.spyOn(torvik, 'current').mockRejectedValue(new Error('db down'));
        jest.spyOn(torvik, 'seasonUnderway').mockRejectedValue(new Error('db down'));
        jest.spyOn(console, 'error').mockImplementation(() => {});
        expect((await request(app()).get('/hoops/admin/preseason')).status).toBe(500);
        expect((await preview()).status).toBe(500);
        const res = await request(app()).post('/hoops/admin/preseason/apply').send({ rows: [], origin: 'json' });
        expect(res.status).toBe(500);
        expect(res.body.message).toMatch(/Could not apply/);
    });
});

test('the page loads the preseason card into its own container', async () => {
    const res = await request(appAs(['Admin'])).get('/hoops/admin');
    expect(res.text).toContain('id="hoops-preseason"');
    expect(res.text).toContain('src="/hoopsPreseason.js"');
});
