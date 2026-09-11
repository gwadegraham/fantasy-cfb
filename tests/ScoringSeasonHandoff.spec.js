// The season travels with a scoring write.
//
// modules/scoring.js resolves the season once per pass. That fixes only the
// SENDING half: every score is written by PATCH /users/:id over HTTP to the
// app's own public hostname, so it lands on whichever dyno the router picks,
// and each dyno re-primes its season cache on its own 60s phase. If the
// receiving side re-derives the season independently, a rollover mid-pass files
// 2026-derived scores under 2027 — or 404s every write.
//
// So the write carries the season, and getUser honours it. These tests drive
// the real route against real Mongo with the server's own cache pointed at a
// DIFFERENT season, which is exactly the skew being defended against.

const express = require('express');
const request = require('supertest');
const { useMongo } = require('./helpers/mongo');
const User = require('../models/user');
const SportSeason = require('../models/sportSeason');
const activeSeason = require('../modules/active-season');
const usersRouter = require('../routes/users');

const app = express();
app.use(express.json());
app.use('/users', usersRouter);

useMongo();

let userId;

beforeEach(async () => {
    activeSeason._reset();
    jest.spyOn(console, 'error').mockImplementation(() => {});
    jest.spyOn(console, 'log').mockImplementation(() => {});

    const user = await User.create({
        firstName: 'Garrett', lastName: 'Graham', league: 'graham-league',
        seasons: [
            { season: 2026, cumulativeScore: 0, weeklyScore: [] },
            { season: 2027, cumulativeScore: 0, weeklyScore: [] }
        ]
    });
    userId = String(user._id);

    // This dyno has already rolled over; the scoring pass has not.
    await SportSeason.create({ sport: 'football', season: 2027, status: 'in-season' });
    await activeSeason.prime();
});

afterEach(() => jest.restoreAllMocks());

const seasonEntry = async (year) => {
    const doc = await User.findById(userId).lean();
    return doc.seasons.find(s => s.season === year);
};

test('a write naming 2026 lands in 2026, even though this dyno says 2027', async () => {
    const res = await request(app).patch(`/users/${userId}`)
        .send({ cumulativeScore: 123, isUpdated: true, season: 2026 });
    expect(res.status).toBe(200);

    expect((await seasonEntry(2026)).cumulativeScore).toBe(123);
    // The whole point: the dyno's own view must not capture the write.
    expect((await seasonEntry(2027)).cumulativeScore).toBe(0);
});

test('the same for weeklyScore, which is the bulk of a scoring pass', async () => {
    const week = [{ week: 1, score: 17, season: 'regular', scoreByTeam: [] }];
    const res = await request(app).patch(`/users/${userId}`)
        .send({ weeklyScore: week, isUpdated: true, season: 2026 });
    expect(res.status).toBe(200);

    expect((await seasonEntry(2026)).weeklyScore).toHaveLength(1);
    expect((await seasonEntry(2027)).weeklyScore).toHaveLength(0);
});

test('accepts the season as a string, as JSON round-trips sometimes make it', async () => {
    const res = await request(app).patch(`/users/${userId}`)
        .send({ cumulativeScore: 5, season: '2026' });
    expect(res.status).toBe(200);
    expect((await seasonEntry(2026)).cumulativeScore).toBe(5);
});

test('falls back to this dyno\'s season when the caller names none', async () => {
    // Every pre-existing client (the admin UI) sends no season, and must keep
    // behaving exactly as it did.
    const res = await request(app).patch(`/users/${userId}`).send({ cumulativeScore: 77 });
    expect(res.status).toBe(200);
    expect((await seasonEntry(2027)).cumulativeScore).toBe(77);
    expect((await seasonEntry(2026)).cumulativeScore).toBe(0);
});

test('ignores a junk season rather than writing nowhere', async () => {
    const res = await request(app).patch(`/users/${userId}`)
        .send({ cumulativeScore: 9, season: 'soon' });
    expect(res.status).toBe(200);
    expect((await seasonEntry(2027)).cumulativeScore).toBe(9);
});

test('404s naming a season the manager does not have, instead of writing elsewhere', async () => {
    const res = await request(app).patch(`/users/${userId}`)
        .send({ cumulativeScore: 1, season: 2024 });
    expect(res.status).toBe(404);
    expect(res.body.message).toMatch(/season 2024/);
    expect((await seasonEntry(2026)).cumulativeScore).toBe(0);
    expect((await seasonEntry(2027)).cumulativeScore).toBe(0);
});
