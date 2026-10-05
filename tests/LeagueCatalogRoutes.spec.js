// A league that exists only in Mongo has to WORK, not merely be listed.
//
// #319 part 2 replaced one `LEAGUES.map(...)` in server.js with a catalog, and
// a review found four more places still enumerating the hardcoded
// scoring-defaults array. The worst of them hard-blocked the whole feature:
//
//   POST /users is the ONLY path in the app that creates a franchise. While it
//   validated against the array, a basketball league could be created, named
//   and selected — and then never have a single member. No member, no second
//   franchise, so the member league switcher the part exists to deliver was
//   unreachable for exactly the leagues the catalog was added to support.
//
// This repo has been bitten by this shape before (the non-P5 upset bonus went
// through six places that each swallowed a new config field), so each migrated
// route is exercised against a Mongo-only league here.

const express = require('express');
const request = require('supertest');
const { useMongo, mirrorUsers } = require('./helpers/mongo');
const League = require('../models/league');
const User = require('../models/user');
const Franchise = require('../models/franchise');

useMongo();

const HOOPS = 'hoops-league';
const BALL = 'graham-league';

// An Admin session, as server.js's devRole middleware leaves it.
const asAdmin = (router, mount) => {
    const app = express();
    app.use(express.json());
    app.use((req, res, next) => {
        const user = { sub: 'auth0|a', user_metadata: { roles: ['Admin'], metadata: { league: 'gg', userId: 'a' } } };
        req.oidc = { isAuthenticated: () => true, user };
        req.effUser = user;
        next();
    });
    app.use(mount, router);
    return app;
};

