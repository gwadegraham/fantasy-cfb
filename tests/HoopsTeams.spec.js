// Basketball team ingest (#317, Hardwood B4).
//
// The shapes below were taken from the live /teams?season=2027 payload, not
// imagined — measured across all 365 rows: school is present and UNIQUE,
// mascot is never null (the issue expected nullable), secondaryColor is absent
// for 34 teams, and colours arrive without a '#'.

const express = require('express');
const request = require('supertest');
const { useMongo } = require('./helpers/mongo');
const HoopsTeam = require('../models/hoopsTeam');
const teamsRouter = require('../routes/hoopsTeams');
const client = require('../modules/cbbd-client');
const SportSeason = require('../models/sportSeason');
const activeSeason = require('../modules/active-season');
const { pickLogo } = require('../public/logo.js');

const app = express();
app.use(express.json());
app.use('/hoops/teams', teamsRouter);

useMongo();
const SEASON = 2027;

beforeEach(async () => {
    jest.spyOn(console, 'log').mockImplementation(() => {});
    activeSeason._reset();
    await SportSeason.create([{ sport: 'football', season: 2026, status: 'in-season' },
                               { sport: 'basketball', season: SEASON, status: 'preseason' }]);
    await activeSeason.prime();
    // Default: every fixture team has a logo. Tests that care override it.
    jest.spyOn(client, 'logoIdsThatExist').mockImplementation(async (ids) => new Set(ids.filter(Boolean).map(String)));
});
afterEach(() => jest.restoreAllMocks());

// Every buildUpsertOp call now needs the season and the verified-logo set.
const HAVE_ALL = { has: () => true };
const HAVE_NONE = { has: () => false };

const team = (over = {}) => Object.assign({
    id: 264, sourceId: '2561', school: 'Siena', mascot: 'Saints', abbreviation: 'SIE',
    displayName: 'Siena Saints', shortDisplayName: 'Siena',
    primaryColor: '037961', secondaryColor: 'eea60f',
    currentVenueId: 71, currentVenue: 'MVP Arena', currentCity: 'Albany', currentState: 'NY',
    conferenceId: 16, conference: 'Metro'
}, over);

const stub = (data) => jest.spyOn(client, 'fetchTeams')
    .mockResolvedValue({ data, remainingCalls: 28852 });

describe('buildUpsertOp', () => {
    const build = (t, have = HAVE_ALL) => teamsRouter.buildUpsertOp(t, SEASON, have);

    test('colours gain the # prefix CBBD omits', () => {
        // Every renderer in public/ and every stored football row expects it.
        const doc = build(team()).updateOne.update.$set;
        expect(doc.color).toBe('#037961');
        expect(doc.alt_color).toBe('#eea60f');
    });

    test('and adding it is idempotent', () => {
        const doc = build(team({ primaryColor: '#ABCDEF' })).updateOne.update.$set;
        expect(doc.color).toBe('#abcdef');
    });

    test('a team with no secondary colour stores none, rather than "#"', () => {
        // 34 of 365 are in this state.
        const doc = build(team({ secondaryColor: null })).updateOne.update.$set;
        expect(doc.alt_color).toBeUndefined();
        expect(doc.color).toBe('#037961');
    });

    test('logos are synthesised from sourceId in football\'s exact shape', () => {
        const doc = build(team()).updateOne.update.$set;
        expect(doc.logos).toHaveLength(16);
        expect(doc.logos).toContain('https://cdn.collegefootballdata.com/logos/500/2561.png');
        expect(doc.logos).toContain('https://cdn.collegefootballdata.com/logos-dark/16/2561.png');
    });

    test('and the football logo helper picks one unchanged', () => {
        // The whole point of mirroring the shape: no sport branch in public/.
        const doc = build(team()).updateOne.update.$set;
        expect(pickLogo(doc.logos, { dark: true })).toMatch(/logos-dark\/500\/2561\.png$/);
        expect(pickLogo(doc.logos, { dark: false })).toMatch(/logos\/500\/2561\.png$/);
    });

    test('a team with no sourceId gets no logos rather than a broken URL', () => {
        const logos = build(team({ sourceId: null })).updateOne.update.$set.logos || [];
        expect(logos).toHaveLength(0);
        expect(pickLogo(logos)).toBe('');
    });

    // ⚠️ The finding this file got wrong first time round.
    test('a team the CDN does not serve gets NO logos, not 16 dead URLs', () => {
        // The CFBD CDN only hosts schools CFBD knows about — football schools.
        // 101 of 365 basketball teams have nothing there: Gonzaga, Marquette,
        // Seton Hall, Saint Mary's, and Siena, which is this file's own fixture.
        // Synthesising anyway gave them 16 links that all 403, and every render
        // site emits a bare <img> with no onerror, so the row showed a broken
        // image rather than falling back.
        const logos = build(team(), HAVE_NONE).updateOne.update.$set.logos;
        expect(logos).toEqual([]);
        expect(pickLogo(logos)).toBe('');
    });

    test('the season is part of the document AND the upsert key', () => {
        // /teams answers for ANY season and 27 teams change conference between
        // 2026 and 2027, so an id-only key let the wrong season rewrite live rows.
        const op = build(team());
        expect(op.updateOne.update.$set.season).toBe(SEASON);
        expect(op.updateOne.filter).toEqual({ id: 264, season: SEASON });
    });

    test('a field CBBD stops sending is UNSET, not left stale', () => {
        // Deleting the key from $set only skips it: a team whose wrong secondary
        // colour is corrected upstream would keep the wrong value forever.
        const op = build(team({ secondaryColor: null }));
        expect(op.updateOne.update.$set.alt_color).toBeUndefined();
        expect(op.updateOne.update.$unset).toHaveProperty('alt_color');
    });

    test('sourceId stays a string', () => {
        expect(build(team({ sourceId: '0402' })).updateOne.update.$set.sourceId).toBe('0402');
    });

    test('rows with no id or no school are skipped', () => {
        // school is the key the Torvik pool import will match on, so a blank
        // one is worse than useless.
        expect(build(team({ id: null }))).toBeNull();
        expect(build(team({ school: null }))).toBeNull();
        expect(build(null)).toBeNull();
    });

    test('upserts rather than inserting', () => {
        expect(build(team()).updateOne.upsert).toBe(true);
    });
});

