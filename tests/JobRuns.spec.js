const express = require('express');
const request = require('supertest');
const { useMongo } = require('./helpers/mongo');
const JobRun = require('../models/jobRun');
const { latestPerJob } = require('../modules/job-runs-util');

describe('latestPerJob', () => {
    it('returns the most recent run for each job', () => {
        const runs = [
            { jobName: 'daily-scores', startedAt: '2025-01-03T05:00:00Z', status: 'success' },
            { jobName: 'daily-scores', startedAt: '2025-01-02T05:00:00Z', status: 'error' },
            { jobName: 'saturday-scores', startedAt: '2025-01-04T20:00:00Z', status: 'success' }
        ];
        const latest = latestPerJob(runs);
        expect(latest).toHaveLength(2);
        const daily = latest.find(r => r.jobName === 'daily-scores');
        expect(daily.startedAt).toBe('2025-01-03T05:00:00Z');
        expect(daily.status).toBe('success');
    });

    it('handles empty / malformed input', () => {
        expect(latestPerJob([])).toEqual([]);
        expect(latestPerJob(undefined)).toEqual([]);
        expect(latestPerJob([{ startedAt: '2025-01-01' }])).toEqual([]); // no jobName -> skipped
    });
});

// The endpoint behind the admin page's "Automated jobs" strip. The bug these
// cover: it used to pull the 200 newest runs and reduce THOSE to the latest per
// job. The live poller writes a run every 10 seconds while games are live, so
// 200 rows is roughly half an hour of a Saturday — every weekly job fell out of
// the window and vanished from the page. Against a copy of prod, all 7 jobs had
// runs recorded and the strip showed 2.
describe('GET /job-runs', () => {
    const app = express();
    app.use(express.json());
    app.use('/job-runs', require('../routes/jobRuns'));

    useMongo();

    it('still reports a weekly job buried under thousands of live-poller runs', async () => {
        const base = Date.parse('2026-09-15T10:30:00Z');
        await JobRun.create({ jobName: 'enrichment', status: 'success', startedAt: new Date(base) });
        // Newer than the weekly run, and far more numerous than any row cap.
        await JobRun.insertMany(Array.from({ length: 500 }, (_, i) => ({
            jobName: 'live-scores', status: 'success', startedAt: new Date(base + 60000 + i * 10000)
        })));

        const res = await request(app).get('/job-runs');

        expect(res.status).toBe(200);
        const names = res.body.map(r => r.jobName).sort();
        expect(names).toEqual(['enrichment', 'live-scores']);
    });

    it('returns exactly one row per job — the newest, with its outcome', async () => {
        await JobRun.create([
            { jobName: 'season-stats', status: 'error', startedAt: new Date('2026-09-08T11:00:00Z') },
            { jobName: 'season-stats', status: 'success', startedAt: new Date('2026-09-15T11:00:00Z') }
        ]);

        const res = await request(app).get('/job-runs');

        expect(res.body).toHaveLength(1);
        expect(res.body[0]).toMatchObject({ jobName: 'season-stats', status: 'success' });
    });

    it('answers an empty list when nothing has run', async () => {
        const res = await request(app).get('/job-runs');
        expect(res.status).toBe(200);
        expect(res.body).toEqual([]);
    });
});