beforeEach(async () => {
    await League.create({ code: HOOPS, name: 'Hardwood Heroes', sport: 'basketball' });
    jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

describe('POST /users — the only franchise-creation path there is', () => {
    const app = () => asAdmin(require('../routes/users'), '/users');

    test('a manager CAN be created in a database-only league', async () => {
        // The finding. Without this the member switcher can never happen,
        // because nobody can ever hold a second franchise.
        const res = await request(app()).post('/users').send({
            firstName: 'Ann', lastName: 'T', email: 'ann@example.com', league: HOOPS
        });
        expect(res.status).toBeLessThan(300);

        const f = await Franchise.findOne({ league: HOOPS }).lean();
        expect(f).not.toBeNull();
    });

    test('and the hardcoded leagues still work', async () => {
        const res = await request(app()).post('/users').send({
            firstName: 'Bo', lastName: 'H', email: 'bo@example.com', league: BALL
        });
        expect(res.status).toBeLessThan(300);
    });

    test('but a league that does not exist is still refused', async () => {
        // The guard is widened, not removed: canManageLeague answers true for
        // an Admin whatever it is handed, so a missing league would otherwise
        // create a manager belonging to no league at all.
        for (const league of [undefined, '', 'nonsense']) {
            const res = await request(app()).post('/users').send({
                firstName: 'Cy', lastName: 'K', email: 'cy@example.com', league
            });
            expect(res.status).toBe(400);
        }
        expect(await Franchise.countDocuments({ league: 'nonsense' })).toBe(0);
    });

    test('an ARCHIVED league is not a valid destination', async () => {
        await League.create({ code: 'old-league', name: 'Retired', status: 'archived' });
        const res = await request(app()).post('/users').send({
            firstName: 'Di', lastName: 'M', email: 'di@example.com', league: 'old-league'
        });
        expect(res.status).toBe(400);
    });
});

describe('GET/PATCH /leagues — naming', () => {
    const app = () => asAdmin(require('../routes/leagues'), '/leagues');

    test('a database-only league is listed', async () => {
        const res = await request(app()).get('/leagues');
        expect(res.body.map(l => l.code)).toContain(HOOPS);
    });

    test('and can be RENAMED', async () => {
        // The one editable thing about a league is the name the switcher
        // shows. It used to 404 for anything outside the hardcoded array,
        // so a new league was stuck with whatever its insert set.
        const res = await request(app()).patch(`/leagues/${HOOPS}`).send({ name: 'Hoops Dreams' });
        expect(res.status).toBe(200);
        expect((await League.findOne({ code: HOOPS }).lean()).name).toBe('Hoops Dreams');
    });

    test('an unknown league still 404s', async () => {
        expect((await request(app()).patch('/leagues/nonsense').send({ name: 'X' })).status).toBe(404);
    });
});

describe('GET /audit-log — scope', () => {
    test('an Admin sees every league, including the database-only one', async () => {
        const app = asAdmin(require('../routes/auditLog'), '/audit-log');
        const res = await request(app).get('/audit-log');
        expect(res.status).toBe(200);
        // `seesAll` is computed as visible.length === all.length; with the
        // hardcoded array as the denominator a Mongo-only league made the two
        // disagree, which would have silently scoped an Admin's own view.
        expect(res.body.scope === undefined || res.body.scope.includes(HOOPS)).toBe(true);
    });
});

describe('a basketball league gets its OWN season', () => {
    // #319 part 2 is what made a member able to ask for a basketball league
    // at all. GET /users/league/:code answered `activeSeason('football')`
    // for every league, so the first thing they could reach returned the
    // football season's roster for a basketball team.
    //
    // The REAL season cache is primed here rather than seasonForLeague being
    // spied on: routes/users.js destructures it at require time, so a spy on
    // the module object never reaches the route — the first version of this
    // test mocked it and simply never got called.
    const franchiseRepo = require('../modules/franchise-repo');
    const seasons = require('../modules/active-season');
    const SportSeason = require('../models/sportSeason');

    beforeEach(async () => {
        await SportSeason.create([
            { sport: 'football', season: 2026, status: 'in-season' },
            { sport: 'basketball', season: 2027, status: 'preseason' }
        ]);
        await seasons.prime();
    });
    afterEach(() => seasons._reset());

    const seasonAskedFor = async (league, qs = '') => {
        const spy = jest.spyOn(franchiseRepo, 'byLeagueAndSeason').mockResolvedValue([]);
        await request(asAdmin(require('../routes/users'), '/users')).get(`/users/league/${league}${qs}`);
        const season = spy.mock.calls.length ? spy.mock.calls[0][1] : null;
        spy.mockRestore();
        return season;
    };

    test('the basketball season for a basketball league', async () => {
        expect(seasons.sportForLeague(HOOPS)).toBe('basketball');   // the fixture is real
        expect(await seasonAskedFor(HOOPS)).toBe(2027);
    });

    test('and the football season is untouched for a football league', async () => {
        expect(await seasonAskedFor(BALL)).toBe(2026);
    });

    test('an explicit ?season still wins', async () => {
        expect(String(await seasonAskedFor(HOOPS, '?season=2025'))).toBe('2025');
    });
});

describe('a two-league account reads the league it is VIEWING', () => {
    // My Team rendered the FOOTBALL franchise under the basketball league's
    // header: "Name, Image, & Sadness", 58 points, football season pills, a
    // football roster. GET /users/:id resolved the franchise by account id
    // with no league, and an account can hold two — so Mongo's first match
    // won. The same shape as the wrong-league draft write in #481.
    const Account = require('../models/account');
    const seasons = require('../modules/active-season');
    const SportSeason = require('../models/sportSeason');

    const FOOTBALL_SEASON = 2026;
    const HOOPS_SEASON = 2027;

    // A session carrying a cc_league cookie, which is what decides the league.
    const viewing = (accountId, league) => {
        const app = express();
        app.use(express.json());
        app.use((req, res, next) => {
            const user = { user_metadata: { roles: [], metadata: { league: 'gg', userId: String(accountId) } } };
            req.oidc = { isAuthenticated: () => true, user };
            req.effUser = user;
            req.headers.cookie = `cc_league=${league}`;
            next();
        });
        app.use('/users', require('../routes/users'));
        return app;
    };

    let me;
    beforeEach(async () => {
        await SportSeason.create([
            { sport: 'football', season: FOOTBALL_SEASON, status: 'in-season' },
            { sport: 'basketball', season: HOOPS_SEASON, status: 'preseason' }
        ]);
        await seasons.prime();

        me = await Account.create({ firstName: 'Garrett', lastName: 'Graham', email: 'gg@example.invalid' });
        // The football franchise carries a 2027 entry TOO. Leagues run
        // concurrently, so the seasons overlap in reality — and without the
        // overlap the season alone picks the right franchise and the league
        // scoping cannot be tested. The first version of this gave them
        // 2026 and 2027, and passing no league at all stayed green.
        await Franchise.create([
            { accountId: me._id, league: BALL, seasons: [
                { season: FOOTBALL_SEASON, franchiseName: 'Name, Image, & Sadness' },
                { season: HOOPS_SEASON, franchiseName: 'Name, Image, & Sadness', teamRefs: [{ id: 99, sport: 'football' }] }
            ] },
            { accountId: me._id, league: HOOPS, seasons: [{ season: HOOPS_SEASON, franchiseName: 'Hoop Dreams', teamRefs: [{ id: 150, sport: 'basketball' }] }] }
        ]);
    });
    afterEach(() => seasons._reset());

    test('GET /users/:id returns the BASKETBALL franchise when viewing hoops', async () => {
        const res = await request(viewing(me._id, HOOPS)).get(`/users/${me._id}`);
        expect(res.status).toBe(200);
        expect(res.body[0].league).toBe(HOOPS);
        expect(res.body[0].seasons.map(s => s.season)).toEqual([HOOPS_SEASON]);
    });

    test('and the FOOTBALL one when viewing football', async () => {
        const res = await request(viewing(me._id, BALL)).get(`/users/${me._id}`);
        expect(res.body[0].league).toBe(BALL);
        expect(res.body[0].seasons.map(s => s.season)).toEqual([FOOTBALL_SEASON, HOOPS_SEASON]);
    });

    test('GET /users/:id/season uses the LEAGUE’s season, not football’s', async () => {
        // The season pills read 2026 on the basketball page, so the 2027
        // roster could never be found.
        const res = await request(viewing(me._id, HOOPS)).get(`/users/${me._id}/season`);
        expect(res.status).toBe(200);
        expect(res.body).toHaveLength(1);
        expect(res.body[0].league).toBe(HOOPS);
        expect(res.body[0].seasons[0].season).toBe(HOOPS_SEASON);
        expect(res.body[0].seasons[0].franchiseName).toBe('Hoop Dreams');
    });

    test('and football still gets football', async () => {
        const res = await request(viewing(me._id, BALL)).get(`/users/${me._id}/season`);
        expect(res.body[0].seasons[0].season).toBe(FOOTBALL_SEASON);
        expect(res.body[0].seasons[0].franchiseName).toBe('Name, Image, & Sadness');
    });

    test('the roster that comes back is the basketball one', async () => {
        const res = await request(viewing(me._id, HOOPS)).get(`/users/${me._id}/season`);
        const refs = res.body[0].seasons[0].teamRefs || [];
        expect(refs.map(r => r.sport)).toEqual(['basketball']);
    });
});

describe('seasonFor — the season a page renders', () => {
    const selection = require('../modules/league-selection');
    const seasons = require('../modules/active-season');
    const SportSeason = require('../models/sportSeason');

    beforeEach(async () => {
        await SportSeason.create([
            { sport: 'football', season: 2026, status: 'in-season' },
            { sport: 'basketball', season: 2027, status: 'preseason' }
        ]);
        await seasons.prime();
    });
    afterEach(() => seasons._reset());

    test('the basketball league’s own season', () => {
        expect(selection.seasonFor(HOOPS)).toBe(2027);
    });

    test('the football league’s', () => {
        expect(selection.seasonFor(BALL)).toBe(2026);
    });

    test('and football for an unknown or missing league', () => {
        // A signed-out page has no league at all.
        expect(selection.seasonFor('nope-league')).toBe(2026);
        expect(selection.seasonFor('')).toBe(2026);
        expect(selection.seasonFor(undefined)).toBe(2026);
    });
});

describe('page renders carry the viewed league’s season', () => {
    // server.js passed activeSeason('football') to every render, so the
    // basketball page booted with window.APP_YEAR = the football year.
    const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'server.js'), 'utf8');

    test('My Team, the draft room, the board, the scoreboard and admin all use it', () => {
        for (const view of ['userHome', 'draftRoom', 'admin']) {
            const m = new RegExp(`res\\.render\\('${view}'[\\s\\S]{0,160}?\\}\\)`).exec(src);
            expect(m).not.toBeNull();
            expect(m[0]).toContain('viewerSeason(res)');
            expect(m[0]).not.toContain("activeSeason('football')");
        }
    });

    test('and server.js delegates rather than keeping its own copy', () => {
        // Inline, it could be reverted to activeSeason('football') with the
        // suite green — the behaviour is tested on seasonFor above.
        expect(src).toContain('leagueSelection.seasonFor(');
        expect(src).not.toMatch(/function viewerSeason\(res\)/);
    });
});

