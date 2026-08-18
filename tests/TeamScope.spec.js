// FCS teams are opponent REFERENCE DATA, not part of the league's team universe.
//
// They were added so a matchup row can render "vs EKU" instead of falling back
// to the full school name and truncating on a phone ("vs Eastern Kent…"). CFBD
// carries a real abbreviation for 127 of the 128, which is the only reason this
// is worth storing at all.
//
// But they share the `teams` collection with FBS teams, and several places read
// that collection unfiltered as "every team we care about" — most importantly
// the DRAFT POOL. Ingesting 128 FCS schools without scoping those reads would
// have put Eastern Kentucky on the draft board. These tests pin the scoping.
//
// Runs against an in-memory Mongo with the real models and the real routes.

process.env.YEAR = '2026';

const express = require('express');
const request = require('supertest');
const { useMongo } = require('./helpers/mongo');
const Team = require('../models/team');
const User = require('../models/user');
const { FBS_ONLY } = require('../modules/team-scope');

useMongo();

const SEASON = 2026;

function team(id, school, abbr, classification) {
    const doc = {
        id, school, mascot: 'Mascot', abbreviation: abbr,
        conference: 'SEC', color: '#000', logos: ['http://x/logo.png'],
        location: { venue_id: id, name: 'Stadium', city: 'City', state: 'ST', zip: '00000', latitude: 1, longitude: 1, capacity: 100, grass: true, dome: false },
        seasons: [{ season: SEASON, conference: 'SEC', spRating: 5, expectedWins: 6 }]
    };
    if (classification) doc.classification = classification;
    return doc;
}

async function seed() {
    await Team.create([
        team(1, 'Texas', 'TEX', 'fbs'),
        team(2, 'LSU', 'LSU', 'fbs'),
        // Pre-dates the field entirely — every such doc came from /teams/fbs.
        team(3, 'Oregon', 'ORE', null),
        team(98, 'Eastern Kentucky', 'EKU', 'fcs'),
        team(99, 'Abilene Christian', 'ACU', 'fcs')
    ]);
}

describe('the FBS_ONLY scope', () => {
    test('keeps FBS teams and legacy docs, drops FCS', async () => {
        await seed();
        const schools = (await Team.find(FBS_ONLY, { school: 1, _id: 0 }).lean()).map(t => t.school).sort();
        // Oregon has no classification at all and must survive — the field was
        // added after those docs were written, so absent means FBS.
        expect(schools).toEqual(['LSU', 'Oregon', 'Texas']);
    });

    test('the FCS teams are still there to look up as opponents', async () => {
        await seed();
        const eku = await Team.findOne({ id: 98 }, { abbreviation: 1, _id: 0 }).lean();
        expect(eku.abbreviation).toBe('EKU');
    });
});

describe('FCS teams stay out of the league surfaces', () => {
    test('the roster-assignment list offers only FBS teams', async () => {
        await seed();
        const app = express();
        app.use(express.json());
        app.use('/users', require('../routes/users'));

        const res = await request(app).get('/users/league/graham-league/roster-teams?season=' + SEASON);
        expect(res.status).toBe(200);
        const offered = (res.body.available || []).map(t => t.school).sort();
        // Assignable teams are the draft pool by another name — an FCS school
        // showing up here is the same bug as one showing up on the draft board.
        expect(offered).toEqual(['LSU', 'Oregon', 'Texas']);
    });

    test('enrichment readiness counts FBS teams only', async () => {
        await seed();
        const app = express();
        app.use(express.json());
        app.use('/scores', require('../routes/scores'));

        const res = await request(app).get('/scores/readiness/' + SEASON);
        expect(res.status).toBe(200);
        // All three FBS teams carry SP+, so coverage is complete. Had the two
        // FCS teams counted, this would read "3 of 5" and report a false alarm
        // on the admin readiness board every preseason.
        const sp = res.body.platform.find(c => c.key === 'spPlus');
        expect(sp.detail).toBe('3 of 3 teams');
        expect(sp.status).toBe('ready');
    });
});

// The refresh reads CFBD's /teams, which returns every division and is not
// uniformly populated. A row that cannot satisfy the model's required fields
// must be dropped BEFORE insertMany — that call is ordered, so one invalid doc
// aborts the whole insert, 400s the refresh, and skips the roster/draft
// propagation that runs after it. Both of these are real 2026 rows: Chicago
// State has no abbreviation, logos or location; West Florida has an
// abbreviation but no logos, which an abbreviation-only guard would let through.
describe('the refresh drops rows it cannot insert', () => {
    const cfbdTeam = (over) => Object.assign({
        id: 500, school: 'Somebody', mascot: 'Mascot', abbreviation: 'SMB',
        classification: 'fcs', conference: 'Big Sky', color: '#123456',
        logos: ['http://x/logo.png'],
        location: { venue_id: 500, name: 'Field', city: 'Town', state: 'ST' }
    }, over);

    test('keeps the valid fbs+fcs rows and skips the rest', async () => {
        const payload = [
            cfbdTeam({ id: 1, school: 'Texas', abbreviation: 'TEX', classification: 'fbs' }),
            cfbdTeam({ id: 2, school: 'Eastern Kentucky', abbreviation: 'EKU' }),
            // logos: null, not undefined — mongoose defaults a missing array to []
        // and `required` accepts that, so only an explicit null reproduces it.
        cfbdTeam({ id: 3, school: 'West Florida', abbreviation: 'UWF', logos: null }),
            cfbdTeam({ id: 4, school: 'Chicago State', abbreviation: null, logos: null, location: null }),
            cfbdTeam({ id: 5, school: 'Some D3 School', classification: 'iii' }),
            cfbdTeam({ id: 6, school: 'No Division', classification: undefined })
        ];
        const realFetch = global.fetch;
        global.fetch = async () => ({ ok: true, json: async () => payload });
        jest.spyOn(console, 'log').mockImplementation(() => {});

        const app = express();
        app.use(express.json());
        app.use('/teams', require('../routes/teams'));
        try {
            const res = await request(app).post('/teams/refresh').send({ year: SEASON });
            expect(res.status).toBe(201);
        } finally {
            global.fetch = realFetch;
            console.log.mockRestore();
        }

        const stored = (await Team.find({}, { school: 1, classification: 1, _id: 0 }).lean())
            .map(t => t.school).sort();
        // Texas and Eastern Kentucky only. West Florida would have thrown inside
        // insertMany and taken the whole refresh down with it.
        expect(stored).toEqual(['Eastern Kentucky', 'Texas']);
    });
});
