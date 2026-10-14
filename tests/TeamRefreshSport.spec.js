// The football team refresh must not touch basketball (#545).
//
// POST /teams/refresh pushes CFBD's fresh team fields into the denormalized
// copies — drafts.picks[].team and franchise seasons[].teams[] — matching on
// team id. CBBD numbers basketball teams independently and the ranges overlap:
// in the dev 2027 hoops draft, 20 of 60 picks share an id with a football team
// (CBB 87 = Florida, CFBD 87 = Notre Dame). Unscoped, one press of the admin
// button renamed those picks to football schools with football logos.
//
// Runs the real route against an in-memory Mongo with CFBD's fetch stubbed.

process.env.YEAR = '2026';

const express = require('express');
const request = require('supertest');
const mongoose = require('mongoose');
const { useMongo } = require('./helpers/mongo');
const Draft = require('../models/draft');
const Franchise = require('../models/franchise');
const League = require('../models/league');

useMongo();

const SEASON = 2026;

// What CFBD answers for id 87.
const NOTRE_DAME = {
    id: 87, school: 'Notre Dame', mascot: 'Fighting Irish', abbreviation: 'ND',
    classification: 'fbs', conference: 'FBS Independents', color: '#0c2340',
    logos: ['http://cfbd/nd.png'],
    location: { venue_id: 87, name: 'Notre Dame Stadium', city: 'South Bend', state: 'IN' }
};

// An embedded team as it sits in a draft pick or roster, before the refresh.
function embedded(id, school, logo) {
    return {
        id, school, mascot: 'Old', abbreviation: 'OLD', conference: 'X', color: '#111',
        logos: [logo],
        location: { venue_id: id, name: 'V', city: 'C', state: 'ST', zip: '1',
                    latitude: 1, longitude: 1, capacity: 1, grass: true, dome: false }
    };
}

const FLORIDA_CBB = () => embedded(87, 'Florida', 'http://cbbd/florida.png');
const STALE_ND = () => embedded(87, 'Notre Dame (stale)', 'http://old/nd.png');

function draft(league, team) {
    return {
        league, season: SEASON, status: 'complete',
        picks: [{ round: 1, overall: 1, userId: new mongoose.Types.ObjectId(), team }]
    };
}

function franchise(league, team) {
    return { accountId: new mongoose.Types.ObjectId(), league, seasons: [{ season: SEASON, teams: [team] }] };
}

async function refresh() {
    const realFetch = global.fetch;
    global.fetch = async () => ({ ok: true, json: async () => [NOTRE_DAME] });
    jest.spyOn(console, 'log').mockImplementation(() => {});
    const app = express();
    app.use(express.json());
    app.use('/teams', require('../routes/teams'));
    try {
        const res = await request(app).post('/teams/refresh').send({ year: SEASON });
        expect(res.status).toBe(201);
        return res.body;
    } finally {
        global.fetch = realFetch;
        console.log.mockRestore();
    }
}

beforeEach(async () => {
    // graham-league deliberately has NO League doc: the original leagues
    // pre-date the collection, and the schema's default sport is football.
    await League.create([
        { code: 'claunts-league', name: 'Claunts', sport: 'football' },
        { code: 'hoops-league', name: 'Hoops', sport: 'basketball' }
    ]);
});

describe('POST /teams/refresh is scoped to football leagues', () => {
    test("leaves a basketball draft's picks alone and still updates football drafts", async () => {
        await Draft.create([
            draft('hoops-league', FLORIDA_CBB()),
            draft('claunts-league', STALE_ND()),
            draft('graham-league', STALE_ND())
        ]);

        const body = await refresh();

        const pick = async (league) => (await Draft.findOne({ league }).lean()).picks[0].team;
        const hoops = await pick('hoops-league');
        expect(hoops.school).toBe('Florida');
        expect(hoops.logos).toEqual(['http://cbbd/florida.png']);
        expect(hoops.mascot).toBe('Old');

        expect((await pick('claunts-league')).school).toBe('Notre Dame');
        expect((await pick('graham-league')).logos).toEqual(['http://cfbd/nd.png']);
        expect(body.draftsSynced).toBe(2);
    });

    test('leaves a basketball franchise roster alone and still updates football rosters', async () => {
        // A hoops roster is normally teamRefs, with nothing embedded — but the
        // scope must not rely on that: an embedded copy on a basketball
        // franchise is exactly what the refresh would have rewritten.
        await Franchise.create([
            franchise('hoops-league', FLORIDA_CBB()),
            franchise('graham-league', STALE_ND())
        ]);

        const body = await refresh();

        const team = async (league) => (await Franchise.findOne({ league }).lean()).seasons[0].teams[0];
        const hoops = await team('hoops-league');
        expect(hoops.school).toBe('Florida');
        expect(hoops.logos).toEqual(['http://cbbd/florida.png']);

        expect((await team('graham-league')).school).toBe('Notre Dame');
        expect(body.rostersSynced).toBe(1);
    });
});
