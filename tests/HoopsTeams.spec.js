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
const { pickLogo } = require('../public/logo.js');

const app = express();
app.use(express.json());
app.use('/hoops/teams', teamsRouter);

useMongo();
beforeEach(() => { jest.spyOn(console, 'log').mockImplementation(() => {}); });
afterEach(() => jest.restoreAllMocks());

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
    const build = teamsRouter.buildUpsertOp;

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
        // The property is that no URL is synthesised, not which empty shape is
        // stored — pickLogo treats an absent array and an empty one alike.
        const logos = build(team({ sourceId: null })).updateOne.update.$set.logos || [];
        expect(logos).toHaveLength(0);
        expect(pickLogo(logos)).toBe('');
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

    test('upserts on the CBBD id', () => {
        expect(build(team()).updateOne.filter).toEqual({ id: 264 });
        expect(build(team()).updateOne.upsert).toBe(true);
    });
});

describe('POST /:season/ingest', () => {
    test('ingests and reports counts off the write result', async () => {
        stub([team(), team({ id: 2, school: 'Duke', sourceId: '150' })]);
        const res = await request(app).post('/hoops/teams/2027/ingest').send({});
        expect(res.status).toBe(200);
        expect(res.body).toMatchObject({ season: 2027, created: 2, updated: 0, teams: 2 });
        expect(await HoopsTeam.countDocuments({})).toBe(2);
    });

    test('re-running updates in place', async () => {
        stub([team()]);
        await request(app).post('/hoops/teams/2027/ingest').send({});
        const res = await request(app).post('/hoops/teams/2027/ingest').send({});
        expect(res.body).toMatchObject({ created: 0, updated: 1 });
        expect(await HoopsTeam.countDocuments({})).toBe(1);
    });

    test('an empty team list is a 422 naming the ending-year trap', async () => {
        stub([]);
        const res = await request(app).post('/hoops/teams/2026/ingest').send({});
        expect(res.status).toBe(422);
        expect(res.body.message).toMatch(/ENDING year/);
    });

    test('teams that all fail to map are a 500, not a silent success', async () => {
        stub([{ school: 'Duke' }, { id: 5 }]);
        const res = await request(app).post('/hoops/teams/2027/ingest').send({});
        expect(res.status).toBe(500);
        expect(res.body.message).toMatch(/response shape changed/);
    });

    test('an unreachable CBBD is a 502', async () => {
        const e = new Error('Could not reach CBBD'); e.unreachable = true;
        jest.spyOn(client, 'fetchTeams').mockRejectedValue(e);
        expect((await request(app).post('/hoops/teams/2027/ingest').send({})).status).toBe(502);
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
        const res = await request(app).post('/hoops/teams/2027/ingest').send({});
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
        await request(app).post('/hoops/teams/2027/ingest').send({});

        const byName = async (s) => HoopsTeam.findOne({ school: s }).lean();
        expect((await byName('UConn')).conference).toBe('Big East');
        expect((await byName('Central Connecticut')).conference).toBe('NEC');
        expect((await byName('Miami')).conference).toBe('ACC');
        expect((await byName('Miami (OH)')).conference).toBe('MAC');
    });
});
