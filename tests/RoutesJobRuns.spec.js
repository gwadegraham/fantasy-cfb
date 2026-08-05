// HTTP-level tests for routes/jobRuns.js. The router is mounted on a bare
// Express app (no Auth0 — the server's auth tiers are unit-tested separately in
// Permissions.spec.js) backed by an in-memory Mongo, so these exercise the real
// handlers, real validation, and real DB reads/writes end to end.

const express = require('express');
const request = require('supertest');
const mongoose = require('mongoose');
const { useMongo } = require('./helpers/mongo');
const JobRun = require('../models/jobRun');
const jobRunsRouter = require('../routes/jobRuns');

const app = express();
app.use(express.json());
app.use('/job-runs', jobRunsRouter);

useMongo();

describe('GET /job-runs', () => {
    test('returns an empty array when nothing has run', async () => {
        const res = await request(app).get('/job-runs');
        expect(res.status).toBe(200);
        expect(res.body).toEqual([]);
    });

    test('reduces history to the latest run per job', async () => {
        await JobRun.create([
            { jobName: 'scoring', status: 'error', startedAt: new Date('2025-09-01T10:00:00Z') },
            { jobName: 'scoring', status: 'success', startedAt: new Date('2025-09-08T10:00:00Z') }, // newer
            { jobName: 'enrichment', status: 'success', startedAt: new Date('2025-09-05T10:00:00Z') }
        ]);
        const res = await request(app).get('/job-runs');
        expect(res.status).toBe(200);
        expect(res.body).toHaveLength(2);   // one per distinct job
        const scoring = res.body.find(r => r.jobName === 'scoring');
        expect(scoring.status).toBe('success');   // the newer run wins
    });
});

describe('POST /job-runs', () => {
    test('rejects a body with no jobName (400)', async () => {
        const res = await request(app).post('/job-runs').send({ season: '2025' });
        expect(res.status).toBe(400);
        expect(res.body.message).toMatch(/jobName is required/);
    });

    test('records a new running job (201) and persists it', async () => {
        const res = await request(app).post('/job-runs').send({ jobName: 'scoring', season: '2025', week: 3 });
        expect(res.status).toBe(201);
        expect(res.body._id).toBeDefined();
        expect(res.body.status).toBe('running');
        expect(res.body.startedAt).toBeDefined();
        expect(await JobRun.countDocuments()).toBe(1);
    });
});

describe('PATCH /job-runs/:id', () => {
    test('finishes a run: sets outcome, message, and finishedAt', async () => {
        const created = await request(app).post('/job-runs').send({ jobName: 'scoring' });
        const id = created.body._id;
        const res = await request(app).patch(`/job-runs/${id}`).send({ status: 'success', message: 'done', week: 4 });
        expect(res.status).toBe(200);
        expect(res.body.status).toBe('success');
        expect(res.body.message).toBe('done');
        expect(res.body.week).toBe(4);
        expect(res.body.finishedAt).toBeDefined();
    });

    test('404s when the run id does not exist', async () => {
        const ghostId = new mongoose.Types.ObjectId().toString();
        const res = await request(app).patch(`/job-runs/${ghostId}`).send({ status: 'success' });
        expect(res.status).toBe(404);
    });

    test('400s on a malformed id', async () => {
        const res = await request(app).patch('/job-runs/not-an-object-id').send({ status: 'success' });
        expect(res.status).toBe(400);
    });
});
