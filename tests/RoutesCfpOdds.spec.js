// The CFP futures board is pasted by hand and nothing refreshes it on a
// schedule, yet it drives both the draft-grade CFP component and the standings
// projection's postseason points. So a committed board records WHEN it was
// pasted, and the admin screen can ask how stale the numbers on file are.

const express = require('express');
const request = require('supertest');
const { useMongo } = require('./helpers/mongo');
const Team = require('../models/team');
const MarketSnapshot = require('../models/marketSnapshot');
const teamsRouter = require('../routes/teams');

const SEASON = 2026;

const app = express();
app.use(express.json());
app.use('/teams', teamsRouter);

useMongo();

function fullTeam(id, school) {
    return {
        id, school, mascot: 'M', abbreviation: school.slice(0, 3).toUpperCase(),
        classification: 'fbs', conference: 'Big Ten', color: '#000', logos: [`${school}.png`],
        location: { venue_id: id, name: 'V', city: 'C', state: 'ST', zip: '1',
                    latitude: 1, longitude: 1, capacity: 100, grass: true, dome: false },
        seasons: [{ season: SEASON, conference: 'Big Ten' }]
    };
}

beforeEach(async () => {
    await Team.create([fullTeam(1, 'Oregon'), fullTeam(2, 'Alabama')]);
});

const board = 'Oregon\t-320\nAlabama\t+180\n';

describe('POST /teams/:season/cfp-odds', () => {
    it('previews without writing, and reports no commit time', async () => {
        const res = await request(app).post(`/teams/${SEASON}/cfp-odds`)
            .send({ market: 'make', text: board });
        expect(res.status).toBe(200);
        expect(res.body.dryRun).toBe(true);
        expect(res.body.matchedCount).toBe(2);
        expect(res.body.updatedAt).toBeNull();
        expect(res.body.snapshotId).toBeNull();

        const t = await Team.findOne({ id: 1 }).lean();
        expect(t.seasons[0].cfpMakeOdds).toBeUndefined();
        expect(t.seasons[0].cfpOddsUpdatedAt).toBeUndefined();
        expect(await MarketSnapshot.countDocuments()).toBe(0);
    });

    it('stamps the commit time on every team it writes', async () => {
        const before = Date.now();
        const res = await request(app).post(`/teams/${SEASON}/cfp-odds`)
            .send({ market: 'make', text: board, commit: true });
        expect(res.status).toBe(200);
        expect(res.body.updatedAt).not.toBeNull();

        const t = await Team.findOne({ id: 1 }).lean();
        expect(t.seasons[0].cfpMakeOdds).toBe(-320);
        expect(new Date(t.seasons[0].cfpOddsUpdatedAt).getTime()).toBeGreaterThanOrEqual(before - 1000);
    });
});

describe('GET /teams/:season/cfp-odds/status', () => {
    it('reports nothing on file before any board is committed', async () => {
        const res = await request(app).get(`/teams/${SEASON}/cfp-odds/status`);
        expect(res.status).toBe(200);
        expect(res.body).toMatchObject({ season: SEASON, makeCount: 0, champCount: 0, updatedAt: null });
    });

    it('counts each market separately and reports the most recent paste', async () => {
        await request(app).post(`/teams/${SEASON}/cfp-odds`).send({ market: 'make', text: board, commit: true });
        await request(app).post(`/teams/${SEASON}/cfp-odds`).send({ market: 'champ', text: 'Oregon\t+750\n', commit: true });

        const res = await request(app).get(`/teams/${SEASON}/cfp-odds/status`);
        expect(res.status).toBe(200);
        expect(res.body.makeCount).toBe(2);
        expect(res.body.champCount).toBe(1);
        expect(res.body.updatedAt).toBeTruthy();
    });

    it('rejects a season that is not four digits', async () => {
        const res = await request(app).get('/teams/20x6/cfp-odds/status');
        expect(res.status).toBe(400);
    });
});


// Pasting overwrites the odds in place, so without a snapshot there is no
// answer to "what did the market say in September" once October lands on top.
describe('CFP odds snapshots', () => {
    it('records a snapshot of the board on every commit', async () => {
        const res = await request(app).post(`/teams/${SEASON}/cfp-odds`)
            .send({ market: 'make', text: board, commit: true });
        expect(res.body.snapshotId).toBeTruthy();

        const snap = await MarketSnapshot.findById(res.body.snapshotId).lean();
        expect(snap).toMatchObject({ season: SEASON, reason: 'cfp-odds-paste', market: 'make' });
        expect(snap.teams.find(t => t.id === 1).cfpMakeOdds).toBe(-320);
    });

    it('keeps the earlier board when a second one is pasted over it', async () => {
        await request(app).post(`/teams/${SEASON}/cfp-odds`)
            .send({ market: 'make', text: 'Oregon\t-320\n', commit: true });
        await request(app).post(`/teams/${SEASON}/cfp-odds`)
            .send({ market: 'make', text: 'Oregon\t+160\n', commit: true });

        const snaps = await MarketSnapshot.find({ season: SEASON }).sort({ takenAt: 1 }).lean();
        expect(snaps).toHaveLength(2);
        const oregonIn = (s) => s.teams.find(t => t.id === 1).cfpMakeOdds;
        expect(oregonIn(snaps[0])).toBe(-320);   // the board we replaced
        expect(oregonIn(snaps[1])).toBe(160);

        // ...and the live doc holds only the newest.
        const t = await Team.findOne({ id: 1 }).lean();
        expect(t.seasons[0].cfpMakeOdds).toBe(160);
    });

    it('lists snapshots newest first, without hauling the team rows', async () => {
        await request(app).post(`/teams/${SEASON}/cfp-odds`).send({ market: 'make', text: board, commit: true });
        await request(app).post(`/teams/${SEASON}/cfp-odds`).send({ market: 'champ', text: 'Oregon\t+750\n', commit: true });

        const res = await request(app).get(`/teams/${SEASON}/market-snapshots`);
        expect(res.status).toBe(200);
        expect(res.body).toHaveLength(2);
        expect(res.body[0].market).toBe('champ');
        expect(res.body[0].teams).toBeUndefined();
    });
});