describe('POST /:season/ingest', () => {
    test('ingests and reports counts off the write result', async () => {
        stub([team(), team({ id: 2, school: 'Duke', sourceId: '150' })]);
        const res = await request(app).post(`/hoops/teams/${SEASON}/ingest`).send({});
        expect(res.status).toBe(200);
        expect(res.body).toMatchObject({ season: 2027, created: 2, updated: 0, teams: 2 });
        expect(await HoopsTeam.countDocuments({})).toBe(2);
    });

    test('re-running updates in place', async () => {
        stub([team()]);
        await request(app).post(`/hoops/teams/${SEASON}/ingest`).send({});
        const res = await request(app).post(`/hoops/teams/${SEASON}/ingest`).send({});
        expect(res.body).toMatchObject({ created: 0, updated: 1 });
        expect(await HoopsTeam.countDocuments({})).toBe(1);
    });

    // ⚠️ The guard that used to be here could never fire.
    test('a season that is not the stored basketball season is refused', async () => {
        // The old guard checked for an EMPTY response, copied from /games. But
        // /teams returns 365 teams for season=2026 and even 40 for 1900, so it
        // never fired for the off-by-one it named — while 27 teams carry a
        // different conference in 2026, silently poisoning the (school,
        // conference) key the Torvik pool import is built on.
        const spy = stub([team()]);
        const res = await request(app).post('/hoops/teams/2026/ingest').send({});
        expect(res.status).toBe(422);
        expect(res.body).toMatchObject({ requested: 2026, expected: SEASON });
        expect(res.body.message).toMatch(/ENDING year/);
        expect(spy).not.toHaveBeenCalled();
    });

    test('but ?force=1 allows a deliberate backfill', async () => {
        stub([team()]);
        const res = await request(app).post('/hoops/teams/2026/ingest?force=1').send({});
        expect(res.status).toBe(200);
        expect((await HoopsTeam.findOne({ id: 264 }).lean()).season).toBe(2026);
    });

    test('and a forced other-season ingest does NOT touch the live rows', async () => {
        stub([team({ conference: 'Metro' })]);
        await request(app).post(`/hoops/teams/${SEASON}/ingest`).send({});
        stub([team({ conference: 'WRONG' })]);
        await request(app).post('/hoops/teams/2026/ingest?force=1').send({});

        expect((await HoopsTeam.findOne({ id: 264, season: 2027 }).lean()).conference).toBe('Metro');
        expect((await HoopsTeam.findOne({ id: 264, season: 2026 }).lean()).conference).toBe('WRONG');
        expect(await HoopsTeam.countDocuments({})).toBe(2);
    });

    test('an empty response is a 500 — the endpoint changed, not the season', async () => {
        stub([]);
        const res = await request(app).post(`/hoops/teams/${SEASON}/ingest`).send({});
        expect(res.status).toBe(500);
        expect(res.body.message).toMatch(/never/);
    });

    test('teams without a CDN logo are counted and stored empty', async () => {
        client.logoIdsThatExist.mockResolvedValue(new Set(['150']));
        stub([team({ id: 1, sourceId: '150', school: 'Duke' }), team({ id: 2, sourceId: '2561', school: 'Siena' })]);
        const res = await request(app).post(`/hoops/teams/${SEASON}/ingest`).send({});
        expect(res.body.withLogos).toBe(1);
        expect((await HoopsTeam.findOne({ school: 'Duke' }).lean()).logos).toHaveLength(16);
        expect((await HoopsTeam.findOne({ school: 'Siena' }).lean()).logos).toEqual([]);
    });

    test('a failed logo probe stores no logos rather than unverified ones', async () => {
        client.logoIdsThatExist.mockRejectedValue(new Error('CDN down'));
        stub([team()]);
        const res = await request(app).post(`/hoops/teams/${SEASON}/ingest`).send({});
        expect(res.status).toBe(200);
        expect((await HoopsTeam.findOne({ id: 264 }).lean()).logos).toEqual([]);
    });

    test('a CBBD 429 or 5xx is a 502, not a 400', async () => {
        const e = new Error('CBBD /teams 429: slow down'); e.status = 429;
        jest.spyOn(client, 'fetchTeams').mockRejectedValue(e);
        const res = await request(app).post(`/hoops/teams/${SEASON}/ingest`).send({});
        expect(res.status).toBe(502);
        expect(res.body.upstreamStatus).toBe(429);
    });

    test('teams that all fail to map are a 500, not a silent success', async () => {
        stub([{ school: 'Duke' }, { id: 5 }]);
        const res = await request(app).post(`/hoops/teams/${SEASON}/ingest`).send({});
        expect(res.status).toBe(500);
        expect(res.body.message).toMatch(/response shape changed/);
    });

    test('an unreachable CBBD is a 502', async () => {
        const e = new Error('Could not reach CBBD'); e.unreachable = true;
        jest.spyOn(client, 'fetchTeams').mockRejectedValue(e);
        expect((await request(app).post(`/hoops/teams/${SEASON}/ingest`).send({})).status).toBe(502);
    });

    test('a non-numeric season is refused before any fetch', async () => {
        const spy = stub([team()]);
        expect((await request(app).post('/hoops/teams/xx/ingest').send({})).status).toBe(400);
        expect(spy).not.toHaveBeenCalled();
    });

    test('a duplicate-key loss to a concurrent run is still a success', async () => {
        stub([team()]);
        const err = new Error('E11000 duplicate key');
        err.result = { upsertedCount: 1, matchedCount: 0 };
        err.writeErrors = [{ code: 11000 }];
        jest.spyOn(HoopsTeam, 'bulkWrite').mockRejectedValue(err);
        const res = await request(app).post(`/hoops/teams/${SEASON}/ingest`).send({});
        expect(res.status).toBe(200);
        expect(res.body.created).toBe(1);
    });
});

describe('the names the Torvik pool import will have to match', () => {
    // Recorded here because the dangerous cases SUBSTITUTE rather than drop:
    // Torvik's "Connecticut" fuzzy-matches CBBD's "Central Connecticut", and
    // "Miami FL" matches "Miami (OH)". Both pairs differ by conference, which
    // is what makes (school, conference) a safe key and bare name matching not.
    test('the ambiguous pairs are distinguishable by conference', async () => {
        stub([
            team({ id: 41, school: 'UConn', conference: 'Big East' }),
            team({ id: 42, school: 'Central Connecticut', conference: 'NEC' }),
            team({ id: 43, school: 'Miami', conference: 'ACC' }),
            team({ id: 44, school: 'Miami (OH)', conference: 'MAC' })
        ]);
        await request(app).post(`/hoops/teams/${SEASON}/ingest`).send({});

        const byName = async (s) => HoopsTeam.findOne({ school: s }).lean();
        expect((await byName('UConn')).conference).toBe('Big East');
        expect((await byName('Central Connecticut')).conference).toBe('NEC');
        expect((await byName('Miami')).conference).toBe('ACC');
        expect((await byName('Miami (OH)')).conference).toBe('MAC');
    });
});
