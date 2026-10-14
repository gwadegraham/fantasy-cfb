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
const League = require('../models/league');
const Draft = require('../models/draft');
const mongoose = require('mongoose');

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
    // Default: every fixture team's logo loads. Tests that care override it.
    jest.spyOn(client, 'logoUrlsThatExist').mockImplementation(async (urls) => new Set(urls.filter(Boolean)));
});
afterEach(() => jest.restoreAllMocks());

// Every buildUpsertOp call now needs the season and the verified-logo set.
const HAVE_ALL = { has: () => true };
const HAVE_NONE = { has: () => false };

// CBBD's /teams `logos`, in the order and shape it sends them (#508): light
// and dark at eight sizes, keyed on sourceId.
const SIZES = [500, 256, 128, 96, 64, 48, 32, 16];
const cbbLogos = (sourceId) => SIZES.flatMap(n => [
    `http://cdn.collegefootballdata.com/cbb-logos/${n}/${sourceId}.png`,
    `http://cdn.collegefootballdata.com/cbb-logos-dark/${n}/${sourceId}.png`
]);
const probeOf = (sourceId) => `https://cdn.collegefootballdata.com/cbb-logos/500/${sourceId}.png`;

const team = (over = {}) => Object.assign({
    id: 264, sourceId: '2561', logos: cbbLogos('2561'), school: 'Siena', mascot: 'Saints', abbreviation: 'SIE',
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

    test('logos are the 16 CBBD sends, stored as sent', () => {
        // #508: CBBD's /teams carries football's exact shape now, so nothing is
        // built from sourceId and nothing comes from ESPN.
        const doc = build(team()).updateOne.update.$set;
        expect(doc.logos).toEqual(cbbLogos('2561'));
        expect(doc.logos.join(' ')).not.toMatch(/espncdn/);
    });

    test('and the football logo helper picks from them unchanged', () => {
        // The point of keeping the array shape: no sport branch in public/.
        const doc = build(team()).updateOne.update.$set;
        expect(pickLogo(doc.logos)).toBe('https://cdn.collegefootballdata.com/cbb-logos-dark/500/2561.png');
        expect(pickLogo(doc.logos, { dark: false })).toBe(probeOf('2561'));
    });

    test('the probe set is keyed on the largest LIGHT url', () => {
        const asked = [];
        build(team(), { has: (u) => { asked.push(u); return true; } });
        expect(asked).toEqual([probeOf('2561')]);
    });

    test('a team CBBD sends no logos for gets none, not a built URL', () => {
        const logos = build(team({ logos: undefined })).updateOne.update.$set.logos;
        expect(logos).toEqual([]);
        expect(pickLogo(logos)).toBe('');
        expect(build(team({ logos: [] })).updateOne.update.$set.logos).toEqual([]);
    });

    test('non-string entries are dropped before they reach an <img src>', () => {
        const logos = build(team({ logos: [null, 42, { u: 1 }, ...cbbLogos('2561')] })).updateOne.update.$set.logos;
        expect(logos).toEqual(cbbLogos('2561'));
    });

    // ⚠️ The finding this file got wrong first time round.
    test('a team whose logo does not load gets NO logos, not 16 dead URLs', () => {
        // The first version of this ingest built URLs blindly and 101 of 365
        // teams got links that all 403. Every render site emits a bare <img>
        // with no onerror, so the row showed a broken image.
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

    test('teams without a loadable logo are counted and stored empty', async () => {
        client.logoUrlsThatExist.mockResolvedValue(new Set([probeOf('150')]));
        stub([team({ id: 1, sourceId: '150', school: 'Duke', logos: cbbLogos('150') }), team({ id: 2, school: 'Siena' })]);
        const res = await request(app).post(`/hoops/teams/${SEASON}/ingest`).send({});
        expect(res.body.withLogos).toBe(1);
        expect((await HoopsTeam.findOne({ school: 'Duke' }).lean()).logos).toHaveLength(16);
        expect((await HoopsTeam.findOne({ school: 'Siena' }).lean()).logos).toEqual([]);
    });

    test('the probe is handed the API\'s own URLs, one per team', async () => {
        stub([team({ id: 1, sourceId: '150', school: 'Duke', logos: cbbLogos('150') }), team({ id: 2, school: 'Siena' })]);
        await request(app).post(`/hoops/teams/${SEASON}/ingest`).send({});
        expect(client.logoUrlsThatExist).toHaveBeenCalledWith([probeOf('150'), probeOf('2561')]);
    });

    // The "done when" test in #508, end to end through the real probe: CBBD
    // hands over 16 URLs, the CDN 404s them, and nothing is stored.
    test('API logos that 404 on the CDN are stored as []', async () => {
        client.logoUrlsThatExist.mockRestore();
        const seen = [];
        jest.spyOn(global, 'fetch').mockImplementation(async (url) => {
            seen.push(url);
            return { ok: !url.includes('/2561.png'), status: url.includes('/2561.png') ? 404 : 200 };
        });
        stub([team({ id: 1, sourceId: '150', school: 'Duke', logos: cbbLogos('150') }), team({ id: 2, school: 'Siena' })]);
        const res = await request(app).post(`/hoops/teams/${SEASON}/ingest`).send({});
        expect(res.status).toBe(200);
        expect(res.body.withLogos).toBe(1);
        expect((await HoopsTeam.findOne({ school: 'Siena' }).lean()).logos).toEqual([]);
        expect((await HoopsTeam.findOne({ school: 'Duke' }).lean()).logos).toEqual(cbbLogos('150'));
        expect(seen.sort()).toEqual([probeOf('150'), probeOf('2561')]);
    });

    test('a failed logo probe stores no logos rather than unverified ones', async () => {
        client.logoUrlsThatExist.mockRejectedValue(new Error('CDN down'));
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

describe('refreshing the draft\'s copies of each team', () => {
    // Draft picks store a full copy of the team, so a re-ingest alone left the
    // draft room on ESPN URLs. Football has the same job in routes/teams.js.
    const ESPN = ['https://a.espncdn.com/i/teamlogos/ncaa/500/2561.png'];
    const pick = (overall, t) => ({ round: 1, overall, userId: new mongoose.Types.ObjectId(), team: t });
    const draftOf = (league, season, picks) => Draft.create({ league, season, picks });

    beforeEach(async () => {
        await League.create([
            { code: 'hoops-league', name: 'Hoops', sport: 'basketball', season: SEASON },
            { code: 'graham-league', name: 'Graham', sport: 'football', season: 2026 }
        ]);
        await activeSeason.prime();
    });

    test('the ingest repaints this season\'s basketball picks', async () => {
        await draftOf('hoops-league', SEASON, [pick(1, { id: 264, school: 'Siena', logos: ESPN }),
                                              pick(2, { id: 9999, school: 'Not ingested', logos: ESPN })]);
        stub([team()]);
        const res = await request(app).post(`/hoops/teams/${SEASON}/ingest`).send({});
        expect(res.body.draftCopies).toEqual({ drafts: 1, failed: 0, skippedLive: 0 });
        const d = await Draft.findOne({ league: 'hoops-league' }).lean();
        expect(d.picks[0].team.logos).toEqual(cbbLogos('2561'));
        expect(d.picks[0].team.color).toBe('#037961');
        // A team the ingest did not return is left alone, not blanked.
        expect(d.picks[1].team.logos).toEqual(ESPN);
    });

    test('but never a FOOTBALL draft, whose ids mean different teams', async () => {
        // CBB 87 is Florida; football 87 is Notre Dame. 20 of the 60 real hoops
        // picks share an id with a football team.
        await draftOf('graham-league', SEASON, [pick(1, { id: 264, school: 'Football 264', logos: ESPN })]);
        stub([team()]);
        await request(app).post(`/hoops/teams/${SEASON}/ingest`).send({});
        const d = await Draft.findOne({ league: 'graham-league' }).lean();
        expect(d.picks[0].team).toMatchObject({ school: 'Football 264', logos: ESPN });
    });

    test('nor another season\'s basketball draft', async () => {
        await draftOf('hoops-league', 2026, [pick(1, { id: 264, school: 'Siena', logos: ESPN })]);
        stub([team()]);
        await request(app).post('/hoops/teams/2026/ingest?force=1').send({});
        expect((await Draft.findOne({ season: 2026 }).lean()).picks[0].team.logos).toEqual(cbbLogos('2561'));
        stub([team({ logos: cbbLogos('X') })]);
        await request(app).post(`/hoops/teams/${SEASON}/ingest`).send({});
        expect((await Draft.findOne({ season: 2026 }).lean()).picks[0].team.logos).toEqual(cbbLogos('2561'));
    });

    test('a probe miss keeps the pick\'s logos rather than blanking them', async () => {
        // One CDN outage during the prod re-run would otherwise strip all 60
        // picks. The team row still stores [], so nothing unverified is served.
        client.logoUrlsThatExist.mockResolvedValue(new Set());
        await draftOf('hoops-league', SEASON, [pick(1, { id: 264, school: 'Old name', logos: ESPN })]);
        stub([team()]);
        await request(app).post(`/hoops/teams/${SEASON}/ingest`).send({});
        expect((await HoopsTeam.findOne({ id: 264 }).lean()).logos).toEqual([]);
        const t = (await Draft.findOne({ league: 'hoops-league' }).lean()).picks[0].team;
        expect(t.logos).toEqual(ESPN);
        expect(t.school).toBe('Siena');   // the other fields still refresh
    });

    test('a LIVE draft is left alone', async () => {
        // The socket $pushes picks without bumping __v, so saving a picks array
        // loaded a moment earlier would erase the pick made in between.
        await Draft.create({ league: 'hoops-league', season: SEASON, status: 'active',
            picks: [pick(1, { id: 264, school: 'Siena', logos: ESPN })] });
        stub([team()]);
        const res = await request(app).post(`/hoops/teams/${SEASON}/ingest`).send({});
        expect(res.body.draftCopies).toMatchObject({ drafts: 0, skippedLive: 1 });
        expect((await Draft.findOne({ league: 'hoops-league' }).lean()).picks[0].team.logos).toEqual(ESPN);
    });

    test('an unprimed season cache does not silently skip the refresh', async () => {
        // sportForLeague answers 'football' for every league when unprimed.
        activeSeason._reset();
        await draftOf('hoops-league', SEASON, [pick(1, { id: 264, school: 'Siena', logos: ESPN })]);
        stub([team()]);
        const res = await request(app).post(`/hoops/teams/${SEASON}/ingest?force=1`).send({});
        expect(res.body.draftCopies.drafts).toBe(1);
    });

    test('a failed copy refresh still reports the team write', async () => {
        jest.spyOn(Draft, 'find').mockRejectedValue(new Error('boom'));
        stub([team()]);
        const res = await request(app).post(`/hoops/teams/${SEASON}/ingest`).send({});
        expect(res.status).toBe(200);
        expect(res.body.draftCopies.error).toBe('boom');
        expect(await HoopsTeam.countDocuments({})).toBe(1);
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
