// /standings/last-updated reports `running` so the badge's mascot can bounce while
// a scoring job is in flight. The trap is a crashed job: its JobRun row stays
// 'running' until the 60-day TTL reaps it, so the route only counts runs started
// inside a recent window. Without that window, one crash would leave every
// manager's mascot bouncing for two months.

const express = require('express');
const request = require('supertest');
const { useMongo } = require('./helpers/mongo');
const JobRun = require('../models/jobRun');
const standingsRouter = require('../routes/standings');

const app = express();
app.use('/standings', standingsRouter);

useMongo();

const minutesAgo = m => new Date(Date.now() - m * 60 * 1000);

async function lastSuccess() {
    await JobRun.create({ jobName: 'daily-scores', status: 'success', startedAt: minutesAgo(60), finishedAt: minutesAgo(58), week: 7 });
}

describe('GET /standings/last-updated running flag', () => {
    test('no scoring job in flight → running: false', async () => {
        await lastSuccess();
        const res = await request(app).get('/standings/last-updated');
        expect(res.status).toBe(200);
        expect(res.body.week).toBe(7);
        expect(res.body.running).toBe(false);
    });

    test('a scoring job started a minute ago → running: true', async () => {
        await lastSuccess();
        await JobRun.create({ jobName: 'saturday-scores', status: 'running', startedAt: minutesAgo(1) });
        const res = await request(app).get('/standings/last-updated');
        expect(res.body.running).toBe(true);
        // The "data as of" time still comes from the last SUCCESSFUL run.
        expect(res.body.week).toBe(7);
    });

    test('a run stuck at running from hours ago (a crash) does not count', async () => {
        await lastSuccess();
        await JobRun.create({ jobName: 'saturday-scores', status: 'running', startedAt: minutesAgo(180) });
        const res = await request(app).get('/standings/last-updated');
        expect(res.body.running).toBe(false);
    });

    test('just past the 15-minute window does not count', async () => {
        await lastSuccess();
        await JobRun.create({ jobName: 'daily-scores', status: 'running', startedAt: minutesAgo(20) });
        const res = await request(app).get('/standings/last-updated');
        expect(res.body.running).toBe(false);
    });

    // The live poller writes a 'running' row on every 10s game-day tick. The badge
    // reads the flag once per page load, so a load that landed mid-tick would say
    // "scoring in progress" long after that tick finished.
    test('a live-poller tick in flight does not count', async () => {
        await lastSuccess();
        await JobRun.create({ jobName: 'live-scores', status: 'running', startedAt: minutesAgo(0) });
        const res = await request(app).get('/standings/last-updated');
        expect(res.body.running).toBe(false);
    });

    test('a non-scoring job in flight does not count', async () => {
        await lastSuccess();
        await JobRun.create({ jobName: 'update-enrichment', status: 'running', startedAt: minutesAgo(1) });
        const res = await request(app).get('/standings/last-updated');
        expect(res.body.running).toBe(false);
    });

    test('no successful run ever → null, even while one is running', async () => {
        await JobRun.create({ jobName: 'daily-scores', status: 'running', startedAt: minutesAgo(1) });
        const res = await request(app).get('/standings/last-updated');
        expect(res.body).toBeNull();
    });
});