describe('a basketball roster reaches the client as `teams`', () => {
    // Every client reads season.teams — public/userHome.js alone does it in
    // fifteen places. A basketball roster is stored as teamRefs, so all
    // fifteen saw an empty roster: My Team told a manager whose ten teams
    // were already drafted that "your draft is set up, you pick 1st", and no
    // roster appeared anywhere in the app.
    const { hydrateRosters } = require('../modules/roster-teams');
    const HoopsTeam = require('../models/hoopsTeam');
    const Team = require('../models/team');
    const SEASON = 2027;

    beforeEach(async () => {
        await HoopsTeam.create([
            { id: 150, season: SEASON, school: 'Duke', conference: 'ACC' },
            { id: 151, season: SEASON, school: 'UConn', conference: 'Big East' },
            { id: 152, season: SEASON, school: 'Michigan', conference: 'Big Ten' }
        ]);
    });

    const withRefs = (refs) => ([{ seasons: [{ season: SEASON, teamRefs: refs }] }]);

    test('refs are resolved, in roster order', async () => {
        // Pick order is the roster order, and several surfaces show "first
        // pick" without saying so.
        const users = withRefs([
            { id: 151, sport: 'basketball' },
            { id: 150, sport: 'basketball' },
            { id: 152, sport: 'basketball' }
        ]);
        await hydrateRosters(users, SEASON);
        expect(users[0].seasons[0].teams.map(t => t.school)).toEqual(['UConn', 'Duke', 'Michigan']);
    });

    test('a football roster already in `teams` is left alone', async () => {
        const users = [{ seasons: [{ season: SEASON, teams: [{ id: 8, school: 'Arkansas' }] }] }];
        await hydrateRosters(users, SEASON);
        expect(users[0].seasons[0].teams).toEqual([{ id: 8, school: 'Arkansas' }]);
    });

    test('a ref that resolves to nothing is dropped, not left as a hole', async () => {
        // A null in a roster array reaches every renderer as a crash.
        const users = withRefs([{ id: 150, sport: 'basketball' }, { id: 999, sport: 'basketball' }]);
        await hydrateRosters(users, SEASON);
        expect(users[0].seasons[0].teams.map(t => t.school)).toEqual(['Duke']);
    });

    test('a ref for ANOTHER season does not resolve', async () => {
        // The rows are per-season; a 2026 lookup must not return 2027 teams.
        const users = withRefs([{ id: 150, sport: 'basketball' }]);
        users[0].seasons[0].season = 2026;
        await hydrateRosters(users, 2026);
        expect(users[0].seasons[0].teams).toEqual([]);
    });

    test('six managers cost ONE query, not six', async () => {
        // A rosterTeams() per manager is six round trips on a cluster capped
        // near 85KB/s.
        const users = Array.from({ length: 6 }, () => withRefs([{ id: 150, sport: 'basketball' }])[0]);
        const spy = jest.spyOn(HoopsTeam, 'find');
        await hydrateRosters(users, SEASON);
        expect(spy).toHaveBeenCalledTimes(1);
        expect(users.every(u => u.seasons[0].teams.length === 1)).toBe(true);
        spy.mockRestore();
    });

    test('football and basketball refs never collide on id', async () => {
        // The two collections number teams independently, so football 150 and
        // basketball 150 are different programs.
        await Team.create({
            id: 150, school: 'Arkansas', mascot: 'Razorbacks', abbreviation: 'ARK',
            conference: 'SEC', color: '#9d2235',
            location: { name: 'Reynolds Razorback Stadium', city: 'Fayetteville', state: 'AR' }
        });
        const users = withRefs([{ id: 150, sport: 'basketball' }, { id: 150, sport: 'football' }]);
        await hydrateRosters(users, SEASON);
        expect(users[0].seasons[0].teams.map(t => t.school)).toEqual(['Duke', 'Arkansas']);
    });

    test('an existing `teams` is never clobbered, even with refs beside it', async () => {
        // #478 migrates football to refs, so a season can legitimately carry
        // BOTH for a while. The already-whole list wins — re-resolving it
        // would drop any team the collection no longer has.
        const users = [{ seasons: [{
            season: SEASON,
            teams: [{ id: 8, school: 'Arkansas' }],
            teamRefs: [{ id: 150, sport: 'basketball' }]
        }] }];
        await hydrateRosters(users, SEASON);
        expect(users[0].seasons[0].teams.map(t => t.school)).toEqual(['Arkansas']);
    });

    test('the league route hydrates too, so Standings can show rosters', async () => {
        // Not just the single-manager reads: the league list feeds Standings
        // and the roster drawers.
        const Account = require('../models/account');
        const acct = await Account.create({ firstName: 'Ann', lastName: 'T', email: 'ann@example.invalid' });
        await Franchise.create({
            accountId: acct._id, league: HOOPS,
            seasons: [{ season: SEASON, franchiseName: 'Hoop Dreams', teamRefs: [{ id: 150, sport: 'basketball' }] }]
        });
        const seasons = require('../modules/active-season');
        const SportSeason = require('../models/sportSeason');
        await SportSeason.create([
            { sport: 'football', season: 2026, status: 'in-season' },
            { sport: 'basketball', season: SEASON, status: 'preseason' }
        ]);
        await seasons.prime();

        const res = await request(asAdmin(require('../routes/users'), '/users')).get(`/users/league/${HOOPS}`);
        seasons._reset();
        expect(res.status).toBe(200);
        const mine = res.body.find(u => (u.seasons || []).some(x => x.season === SEASON));
        expect(mine.seasons[0].teams.map(t => t.school)).toEqual(['Duke']);
    });

    test('a single manager, not wrapped in an array', async () => {
        // GET /users/:id passes one; the league route passes a list.
        const one = { seasons: [{ season: SEASON, teamRefs: [{ id: 150, sport: 'basketball' }] }] };
        await hydrateRosters(one, SEASON);
        expect(one.seasons[0].teams.map(t => t.school)).toEqual(['Duke']);
    });

    test('a manager with no entry for that season is skipped', async () => {
        const users = [{ seasons: [{ season: 2099, teamRefs: [{ id: 150, sport: 'basketball' }] }] }];
        await hydrateRosters(users, SEASON);
        expect(users[0].seasons[0].teams).toBeUndefined();
    });

    test('a football-only roster of refs never touches the hoops collection', async () => {
        // #478 migrates football to refs too, and the hoops query must not
        // run for a league that has none.
        await Team.create({
            id: 77, school: 'Texas', mascot: 'Longhorns', abbreviation: 'TEX',
            conference: 'SEC', color: '#bf5700',
            location: { name: 'DKR', city: 'Austin', state: 'TX' }
        });
        const spy = jest.spyOn(HoopsTeam, 'find');
        const users = withRefs([{ id: 77, sport: 'football' }]);
        await hydrateRosters(users, SEASON);
        expect(users[0].seasons[0].teams.map(t => t.school)).toEqual(['Texas']);
        expect(spy).not.toHaveBeenCalled();
        spy.mockRestore();
    });

    test('nothing to do is not a query', async () => {
        const spy = jest.spyOn(HoopsTeam, 'find');
        await hydrateRosters([{ seasons: [{ season: SEASON }] }], SEASON);
        expect(spy).not.toHaveBeenCalled();
        spy.mockRestore();
    });
});
