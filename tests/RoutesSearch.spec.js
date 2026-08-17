// GET /search/index — the index behind the app-wide search palette.
//
// The security property under test is the manager list. It is scoped by reading
// the caller's league off req.effUser, NOT from anything the client sends, so
// there is no parameter to tamper with. That is deliberate: this app has already
// had one wrong-league incident, and a league code in the URL would be a standing
// invitation to repeat it. The final test is the one that would catch a
// regression to a client-supplied league.
//
// The route, models and Mongo are real; only the session is faked.

const express = require('express');
const request = require('supertest');
const mongoose = require('mongoose');
const { useMongo } = require('./helpers/mongo');
const Team = require('../models/team');
const User = require('../models/user');
const searchRouter = require('../routes/search');

const SEASON = 2026;

// Mounts the router behind a middleware that fakes an authenticated session for
// the given league, mirroring what server.js's devRole middleware sets.
function appAs(leagueFlag) {
    const app = express();
    app.use(express.json());
    app.use((req, res, next) => {
        req.effUser = {
            sub: 'auth0|spec',
            user_metadata: { roles: [], metadata: { league: leagueFlag, userId: 'spec' } }
        };
        next();
    });
    app.use('/search', searchRouter);
    return app;
}

const asGraham = appAs('gg');       // -> graham-league
const asClaunts = appAs('cl');      // -> claunts-league

useMongo();

let prevYear;
beforeAll(() => { prevYear = process.env.YEAR; process.env.YEAR = String(SEASON); });
afterAll(() => { process.env.YEAR = prevYear; });

// CFBD hands back many logo URLs — 8 sizes x light/dark. The dark 500 is the one
// pickLogo should choose, and it arrives over http, which must be upgraded.
const LOGOS = [
    'http://a.espncdn.com/i/teamlogos/ncaa/500/8.png',
    'http://a.espncdn.com/i/teamlogos/ncaa/500-dark/8.png',
    'http://a.espncdn.com/i/teamlogos/ncaa/16/8.png',
    'http://a.espncdn.com/i/teamlogos/ncaa/16-dark/8.png'
];

beforeEach(async () => {
    await Team.create([{
        id: 8, school: 'Arkansas', mascot: 'Razorbacks', abbreviation: 'ARK',
        conference: 'SEC', color: '#9d2235', logos: LOGOS,
        alt_name1: 'Arkansas', alt_name2: 'ARK', alt_name3: 'Arkansas',
        alternateNames: ['ARK', 'Arkansas'],
        location: { name: 'Reynolds Razorback Stadium', city: 'Fayetteville', state: 'AR' },
        // 60 weeks of scoring the palette has no use for — present so the
        // projection is doing real work rather than trivially passing.
        weeklyScore: Array.from({ length: 60 }, (_, i) => ({
            week: (i % 15) + 1, seasonType: 'regular', season: SEASON, scoreV1: i, scoreV2: i
        })),
        seasons: [{ season: SEASON, conference: 'SEC', spRating: 12 }]
    }, {
        id: 2032, school: 'Arkansas State', mascot: 'Red Wolves', abbreviation: 'ARST',
        conference: 'Sun Belt', color: '#cc092f', logos: [],
        location: { name: 'Centennial Bank Stadium', city: 'Jonesboro', state: 'AR' },
        seasons: [{ season: SEASON, conference: 'Sun Belt' }]
    }]);

    await User.create([{
        firstName: 'Garrett', lastName: 'Graham', email: 'gg@example.com',
        league: 'graham-league', color: '#8E8CF0',
        avatarUrl: 'https://res.cloudinary.com/x/image/upload/v1/gg.jpg',
        seasons: [
            { season: SEASON - 1, franchiseName: 'Old Name' },
            { season: SEASON, franchiseName: 'Razorback Rejects' }
        ]
    }, {
        firstName: 'Cole', lastName: 'Smith', email: 'cs@example.com',
        league: 'claunts-league', color: '#22C37A',
        seasons: [{ season: SEASON, franchiseName: 'Claunts Crew' }]
    }]);
});

const get = (app) => request(app).get('/search/index');

