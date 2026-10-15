// /standings/last-updated is per sport (#575). It used to read football's
// scoring jobs for every league, so a basketball league's badge moved when
// football scored and stood still when hoops-scores ran. These seed both
// sports' runs at different times and check each league gets its own.

const express = require('express');
const request = require('supertest');
const { useMongo } = require('./helpers/mongo');
const JobRun = require('../models/jobRun');
const League = require('../models/league');
const SportSeason = require('../models/sportSeason');
const seasons = require('../modules/active-season');

useMongo();

const app = express();
app.use('/standings', require('../routes/standings'));

const minutesAgo = m => new Date(Date.now() - m * 60 * 1000);

beforeEach(async () => {
    await League.create([
        { code: 'graham-league', name: 'Graham', sport: 'football' },
        { code: 'hoops-league', name: 'Hardwood', sport: 'basketball' }
    ]);
    await SportSeason.create([
        { sport: 'football', season: 2026, status: 'in-season' },
        { sport: 'basketball', season: 2027, status: 'in-season' }
    ]);
    await seasons.prime();
    // Football scored most recently; basketball's last run is older.
    await JobRun.create([
        { jobName: 'saturday-scores', status: 'success', startedAt: minutesAgo(12), finishedAt: minutesAgo(10), week: 7 },
        { jobName: 'hoops-scores', status: 'success', startedAt: minutesAgo(62), finishedAt: minutesAgo(60), week: 2 }
    ]);
});
afterEach(() => seasons._reset());

describe('GET /standings/last-updated per sport', () => {
    test('a basketball league gets hoops-scores, not the newer football run', async () => {
        const res = await request(app).get('/standings/last-updated?league=hoops-league');
        expect(res.status).toBe(200);
        expect(res.body.jobName).toBe('hoops-scores');
        expect(res.body.week).toBe(2);
    });

    test('a football league still gets football', async () => {
        const res = await request(app).get('/standings/last-updated?league=graham-league');
        expect(res.body.jobName).toBe('saturday-scores');
        expect(res.body.week).toBe(7);
    });

    test('no league (signed out) falls back to football', async () => {
        const res = await request(app).get('/standings/last-updated');
        expect(res.body.jobName).toBe('saturday-scores');
    });

    test('a hoops-live final counts as basketball data', async () => {
        await JobRun.create({ jobName: 'hoops-live', status: 'success', startedAt: minutesAgo(31), finishedAt: minutesAgo(30) });
        const res = await request(app).get('/standings/last-updated?league=hoops-league');
        expect(res.body.jobName).toBe('hoops-live');
    });

    test('a basketball league with no basketball run is null, not football', async () => {
        await JobRun.deleteMany({ jobName: 'hoops-scores' });
        const res = await request(app).get('/standings/last-updated?league=hoops-league');
        expect(res.body).toBeNull();
    });

    describe('running', () => {
        test('hoops-scores in flight → running on the basketball league only', async () => {
            await JobRun.create({ jobName: 'hoops-scores', status: 'running', startedAt: minutesAgo(1) });
            const hoops = await request(app).get('/standings/last-updated?league=hoops-league');
            const football = await request(app).get('/standings/last-updated?league=graham-league');
            expect(hoops.body.running).toBe(true);
            expect(football.body.running).toBe(false);
        });

        test('a football job in flight does not make the basketball league busy', async () => {
            await JobRun.create({ jobName: 'daily-scores', status: 'running', startedAt: minutesAgo(1) });
            const res = await request(app).get('/standings/last-updated?league=hoops-league');
            expect(res.body.running).toBe(false);
        });

        // Mirrors football leaving out its live poller.
        test('a hoops-live tick in flight does not count', async () => {
            await JobRun.create({ jobName: 'hoops-live', status: 'running', startedAt: minutesAgo(0) });
            const res = await request(app).get('/standings/last-updated?league=hoops-league');
            expect(res.body.running).toBe(false);
        });
    });
});
