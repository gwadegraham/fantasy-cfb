// What a NEW draft starts at, per sport (#320).
//
// The numbers are not arbitrary and the comments in modules/draft-defaults.js
// carry the measurement. What is tested here is that they REACH a new draft,
// and — more importantly — that they never overwrite a draft that already
// exists, because a commissioner who deliberately uncapped a pool must keep
// it.

const express = require('express');
const request = require('supertest');
const { useMongo } = require('./helpers/mongo');
const { draftDefaultsFor, BY_SPORT } = require('../modules/draft-defaults');
const Draft = require('../models/draft');
const League = require('../models/league');
const SportSeason = require('../models/sportSeason');
const seasons = require('../modules/active-season');

const HOOPS = 'hoops-league';
const BALL = 'graham-league';
const HOOPS_SEASON = 2027;
const BALL_SEASON = 2026;

describe('the defaults themselves', () => {
    test('basketball starts capped, football does not', () => {
        expect(draftDefaultsFor('basketball')).toEqual({ snake: true, totalRounds: 10, poolSize: 120 });
        expect(draftDefaultsFor('football')).toEqual({ snake: true, totalRounds: 10, poolSize: null });
    });

    test('an unknown sport gets football’s', () => {
        expect(draftDefaultsFor('curling')).toEqual(draftDefaultsFor('football'));
        expect(draftDefaultsFor(undefined)).toEqual(draftDefaultsFor('football'));
    });

    test('a caller cannot mutate them for everyone else', () => {
        const a = draftDefaultsFor('basketball');
        a.poolSize = 1;
        expect(draftDefaultsFor('basketball').poolSize).toBe(120);
        expect(BY_SPORT.basketball.poolSize).toBe(120);
    });

    test('the pool is big enough that no round is forced', () => {
        // #320's actual worry: 10 managers x 12 rounds is exactly 120 and
        // empties the pool on the final pick. At the sizes in play — 6 or 8
        // managers, 10 rounds — there are 40+ teams still on the board.
        const { totalRounds, poolSize } = draftDefaultsFor('basketball');
        for (const managers of [6, 8]) {
            expect(poolSize - managers * totalRounds).toBeGreaterThanOrEqual(40);
        }
        // And it would still hold if the league went to 12 rounds.
        expect(poolSize - 8 * 12).toBeGreaterThan(0);
    });
});

describe('POST /draft applies them', () => {
    useMongo();

    const app = (() => {
        const a = express();
        a.use(express.json());
        a.use((req, res, next) => {
            const user = { user_metadata: { roles: ['Admin'], metadata: { league: 'gg', userId: 'a' } } };
            req.oidc = { isAuthenticated: () => true, user };
            req.effUser = user;
            next();
        });
        a.use('/draft', require('../routes/draft'));
        return a;
    })();

    beforeEach(async () => {
        await League.create([
            { code: HOOPS, name: 'Hardwood Heroes', sport: 'basketball' },
            { code: BALL, name: 'Football', sport: 'football' }
        ]);
        await SportSeason.create([
            { sport: 'football', season: BALL_SEASON, status: 'in-season' },
            { sport: 'basketball', season: HOOPS_SEASON, status: 'preseason' }
        ]);
        await seasons.prime();
    });
    afterEach(() => seasons._reset());

    // POST /draft, not /draft/settings — the route the admin form uses.
    const save = (league, season, body = {}) =>
        request(app).post('/draft').send(Object.assign({ league, season, draftOrder: [] }, body));

    test('a NEW basketball draft is capped at 120 and 10 rounds', async () => {
        const res = await save(HOOPS, HOOPS_SEASON);
        expect(res.status).toBe(200);
        const d = await Draft.findOne({ league: HOOPS, season: HOOPS_SEASON }).lean();
        expect(d.poolSize).toBe(120);
        expect(d.totalRounds).toBe(10);
        expect(d.snake).toBe(true);
    });

    test('a NEW football draft is left uncapped', async () => {
        await save(BALL, BALL_SEASON);
        const d = await Draft.findOne({ league: BALL, season: BALL_SEASON }).lean();
        expect(d.poolSize).toBeNull();
    });

    test('an explicit pool size wins over the default', async () => {
        await save(HOOPS, HOOPS_SEASON, { poolSize: 90 });
        expect((await Draft.findOne({ league: HOOPS }).lean()).poolSize).toBe(90);
    });

    test('and an explicit UNCAP is honoured, not re-defaulted', async () => {
        // The distinction the route is built around: an absent poolSize and
        // a deliberately empty one are different inputs.
        await save(HOOPS, HOOPS_SEASON, { poolSize: '' });
        expect((await Draft.findOne({ league: HOOPS }).lean()).poolSize).toBeNull();
    });

    test('re-saving an uncapped draft does NOT put the cap back', async () => {
        // $setOnInsert, so the default only ever reaches a draft that did
        // not exist. A commissioner who uncapped a pool keeps it, however
        // many times the settings form is saved afterwards.
        await save(HOOPS, HOOPS_SEASON, { poolSize: '' });
        await save(HOOPS, HOOPS_SEASON);                  // no poolSize key at all
        expect((await Draft.findOne({ league: HOOPS }).lean()).poolSize).toBeNull();
    });

    test('re-saving does not reset the rounds either', async () => {
        await save(HOOPS, HOOPS_SEASON, { totalRounds: 12 });
        await save(HOOPS, HOOPS_SEASON, { totalRounds: 12 });
        expect((await Draft.findOne({ league: HOOPS }).lean()).totalRounds).toBe(12);
    });
});