describe('teams', () => {
    test('returns every team, shaped for the palette', async () => {
        const res = await get(asGraham);
        expect(res.status).toBe(200);
        expect(res.body.teams).toHaveLength(2);

        const ark = res.body.teams.find((t) => t.name === 'Arkansas');
        expect(ark).toMatchObject({ type: 'team', id: 8, name: 'Arkansas', sub: 'SEC', color: '#9d2235' });
    });

    test('the logo is resolved server-side to the dark, highest-res, https URL', async () => {
        const res = await get(asGraham);
        const ark = res.body.teams.find((t) => t.name === 'Arkansas');
        // Not the raw array, and not the 16px dark one `.at(-1)` would have given.
        expect(ark.image).toBe('https://a.espncdn.com/i/teamlogos/ncaa/500-dark/8.png');
    });

    test('a team with no logos yields an empty string rather than throwing', async () => {
        const res = await get(asGraham);
        expect(res.body.teams.find((t) => t.name === 'Arkansas State').image).toBe('');
    });

    test('aliases carry mascot and abbreviation, de-duped', async () => {
        const res = await get(asGraham);
        const ark = res.body.teams.find((t) => t.name === 'Arkansas').aliases;
        expect(ark).toContain('Razorbacks');
        expect(ark).toContain('ARK');
        // alt_name1/3 and alternateNames all repeat "Arkansas" and "ARK" in the
        // real data; the payload must not.
        expect(new Set(ark).size).toBe(ark.length);
    });

    test('the heavy fields never reach the client', async () => {
        // weeklyScore is 152 KB across the collection and seasons is 729 KB.
        // Neither is any use to a search row, and shipping them would put the
        // index back over 1 MB.
        const t = (await get(asGraham)).body.teams[0];
        expect(t.weeklyScore).toBeUndefined();
        expect(t.seasons).toBeUndefined();
        expect(t.logos).toBeUndefined();
        expect(t.location).toBeUndefined();
    });
});

describe('managers', () => {
    test('uses the ACTIVE season franchise name, not the newest entry', async () => {
        const res = await get(asGraham);
        expect(res.body.managers).toHaveLength(1);
        expect(res.body.managers[0]).toMatchObject({
            type: 'manager', name: 'Garrett Graham', sub: 'Razorback Rejects', initials: 'GG'
        });
    });

    test('a member with no entry for the active season still resolves', async () => {
        await User.create({
            firstName: 'Past', lastName: 'Member', email: 'pm@example.com',
            league: 'graham-league', seasons: [{ season: SEASON - 1, franchiseName: 'Gone' }]
        });
        const res = await get(asGraham);
        const past = res.body.managers.find((m) => m.name === 'Past Member');
        expect(past.sub).toBe('');                 // NOT last season's "Gone"
        expect(past.initials).toBe('PM');
    });

    test('falls back to initials + colour when there is no avatar', async () => {
        const res = await get(asClaunts);
        expect(res.body.managers[0]).toMatchObject({ name: 'Cole Smith', image: null, initials: 'CS', color: '#22C37A' });
    });

    test('the id is the one /userHome expects', async () => {
        const res = await get(asGraham);
        const saved = await User.findOne({ firstName: 'Garrett' }).lean();
        expect(res.body.managers[0].id).toBe(String(saved._id));
        expect(mongoose.Types.ObjectId.isValid(res.body.managers[0].id)).toBe(true);
    });
});

describe('league scoping', () => {
    // The one that matters. Teams are shared CFBD data, so both leagues see all
    // of them; managers are not.
    test('a viewer only ever sees their OWN league\'s managers', async () => {
        const graham = (await get(asGraham)).body;
        const claunts = (await get(asClaunts)).body;

        expect(graham.managers.map((m) => m.name)).toEqual(['Garrett Graham']);
        expect(claunts.managers.map((m) => m.name)).toEqual(['Cole Smith']);

        // Same team list for both — no per-league filtering leaked into teams.
        expect(graham.teams.map((t) => t.id).sort()).toEqual(claunts.teams.map((t) => t.id).sort());
    });

    test('a league code in the query string is ignored', async () => {
        // Scoping reads the session, so there is nothing here to override. If
        // this ever starts returning Cole, someone has wired a client-supplied
        // league into the handler.
        const res = await request(asGraham).get('/search/index?league=claunts-league&code=claunts-league');
        expect(res.body.managers.map((m) => m.name)).toEqual(['Garrett Graham']);
    });
});
