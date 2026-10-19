// The 60 s per-process cache in front of GET /standings/projections
// (routes/standings.js cachedProjection), for both sports.
//
// The answer is a function of league + season, so the cache key must hold
// both: a key missing either hands one league (or season) another's answer.
// And a failed computation must not be cached, or one transient Mongo error
// pins a 500 on Standings for a minute.
//
// Seam: franchiseRepo.projectionManagers is the first read of BOTH sports'
// computations. Spying on it counts the computations, and an empty answer
// short-circuits each sport to { league, season, managers: [] } — which
// echoes the league and season it was computed for, so a collision shows in
// the body too. No production code changes.

const express = require('express');
const request = require('supertest');
const { useMongo } = require('./helpers/mongo');
const League = require('../models/league');
const SportSeason = require('../models/sportSeason');
const seasons = require('../modules/active-season');
const franchiseRepo = require('../modules/franchise-repo');

const FOOTBALL = 'graham-league';
const CLAUNTS = 'claunts-league';   // a second FOOTBALL league: a sport + season key would merge it with graham-league
const HOOPS = 'hoops-league';
const router = require('../routes/standings');
const app = express();
app.use('/standings', router);

useMongo();

let spy;
beforeEach(async () => {
    await League.create({ code: HOOPS, name: 'Hardwood Heroes', sport: 'basketball' });
    await SportSeason.create([{ sport: 'football', season: 2026, status: 'in-season' }, { sport: 'basketball', season: 2027, status: 'in-season' }]);
    await seasons.prime();
    router.projectionCache.enabled = true;
    router.projectionCache.entries.clear();
    spy = jest.spyOn(franchiseRepo, 'projectionManagers').mockResolvedValue([]);
});
afterEach(() => {
    router.projectionCache.enabled = false;
    router.projectionCache.entries.clear();
    seasons._reset();
    jest.restoreAllMocks();
});

const get = (league, season) => request(app).get(`/standings/projections/${league}/${season}`);

test('the fixture routes each league to its own sport', () => {
    expect(seasons.sportForLeague(HOOPS)).toBe('basketball');
    expect(seasons.sportForLeague(FOOTBALL)).toBe('football');
    expect(seasons.sportForLeague(CLAUNTS)).toBe('football');
});

test('the key holds league AND season: no two of them share an answer', async () => {
    // Two football leagues in one season (Graham and Claunts must never share
    // a projection), both sports, two seasons — and a pair whose league and
    // season run together into the same string ('graham-league' + 226 vs
    // 'graham-league2' + 26), which only a separator in the key keeps apart.
    const pairs = [[FOOTBALL, 2026], [CLAUNTS, 2026], [HOOPS, 2026], [FOOTBALL, 2027], [CLAUNTS, 2027], [HOOPS, 2027],
        [FOOTBALL, 226], [`${FOOTBALL}2`, 26]];
    for (const [league, season] of pairs) {
        const res = await get(league, season);
        expect(res.status).toBe(200);
        expect(res.body).toEqual({ league, season, managers: [] });
    }
    expect(spy).toHaveBeenCalledTimes(pairs.length);
    // ...and each one is still cached under its own key.
    for (const [league, season] of pairs) {
        expect((await get(league, season)).body).toEqual({ league, season, managers: [] });
    }
    expect(spy).toHaveBeenCalledTimes(pairs.length);
});

describe.each([['football', FOOTBALL, 2026], ['basketball', HOOPS, 2027]])('%s', (sport, league, season) => {
    test('a failed projection is not cached: the next request recomputes', async () => {
        spy.mockRejectedValueOnce(new Error('transient read failure'));
        const failed = await get(league, season);
        expect(failed.status).toBe(500);
        expect(failed.body.message).toBe('transient read failure');
        const next = await get(league, season);
        expect(next.status).toBe(200);
        expect(next.body).toEqual({ league, season, managers: [] });
        expect(spy).toHaveBeenCalledTimes(2);
    });

    test('a successful projection IS cached (the rejection test is not passing for want of a cache)', async () => {
        await get(league, season);
        await get(league, season);
        expect(spy).toHaveBeenCalledTimes(1);
    });
});
